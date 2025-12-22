// src/utils/sessionQueueManager.js
// Session queue + attendees system (NO Hyra calls here – pure Trello + Discord)

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const TRELLO_KEY = process.env.TRELLO_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;
const TRELLO_API_BASE = 'https://api.trello.com/1';

// Queue channels (DO NOT RENAME – using your names)
const SESSION_QUEUECHANNEL_INTERVIEW_ID = process.env.SESSION_QUEUECHANNEL_INTERVIEW_ID;
const SESSION_QUEUECHANNEL_MASSSHIFT_ID = process.env.SESSION_QUEUECHANNEL_MASSSHIFT_ID;
const SESSION_QUEUECHANNEL_TRAINING_ID = process.env.SESSION_QUEUECHANNEL_TRAINING_ID;

// Ping roles (DO NOT RENAME – using your names)
const SESSION_QUEUE_PING_INTERVIEW_ROLE_ID = process.env.SESSION_QUEUE_PING_INTERVIEW_ROLE_ID;
const SESSION_QUEUE_PING_MASS_SHIFT_ROLE_ID = process.env.SESSION_QUEUE_PING_MASS_SHIFT_ROLE_ID;
const SESSION_QUEUE_PING_TRAINING_ROLE_ID = process.env.SESSION_QUEUE_PING_TRAINING_ROLE_ID;

// Where to log final attendees when session is completed
const SESSION_ATTENDEES_LOG_CHANNEL_ID = process.env.SESSION_ATTENDEES_LOG_CHANNEL_ID;

if (!TRELLO_KEY || !TRELLO_TOKEN) {
  console.warn('[QUEUE] TRELLO_KEY or TRELLO_TOKEN is missing – /sessionqueue will fail.');
}

// In-memory queues: shortId -> queueState
const activeQueues = new Map();

/**
 * Helper: delete an ephemeral reply after N ms.
 */
function scheduleEphemeralDelete(interaction, ms = 5000) {
  try {
    setTimeout(() => {
      interaction.deleteReply().catch(() => {});
    }, ms);
  } catch {
    // ignore
  }
}

/**
 * Helper: parse Trello short link from a URL or raw ID.
 */
function extractShortId(input) {
  if (!input) return null;

  // Full Trello URL: https://trello.com/c/XXXXXXX/...
  const urlMatch = input.match(/trello\.com\/c\/([A-Za-z0-9]+)/i);
  if (urlMatch) return urlMatch[1];

  // Just the short id (8+ chars)
  const idMatch = input.match(/^[A-Za-z0-9]{8,}$/);
  if (idMatch) return idMatch[0];

  return null;
}

/**
 * Minimal Trello GET wrapper just for cards.
 */
async function fetchCardInfo(shortId) {
  if (!TRELLO_KEY || !TRELLO_TOKEN) {
    throw new Error('Trello API key/token missing.');
  }

  const url = new URL(`${TRELLO_API_BASE}/cards/${shortId}`);
  url.searchParams.set('key', TRELLO_KEY);
  url.searchParams.set('token', TRELLO_TOKEN);
  url.searchParams.set('fields', 'name,desc,due,url,labels');
  url.searchParams.set('label_fields', 'name,color');

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('[TRELLO] Card fetch failed', res.status, text);
    throw new Error(`Trello API error: ${res.status}`);
  }

  const card = await res.json();
  return card;
}

/**
 * Determine session type from card name or labels.
 * Returns: 'interview' | 'training' | 'massshift' | null
 */
function detectSessionType(card) {
  const name = (card.name || '').toLowerCase();
  const labels = Array.isArray(card.labels) ? card.labels : [];

  if (name.includes('[interview]')) return 'interview';
  if (name.includes('[training]')) return 'training';
  if (name.includes('[mass shift]') || name.includes('[massshift]') || name.includes('[ms]')) {
    return 'massshift';
  }

  if (labels.some(l => (l.name || '').toLowerCase().includes('interview'))) return 'interview';
  if (labels.some(l => (l.name || '').toLowerCase().includes('training'))) return 'training';
  if (labels.some(l => (l.name || '').toLowerCase().includes('mass shift'))) return 'massshift';

  return null;
}

/**
 * Parse host Discord ID from card description.
 * Expected line: "Host: username (123456789012345678)"
 */
function parseHostIdFromDesc(desc) {
  if (!desc) return null;
  const match = desc.match(/Host:\s*.+\((\d{17,20})\)/i);
  return match ? match[1] : null;
}

/**
 * Format due date into local time string (America/Toronto).
 */
function formatLocalTime(due) {
  if (!due) return 'Unknown time';
  const date = new Date(due);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Toronto',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

/**
 * Format "Starts in X minutes/hours".
 */
function formatRelativeTime(due) {
  if (!due) return 'Unknown';
  const now = Date.now();
  const target = new Date(due).getTime();
  const diffMs = target - now;

  if (diffMs <= 0) return 'now';

  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 60) {
    return `in ${diffMin} minute${diffMin === 1 ? '' : 's'}`;
  }

  const hours = Math.floor(diffMin / 60);
  const minutes = diffMin % 60;

  if (minutes === 0) {
    return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  }

  return `in ${hours} hour${hours === 1 ? '' : 's'} ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/**
 * Config per session type – how many of each role.
 */
function getQueueRoleConfig(sessionType) {
  if (sessionType === 'interview') {
    return {
      displayName: 'Interview',
      roles: ['cohost', 'overseer', 'interviewer', 'spectator'],
      maxSlots: {
        cohost: 1,
        overseer: 1,
        interviewer: 12,
        spectator: 4,
      },
      labels: {
        cohost: 'Co-Host',
        overseer: 'Overseer',
        interviewer: 'Interviewer',
        spectator: 'Spectator',
      },
    };
  }

  if (sessionType === 'training') {
    return {
      displayName: 'Training',
      roles: ['cohost', 'overseer', 'supervisor', 'spectator'],
      maxSlots: {
        cohost: 1,
        overseer: 1,
        supervisor: 4,
        spectator: 4,
      },
      labels: {
        cohost: 'Co-Host',
        overseer: 'Overseer',
        supervisor: 'Supervisor',
        spectator: 'Spectator',
      },
    };
  }

  if (sessionType === 'massshift') {
    return {
      displayName: 'Mass Shift',
      roles: ['cohost', 'overseer', 'supervisor', 'spectator'],
      maxSlots: {
        cohost: 1,
        overseer: 1,
        supervisor: 8,
        spectator: 8,
      },
      labels: {
        cohost: 'Co-Host',
        overseer: 'Overseer',
        supervisor: 'Supervisor',
        spectator: 'Spectator',
      },
    };
  }

  return null;
}

/**
 * Queue embed builder.
 */
function buildQueueEmbed(queue) {
  const cfg = getQueueRoleConfig(queue.sessionType);
  const typeTitle = cfg ? cfg.displayName.toUpperCase() : 'SESSION';
  const localTime = formatLocalTime(queue.due);
  const relative = formatRelativeTime(queue.due);

  const header =
    '╔══════════════════════════════════════╗\n' +
    `🟡 ${typeTitle} | ${queue.hostDisplayName} | ${localTime} 🟡\n` +
    '╚══════════════════════════════════════╝';

  let rolesBlock = '💠 ROLES 💠\n' +
    '----------------------------------------------------------------\n';

  if (queue.sessionType === 'interview') {
    rolesBlock +=
      'ℹ️ Co-Host: Corporate Intern+\n' +
      'ℹ️ Overseer: Executive Manager+\n' +
      'ℹ️ Interviewer (12): Leadership Intern+\n' +
      'ℹ️ Spectator (4): Leadership Intern+\n';
  } else if (queue.sessionType === 'training') {
    rolesBlock +=
      'ℹ️ Co-Host: Corporate Intern+\n' +
      'ℹ️ Overseer: Executive Manager+\n' +
      'ℹ️ Supervisor (4): Leadership Intern+\n' +
      'ℹ️ Spectator (4): Leadership Intern+\n';
  } else if (queue.sessionType === 'massshift') {
    rolesBlock +=
      'ℹ️ Co-Host: Corporate Intern+\n' +
      'ℹ️ Overseer: Executive Manager+\n' +
      'ℹ️ Supervisor (8): Leadership Intern+\n' +
      'ℹ️ Spectator (8): Leadership Intern+\n';
  }

  const instructions =
    '\n❓ HOW TO JOIN THE QUEUE ❓\n' +
    '----------------------------------------------------------------\n' +
    'Check the role list above — if your rank is allowed, press the role button you want.\n' +
    'You’ll get a private message in this channel that is only visible to you.\n' +
    'Do NOT join the game until the attendees post is made in the attendees channel.\n' +
    '\n' +
    '❓ HOW TO LEAVE THE QUEUE / INFORM LATE ARRIVAL ❓\n' +
    '----------------------------------------------------------------\n' +
    'Click the Leave Queue button once you have joined a role.\n' +
    'After the attendees post is made, changes must be handled by the host/corporate manually.\n';

  const linksBlock =
    '\n----------------------------------------------------------------\n' +
    '╭─────── 💠 LINKS 💠 ───────────╮\n' +
    `• Trello Card: ${queue.cardUrl}\n` +
    '╰─────────────────────────────╯';

  const description =
    `${header}\n\n` +
    `📌 Host: <@${queue.hostId}>\n` +
    `📌 Starts: ${relative}\n` +
    `📌 Time: ${localTime}\n\n` +
    rolesBlock +
    '\n' +
    instructions +
    linksBlock;

  return new EmbedBuilder()
    .setDescription(description)
    .setColor(0xf1c40f);
}

/**
 * Buttons (join/leave/close).
 */
function buildQueueComponents(queue) {
  const cfg = getQueueRoleConfig(queue.sessionType);
  const shortId = queue.shortId;

  const rows = [];

  // First row: join role buttons (up to 3)
  const row1 = new ActionRowBuilder();
  let addedInRow1 = 0;

  for (const roleKey of cfg.roles) {
    if (addedInRow1 >= 3) break;
    const label = cfg.labels[roleKey] || roleKey;
    row1.addComponents(
      new ButtonBuilder()
        .setCustomId(`sessionQueue:join:${roleKey}:${shortId}`)
        .setLabel(label)
        .setStyle(ButtonStyle.Primary)
    );
    addedInRow1++;
  }

  if (addedInRow1 > 0) rows.push(row1);

  // Second row (if more roles)
  if (cfg.roles.length > addedInRow1) {
    const row2 = new ActionRowBuilder();
    for (const roleKey of cfg.roles.slice(addedInRow1)) {
      const label = cfg.labels[roleKey] || roleKey;
      row2.addComponents(
        new ButtonBuilder()
          .setCustomId(`sessionQueue:join:${roleKey}:${shortId}`)
          .setLabel(label)
          .setStyle(ButtonStyle.Primary)
      );
    }
    rows.push(row2);
  }

  // Third row: leave + close
  const controlRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`sessionQueue:leave:${shortId}`)
      .setLabel('Leave Queue')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`sessionQueue:close:${shortId}`)
      .setLabel('Close Queue & Post Attendees')
      .setStyle(ButtonStyle.Danger)
  );

  rows.push(controlRow);

  return rows;
}

/**
 * Build attendees text message (plain, not embed) – this one PINGS people.
 * This is what gets posted in the queue channel when the queue is closed.
 */
function buildAttendeesMessage(queue) {
  const cfg = getQueueRoleConfig(queue.sessionType);
  const qRoles = queue.roles;
  const header =
    '╔══════════════════════════════════════╗\n' +
    '                             ✅  SELECTED ATTENDEES ✅\n' +
    '╚══════════════════════════════════════╝';

  let lines = [];
  lines.push(header, '');
  lines.push(`🧊 Host: <@${queue.hostId}>`);

  const cohost = (qRoles.cohost && qRoles.cohost[0]) || null;
  const overseer = (qRoles.overseer && qRoles.overseer[0]) || null;

  lines.push(`🧊 Co-Host: ${cohost ? `<@${cohost}>` : 'None selected'}`);
  lines.push(`🧊 Overseer: ${overseer ? `<@${overseer}>` : 'None selected'}`);
  lines.push('', '────────────', '');

  if (queue.sessionType === 'interview') {
    const interviewers = qRoles.interviewer || [];
    const spectators = qRoles.spectator || [];

    lines.push('🟡  Interviewers 🟡');
    const maxInterviewers = 12;
    for (let i = 0; i < maxInterviewers; i++) {
      const userId = interviewers[i];
      lines.push(`${i + 1}. ${userId ? `<@${userId}>` : ''}`);
    }

    lines.push('', '────────────', '', '⚪  Spectators ⚪');
    const maxSpectators = 4;
    for (let i = 0; i < maxSpectators; i++) {
      const userId = spectators[i];
      lines.push(`${i + 1}. ${userId ? `<@${userId}>` : ''}`);
    }
  } else {
    const supervisors = qRoles.supervisor || [];
    const spectators = qRoles.spectator || [];

    lines.push('🟡  Supervisors 🟡');
    const maxSup = cfg.maxSlots.supervisor || 4;
    for (let i = 0; i < maxSup; i++) {
      const userId = supervisors[i];
      lines.push(`${i + 1}. ${userId ? `<@${userId}>` : ''}`);
    }

    lines.push('', '────────────', '', '⚪  Spectators ⚪');
    const maxSpecs = cfg.maxSlots.spectator || 4;
    for (let i = 0; i < maxSpecs; i++) {
      const userId = spectators[i];
      lines.push(`${i + 1}. ${userId ? `<@${userId}>` : ''}`);
    }
  }

  lines.push(
    '',
    '🧊 You should now join! Please join within **5 minutes**, or your spot will be given to someone else.',
    '🧊 Failure to join on time will result in a **written warning**. :('
  );

  return lines.join('\n');
}

/**
 * Build LOG embed (NO pings, usernames only) for the log channel.
 */
function buildAttendeesLogEmbed(queue, userNamesById) {
  const cfg = getQueueRoleConfig(queue.sessionType);
  const displayName = cfg ? cfg.displayName : 'Session';

  const loggedAt = new Date();
  const loggedAtStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Toronto',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(loggedAt);

  const qRoles = queue.roles || {};
  const nameFor = (id) => {
    if (!id) return '';
    return userNamesById[id] || `Unknown (${id})`;
  };

  function formatNumberedList(ids, totalSlots) {
    const list = [];
    for (let i = 0; i < totalSlots; i++) {
      const id = ids[i];
      const label = id ? nameFor(id) : '';
      list.push(`${i + 1}. ${label}`);
    }
    return list.join('\n') || 'None selected';
  }

  const cohostId = (qRoles.cohost && qRoles.cohost[0]) || null;
  const overseerId = (qRoles.overseer && qRoles.overseer[0]) || null;

  let fields = [];

  fields.push({
    name: 'Host',
    value: nameFor(queue.hostId) || `Unknown (${queue.hostId})`,
    inline: false,
  });

  fields.push({
    name: 'Co-Host',
    value: cohostId ? nameFor(cohostId) : 'None selected',
    inline: false,
  });

  fields.push({
    name: 'Overseer',
    value: overseerId ? nameFor(overseerId) : 'None selected',
    inline: false,
  });

  if (queue.sessionType === 'interview') {
    const interviewers = qRoles.interviewer || [];
    const spectators = qRoles.spectator || [];
    fields.push({
      name: 'Interviewers',
      value: formatNumberedList(interviewers, 12),
      inline: false,
    });
    fields.push({
      name: 'Spectators',
      value: formatNumberedList(spectators, 4),
      inline: false,
    });
  } else {
    const supervisors = qRoles.supervisor || [];
    const spectators = qRoles.spectator || [];
    const cfgSlots = getQueueRoleConfig(queue.sessionType)?.maxSlots || {};
    const maxSup = cfgSlots.supervisor || supervisors.length || 4;
    const maxSpec = cfgSlots.spectator || spectators.length || 4;

    fields.push({
      name: 'Supervisors',
      value: formatNumberedList(supervisors, maxSup),
      inline: false,
    });
    fields.push({
      name: 'Spectators',
      value: formatNumberedList(spectators, maxSpec),
      inline: false,
    });
  }

  const descLines = [];
  descLines.push(`**Logged:** ${loggedAtStr} (ET)`);
  if (queue.due) {
    const startTime = formatLocalTime(queue.due);
    descLines.push(`**Scheduled Time:** ${startTime} (ET)`);
  }
  if (queue.cardUrl) {
    descLines.push(`**Trello Card:** ${queue.cardUrl}`);
  }

  return new EmbedBuilder()
    .setTitle(`${displayName} Session Log`)
    .setDescription(descLines.join('\n'))
    .addFields(fields)
    .setColor(0x3498db)
    .setFooter({ text: `Card short ID: ${queue.shortId}` });
}

/**
 * Get queue channel + ping role by session type.
 */
function getQueueChannelAndPing(sessionType) {
  if (sessionType === 'interview') {
    return {
      channelId: SESSION_QUEUECHANNEL_INTERVIEW_ID,
      pingRoleId: SESSION_QUEUE_PING_INTERVIEW_ROLE_ID,
    };
  }
  if (sessionType === 'training') {
    return {
      channelId: SESSION_QUEUECHANNEL_TRAINING_ID,
      pingRoleId: SESSION_QUEUE_PING_TRAINING_ROLE_ID,
    };
  }
  if (sessionType === 'massshift') {
    return {
      channelId: SESSION_QUEUECHANNEL_MASSSHIFT_ID,
      pingRoleId: SESSION_QUEUE_PING_MASS_SHIFT_ROLE_ID,
    };
  }
  return { channelId: null, pingRoleId: null };
}

/**
 * Open a queue for a Trello card (called by /sessionqueue).
 */
async function openQueueForCard(interaction, cardOptionRaw) {
  try {
    const cardOption = (cardOptionRaw || '').trim();
    console.log('[QUEUE] Raw card option:', cardOption);

    const shortId = extractShortId(cardOption);
    if (!shortId) {
      await interaction.reply({
        content:
          'I could not open a queue for that Trello card.\n' +
          '• Make sure the link is valid\n' +
          '• The card has the correct session labels or [Interview], [Training], [Mass Shift] in the name\n' +
          '• The queue channels/roles are configured in SESSION_* and QUEUE_* env vars.',
        ephemeral: true,
      });
      scheduleEphemeralDelete(interaction);
      return;
    }

    const card = await fetchCardInfo(shortId);
    const sessionType = detectSessionType(card);

    if (!sessionType) {
      console.warn('[QUEUE] Could not detect session type for card:', card && card.id);
      await interaction.reply({
        content: 'I could not detect the session type from that Trello card.',
        ephemeral: true,
      });
      scheduleEphemeralDelete(interaction);
      return;
    }

    const { channelId, pingRoleId } = getQueueChannelAndPing(sessionType);
    if (!channelId) {
      console.warn('[QUEUE] Missing channel config for session type:', sessionType);
      await interaction.reply({
        content: `I could not open a queue for that Trello card.\n• Make sure SESSION_QUEUECHANNEL_* env vars are set for ${sessionType}.`,
        ephemeral: true,
      });
      scheduleEphemeralDelete(interaction);
      return;
    }

    const queueChannel = await interaction.client.channels.fetch(channelId);
    if (!queueChannel || !queueChannel.isTextBased()) {
      await interaction.reply({
        content: 'The configured queue channel is invalid or not text-based.',
        ephemeral: true,
      });
      scheduleEphemeralDelete(interaction);
      return;
    }

    const hostId = parseHostIdFromDesc(card.desc) || interaction.user.id;
    const hostDisplayName = interaction.member?.displayName || interaction.user.username;

    const cfg = getQueueRoleConfig(sessionType);
    const queueState = {
      shortId,
      cardId: card.id,
      cardUrl: card.url,
      sessionType,
      hostId,
      hostDisplayName,
      due: card.due,
      roles: {},
      maxSlots: cfg.maxSlots,
      channelId,
      messageId: null,
      attendeesMessageId: null,
    };

    // Initialize roles arrays
    for (const r of cfg.roles) {
      queueState.roles[r] = [];
    }

    const embed = buildQueueEmbed(queueState);
    const components = buildQueueComponents(queueState);

    const messagePayload = {
      embeds: [embed],
      components,
    };

    if (pingRoleId) {
      messagePayload.content = `<@&${pingRoleId}>`;
    }

    const queueMessage = await queueChannel.send(messagePayload);

    queueState.messageId = queueMessage.id;
    activeQueues.set(shortId, queueState);

    console.log(
      `[QUEUE] Opened queue for card ${shortId} in channel ${channelId}`
    );

    const sessionTitle = `${cfg.displayName ? `[${cfg.displayName}] ` : ''}${formatLocalTime(
      queueState.due
    )} - ${queueState.hostDisplayName}`;

    await interaction.reply({
      content: `✅ Opened queue for ${sessionTitle} in <#${channelId}>`,
      ephemeral: true,
    });
    scheduleEphemeralDelete(interaction);
  } catch (err) {
    console.error('[SESSIONQUEUE] Error while executing /sessionqueue:', err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: 'There was an error while opening the queue for that Trello card.',
        ephemeral: true,
      });
      scheduleEphemeralDelete(interaction);
    }
  }
}

/**
 * Handle queue buttons (join/leave/close).
 * Uses EPHEMERAL replies instead of DMs.
 */
async function handleQueueButtonInteraction(interaction) {
  try {
    const customId = interaction.customId || '';
    const parts = customId.split(':');

    if (parts[0] !== 'sessionQueue') {
      return;
    }

    const action = parts[1];

    await interaction.deferReply({ ephemeral: true });

    if (action === 'join') {
      const roleKey = parts[2];
      const shortId = parts[3];
      const queue = activeQueues.get(shortId);
      if (!queue) {
        await interaction.editReply('This queue is no longer active.');
        scheduleEphemeralDelete(interaction);
        return;
      }

      const cfg = getQueueRoleConfig(queue.sessionType);
      if (!cfg.roles.includes(roleKey)) {
        await interaction.editReply('That role is not valid for this queue.');
        scheduleEphemeralDelete(interaction);
        return;
      }

      for (const rk of Object.keys(queue.roles)) {
        queue.roles[rk] = queue.roles[rk].filter(id => id !== interaction.user.id);
      }

      const current = queue.roles[roleKey] || [];
      const max = queue.maxSlots[roleKey] || 0;

      if (max > 0 && current.length >= max) {
        await interaction.editReply(
          `The **${cfg.labels[roleKey]}** queue is already full.`
        );
      } else {
        queue.roles[roleKey].push(interaction.user.id);
        await interaction.editReply(
          `You have been added to the **${cfg.labels[roleKey]}** queue for this session.`
        );
      }
      scheduleEphemeralDelete(interaction);

      const queueChannel = await interaction.client.channels.fetch(queue.channelId);
      if (queueChannel && queueChannel.isTextBased()) {
        const message = await queueChannel.messages.fetch(queue.messageId).catch(() => null);
        if (message) {
          const embed = buildQueueEmbed(queue);
          const components = buildQueueComponents(queue);
          await message.edit({ embeds: [embed], components });
        }
      }

      return;
    }

    if (action === 'leave') {
      const shortId = parts[2];
      const queue = activeQueues.get(shortId);
      if (!queue) {
        await interaction.editReply('This queue is no longer active.');
        scheduleEphemeralDelete(interaction);
        return;
      }

      for (const rk of Object.keys(queue.roles)) {
        queue.roles[rk] = queue.roles[rk].filter(id => id !== interaction.user.id);
      }

      await interaction.editReply(
        'You have been removed from the session queue.'
      );
      scheduleEphemeralDelete(interaction);

      const queueChannel = await interaction.client.channels.fetch(queue.channelId);
      if (queueChannel && queueChannel.isTextBased()) {
        const message = await queueChannel.messages.fetch(queue.messageId).catch(() => null);
        if (message) {
          const embed = buildQueueEmbed(queue);
          const components = buildQueueComponents(queue);
          await message.edit({ embeds: [embed], components });
        }
      }

      return;
    }

    if (action === 'close') {
      const shortId = parts[2];
      const queue = activeQueues.get(shortId);
      if (!queue) {
        await interaction.editReply('This queue is no longer active.');
        scheduleEphemeralDelete(interaction);
        return;
      }

      const queueChannel = await interaction.client.channels.fetch(queue.channelId);
      if (queueChannel && queueChannel.isTextBased()) {
        const attendeesText = buildAttendeesMessage(queue);
        const attendeesMsg = await queueChannel.send({ content: attendeesText });
        queue.attendeesMessageId = attendeesMsg.id;

        const message = await queueChannel.messages.fetch(queue.messageId).catch(() => null);
        if (message) {
          const embed = buildQueueEmbed(queue);
          await message.edit({ embeds: [embed], components: [] });
        }
      }

      await interaction.editReply(
        'Queue closed and attendees list has been posted in this channel.'
      );
      scheduleEphemeralDelete(interaction);

      // NOTE: we keep queue in memory so /logsession can still log + clean later.
      return;
    }
  } catch (err) {
    console.error('[QUEUE BUTTON] Error in handleQueueButtonInteraction:', err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: 'There was an error handling that queue action.',
        ephemeral: true,
      });
      scheduleEphemeralDelete(interaction);
    }
  }
}

/**
 * Manual attendees command – uses existing queue state if present.
 */
async function postAttendeesForCard(interaction, cardOptionRaw) {
  try {
    const cardOption = (cardOptionRaw || '').trim();
    console.log('[SESSIONATTENDEES] Raw card option:', cardOption);

    const shortId = extractShortId(cardOption);
    if (!shortId) {
      await interaction.reply({
        content:
          'I could not post attendees for that Trello card.\n' +
          '• Make sure the link is valid',
        ephemeral: true,
      });
      scheduleEphemeralDelete(interaction);
      return;
    }

    const queue = activeQueues.get(shortId);

    if (!queue) {
      const card = await fetchCardInfo(shortId);
      const sessionType = detectSessionType(card);
      if (!sessionType) {
        await interaction.reply({
          content: 'I could not detect the session type from that Trello card.',
          ephemeral: true,
        });
        scheduleEphemeralDelete(interaction);
        return;
      }
      const cfg = getQueueRoleConfig(sessionType);

      const hostId = parseHostIdFromDesc(card.desc) || interaction.user.id;
      const blankQueue = {
        shortId,
        cardId: card.id,
        cardUrl: card.url,
        sessionType,
        hostId,
        hostDisplayName: interaction.member?.displayName || interaction.user.username,
        due: card.due,
        roles: {},
        maxSlots: cfg.maxSlots,
        channelId: interaction.channelId,
        messageId: null,
        attendeesMessageId: null,
      };
      for (const r of cfg.roles) blankQueue.roles[r] = [];

      const attendeesText = buildAttendeesMessage(blankQueue);
      await interaction.channel.send({ content: attendeesText });

      await interaction.reply({
        content: '✅ Posted attendees list (no saved queue, so all slots are blank).',
        ephemeral: true,
      });
      scheduleEphemeralDelete(interaction);
      return;
    }

    const attendeesText = buildAttendeesMessage(queue);
    const attendeesMsg = await interaction.channel.send({ content: attendeesText });
    queue.attendeesMessageId = attendeesMsg.id;

    await interaction.reply({
      content: '✅ Posted attendees list for that session.',
      ephemeral: true,
    });
    scheduleEphemeralDelete(interaction);
  } catch (err) {
    console.error('[SESSIONATTENDEES] Error while executing /sessionattendees:', err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: 'There was an error while posting the attendees list.',
        ephemeral: true,
      });
      scheduleEphemeralDelete(interaction);
    }
  }
}

/**
 * Collect all unique user IDs that appear in the queue (for log username resolution).
 */
function collectQueueUserIds(queue) {
  const ids = new Set();
  if (queue.hostId) ids.add(queue.hostId);
  const roles = queue.roles || {};
  for (const key of Object.keys(roles)) {
    for (const userId of roles[key]) {
      if (userId) ids.add(userId);
    }
  }
  return Array.from(ids);
}

/**
 * Resolve usernames for a set of IDs.
 */
async function resolveUsernames(client, userIds) {
  const result = {};
  const promises = userIds.map(async (id) => {
    try {
      const user = await client.users.fetch(id);
      result[id] = user.username;
    } catch {
      // ignore missing user
    }
  });

  await Promise.all(promises);
  return result;
}

/**
 * Called when a session is COMPLETED (e.g. /logsession).
 * - Logs attendees to SESSION_ATTENDEES_LOG_CHANNEL_ID (embed, usernames only)
 * - Deletes queue embed + attendees message from queue channel
 * - Clears queue from memory
 */
async function onSessionCompleted(shortId, client) {
  const queue = activeQueues.get(shortId);
  if (!queue) {
    console.log('[QUEUE] No active queue found for completed card', shortId);
    return;
  }

  let userNamesById = {};
  try {
    const userIds = collectQueueUserIds(queue);
    if (userIds.length > 0) {
      userNamesById = await resolveUsernames(client, userIds);
    }
  } catch (err) {
    console.error('[QUEUE] Failed to resolve usernames for log embed', err);
  }

  if (SESSION_ATTENDEES_LOG_CHANNEL_ID) {
    try {
      const logChannel = await client.channels.fetch(SESSION_ATTENDEES_LOG_CHANNEL_ID);
      if (logChannel && logChannel.isTextBased()) {
        const logEmbed = buildAttendeesLogEmbed(queue, userNamesById);
        await logChannel.send({ embeds: [logEmbed] });
        console.log('[QUEUE] Logged attendees for card', shortId, 'to log channel');
      }
    } catch (err) {
      console.error('[QUEUE] Failed to log attendees for card', shortId, err);
    }
  } else {
    console.warn(
      '[QUEUE] SESSION_ATTENDEES_LOG_CHANNEL_ID is not set – attendees will not be logged.'
    );
  }

  try {
    const queueChannel = await client.channels.fetch(queue.channelId);
    if (queueChannel && queueChannel.isTextBased()) {
      if (queue.messageId) {
        const queueMsg = await queueChannel.messages.fetch(queue.messageId).catch(() => null);
        if (queueMsg) await queueMsg.delete().catch(() => {});
      }
      if (queue.attendeesMessageId) {
        const attendeesMsg = await queueChannel.messages
          .fetch(queue.attendeesMessageId)
          .catch(() => null);
        if (attendeesMsg) await attendeesMsg.delete().catch(() => {});
      }
    }
  } catch (err) {
    console.error('[QUEUE] Failed to clean up queue messages for card', shortId, err);
  }

  activeQueues.delete(shortId);
  console.log('[QUEUE] Cleaned up queue state for completed card', shortId);
}

module.exports = {
  openQueueForCard,
  handleQueueButtonInteraction,
  postAttendeesForCard,
  onSessionCompleted,
  extractShortId,
};
