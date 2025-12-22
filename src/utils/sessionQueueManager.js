// src/utils/sessionQueueManager.js
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const {
  TRELLO_KEY,
  TRELLO_TOKEN,

  SESSION_QUEUECHANNEL_INTERVIEW_ID,
  SESSION_QUEUECHANNEL_TRAINING_ID,
  SESSION_QUEUECHANNEL_MASSSHIFT_ID,

  SESSION_QUEUE_PING_INTERVIEW_ROLE_ID,
  SESSION_QUEUE_PING_TRAINING_ROLE_ID,
  SESSION_QUEUE_PING_MASS_SHIFT_ROLE_ID,

  SESSION_ATTENDEES_INTERVIEW_CHANNEL_ID,
  SESSION_ATTENDEES_TRAINING_CHANNEL_ID,
  SESSION_ATTENDEES_MASSSHIFT_CHANNEL_ID,

  // Log channel for archived attendee lists (embed, usernames only)
  SESSION_ATTENDEES_LOG_CHANNEL_ID,
} = process.env;

// In-memory queue store keyed by Trello shortId (e.g. YFeAVrFM)
const sessionQueues = new Map();

const TRELLO_API_BASE = 'https://api.trello.com/1';

/**
 * Small helper to log with a consistent prefix.
 */
function logQueue(...args) {
  console.log('[QUEUE]', ...args);
}

/**
 * Extract Trello shortId from URL or raw string.
 */
function extractCardShortId(input) {
  if (!input) return null;

  const urlMatch = input.match(/trello\.com\/c\/([A-Za-z0-9]+)/i);
  if (urlMatch) return urlMatch[1];

  const idMatch = input.trim().match(/^[A-Za-z0-9]{6,10}$/);
  if (idMatch) return idMatch[0];

  return null;
}

/**
 * Fetch a Trello card by shortId using the REST API.
 */
async function fetchTrelloCard(shortId) {
  if (!TRELLO_KEY || !TRELLO_TOKEN) {
    logQueue('Missing TRELLO_KEY or TRELLO_TOKEN env vars.');
    return null;
  }

  const url = `${TRELLO_API_BASE}/cards/${encodeURIComponent(
    shortId
  )}?key=${encodeURIComponent(TRELLO_KEY)}&token=${encodeURIComponent(
    TRELLO_TOKEN
  )}&fields=name,shortUrl,desc,due,labels`;

  const res = await fetch(url);
  if (!res.ok) {
    logQueue(`Trello fetch failed for card ${shortId}:`, res.status, res.statusText);
    return null;
  }

  const data = await res.json();
  return data;
}

/**
 * Derive session type, time label, host tag, host discord ID from Trello card.
 */
function parseSessionFromCard(card) {
  const name = card.name || '';
  const lower = name.toLowerCase();

  let sessionType = null;

  if (lower.includes('interview')) {
    sessionType = 'interview';
  } else if (lower.includes('training')) {
    sessionType = 'training';
  } else if (lower.includes('mass shift') || lower.includes('massshift') || lower.includes('ms ')) {
    sessionType = 'massshift';
  }

  if (!sessionType && Array.isArray(card.labels)) {
    const labelNames = card.labels.map(l => (l.name || '').toLowerCase());
    if (labelNames.includes('interview')) sessionType = 'interview';
    else if (labelNames.includes('training')) sessionType = 'training';
    else if (labelNames.some(n => n.includes('mass shift') || n === 'ms')) sessionType = 'massshift';
  }

  // Try to parse "[Type] time - Host"
  let startTimeLabel = null;
  let hostTag = null;

  const bracketClose = name.indexOf(']');
  if (bracketClose !== -1) {
    const after = name.slice(bracketClose + 1).trim(); // "8:30 PM EST - Man9ixe"
    const parts = after.split('-').map(p => p.trim());
    if (parts.length >= 2) {
      startTimeLabel = parts[0]; // "8:30 PM EST"
      hostTag = parts.slice(1).join(' - '); // "Man9ixe"
    }
  }

  // Host Discord from description: "Host: something (123456789012345678)"
  let hostDiscordId = null;
  if (card.desc) {
    const m = card.desc.match(/Host:\s*[^(]*\(\s*(\d{16,22})\s*\)/i);
    if (m) hostDiscordId = m[1];
  }

  return {
    sessionType,
    startTimeLabel,
    hostTag,
    hostDiscordId,
  };
}

/**
 * Configuration per session type: queue channels, ping roles, roles list, etc.
 */
function getSessionConfig(sessionType) {
  if (sessionType === 'interview') {
    return {
      queueChannelId: SESSION_QUEUECHANNEL_INTERVIEW_ID,
      attendeesChannelId: SESSION_ATTENDEES_INTERVIEW_CHANNEL_ID,
      pingRoleId: SESSION_QUEUE_PING_INTERVIEW_ROLE_ID,
      typeLabel: 'INTERVIEW',
      roles: {
        cohost: { label: 'Co-Host', max: 1 },
        overseer: { label: 'Overseer', max: 1 },
        interviewer: { label: 'Interviewer', max: 12 },
        spectator: { label: 'Spectator', max: 4 },
      },
      rolesDescriptionLines: [
        'ℹ️ Co-Host: Corporate Intern+',
        'ℹ️ Overseer: Executive Manager+',
        'ℹ️ Interviewer (12): Leadership Intern+',
        'ℹ️ Spectator (4): Leadership Intern+',
      ],
    };
  }

  if (sessionType === 'training') {
    return {
      queueChannelId: SESSION_QUEUECHANNEL_TRAINING_ID,
      attendeesChannelId: SESSION_ATTENDEES_TRAINING_CHANNEL_ID,
      pingRoleId: SESSION_QUEUE_PING_TRAINING_ROLE_ID,
      typeLabel: 'TRAINING',
      roles: {
        cohost: { label: 'Co-Host', max: 1 },
        overseer: { label: 'Overseer', max: 1 },
        trainer: { label: 'Trainer', max: 6 },
        supervisor: { label: 'Supervisor', max: 4 },
        spectator: { label: 'Spectator', max: 4 },
      },
      rolesDescriptionLines: [
        'ℹ️ Co-Host: Corporate Intern+',
        'ℹ️ Overseer: Executive Manager+',
        'ℹ️ Trainer (6): Leadership Intern+',
        'ℹ️ Supervisor (4): Supervisor+',
        'ℹ️ Spectator (4): Leadership Intern+',
      ],
    };
  }

  if (sessionType === 'massshift') {
    return {
      queueChannelId: SESSION_QUEUECHANNEL_MASSSHIFT_ID,
      attendeesChannelId: SESSION_ATTENDEES_MASSSHIFT_CHANNEL_ID,
      pingRoleId: SESSION_QUEUE_PING_MASS_SHIFT_ROLE_ID,
      typeLabel: 'MASS SHIFT',
      roles: {
        cohost: { label: 'Co-Host', max: 1 },
        overseer: { label: 'Overseer', max: 1 },
        moderator: { label: 'Moderator', max: 6 },
        spectator: { label: 'Spectator', max: 4 },
      },
      rolesDescriptionLines: [
        'ℹ️ Co-Host: Corporate Intern+',
        'ℹ️ Overseer: Executive Manager+',
        'ℹ️ Moderator (6): Leadership Intern+',
        'ℹ️ Spectator (4): Leadership Intern+',
      ],
    };
  }

  return null;
}

/**
 * Friendly "starts in ..." text from due date.
 */
function buildStartsInLabel(dueIso) {
  if (!dueIso) return null;
  const due = new Date(dueIso);
  if (Number.isNaN(due.getTime())) return null;

  const now = new Date();
  const diffMs = due.getTime() - now.getTime();
  const mins = Math.round(diffMs / 60000);

  if (mins <= 0) return 'already started / past due';
  if (mins === 1) return '1 minute';
  return `${mins} minutes`;
}

/**
 * Build queue embed text body.
 */
function buildQueueDescription(cfg, parsed, queue, card) {
  const header =
    '╔══════════════════════════════════════╗\n' +
    `🟡 ${cfg.typeLabel} | ${parsed.hostTag || 'Host'} | ${
      parsed.startTimeLabel || 'Time'
    } 🟡\n` +
    '╚══════════════════════════════════════╝\n\n';

  const lines = [];

  const hostLine = queue.hostId
    ? `📌 Host: <@${queue.hostId}>`
    : `📌 Host: ${parsed.hostTag || 'Unknown'}`;
  lines.push(hostLine);

  const startsInLabel = buildStartsInLabel(card.due);
  if (startsInLabel) {
    lines.push(`📌 Starts: in ${startsInLabel}`);
  }

  if (queue.startTimeLabel) {
    lines.push(`📌 Time: ${queue.startTimeLabel}`);
  }

  lines.push('');
  lines.push('💠 ROLES 💠');
  lines.push('----------------------------------------------------------------');

  if (Array.isArray(cfg.rolesDescriptionLines)) {
    lines.push(...cfg.rolesDescriptionLines);
  }

  lines.push('');
  lines.push('❓ HOW TO JOIN THE QUEUE ❓');
  lines.push('----------------------------------------------------------------');
  lines.push('Check the role list above — if your rank is allowed, press the role button you want.');
  lines.push("You’ll get a private message that says you were added to that role's queue.");
  lines.push('Do NOT join the game until the attendees post is made in the attendees channel.');
  lines.push('');
  lines.push('❓ HOW TO LEAVE THE QUEUE / INFORM LATE ARRIVAL ❓');
  lines.push('----------------------------------------------------------------');
  lines.push('Click the Leave Queue button once you have joined a role.');
  lines.push('After the attendees post is made, changes must be handled by the host/corporate manually.');
  lines.push('');
  lines.push('----------------------------------------------------------------');
  lines.push('╭─────── 💠 LINKS 💠 ───────────╮');
  lines.push(`• Trello Card: ${card.shortUrl}`);
  lines.push('╰─────────────────────────────╯');

  return header + lines.join('\n');
}

/**
 * Open queue for a given Trello card input (URL or shortId).
 * Returns { success, error?, cardName?, queueChannelId? }.
 */
async function openQueueForCard(interaction, cardInput) {
  const shortId = extractCardShortId(cardInput);
  if (!shortId) {
    return { success: false, error: 'I could not detect a Trello card from that input.' };
  }

  const card = await fetchTrelloCard(shortId);
  if (!card) {
    return {
      success: false,
      error: 'I could not fetch that Trello card. Check that the link/ID is correct.',
    };
  }

  const parsed = parseSessionFromCard(card);
  if (!parsed.sessionType) {
    return {
      success: false,
      error: 'I could not detect the session type (interview / training / mass shift) from that card.',
    };
  }

  const cfg = getSessionConfig(parsed.sessionType);
  if (!cfg || !cfg.queueChannelId) {
    return {
      success: false,
      error: `Missing queue channel config for session type: ${parsed.sessionType}`,
    };
  }

  const queueChannel = await interaction.client.channels
    .fetch(cfg.queueChannelId)
    .catch(() => null);

  if (!queueChannel || !queueChannel.isTextBased()) {
    return {
      success: false,
      error: 'I could not access the configured queue channel. Check the channel ID in env.',
    };
  }

  const queue = {
    cardShortId: shortId,
    cardId: card.id,
    cardName: card.name,
    cardUrl: card.shortUrl,
    sessionType: parsed.sessionType,
    typeLabel: cfg.typeLabel,
    hostId: parsed.hostDiscordId || null,
    startTimeLabel: parsed.startTimeLabel || null,
    queueChannelId: cfg.queueChannelId,
    attendeesChannelId: cfg.attendeesChannelId || cfg.queueChannelId,
    logChannelId: SESSION_ATTENDEES_LOG_CHANNEL_ID || null,
    pingRoleId: cfg.pingRoleId || null,
    createdAt: new Date(),
    closed: false,
    roles: {},
  };

  for (const [key, info] of Object.entries(cfg.roles)) {
    queue.roles[key] = {
      label: info.label,
      max: info.max,
      members: new Set(),
    };
  }

  sessionQueues.set(shortId, queue);

  const description = buildQueueDescription(cfg, parsed, queue, card);

  const embed = new EmbedBuilder()
    .setColor(0xfee75c)
    .setDescription(description);

  // Buttons: role row (max 4) + control row
  const roleButtons = [];

  if (queue.roles.cohost) {
    roleButtons.push(
      new ButtonBuilder()
        .setCustomId(`queue_join_cohost_${shortId}`)
        .setLabel('Co-Host')
        .setStyle(ButtonStyle.Primary)
    );
  }
  if (queue.roles.overseer) {
    roleButtons.push(
      new ButtonBuilder()
        .setCustomId(`queue_join_overseer_${shortId}`)
        .setLabel('Overseer')
        .setStyle(ButtonStyle.Primary)
    );
  }
  if (queue.roles.interviewer) {
    roleButtons.push(
      new ButtonBuilder()
        .setCustomId(`queue_join_interviewer_${shortId}`)
        .setLabel('Interviewer')
        .setStyle(ButtonStyle.Primary)
    );
  }
  if (queue.roles.trainer) {
    roleButtons.push(
      new ButtonBuilder()
        .setCustomId(`queue_join_trainer_${shortId}`)
        .setLabel('Trainer')
        .setStyle(ButtonStyle.Primary)
    );
  }
  if (queue.roles.supervisor) {
    roleButtons.push(
      new ButtonBuilder()
        .setCustomId(`queue_join_supervisor_${shortId}`)
        .setLabel('Supervisor')
        .setStyle(ButtonStyle.Primary)
    );
  }
  if (queue.roles.moderator) {
    roleButtons.push(
      new ButtonBuilder()
        .setCustomId(`queue_join_moderator_${shortId}`)
        .setLabel('Moderator')
        .setStyle(ButtonStyle.Primary)
    );
  }
  if (queue.roles.spectator) {
    roleButtons.push(
      new ButtonBuilder()
        .setCustomId(`queue_join_spectator_${shortId}`)
        .setLabel('Spectator')
        .setStyle(ButtonStyle.Secondary)
    );
  }

  const rows = [];

  if (roleButtons.length > 0) {
    const firstRow = new ActionRowBuilder();
    // max 5 per row – we only ever add 4–5 here
    for (const btn of roleButtons.slice(0, 5)) {
      firstRow.addComponents(btn);
    }
    rows.push(firstRow);
  }

  const controlRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`queue_leave_${shortId}`)
      .setLabel('Leave Queue')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`queue_close_${shortId}`)
      .setLabel('Close Queue')
      .setStyle(ButtonStyle.Danger)
  );

  rows.push(controlRow);

  const pingContent = queue.pingRoleId ? `<@&${queue.pingRoleId}>` : undefined;

  const msg = await queueChannel.send({
    content: pingContent,
    embeds: [embed],
    components: rows,
  });

  queue.queueMessageId = msg.id;

  logQueue(`Opened queue for card ${shortId} in channel ${queue.queueChannelId}`);

  return {
    success: true,
    cardName: card.name,
    queueChannelId: queue.queueChannelId,
  };
}

/**
 * Handle button interactions for queue joins / leaves / close.
 */
async function handleQueueButtonInteraction(interaction) {
  const customId = interaction.customId || '';
  if (!customId.startsWith('queue_')) return;

  const parts = customId.split('_'); // queue_join_role_shortId or queue_leave_shortId, queue_close_shortId
  const action = parts[1];
  const maybeRole = parts[2];
  const shortId = parts[parts.length - 1];

  const queue = sessionQueues.get(shortId);
  if (!queue) {
    await interaction.reply({
      content: 'This queue is no longer active or could not be found.',
      ephemeral: true,
    });
    return;
  }

  const userId = interaction.user.id;

  if (queue.closed && action !== 'close') {
    await interaction.reply({
      content: 'This queue is already closed.',
      ephemeral: true,
    });
    return;
  }

  if (action === 'join') {
    const roleKey = maybeRole;
    const role = queue.roles[roleKey];

    if (!role) {
      await interaction.reply({
        content: 'That role is not available for this queue.',
        ephemeral: true,
      });
      return;
    }

    // Remove user from all other roles first.
    for (const r of Object.values(queue.roles)) {
      r.members.delete(userId);
    }

    if (role.members.size >= role.max) {
      await interaction.reply({
        content: `The **${role.label}** role is already full.`,
        ephemeral: true,
      });
      return;
    }

    role.members.add(userId);

    await interaction.reply({
      content: `You have been added as **${role.label}** for this session.`,
      ephemeral: true,
    });

    return;
  }

  if (action === 'leave') {
    let removed = false;
    for (const r of Object.values(queue.roles)) {
      if (r.members.delete(userId)) removed = true;
    }

    await interaction.reply({
      content: removed
        ? 'You have been removed from the queue.'
        : 'You were not in this queue.',
      ephemeral: true,
    });

    return;
  }

  if (action === 'close') {
    queue.closed = true;

    await interaction.reply({
      content:
        'Queue closed. When you are ready, run `/sessionattendees` on this card to post the attendees list.',
      ephemeral: true,
    });

    return;
  }
}

/**
 * Helper to resolve a single Discord display name from ID.
 */
async function resolveDisplayName(guild, userId) {
  if (!guild) return userId;
  try {
    const member = await guild.members.fetch(userId);
    return member.displayName || member.user.username;
  } catch {
    return userId;
  }
}

/**
 * Build attendees text for the "live" staff post (with pings).
 */
function buildAttendeesContentWithPings(queue) {
  const hostLine = queue.hostId ? `<@${queue.hostId}>` : 'None set';

  const pickFirstMention = roleKey => {
    const role = queue.roles[roleKey];
    if (!role || role.members.size === 0) return 'None selected';
    const firstId = Array.from(role.members)[0];
    return `<@${firstId}>`;
  };

  const cohostLine = queue.roles.cohost ? pickFirstMention('cohost') : 'None selected';
  const overseerLine = queue.roles.overseer ? pickFirstMention('overseer') : 'None selected';

  const listLines = (roleKey, max) => {
    const role = queue.roles[roleKey];
    if (!role) {
      const blanks = [];
      for (let i = 1; i <= max; i++) blanks.push(`${i}.`);
      return blanks;
    }

    const members = Array.from(role.members);
    const lines = [];
    for (let i = 0; i < max; i++) {
      if (i < members.length) lines.push(`${i + 1}. <@${members[i]}>`);
      else lines.push(`${i + 1}.`);
    }
    return lines;
  };

  const isInterview = queue.sessionType === 'interview';
  const isTraining = queue.sessionType === 'training';

  const header =
    '╔══════════════════════════════════════╗\n' +
    '                             ✅  SELECTED ATTENDEES ✅\n' +
    '╚══════════════════════════════════════╝\n';

  const lines = [];

  lines.push('');
  lines.push(`🧊 Host: ${hostLine}`);
  lines.push(`🧊 Co-Host: ${cohostLine}`);
  lines.push(`🧊 Overseer: ${overseerLine}`);
  lines.push('');
  lines.push('────────────');
  lines.push('');

  if (isInterview) {
    lines.push('🟡  Interviewers 🟡');
    lines.push(...listLines('interviewer', 12));
    lines.push('');
    lines.push('────────────');
    lines.push('');
    lines.push('⚪  Spectators ⚪');
    lines.push(...listLines('spectator', 4));
  } else if (isTraining) {
    lines.push('🟡  Trainers 🟡');
    lines.push(...listLines('trainer', 6));
    lines.push('');
    lines.push('────────────');
    lines.push('');
    lines.push('🟣  Supervisors 🟣');
    lines.push(...listLines('supervisor', 4));
    lines.push('');
    lines.push('────────────');
    lines.push('');
    lines.push('⚪  Spectators ⚪');
    lines.push(...listLines('spectator', 4));
  } else {
    // mass shift – generic
    lines.push('🟡  Moderators 🟡');
    lines.push(...listLines('moderator', 6));
    lines.push('');
    lines.push('────────────');
    lines.push('');
    lines.push('⚪  Spectators ⚪');
    lines.push(...listLines('spectator', 4));
  }

  lines.push('');
  lines.push(
    '🧊 You should now join! Please join within **5 minutes**, or your spot will be given to someone else.'
  );
  lines.push('🧊 Failure to join on time will result in a **written warning**. :(');

  return header + lines.join('\n');
}

/**
 * Build attendees text for the LOG embed (usernames only, no pings).
 */
async function buildAttendeesLogDescription(queue, guild) {
  const isInterview = queue.sessionType === 'interview';
  const isTraining = queue.sessionType === 'training';

  const headerLines = [];

  const now = new Date();
  const loggedAtStr = now.toLocaleString('en-US', {
    timeZone: 'America/Toronto',
    hour12: true,
  });

  headerLines.push(`Logged at: ${loggedAtStr}`);
  headerLines.push('');

  headerLines.push(`Session Type: ${queue.typeLabel}`);
  if (queue.startTimeLabel) {
    headerLines.push(`Session Time (card): ${queue.startTimeLabel}`);
  }
  if (queue.cardName) {
    headerLines.push(`Card: ${queue.cardName}`);
  }
  if (queue.cardUrl) {
    headerLines.push(`Card Link: ${queue.cardUrl}`);
  }

  headerLines.push('');
  headerLines.push('Staff:');
  headerLines.push('────────────');

  const hostName = queue.hostId
    ? await resolveDisplayName(guild, queue.hostId)
    : 'None set';

  const resolveFirstName = async roleKey => {
    const role = queue.roles[roleKey];
    if (!role || role.members.size === 0) return 'None selected';
    const firstId = Array.from(role.members)[0];
    return await resolveDisplayName(guild, firstId);
  };

  const cohostName = queue.roles.cohost
    ? await resolveFirstName('cohost')
    : 'None selected';
  const overseerName = queue.roles.overseer
    ? await resolveFirstName('overseer')
    : 'None selected';

  headerLines.push(`Host: ${hostName}`);
  headerLines.push(`Co-Host: ${cohostName}`);
  headerLines.push(`Overseer: ${overseerName}`);
  headerLines.push('');
  headerLines.push('Detailed Roles:');
  headerLines.push('────────────');

  const listNameLines = async (title, roleKey, max) => {
    const role = queue.roles[roleKey];
    const lines = [];
    lines.push('');
    lines.push(`${title}`);
    if (!role) {
      return lines;
    }
    const members = Array.from(role.members);
    for (let i = 0; i < max; i++) {
      if (i < members.length) {
        const name = await resolveDisplayName(guild, members[i]);
        lines.push(`${i + 1}. ${name}`);
      } else {
        lines.push(`${i + 1}.`);
      }
    }
    return lines;
  };

  let bodyLines = [];

  if (isInterview) {
    bodyLines = bodyLines.concat(
      await listNameLines('Interviewers', 'interviewer', 12)
    );
    bodyLines = bodyLines.concat(
      await listNameLines('Spectators', 'spectator', 4)
    );
  } else if (isTraining) {
    bodyLines = bodyLines.concat(
      await listNameLines('Trainers', 'trainer', 6)
    );
    bodyLines = bodyLines.concat(
      await listNameLines('Supervisors', 'supervisor', 4)
    );
    bodyLines = bodyLines.concat(
      await listNameLines('Spectators', 'spectator', 4)
    );
  } else {
    // mass shift
    bodyLines = bodyLines.concat(
      await listNameLines('Moderators', 'moderator', 6)
    );
    bodyLines = bodyLines.concat(
      await listNameLines('Spectators', 'spectator', 4)
    );
  }

  return headerLines.concat(bodyLines).join('\n');
}

/**
 * Post attendees to the correct "live" channel, and also log to the log channel (embed, usernames only).
 * Returns { success, error? }.
 */
async function postAttendeesForCard(interaction, cardInput) {
  const shortId = extractCardShortId(cardInput);
  if (!shortId) {
    return { success: false, error: 'I could not detect a Trello card from that input.' };
  }

  const queue = sessionQueues.get(shortId);
  if (!queue) {
    return {
      success: false,
      error: 'No active queue data was found for that card. Make sure you opened the queue first.',
    };
  }

  const client = interaction.client;
  const guild = interaction.guild;

  const attendeesChannel = await client.channels
    .fetch(queue.attendeesChannelId || queue.queueChannelId)
    .catch(() => null);

  if (!attendeesChannel || !attendeesChannel.isTextBased()) {
    return {
      success: false,
      error:
        'I could not access the attendees channel for this session type. Check the env channel IDs.',
    };
  }

  const attendeesContent = buildAttendeesContentWithPings(queue);

  await attendeesChannel.send({
    content: attendeesContent,
    allowedMentions: {
      parse: ['users', 'roles'],
    },
  });

  // Log to log channel as an embed, usernames only, NO pings
  if (queue.logChannelId) {
    const logChannel = await client.channels
      .fetch(queue.logChannelId)
      .catch(() => null);

    if (logChannel && logChannel.isTextBased()) {
      const description = await buildAttendeesLogDescription(queue, guild);

      const logEmbed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`Session Logged • ${queue.typeLabel}`)
        .setDescription(description);

      await logChannel.send({
        embeds: [logEmbed],
        allowedMentions: { parse: [] },
      });
    }
  }

  logQueue(`Posted attendees for card ${shortId}`);

  // Once attendees are posted & logged, we can safely drop the in-memory queue.
  sessionQueues.delete(shortId);

  return { success: true };
}

module.exports = {
  openQueueForCard,
  handleQueueButtonInteraction,
  postAttendeesForCard,
};
