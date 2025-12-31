// src/utils/sessionQueueManager.js

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');
const { trelloRequest } = require('./trelloClient');

// In-memory registry of active queues, keyed by Trello card shortId.
const queues = new Map();

// Base limits for each role; interviewer is adjusted per sessionType if needed.
const ROLE_LIMITS = {
  cohost: 1,
  overseer: 1,
  interviewer: 12, // default (Interviewers)
  spectator: 4,
  supervisor: 4,

};


// Safety hard-cap (prevents someone from creating massive queues)
const QUEUE_ROLE_HARD_CAP = Number(process.env.SESSION_QUEUE_HARD_CAP || 60);
// Optional: if you want a separate log channel, set this env var.
// Otherwise, logs fall back to the same queue channel.
const SESSION_ATTENDEES_LOG_CHANNEL_ID =
  process.env.SESSION_ATTENDEES_LOG_CHANNEL_ID || null;

/**
 * Extract Trello shortId from:
 *  - Full URL: https://trello.com/c/abcd1234/123-name
 *  - Raw shortId: abcd1234
 */
function extractShortId(cardOption) {
  if (!cardOption) return null;

  const urlMatch = cardOption.match(/trello\.com\/c\/([a-zA-Z0-9]+)/);
  if (urlMatch) return urlMatch[1];

  const idMatch = cardOption.match(/^([a-zA-Z0-9]{6,10})$/);
  if (idMatch) return idMatch[1];

  return null;
}

/**
 * Fetch full card data for a Trello shortId.
 * trelloRequest(path, method, params?)
 */
async function fetchCardByShortId(shortId) {
  try {
    const card = await trelloRequest(`/1/cards/${shortId}`, 'GET');
    if (!card) {
      console.warn(`[TRELLO] No card returned for shortId ${shortId}`);
      return null;
    }
    return card;
  } catch (error) {
    console.error('[TRELLO] API error while fetching card', error);
    return null;
  }
}

/**
 * Detect session type from card name + description.
 * Handles:
 *  - "[Interview] ...", "Session Type: Interview"
 *  - "[Training] ...", "Session Type: Training"
 *  - "[Mass Shift] ...", "Session Type: Mass Shift"
 */
function detectSessionType(cardName, cardDesc) {
  const name = (cardName || '').toLowerCase();
  const desc = (cardDesc || '').toLowerCase();
  const text = `${name}\n${desc}`;

  if (text.includes('interview')) return 'interview';
  if (text.includes('training')) return 'training';

  if (
    text.includes('mass shift') ||
    text.includes('massshift') ||
    text.includes('mass-shift') ||
    text.includes('mass  shift') ||
    text.includes(' ms ')
  ) {
    return 'massshift';
  }

  return null;
}

/**
 * Session-type configuration.
 * Mass Shift tries multiple possible env names so it’s harder to misconfigure.
 */
function getSessionConfig(sessionType) {
  if (sessionType === 'interview') {
    return {
      typeLabel: 'INTERVIEW',
      color: 0xffc107,
      queueChannelId: process.env.SESSION_QUEUECHANNEL_INTERVIEW_ID,
      pingRoleId: process.env.SESSION_QUEUE_PING_INTERVIEW_ROLE_ID,
    };
  }

  if (sessionType === 'training') {
    return {
      typeLabel: 'TRAINING',
      color: 0xf44336,
      queueChannelId: process.env.SESSION_QUEUECHANNEL_TRAINING_ID,
      pingRoleId: process.env.SESSION_QUEUE_PING_TRAINING_ROLE_ID,
    };
  }

  if (sessionType === 'massshift') {
    return {
      typeLabel: 'MASS SHIFT',
      color: 0x9c27b0,
      queueChannelId:
        process.env.SESSION_QUEUECHANNEL_MASSSHIFT_ID || // old style
        process.env.SESSION_QUEUECHANNEL_MASS_SHIFT_ID || // with underscore
        process.env.SESSION_QUEUECHANNEL_MASSHIFT_ID || // typo-safe
        null,
      pingRoleId:
        process.env.SESSION_QUEUE_PING_MASSSHIFT_ROLE_ID ||
        process.env.SESSION_QUEUE_PING_MASS_SHIFT_ROLE_ID ||
        process.env.SESSION_QUEUE_PING_MASSHIFT_ROLE_ID ||
        null,
    };
  }

  return null;
}

/**
 * Extract host from card description:
 *  "Host: name (123456789012345678)"
 * Fallback: last " - Name" part from card name.
 */
function extractHostFromDesc(desc, fallbackName) {
  if (typeof desc !== 'string') desc = '';

  const match = desc.match(/Host:\s*([^()\n]+?)\s*\(([0-9]{17,})\)/i);
  if (match) {
    return {
      hostName: match[1].trim(),
      hostId: match[2],
    };
  }

  if (fallbackName) {
    const nameMatch = fallbackName.match(/-\s*([^\]]+)$/);
    if (nameMatch) {
      return {
        hostName: nameMatch[1].trim(),
        hostId: null,
      };
    }
  }

  return { hostName: 'Unknown Host', hostId: null };
}

/**
 * Extract the "time" part from:
 *  "[Interview] 10:50 AM EST - Man9ixe" → "10:50 AM EST"
 */
function extractTimeFromName(cardName) {
  if (!cardName) return null;
  const match = cardName.match(/\]\s*(.+?)\s*-\s*[^-]+$/);
  if (match) {
    return match[1].trim();
  }
  return null;
}

/**
 * Format a "starts in X minutes" string from Trello due date.
 */
function formatMinutesUntil(dueString) {
  if (!dueString) return null;
  const due = new Date(dueString);
  if (Number.isNaN(due.getTime())) return null;

  const now = new Date();
  const diffMs = due.getTime() - now.getTime();
  const diffMinutes = Math.round(diffMs / 60000);

  if (diffMinutes <= 0) return 'Starting now';
  if (diffMinutes === 1) return 'in 1 minute';
  return `in ${diffMinutes} minutes`;
}

/**
 * Upsert queue object in memory.
 */
function upsertQueue(shortId, data) {
  const existing = queues.get(shortId) || {};
  const merged = {
    shortId,
    sessionType: data.sessionType || existing.sessionType,
    hostId: data.hostId || existing.hostId,
    hostName: data.hostName || existing.hostName,
    guildId: data.guildId || existing.guildId || null,
    channelId: data.channelId || existing.channelId,
    messageId: data.messageId || existing.messageId,
    attendeesMessageId:
      data.attendeesMessageId || existing.attendeesMessageId || null,
    cardName: data.cardName || existing.cardName,
    cardUrl: data.cardUrl || existing.cardUrl,
    timeText: data.timeText || existing.timeText,
    due: data.due || existing.due || null,
    isClosed:
      data.isClosed !== undefined ? data.isClosed : existing.isClosed || false,
    roles: existing.roles || {
      cohost: [],
      overseer: [],
      interviewer: [],
      spectator: [],
      supervisor: [],
    },
  };

  if (data.roles) {
    merged.roles = data.roles;
  }

  queues.set(shortId, merged);
  return merged;
}

/**
 * Add a user to a specific role (sign-up). Limits are applied when posting attendees.
 * Interviewer limit varies by sessionType:
 *  - Interview: 12
 *  - Training: 8 (Trainers)
 *  - Mass Shift: 15 (Attendees)
 */
function addUserToRole(queue, userId, roleKey) {
  // Remove from any existing role first
  for (const entries of Object.values(queue.roles)) {
    const idx = entries.findIndex((entry) => entry.userId === userId);
    if (idx !== -1) entries.splice(idx, 1);
  }

  const list = queue.roles[roleKey];
  if (!list) return { ok: false, reason: 'Invalid role.' };

  // We do NOT enforce role limits here anymore.
  // Instead, we allow sign-ups and apply the limits when we POST attendees
  // (priority-based selection + backups).
  if (Number.isFinite(QUEUE_ROLE_HARD_CAP) && QUEUE_ROLE_HARD_CAP > 0) {
    if (list.length >= QUEUE_ROLE_HARD_CAP) {
      return {
        ok: false,
        reason: 'That queue has reached the hard-cap. Please try again later.',
      };
    }
  }

  list.push({ userId, claimedAt: Date.now() });
  return { ok: true };
}

 /**
  * Remove a user from any role they had in this queue.
 */
function removeUserFromQueue(queue, userId) {
  let removed = false;
  for (const entries of Object.values(queue.roles)) {
    const idx = entries.findIndex((entry) => entry.userId === userId);
    if (idx !== -1) {
      entries.splice(idx, 1);
      removed = true;
    }
  }
  return removed;
}

/**
 * Get selection limit for a role based on session type.
 */
function getRoleLimit(queue, roleKey) {
  let limit = ROLE_LIMITS[roleKey] ?? Infinity;

  if (roleKey === 'interviewer') {
    if (queue.sessionType === 'training') {
      limit = 8;
    } else if (queue.sessionType === 'massshift') {
      limit = 15;
    } else {
      limit = 12;
    }
  }

  return limit;
}

/**
 * Sort role entries:
 * 1) Priority: users who attended least recently go first (or never attended)
 * 2) Tie-break: claim time (first come, first served)
 */
function sortRoleEntries(entries, priorityStore, guildId) {
  return [...(entries || [])].sort((a, b) => {
    const aLast =
      priorityStore && typeof priorityStore.getLastAttendedAt === 'function'
        ? priorityStore.getLastAttendedAt(guildId, a.userId)
        : 0;
    const bLast =
      priorityStore && typeof priorityStore.getLastAttendedAt === 'function'
        ? priorityStore.getLastAttendedAt(guildId, b.userId)
        : 0;

    if (aLast !== bLast) return aLast - bLast;

    if (a.claimedAt && b.claimedAt) return a.claimedAt - b.claimedAt;
    return 0;
  });
}

function splitSelected(entries, limit, priorityStore, guildId) {
  const sorted = sortRoleEntries(entries, priorityStore, guildId);
  const safeLimit = Number.isFinite(limit) ? limit : sorted.length;
  return {
    sorted,
    selected: sorted.slice(0, safeLimit),
    backups: sorted.slice(safeLimit),
  };
}

function formatBackupsLine(backups, maxShow = 10) {
  if (!backups || backups.length === 0) return null;
  const shown = backups
    .slice(0, maxShow)
    .map((e) => `<@${e.userId}>`)
    .join(' • ');
  const extra =
    backups.length > maxShow ? ` (+${backups.length - maxShow} more)` : '';
  return `🟠 Backups: ${shown}${extra}`;
}

/**
 * /sessionqueue – open a queue for a Trello card.
 */
async function openQueueForCard(interaction, cardOption) {
  console.log('[QUEUE] Raw card option:', cardOption);

  const shortId = extractShortId(cardOption);
  if (!shortId) {
    await interaction.reply({
      content:
        'I could not parse that Trello card. Please provide a valid Trello card link or short ID.',
      ephemeral: true,
    });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const card = await fetchCardByShortId(shortId);
  if (!card) {
    console.log('[QUEUE] Could not fetch Trello card for shortId:', shortId);
    await interaction.editReply({
      content:
        'I could not fetch that Trello card. Make sure it exists and I can access it.',
    });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
    return;
  }

  const sessionType = detectSessionType(card.name, card.desc);
  if (!sessionType) {
    console.log('[QUEUE] Could not detect session type for card:', card.name);
    await interaction.editReply({
      content:
        'I could not detect the session type from that card.\n' +
        'Make sure the card name or description includes **Interview**, **Training**, or **Mass Shift**.',
    });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
    return;
  }

  const cfg = getSessionConfig(sessionType);
  if (!cfg || !cfg.queueChannelId) {
    console.log('[QUEUE] Missing channel config for session type:', sessionType);
    await interaction.editReply({
      content:
        `I am missing a queue channel configuration for **${sessionType}**.\n` +
        'Please check your environment variables for the Mass Shift queue channel / ping role.',
    });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
    return;
  }

  const queueChannel = await interaction.client.channels
    .fetch(cfg.queueChannelId)
    .catch(() => null);
  if (!queueChannel) {
    console.log('[QUEUE] Could not fetch queue channel:', cfg.queueChannelId);
    await interaction.editReply({
      content:
        'I could not access the configured queue channel. Please check my permissions and the channel ID.',
    });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
    return;
  }

  const { hostName, hostId } = extractHostFromDesc(card.desc, card.name);
  const timeText = extractTimeFromName(card.name);
  const startsIn = formatMinutesUntil(card.due);
  const cardUrl = card.shortUrl || card.url || cardOption;

  const headerTop = '╔══════════════════════════════════════╗';
  const headerTitle = `🟡 ${cfg.typeLabel} | ${hostName || 'Host'} | ${
    timeText || 'Time'
  } 🟡`;
  const headerBottom = '╚══════════════════════════════════════╝';

  const descriptionLines = [
    headerTop,
    headerTitle,
    headerBottom,
    '',
    hostId
      ? `📌  Host: <@${hostId}>`
      : `📌  Host: ${hostName || 'Unknown'}`,
    startsIn ? `📌  Starts: ${startsIn}` : null,
    timeText ? `📌  Time: ${timeText}` : null,
    '',
    '💠 ROLES 💠',
    '----------------------------------------------------------------',
  ];

  if (sessionType === 'interview') {
    descriptionLines.push(
      'ℹ️  **Co-Host:** Corporate Intern+',
      'ℹ️  **Overseer:** Executive Manager+',
      'ℹ️  **Interviewer (12):** Leadership Intern+',
      'ℹ️  **Spectator (4):** Leadership Intern+',
    );
  } else if (sessionType === 'training') {
    descriptionLines.push(
      'ℹ️  **Co-Host:** Corporate Intern+',
      'ℹ️  **Overseer:** Executive Manager+',
      'ℹ️  **Supervisor (4):** Assistant Manager+',
      'ℹ️  **Trainer (8):** Leadership Intern+',
      'ℹ️  **Spectator (4):** Leadership Intern+',
    );
  } else if (sessionType === 'massshift') {
    descriptionLines.push(
      'ℹ️  **Co-Host:** Corporate Intern+',
      'ℹ️  **Overseer:** Executive Manager+',
      'ℹ️  **Attendees (15):** Leadership Intern+',
    );
  }

  descriptionLines.push(
    '',
    '❓  HOW TO JOIN THE QUEUE ❓',
    '----------------------------------------------------------------',
    '- Check the role list above — if your rank is allowed, press the role button you want.',
    '- You’ll get a popup that says: “You have been added to the (ROLE) Queue.”',
    '- Do NOT join until you are pinged in “Session Attendees” **15 minutes before** the session starts.',
    '- Line up on the number/role you are selected for on "Session Attendees".',
    '- You have 5 minutes after session attendees is posted to join.',
    '',
    '❓ HOW TO LEAVE THE QUEUE/INFORM LATE ARRIVAL ❓',
    '----------------------------------------------------------------',
    '- Click the "Leave Queue" button, which will show up once you join the queue.',
    '- You can only leave the queue BEFORE the session list is posted, at that point, you would have to go to #session-lounge and PING your host with a message stating you need to un-queue.',
    '- If you do not let the host know anything before **5 minutes** after an attendees post was made, you will be given a **Written Warning, and your spot could be given up.**',
    '----------------------------------------------------------------',
    '╭─────── 💠 LINKS 💠 ───────────╮',
    `〰️ Trello Card: ${cardUrl}`,
    '╰─────────────────────────────╯',
  );

  const embed = new EmbedBuilder()
    .setDescription(descriptionLines.filter(Boolean).join('\n'))
    .setColor(cfg.color || 0x6cb2eb);

  // Build buttons; for Mass Shift we do not really need spectator, but we keep
  // it consistent by still using the same internal "interviewer" slot for Attendees.
  const joinRowComponents = [
    new ButtonBuilder()
      .setCustomId(`queue_join_cohost_${shortId}`)
      .setLabel('Co-Host')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`queue_join_overseer_${shortId}`)
      .setLabel('Overseer')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`queue_join_interviewer_${shortId}`)
      .setLabel(
        sessionType === 'training'
          ? 'Trainer'
          : sessionType === 'massshift'
          ? 'Attendee'
          : 'Interviewer',
      )
      .setStyle(ButtonStyle.Success),
  ];

  // Only show Spectator button for non-MassShift types
  if (sessionType !== 'massshift') {
    joinRowComponents.push(
      new ButtonBuilder()
        .setCustomId(`queue_join_spectator_${shortId}`)
        .setLabel('Spectator')
        .setStyle(ButtonStyle.Secondary),
    );
  }

  joinRowComponents.push(
    new ButtonBuilder()
      .setCustomId(`queue_leave_${shortId}`)
      .setLabel('Leave Queue')
      .setStyle(ButtonStyle.Danger),
  );

  const joinRow = new ActionRowBuilder().addComponents(joinRowComponents);

  const controlRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`queue_close_${shortId}`)
      .setLabel('Close Queue & Post Attendees')
      .setStyle(ButtonStyle.Danger),
  );

  const payload = {
    content: cfg.pingRoleId ? `<@&${cfg.pingRoleId}>` : null,
    embeds: [embed],
    components: [joinRow, controlRow],
  };

  const queueMessage = await queueChannel.send(payload);

  upsertQueue(shortId, {
    sessionType,
    hostId,
    hostName,
    guildId: interaction.guildId,
    channelId: queueMessage.channel.id,
    messageId: queueMessage.id,
    attendeesMessageId: null,
    cardName: card.name,
    cardUrl,
    timeText,
    due: card.due || null,
    roles: {
      cohost: [],
      overseer: [],
      interviewer: [],
      spectator: [],
      supervisor: [],
    },
    isClosed: false,
  });

  console.log(
    '[QUEUE] Opened queue for card',
    shortId,
    'in channel',
    queueChannel.id,
  );

  await interaction.editReply({
    content: `✅ Opened queue for **${card.name}** in <#${queueChannel.id}>`,
  });
  setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
}

/**
 * Build the live "Selected Attendees" text message.
 * Priority rules:
 * - People who attended least recently are selected first.
 * - Tie-break: whoever claimed first.
 */
function buildLiveAttendeesMessage(queue, priorityStore) {
  const guildId = queue.guildId || 'global';

  const cohost = splitSelected(
    queue.roles.cohost,
    getRoleLimit(queue, 'cohost'),
    priorityStore,
    guildId,
  );
  const overseer = splitSelected(
    queue.roles.overseer,
    getRoleLimit(queue, 'overseer'),
    priorityStore,
    guildId,
  );
  const main = splitSelected(
    queue.roles.interviewer,
    getRoleLimit(queue, 'interviewer'),
    priorityStore,
    guildId,
  );
  const spectator = splitSelected(
    queue.roles.spectator,
    getRoleLimit(queue, 'spectator'),
    priorityStore,
    guildId,
  );
  const supervisor = splitSelected(
    queue.roles.supervisor,
    getRoleLimit(queue, 'supervisor'),
    priorityStore,
    guildId,
  );

  const headerTop = '╔══════════════════════════════════════╗';
  const headerTitle =
    '                              ✅  SELECTED ATTENDEES ✅';
  const headerBottom = '╚══════════════════════════════════════╝';

  const lines = [
    headerTop,
    headerTitle,
    headerBottom,
    '',
    queue.hostId
      ? `🧊 Host: <@${queue.hostId}>`
      : `🧊 Host: ${queue.hostName || 'Unknown'}`,
    cohost.selected[0]
      ? `🧊 Co-Host: <@${cohost.selected[0].userId}>`
      : '🧊 Co-Host: None selected',
    overseer.selected[0]
      ? `🧊 Overseer: <@${overseer.selected[0].userId}>`
      : '🧊 Overseer: None selected',
  ];

  const cohostBackups = formatBackupsLine(cohost.backups, 5);
  if (cohostBackups) lines.push(cohostBackups);

  const overseerBackups = formatBackupsLine(overseer.backups, 5);
  if (overseerBackups) lines.push(overseerBackups);

  lines.push('', '────────────', '');

  // Main role section (Interviewers / Trainers / Attendees)
  if (queue.sessionType === 'training') {
    lines.push('🔴  Trainers 🔴');
  } else if (queue.sessionType === 'massshift') {
    lines.push('🟣  Attendees 🟣');
  } else {
    lines.push('🟡  Interviewers 🟡');
  }

  if (main.selected.length === 0) {
    lines.push('None selected.');
  } else {
    main.selected.forEach((entry, idx) => {
      lines.push(`${idx + 1}. <@${entry.userId}>`);
    });
  }

  const mainBackups = formatBackupsLine(main.backups, 12);
  if (mainBackups) lines.push(mainBackups);

  // Spectators (not used for mass shift)
  if (queue.sessionType !== 'massshift') {
    lines.push('', '🔵  Spectators 🔵');

    if (spectator.selected.length === 0) {
      lines.push('None selected.');
    } else {
      spectator.selected.forEach((entry, idx) => {
        lines.push(`${idx + 1}. <@${entry.userId}>`);
      });
    }

    const spectatorBackups = formatBackupsLine(spectator.backups, 10);
    if (spectatorBackups) lines.push(spectatorBackups);
  }

  // Supervisors (optional)
  if (supervisor.sorted.length) {
    lines.push('', '🟢  Supervisors 🟢');

    if (supervisor.selected.length === 0) {
      lines.push('None selected.');
    } else {
      supervisor.selected.forEach((entry, idx) => {
        lines.push(`${idx + 1}. <@${entry.userId}>`);
      });
    }

    const supervisorBackups = formatBackupsLine(supervisor.backups, 10);
    if (supervisorBackups) lines.push(supervisorBackups);
  }

  lines.push('', '────────────', '');
  lines.push(
    '🧊 You should now join! Please join within **5 minutes**, or your spot will be given to someone else.',
  );
  lines.push(
    '🧊 Failure to join on time will result in a **written warning**.',
  );

  if (queue.sessionType === 'interview') {
    lines.push('https://www.roblox.com/games/71896062227595/GH-Interview-Center');
  } else if (queue.sessionType === 'training') {
    lines.push('https://www.roblox.com/games/88554128028552/GH-Training-Center');
  } else if (queue.sessionType === 'massshift') {
    lines.push(
      'https://www.roblox.com/games/127619749760478/Glace-Hotels-BETA-V1',
    );
  }

  let msg = lines.join('\\n');

  // Discord message hard limit safety
  if (msg.length > 1950) {
    msg = msg.slice(0, 1940) + '\\n…';
  }

  return msg;
}
/**
 * LIVE attendees post in the queue channel (with pings).
 */
async function postLiveAttendeesForQueue(client, queue) {
  if (!queue || !queue.channelId) return;

  const channel = await client.channels.fetch(queue.channelId).catch(() => null);
  if (!channel) return;
  const content = buildLiveAttendeesMessage(queue, client.priorityStore);
  const message = await channel.send({ content });

  queue.attendeesMessageId = message.id;
  queues.set(queue.shortId, queue);
}

/**
 * Log attendees into the log channel as an embed (usernames only).
 */
async function logAttendeesForCard(client, cardOptionOrShortId, options = {}) {
  const { recordAttendance = false } = options;

  const shortId = extractShortId(cardOptionOrShortId);
  if (!shortId) {
    console.warn('[LOG] Could not parse shortId from', cardOptionOrShortId);
    return;
  }

  const queue = queues.get(shortId);
  if (!queue) {
    console.warn('[LOG] No queue stored for shortId', shortId);
    return;
  }

  const logChannelId = SESSION_ATTENDEES_LOG_CHANNEL_ID || queue.channelId;
  const logChannel = await client.channels.fetch(logChannelId).catch(() => null);
  if (!logChannel) {
    console.warn('[LOG] Could not fetch log channel for attendees');
    return;
  }

  const guildId = queue.guildId || 'global';

  const cohost = splitSelected(
    queue.roles.cohost,
    getRoleLimit(queue, 'cohost'),
    client.priorityStore,
    guildId,
  );
  const overseer = splitSelected(
    queue.roles.overseer,
    getRoleLimit(queue, 'overseer'),
    client.priorityStore,
    guildId,
  );
  const main = splitSelected(
    queue.roles.interviewer,
    getRoleLimit(queue, 'interviewer'),
    client.priorityStore,
    guildId,
  );
  const spectator = splitSelected(
    queue.roles.spectator,
    getRoleLimit(queue, 'spectator'),
    client.priorityStore,
    guildId,
  );
  const supervisor = splitSelected(
    queue.roles.supervisor,
    getRoleLimit(queue, 'supervisor'),
    client.priorityStore,
    guildId,
  );

  async function usernamesFromEntries(entries) {
    const results = [];
    for (const entry of entries) {
      try {
        const user = await client.users.fetch(entry.userId);
        results.push(user.username);
      } catch {
        results.push(`Unknown (${entry.userId})`);
      }
    }
    return results;
  }

  const [
    cohostNames,
    overseerNames,
    mainNames,
    spectatorNames,
    supervisorNames,
  ] = await Promise.all([
    usernamesFromEntries(cohost.selected),
    usernamesFromEntries(overseer.selected),
    usernamesFromEntries(main.selected),
    usernamesFromEntries(spectator.selected),
    usernamesFromEntries(supervisor.selected),
  ]);

  const fields = [];

  // Host
  fields.push({
    name: 'Host',
    value: queue.hostId ? `<@${queue.hostId}>` : queue.hostName || 'Unknown',
  });

  fields.push({
    name: 'Co-Host',
    value: cohostNames.length ? cohostNames.join('\\n') : 'None',
    inline: true,
  });

  fields.push({
    name: 'Overseer',
    value: overseerNames.length ? overseerNames.join('\\n') : 'None',
    inline: true,
  });

  const mainRoleTitle =
    queue.sessionType === 'training'
      ? 'Trainers'
      : queue.sessionType === 'massshift'
      ? 'Attendees'
      : 'Interviewers';

  fields.push({
    name: mainRoleTitle,
    value: mainNames.length
      ? mainNames.map((n, i) => `${i + 1}. ${n}`).join('\\n')
      : 'None',
  });

  if (queue.sessionType !== 'massshift') {
    fields.push({
      name: 'Spectators',
      value: spectatorNames.length
        ? spectatorNames.map((n, i) => `${i + 1}. ${n}`).join('\\n')
        : 'None',
      inline: true,
    });
  }

  if (supervisorNames.length) {
    fields.push({
      name: 'Supervisors',
      value: supervisorNames.map((n, i) => `${i + 1}. ${n}`).join('\\n'),
      inline: true,
    });
  }

  const now = new Date();
  const loggedAt = now.toLocaleString('en-US', { timeZone: 'America/Toronto' });

  const logEmbed = new EmbedBuilder()
    .setTitle('Session Attendees Logged')
    .setDescription(`Logged at **${loggedAt}**`)
    .addFields(fields)
    .setColor(0x6cb2eb);

  await logChannel.send({ embeds: [logEmbed] });

  // Update priority store ONLY when this is a completed session (not cancellations).
  if (
    recordAttendance &&
    client.priorityStore &&
    typeof client.priorityStore.recordAttendance === 'function'
  ) {
    const attendedIds = [
      ...cohost.selected,
      ...overseer.selected,
      ...main.selected,
      ...(queue.sessionType !== 'massshift' ? spectator.selected : []),
      ...supervisor.selected,
    ]
      .map((e) => e.userId)
      .filter(Boolean)
      .filter((id) => id !== queue.hostId);

    client.priorityStore.recordAttendance(guildId, attendedIds, {
      shortId,
      cardName: queue.cardName,
      sessionType: queue.sessionType,
    });

    console.log(
      `[PRIORITY] Recorded attendance for ${attendedIds.length} user(s) (guild: ${guildId}).`,
    );
  }
}

 /**
  * Clean up queue + attendees posts and forget the queue.
 */
async function cleanupQueueForCard(client, cardOptionOrShortId) {
  const shortId = extractShortId(cardOptionOrShortId);
  if (!shortId) return;

  const queue = queues.get(shortId);
  if (!queue) return;

  const channel = await client.channels.fetch(queue.channelId).catch(() => null);
  if (channel) {
    if (queue.messageId) {
      try {
        const msg = await channel.messages.fetch(queue.messageId);
        await msg.delete().catch(() => {});
      } catch {
        // ignore
      }
    }

    if (queue.attendeesMessageId) {
      try {
        const aMsg = await channel.messages.fetch(queue.attendeesMessageId);
        await aMsg.delete().catch(() => {});
      } catch {
        // ignore
      }
    }
  }

  queues.delete(shortId);
}

/**
 * Handle all queue-related button interactions and cancel-log yes/no.
 * Returns true if this function handled the interaction.
 */
async function handleQueueButtonInteraction(interaction) {
  const customId = interaction.customId;

  // cancel-session "log this cancelled session?" buttons
  if (customId.startsWith('cancel_log_')) {
    const parts = customId.split('_'); // cancel_log_yes_<shortId> or cancel_log_no_<shortId>
    const decision = parts[2];
    const shortId = parts[3];

    if (decision === 'no') {
      try {
        await cleanupQueueForCard(interaction.client, shortId);
      } catch (err) {
        console.error(
          '[CANCEL_LOG] Failed to cleanup queue for cancelled session (no log):',
          err,
        );
      }

      await interaction
        .update({
          content:
            'Okay, this cancelled session will not be logged, but the queue & attendees posts have been cleaned up.',
          components: [],
        })
        .catch(() => {});
      setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
      return true;
    }

    // decision === 'yes'
    try {
      await logAttendeesForCard(interaction.client, shortId, { recordAttendance: false });
      await cleanupQueueForCard(interaction.client, shortId);

      await interaction
        .update({
          content:
            'Attendees logged and queue cleaned up for this cancelled session.',
          components: [],
        })
        .catch(() => {});
      setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
    } catch (err) {
      console.error(
        '[CANCEL_LOG] Error while logging attendees for cancelled session:',
        err,
      );
      if (!interaction.replied && !interaction.deferred) {
        await interaction
          .reply({
            content:
              'There was an error logging attendees for this cancelled session. The Trello card itself was already cancelled.',
            ephemeral: true,
          })
          .catch(() => {});
      }
    }
    return true;
  }

  // queue_* buttons (join / leave / close)
  if (!customId.startsWith('queue_')) return false;

  const parts = customId.split('_');
  const action = parts[1];

  try {
    if (action === 'join') {
      const roleKey = parts[2]; // cohost, overseer, interviewer, spectator, supervisor
      const shortId = parts[3];

      const queue = queues.get(shortId);
      if (!queue || queue.isClosed) {
        await interaction.reply({
          content: 'This queue is no longer active.',
          ephemeral: true,
        });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
        return true;
      }

      const addResult = addUserToRole(queue, interaction.user.id, roleKey);
      if (!addResult.ok) {
        await interaction.reply({
          content: addResult.reason,
          ephemeral: true,
        });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
        return true;
      }

      const roleLabel =
        roleKey === 'interviewer'
          ? queue.sessionType === 'training'
            ? 'Trainer'
            : queue.sessionType === 'massshift'
            ? 'Attendee'
            : 'Interviewer'
          : roleKey.charAt(0).toUpperCase() + roleKey.slice(1);

      await interaction.reply({
        content: `You have been added to the **${roleLabel}** queue.`,
        ephemeral: true,
      });
      setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
      return true;
    }

    if (action === 'leave') {
      const shortId = parts[2];
      const queue = queues.get(shortId);
      if (!queue) {
        await interaction.reply({
          content: 'This queue is no longer active.',
          ephemeral: true,
        });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
        return true;
      }

      const removed = removeUserFromQueue(queue, interaction.user.id);
      await interaction.reply({
        content: removed
          ? 'You have been removed from the queue.'
          : 'You are not currently in this queue.',
        ephemeral: true,
      });
      setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
      return true;
    }

    if (action === 'close') {
      const shortId = parts[2];
      const queue = queues.get(shortId);
      if (!queue) {
        await interaction.reply({
          content: 'This queue is no longer active.',
          ephemeral: true,
        });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
        return true;
      }

      if (queue.hostId && interaction.user.id !== queue.hostId) {
        await interaction.reply({
          content: 'Only the host can close this queue.',
          ephemeral: true,
        });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
        return true;
      }

      queue.isClosed = true;
      queues.set(shortId, queue);

      // Disable buttons on original queue message
      try {
        const channel = await interaction.client.channels.fetch(queue.channelId);
        const message = await channel.messages.fetch(queue.messageId);

        const disabledComponents = message.components.map((row) => {
          const newRow = ActionRowBuilder.from(row);
          newRow.components = row.components.map((component) =>
            ButtonBuilder.from(component).setDisabled(true),
          );
          return newRow;
        });

        await message.edit({ components: disabledComponents });
      } catch (err) {
        console.error(
          '[QUEUE] Failed to disable buttons for queue',
          shortId,
          err,
        );
      }

      await interaction.reply({
        content: 'Queue closed. Posting attendees...',
        ephemeral: true,
      });
      setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);

      await postLiveAttendeesForQueue(interaction.client, queue);
      return true;
    }
  } catch (error) {
    console.error('[QUEUE] Error handling button interaction:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction
        .reply({
          content: 'There was an error while handling that queue interaction.',
          ephemeral: true,
        })
        .catch(() => {});
    }
    return true;
  }

  return false;
}

/**
 * /sessionattendees – manually post attendees list for a queue.
 */
async function postAttendeesForCard(interaction, cardOption) {
  console.log(
    '[SESSIONATTENDEES] Requested attendees for card option:',
    cardOption,
  );

  const shortId = extractShortId(cardOption);
  if (!shortId) {
    await interaction.reply({
      content:
        'I could not parse that Trello card. Please provide a valid Trello card link or short ID.',
      ephemeral: true,
    });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
    return;
  }

  const queue = queues.get(shortId);
  if (!queue) {
    await interaction.reply({
      content:
        'There is no active queue stored for that Trello card. You must open a queue first.',
      ephemeral: true,
    });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
    return;
  }

  await interaction.reply({
    content: 'Posting attendees...',
    ephemeral: true,
  });
  setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);

  await postLiveAttendeesForQueue(interaction.client, queue);
}

module.exports = {
  openQueueForCard,
  handleQueueButtonInteraction,
  postAttendeesForCard,
  logAttendeesForCard,
  cleanupQueueForCard,
};
