// src/utils/sessionQueueManager.js

/**
 * Session Queue + Attendees + Hyra priority
 *
 * Exports:
 *   - openQueueForCard({ client, trelloCardUrl })
 *       -> returns { ok: true, message?: string } on success
 *         or { ok: false, message: string } on failure
 *
 *   - handleQueueButtonInteraction(interaction)
 *
 * Flow:
 *   1) /sessionqueue trelloLink
 *      -> openQueueForCard()
 *      -> validates card on Trello
 *      -> posts Queue message in the correct channel with buttons
 *      -> starts a timer to auto-close the queue at (due - 15min)
 *
 *   2) Staff click role buttons:
 *      -> handleQueueButtonInteraction()
 *      -> adds/removes them from the in-memory queue (per card + role)
 *
 *   3) When queue closes:
 *      -> we fetch weekly session counts from Hyra
 *      -> for each role: sort by [sessionCount ASC, joinOrder ASC]
 *      -> pick up to capacity
 *      -> post Attendees list (plain message + ping)
 */

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const { trelloRequest } = require('./trelloClient');
const { getWeeklySessionCounts } = require('./hyraClient');

// ===== CONFIG: CHANNELS & PINGS =====

const QUEUE_CHANNELS = {
  interview:
    process.env.SESSION_INTERVIEW_QUEUE_CHANNEL_ID ||
    process.env.SESSION_INTERVIEW_CHANNEL_ID ||
    '',
  training:
    process.env.SESSION_TRAINING_QUEUE_CHANNEL_ID ||
    process.env.SESSION_TRAINING_CHANNEL_ID ||
    '',
  mass_shift:
    process.env.SESSION_MASS_SHIFT_QUEUE_CHANNEL_ID ||
    process.env.SESSION_MASS_SHIFT_CHANNEL_ID ||
    '',
};

// We post attendees in the same place by default, but you can override.
const ATTENDEE_CHANNELS = {
  interview:
    process.env.SESSION_INTERVIEW_ATTENDEES_CHANNEL_ID ||
    QUEUE_CHANNELS.interview,
  training:
    process.env.SESSION_TRAINING_ATTENDEES_CHANNEL_ID ||
    QUEUE_CHANNELS.training,
  mass_shift:
    process.env.SESSION_MASS_SHIFT_ATTENDEES_CHANNEL_ID ||
    QUEUE_CHANNELS.mass_shift,
};

const QUEUE_PING_ROLES = {
  interview: process.env.SESSION_INTERVIEW_PING_ROLE_ID || '',
  training: process.env.SESSION_TRAINING_PING_ROLE_ID || '',
  mass_shift: process.env.SESSION_MASS_SHIFT_PING_ROLE_ID || '',
};

// ===== ROLE CAPACITY CONFIG =====

const ROLE_CAPACITY = {
  interview: {
    cohost: 1,
    overseer: 1,
    interviewer: 12,
    spectator: 4,
  },
  training: {
    cohost: 1,
    overseer: 1,
    supervisor: 4, // Supervisor (4)
    trainer: 8,
    spectator: 4,
  },
  mass_shift: {
    cohost: 1,
    overseer: 1,
    attendee: 15,
  },
};

// ===== IN-MEMORY QUEUE STATE =====

/**
 * activeQueues: Map<cardId, QueueState>
 *
 * QueueState shape:
 * {
 *   cardId: string,
 *   sessionType: 'interview' | 'training' | 'mass_shift',
 *   trelloUrl: string,
 *   hostTag: string,
 *   hostId: string,
 *   dueUnix: number,
 *   queueMessageId: string,
 *   queueChannelId: string,
 *   closed: boolean,
 *   closeTimeout: Timeout | null,
 *   joinedAtCounter: number,
 *   roles: {
 *     [roleKey: string]: Array<{
 *       userId: string,
 *       username: string,
 *       joinedAtIndex: number,
 *     }>
 *   }
 * }
 */
const activeQueues = new Map();

// ===== TRELLO HELPERS =====

function parseCardIdFromInput(option) {
  if (!option) return null;

  const trimmed = option.trim();
  console.log('[QUEUE] Raw card option:', trimmed);

  // Full Trello URL: https://trello.com/c/SHORTID/...
  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split('/').filter(Boolean);
    // Expect ["c", "SHORTID", ...]
    if (parts.length >= 2 && parts[0] === 'c') {
      return parts[1];
    }
  } catch {
    // Not a URL, ignore
  }

  // If they just paste the short ID directly, accept 8-character style
  if (/^[a-zA-Z0-9]{8}$/.test(trimmed)) {
    return trimmed;
  }

  console.warn('[QUEUE] Could not parse Trello card id from:', trimmed);
  return null;
}

function detectSessionType(card) {
  const name = (card.name || '').toLowerCase();

  if (name.startsWith('[interview]')) return 'interview';
  if (name.startsWith('[training]')) return 'training';
  if (name.startsWith('[mass shift]') || name.startsWith('[mass_shift]')) {
    return 'mass_shift';
  }

  return null;
}

function parseHostFromDesc(desc) {
  // We set desc as:
  //   Session Type: ...
  //   Host: SomeUser#0000 (1234567890)
  if (!desc) return { hostTag: 'Unknown Host', hostId: '' };

  const lines = desc.split('\n').map(l => l.trim());
  const hostLine = lines.find(l => l.toLowerCase().startsWith('host:'));
  if (!hostLine) return { hostTag: 'Unknown Host', hostId: '' };

  // Remove "Host: " prefix
  const after = hostLine.slice(5).trim();

  // Try to grab "(ID)" at end
  const match = after.match(/\((\d+)\)\s*$/);
  if (match) {
    const id = match[1];
    const tag = after.replace(/\(\d+\)\s*$/, '').trim();
    return { hostTag: tag, hostId: id };
  }

  return { hostTag: after, hostId: '' };
}

function isoToDiscordTimestamps(iso) {
  if (!iso) return { unix: null, rel: 'N/A', time: 'N/A' };

  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return { unix: null, rel: 'N/A', time: 'N/A' };

  const unix = Math.floor(ms / 1000);
  return {
    unix,
    rel: `<t:${unix}:R>`,
    time: `<t:${unix}:t>`,
  };
}

// ===== MESSAGE BUILDERS =====

function buildQueueHeaderLine(sessionType, hostTag, timeStr) {
  if (sessionType === 'interview') {
    return `🟡 INTERVIEW | ${hostTag} | ${timeStr} 🟡`;
  }
  if (sessionType === 'training') {
    return `🔴 TRAINING | ${hostTag} | ${timeStr} 🔴`;
  }
  return `🟣 MASS SHIFT | ${hostTag} | ${timeStr} 🟣`;
}

function buildQueueBodyText(sessionType, hostTag, dueIso, trelloUrl) {
  const { rel, time } = isoToDiscordTimestamps(dueIso);

  const prettyTime =
    time === 'N/A' ? 'TIME' : time.replace(/^<t:\d+:t>$/, 'TIME');
  const titleLine = buildQueueHeaderLine(
    sessionType,
    hostTag || 'HOST',
    prettyTime
  );

  const baseLines = [
    '╔══════════════════════════════════════╗',
    ` ${titleLine}`,
    '╚══════════════════════════════════════╝',
    '',
    `📌 Host: ${hostTag}`,
    `📌 Starts: ${rel}`,
    `📌 Time: ${time}`,
    '',
    '💠 ROLES 💠',
    '----------------------------------------------------------------',
  ];

  if (sessionType === 'interview') {
    baseLines.push(
      'ℹ️  **Co-Host:** Corporate Intern+',
      'ℹ️  **Overseer:** Executive Manager+',
      'ℹ️  **Interviewer (12):** Leadership Intern+',
      'ℹ️  **Spectator (4):** Leadership Intern+'
    );
  } else if (sessionType === 'training') {
    baseLines.push(
      'ℹ️  **Co-Host:** Corporate Intern+',
      'ℹ️  **Overseer:** Executive Manager+',
      'ℹ️  **Supervisor (4):** Supervisor+',
      'ℹ️  **Trainer (8):** Leadership Intern+',
      'ℹ️  **Spectator (4):** Leadership Intern+'
    );
  } else {
    // mass_shift
    baseLines.push(
      'ℹ️  **Co-Host:** Corporate Intern+',
      'ℹ️  **Overseer:** Executive Manager+',
      'ℹ️  **Attendee:** Leadership Intern+'
    );
  }

  baseLines.push(
    '',
    '❓  HOW TO JOIN THE QUEUE ❓',
    '----------------------------------------------------------------',
    '- Check the role list above — if your rank is allowed, press the role button you want.',
    "- You’ll get a private message that says you were added to that role's queue.",
    '- Do NOT join until you are pinged in **Session Attendees** before the session starts.',
    '',
    '❓ HOW TO LEAVE THE QUEUE / INFORM LATE ARRIVAL ❓',
    '----------------------------------------------------------------',
    '- Click the **Leave Queue** button once you have joined a role.',
    '- After the attendees post is made, changes must be handled by the host/corporate manually.',
    '',
    '----------------------------------------------------------------',
    '╭─────── 💠 LINKS 💠 ───────────╮',
    `• Trello Card: ${trelloUrl}`,
    '╰─────────────────────────────╯'
  );

  return baseLines.join('\n');
}

function buildQueueButtons(sessionType, cardId) {
  const buttons = [];

  if (sessionType === 'interview') {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`queue:${cardId}:cohost`)
        .setLabel('Co-Host')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`queue:${cardId}:overseer`)
        .setLabel('Overseer')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`queue:${cardId}:interviewer`)
        .setLabel('Interviewer')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`queue:${cardId}:spectator`)
        .setLabel('Spectator')
        .setStyle(ButtonStyle.Secondary)
    );
  } else if (sessionType === 'training') {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`queue:${cardId}:cohost`)
        .setLabel('Co-Host')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`queue:${cardId}:overseer`)
        .setLabel('Overseer')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`queue:${cardId}:supervisor`)
        .setLabel('Supervisor')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`queue:${cardId}:trainer`)
        .setLabel('Trainer')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`queue:${cardId}:spectator`)
        .setLabel('Spectator')
        .setStyle(ButtonStyle.Secondary)
    );
  } else {
    // mass_shift
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`queue:${cardId}:cohost`)
        .setLabel('Co-Host')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`queue:${cardId}:overseer`)
        .setLabel('Overseer')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`queue:${cardId}:attendee`)
        .setLabel('Attendee')
        .setStyle(ButtonStyle.Success)
    );
  }

  const row1 = new ActionRowBuilder().addComponents(buttons.slice(0, 5));

  const leaveRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`queue:${cardId}:leave`)
      .setLabel('Leave Queue')
      .setStyle(ButtonStyle.Danger)
  );

  return [row1, leaveRow];
}

// ===== ATTENDEES MESSAGE BUILDERS (PLAIN TEXT) =====

function buildAttendeesMessage(sessionType, hostTag, picksByRole, pingRoleId) {
  let lines = [];

  if (sessionType === 'interview') {
    lines.push(
      '╔══════════════════════════════════════╗',
      '                              ✅  SELECTED ATTENDEES ✅',
      '╚══════════════════════════════════════╝',
      '',
      `🧊 Host: ${hostTag}`,
      `🧊 Co-Host: ${formatSingle(picksByRole.cohost)}`,
      `🧊 Overseer: ${formatSingle(picksByRole.overseer)}`,
      '',
      '────────────',
      '',
      '🟡  Interviewers 🟡'
    );

    lines = lines.concat(formatNumberedList(picksByRole.interviewer, 12));

    lines.push('', '────────────', '', '⚪  Spectators ⚪');
    lines = lines.concat(formatNumberedList(picksByRole.spectator, 4));
  } else if (sessionType === 'training') {
    lines.push(
      '╔══════════════════════════════════════╗',
      '                              ✅  SELECTED ATTENDEES ✅',
      '╚══════════════════════════════════════╝',
      '',
      `🧊 Host: ${hostTag}`,
      `🧊 Co-Host: ${formatSingle(picksByRole.cohost)}`,
      `🧊 Overseer: ${formatSingle(picksByRole.overseer)}`,
      `🧊 Supervisor: ${formatSingle(picksByRole.supervisor)}`,
      '',
      '────────────',
      '',
      '🔴  Trainers 🔴'
    );

    lines = lines.concat(formatNumberedList(picksByRole.trainer, 8));

    lines.push('', '────────────', '', '⚪  Spectators ⚪');
    lines = lines.concat(formatNumberedList(picksByRole.spectator, 4));
  } else {
    // mass_shift
    lines.push(
      '╔══════════════════════════════════════╗',
      '                              ✅  SELECTED ATTENDEES ✅',
      '╚══════════════════════════════════════╝',
      '',
      `🧊 Host: ${hostTag}`,
      `🧊 Co-Host: ${formatSingle(picksByRole.cohost)}`,
      `🧊 Overseer: ${formatSingle(picksByRole.overseer)}`,
      '',
      '────────────',
      '',
      '🟣  Attendees  🟣'
    );

    lines = lines.concat(formatNumberedList(picksByRole.attendee, 15));
  }

  lines.push(
    '',
    '🧊 You should now join! Please join within **5 minutes**, or your spot will be given to someone else.',
    '🧊 Failure to join on time will result in a **written warning**. :('
  );

  const ping = pingRoleId ? `<@&${pingRoleId}>` : '';
  return ping ? `${ping}\n\n${lines.join('\n')}` : lines.join('\n');
}

function formatSingle(arr) {
  if (!arr || !arr.length) return 'N/A';
  const u = arr[0];
  return `<@${u.userId}>`;
}

function formatNumberedList(arr, maxCount) {
  const lines = [];
  const picks = arr || [];
  for (let i = 0; i < maxCount; i++) {
    const spot = i + 1;
    const u = picks[i];
    if (u) {
      lines.push(`${spot}. <@${u.userId}>`);
    } else {
      lines.push(`${spot}.`);
    }
  }
  return lines;
}

// ===== CORE: OPEN QUEUE (NO INTERACTION HERE) =====

async function openQueueForCard({ client, trelloCardUrl }) {
  const cardId = parseCardIdFromInput(trelloCardUrl);
  if (!cardId) {
    return {
      ok: false,
      message:
        'I could not open a queue for that Trello card.\n• Make sure the link is valid\n• The card has the correct session labels or [Interview], [Training], [Mass Shift] in the name\n• The queue channels/roles are configured in SESSION_* and QUEUE_* env vars.',
    };
  }

  // Load card from Trello
  const cardRes = await trelloRequest(`/cards/${cardId}`, 'GET', {
    fields: 'name,desc,due,idList,shortUrl,url',
  });

  if (!cardRes.ok || !cardRes.data) {
    console.error(
      '[QUEUE] Failed to fetch Trello card',
      cardId,
      cardRes.status,
      cardRes.data
    );
    return {
      ok: false,
      message:
        'I could not load that Trello card from Trello. Please check the link.',
    };
  }

  const card = cardRes.data;
  const sessionType = detectSessionType(card);

  if (!sessionType) {
    return {
      ok: false,
      message:
        'I could not determine the session type from that card.\nMake sure the name starts with [Interview], [Training], or [Mass Shift].',
    };
  }

  const queueChannelId = QUEUE_CHANNELS[sessionType];
  if (!queueChannelId) {
    console.log('[QUEUE] Missing channel config for session type:', sessionType);
    return {
      ok: false,
      message:
        'I could not open a queue for that Trello card.\n• Make sure the link is valid\n• The card has the correct session labels or [Interview], [Training], [Mass Shift] in the name\n• The queue channels/roles are configured in SESSION_* and QUEUE_* env vars.',
    };
  }

  const queueChannel = await client.channels.fetch(queueChannelId).catch(() => null);
  if (!queueChannel || !queueChannel.isTextBased()) {
    console.error(
      '[QUEUE] Configured queue channel is invalid or not text-based:',
      queueChannelId
    );
    return {
      ok: false,
      message:
        'The configured queue channel is invalid or not text-based. Please check the env vars.',
    };
  }

  const { hostTag, hostId } = parseHostFromDesc(card.desc || '');
  const dueInfo = isoToDiscordTimestamps(card.due);
  const trelloUrl = card.shortUrl || card.url || trelloCardUrl;

  // Build queue message
  const bodyText = buildQueueBodyText(sessionType, hostTag, card.due, trelloUrl);
  const components = buildQueueButtons(sessionType, cardId);
  const pingRoleId = QUEUE_PING_ROLES[sessionType];
  const ping = pingRoleId ? `<@&${pingRoleId}>` : '';

  const msg = await queueChannel.send({
    content: ping ? `${ping}\n\n${bodyText}` : bodyText,
    components,
  });

  // Set up queue state
  const nowMs = Date.now();
  const dueMs = dueInfo.unix ? dueInfo.unix * 1000 : nowMs + 30 * 60 * 1000;

  // Close at due - 15 minutes
  const closeAtMs = dueMs - 15 * 60 * 1000;
  let delay = closeAtMs - nowMs;
  if (delay < 0) delay = 10 * 1000; // if already within 15 minutes, close in 10s

  if (activeQueues.has(cardId)) {
    // Clear any previous timer
    const existing = activeQueues.get(cardId);
    if (existing.closeTimeout) clearTimeout(existing.closeTimeout);
  }

  const queueState = {
    cardId,
    sessionType,
    trelloUrl,
    hostTag,
    hostId,
    dueUnix: dueInfo.unix,
    queueMessageId: msg.id,
    queueChannelId: msg.channel.id,
    closed: false,
    closeTimeout: null,
    joinedAtCounter: 0,
    roles: {},
  };

  // Pre-create arrays for roles in this session type
  const roleDefs = ROLE_CAPACITY[sessionType] || {};
  for (const roleKey of Object.keys(roleDefs)) {
    queueState.roles[roleKey] = [];
  }

  queueState.closeTimeout = setTimeout(() => {
    closeQueueAndPostAttendees(queueState, client).catch(err =>
      console.error('[QUEUE] Error during closeQueueAndPostAttendees:', err)
    );
  }, delay);

  activeQueues.set(cardId, queueState);

  console.log('[QUEUE] Opened queue for card', cardId, 'in channel', queueChannelId);

  return {
    ok: true,
    message: 'Queue opened successfully.',
  };
}

// ===== HANDLE BUTTON INTERACTIONS =====

async function handleQueueButtonInteraction(interaction) {
  if (!interaction.isButton()) return false;

  const id = interaction.customId;
  if (!id.startsWith('queue:')) return false;

  const parts = id.split(':'); // queue:cardId:roleKey or queue:cardId:leave
  if (parts.length < 3) return false;

  const cardId = parts[1];
  const action = parts[2];

  const queue = activeQueues.get(cardId);
  if (!queue) {
    await interaction.reply({
      content: 'This queue is no longer active.',
      ephemeral: true,
    });
    return true;
  }

  if (queue.closed) {
    await interaction.reply({
      content: 'This queue has already been closed.',
      ephemeral: true,
    });
    return true;
  }

  if (action === 'leave') {
    await handleLeaveQueue(interaction, queue);
    return true;
  }

  // role join (cohost, overseer, interviewer, etc.)
  await handleJoinRole(interaction, queue, action);
  return true;
}

async function handleLeaveQueue(interaction, queue) {
  const userId = interaction.user.id;
  let removed = false;

  for (const [roleKey, arr] of Object.entries(queue.roles)) {
    const idx = arr.findIndex(x => x.userId === userId);
    if (idx !== -1) {
      arr.splice(idx, 1);
      removed = true;
    }
  }

  if (!removed) {
    await interaction.reply({
      content: 'You are not in this queue.',
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content: 'You have been removed from the queue.',
    ephemeral: true,
  });

  try {
    await interaction.user.send(
      `You have been removed from the queue for the session: ${queue.trelloUrl}`
    );
  } catch {
    // ignore DM failures
  }
}

async function handleJoinRole(interaction, queue, roleKey) {
  const capacities = ROLE_CAPACITY[queue.sessionType] || {};
  const capacity = capacities[roleKey];

  if (capacity === undefined) {
    await interaction.reply({
      content: 'That role is not available for this queue.',
      ephemeral: true,
    });
    return;
  }

  const userId = interaction.user.id;
  const username = interaction.user.tag;

  // Check if already in that role
  const arr = queue.roles[roleKey] || [];
  if (arr.find(x => x.userId === userId)) {
    await interaction.reply({
      content: `You are already in the **${roleKey}** queue for this session.`,
      ephemeral: true,
    });
    return;
  }

  // Ensure they are not over capacity
  if (arr.length >= capacity) {
    await interaction.reply({
      content: `The **${roleKey}** queue is currently full.`,
      ephemeral: true,
    });
    return;
  }

  // Remove them from any other role queues for this card
  for (const [rk, list] of Object.entries(queue.roles)) {
    const idx = list.findIndex(x => x.userId === userId);
    if (idx !== -1) {
      list.splice(idx, 1);
    }
  }

  queue.joinedAtCounter += 1;
  const joinedAtIndex = queue.joinedAtCounter;

  arr.push({
    userId,
    username,
    joinedAtIndex,
  });

  await interaction.reply({
    content: `You have been added to the **${roleKey}** queue for this session.`,
    ephemeral: true,
  });

  try {
    await interaction.user.send(
      `You have been added to the **${roleKey}** queue for the session: ${queue.trelloUrl}`
    );
  } catch {
    // ignore DM failures
  }
}

// ===== CLOSE QUEUE + HYRA PRIORITY + POST ATTENDEES =====

async function closeQueueAndPostAttendees(queue, client) {
  if (queue.closed) return;
  queue.closed = true;

  console.log('[QUEUE] Closing queue for card', queue.cardId);

  // Disable buttons on queue message
  try {
    const channel = await client.channels.fetch(queue.queueChannelId).catch(() => null);
    if (channel && channel.isTextBased()) {
      const msg = await channel.messages.fetch(queue.queueMessageId).catch(() => null);
      if (msg && msg.edit) {
        const disabledComponents = msg.components.map(row => {
          const newRow = ActionRowBuilder.from(row);
          newRow.components.forEach(component => {
            component.setDisabled(true);
          });
          return newRow;
        });

        await msg.edit({ components: disabledComponents });
      }
    }
  } catch (err) {
    console.error('[QUEUE] Failed to disable queue buttons:', err);
  }

  // HYRA PRIORITIZATION
  const allUserIds = new Set();
  for (const arr of Object.values(queue.roles)) {
    for (const u of arr) {
      allUserIds.add(u.userId);
    }
  }
  const allIdsArray = Array.from(allUserIds);

  let hyraCounts = {};
  try {
    hyraCounts = await getWeeklySessionCounts(allIdsArray);
  } catch (err) {
    console.error('[QUEUE] Error while fetching Hyra session counts:', err);
    hyraCounts = {};
  }

  // Build picks per role with priority:
  // - fewer sessions first
  // - tie: earlier joinedAtIndex
  const picksByRole = {};
  const capacities = ROLE_CAPACITY[queue.sessionType] || {};

  for (const [roleKey, capacity] of Object.entries(capacities)) {
    const candidates = (queue.roles[roleKey] || []).slice();

    candidates.sort((a, b) => {
      const aCount = hyraCounts[a.userId] ?? 0;
      const bCount = hyraCounts[b.userId] ?? 0;

      if (aCount !== bCount) return aCount - bCount;
      return a.joinedAtIndex - b.joinedAtIndex;
    });

    picksByRole[roleKey] = candidates.slice(0, capacity);
  }

  // Post attendees message
  const attendeeChannelId = ATTENDEE_CHANNELS[queue.sessionType];
  if (!attendeeChannelId) {
    console.error('[QUEUE] No attendee channel configured for type', queue.sessionType);
    return;
  }

  const attendeeChannel = await client.channels.fetch(attendeeChannelId).catch(() => null);
  if (!attendeeChannel || !attendeeChannel.isTextBased()) {
    console.error('[QUEUE] Attendee channel is invalid or not text-based:', attendeeChannelId);
    return;
  }

  const pingRoleId = QUEUE_PING_ROLES[queue.sessionType] || '';
  const text = buildAttendeesMessage(queue.sessionType, queue.hostTag, picksByRole, pingRoleId);

  await attendeeChannel.send({
    content: text,
    allowedMentions: { roles: pingRoleId ? [pingRoleId] : [] },
  });

  console.log('[QUEUE] Posted attendees for card', queue.cardId);
}

// ===== EXPORTS =====

module.exports = {
  openQueueForCard,
  handleQueueButtonInteraction,
};
