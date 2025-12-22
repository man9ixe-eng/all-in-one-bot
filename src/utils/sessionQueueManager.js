// src/utils/sessionQueueManager.js
// Clean queue + attendees core (no Hyra yet, Trello read only for card info)

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

// In-memory queue store: key = Trello shortId (e.g. d94SwJQc)
const liveQueues = new Map();

/**
 * Session type configuration
 */
const SESSION_TYPES = {
  interview: {
    key: 'interview',
    displayName: 'INTERVIEW',
    borderEmoji: '🟡',
    // Where queue posts go
    queueChannelEnv: 'SESSION_QUEUECHANNEL_INTERVIEW_ID',
    // Optional ping role for queue post
    queuePingRoleEnv: 'SESSION_QUEUEPING_INTERVIEW_ROLE_ID',
    // Role queues + capacities
    roles: {
      cohost: { label: 'Co-Host', max: 1 },
      overseer: { label: 'Overseer', max: 1 },
      interviewer: { label: 'Interviewer', max: 12 },
      spectator: { label: 'Spectator', max: 4 },
    },
  },

  training: {
    key: 'training',
    displayName: 'TRAINING',
    borderEmoji: '🔴',
    queueChannelEnv: 'SESSION_QUEUECHANNEL_TRAINING_ID',
    queuePingRoleEnv: 'SESSION_QUEUEPING_TRAINING_ROLE_ID',
    roles: {
      cohost: { label: 'Co-Host', max: 1 },
      overseer: { label: 'Overseer', max: 1 },
      trainer: { label: 'Trainer', max: 8 },
      supervisor: { label: 'Supervisor', max: 4 },
      spectator: { label: 'Spectator', max: 4 },
    },
  },

  massshift: {
    key: 'massshift',
    displayName: 'MASS SHIFT',
    borderEmoji: '🟣',
    queueChannelEnv: 'SESSION_QUEUECHANNEL_MASSSHIFT_ID',
    queuePingRoleEnv: 'SESSION_QUEUEPING_MASSSHIFT_ROLE_ID',
    roles: {
      cohost: { label: 'Co-Host', max: 1 },
      overseer: { label: 'Overseer', max: 1 },
      attendee: { label: 'Attendee', max: 15 },
    },
  },
};

/**
 * Small helpers
 */

// Pull shortId from Trello link or raw id
function extractCardShortId(raw) {
  if (!raw) return null;
  const urlMatch = raw.match(/trello\.com\/c\/([A-Za-z0-9]+)/i);
  if (urlMatch) return urlMatch[1];

  const idMatch = raw.match(/^[A-Za-z0-9]{8,}$/);
  if (idMatch) return idMatch[0];

  return null;
}

// Decide session type from Trello card name / labels
function detectSessionType(card) {
  const name = (card.name || '').toLowerCase();
  const labels = (card.labels || []).map(l => (l.name || '').toLowerCase());

  const text = `${name} ${labels.join(' ')}`;

  if (text.includes('interview')) return 'interview';
  if (text.includes('training')) return 'training';
  if (text.includes('mass shift') || text.includes('mass-shift') || text.includes('massshift')) {
    return 'massshift';
  }

  return null;
}

// Fetch core card info straight from Trello (no shared trelloClient logic)
async function fetchCardInfo(cardInput) {
  const shortId = extractCardShortId(cardInput);
  if (!shortId) {
    console.warn('[QUEUE] Could not parse Trello card id from:', cardInput);
    return null;
  }

  const key = process.env.TRELLO_KEY;
  const token = process.env.TRELLO_TOKEN;

  if (!key || !token) {
    console.error('[QUEUE] Missing TRELLO_KEY or TRELLO_TOKEN in env.');
    return null;
  }

  const url = new URL(`https://api.trello.com/1/cards/${shortId}`);
  url.searchParams.set('key', key);
  url.searchParams.set('token', token);
  url.searchParams.set('fields', 'id,name,desc,due,shortUrl,labels');
  url.searchParams.set('members', 'true');
  url.searchParams.set('member_fields', 'fullName,username');

  let res;
  try {
    res = await fetch(url.toString());
  } catch (err) {
    console.error('[QUEUE] Error calling Trello cards endpoint:', err);
    return null;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('[QUEUE] Trello cards endpoint responded', res.status, body);
    return null;
  }

  const data = await res.json();

  const sessionType = detectSessionType(data);
  const dueIso = data.due;
  let dueDate = null;
  let dueUnix = null;

  if (dueIso) {
    const tmp = new Date(dueIso);
    if (!Number.isNaN(tmp.getTime())) {
      dueDate = tmp;
      dueUnix = Math.floor(tmp.getTime() / 1000);
    }
  }

  // Host name from card title pattern: "[Training] 6:30 PM EST - Man9ixe"
  let hostName = null;
  const hostMatch = (data.name || '').match(/-\s*(.+)$/);
  if (hostMatch) hostName = hostMatch[1];

  return {
    shortId,
    id: data.id,
    name: data.name,
    shortUrl: data.shortUrl,
    dueDate,
    dueUnix,
    sessionType,
    hostName,
  };
}

// Get merged config with actual channel / ping ids
function getSessionConfig(sessionType) {
  const base = SESSION_TYPES[sessionType];
  if (!base) return null;

  const queueChannelId =
    process.env[base.queueChannelEnv] ||
    null;

  const queuePingRoleId =
    process.env[base.queuePingRoleEnv] ||
    null;

  return {
    ...base,
    queueChannelId,
    queuePingRoleId,
  };
}

/**
 * Open queue for given Trello card
 */
async function openQueueForCard(interaction, cardInput) {
  const card = await fetchCardInfo(cardInput);
  if (!card) {
    return {
      ok: false,
      errorMessage:
        'I could not open a queue for that Trello card.\n• Make sure the link is valid.\n• The card name includes [Interview], [Training], or [Mass Shift].\n• TRELLO_KEY and TRELLO_TOKEN are set in the env.',
    };
  }

  const sessionType = card.sessionType;
  if (!sessionType) {
    return {
      ok: false,
      errorMessage:
        'I could not determine the session type from that card. Make sure the card name has [Interview], [Training], or [Mass Shift].',
    };
  }

  const config = getSessionConfig(sessionType);
  if (!config || !config.queueChannelId) {
    console.warn('[QUEUE] Missing channel config for session type:', sessionType);
    return {
      ok: false,
      errorMessage:
        `I could not open a queue for that Trello card.\n• Make sure SESSION_QUEUECHANNEL_* env vars are set for **${sessionType}**.`,
    };
  }

  const client = interaction.client;
  let queueChannel;

  try {
    queueChannel = await client.channels.fetch(config.queueChannelId);
  } catch (err) {
    console.error('[QUEUE] Failed to fetch queue channel:', err);
    return {
      ok: false,
      errorMessage:
        'I could not access the queue channel for this session type. Check my channel permissions.',
    };
  }

  const hostId = interaction.user.id;
  const hostDisplay =
    interaction.member?.displayName || interaction.user.username;

  // Build the pretty header
  const border = '╔══════════════════════════════════════╗';
  const borderBottom = '╚══════════════════════════════════════╝';

  let timeLabel = 'Time TBA';
  let relativeLine = '';
  let exactLine = '';

  if (card.dueUnix) {
    timeLabel = `<t:${card.dueUnix}:t>`;
    relativeLine = `📌 Starts: <t:${card.dueUnix}:R>`;
    exactLine = `📌 Time: <t:${card.dueUnix}:t>`;
  }

  const headerTitle = `${config.borderEmoji} ${config.displayName} | ${hostDisplay} | ${timeLabel} ${config.borderEmoji}`;

  // Roles section text
  const rolesTextLines = [];
  const r = config.roles;

  if (r.cohost) rolesTextLines.push(`ℹ️ **Co-Host:** Corporate Intern+`);
  if (r.overseer) rolesTextLines.push(`ℹ️ **Overseer:** Executive Manager+`);

  if (sessionType === 'interview') {
    rolesTextLines.push(`ℹ️ **Interviewer (${r.interviewer.max}):** Leadership Intern+`);
    rolesTextLines.push(`ℹ️ **Spectator (${r.spectator.max}):** Leadership Intern+`);
  } else if (sessionType === 'training') {
    rolesTextLines.push(`ℹ️ **Trainer (${r.trainer.max}):** Leadership Intern+`);
    rolesTextLines.push(`ℹ️ **Supervisor (${r.supervisor.max}):** Supervisor+`);
    rolesTextLines.push(`ℹ️ **Spectator (${r.spectator.max}):** Leadership Intern+`);
  } else if (sessionType === 'massshift') {
    rolesTextLines.push(`ℹ️ **Attendee (${r.attendee.max}):** Leadership Intern+`);
  }

  const rolesBlock = rolesTextLines.join('\n');

  const description = [
    border,
    headerTitle,
    borderBottom,
    '',
    `📌 Host: <@${hostId}>`,
    card.dueUnix ? relativeLine : '',
    card.dueUnix ? exactLine : '',
    '',
    '💠 ROLES 💠',
    '----------------------------------------------------------------',
    rolesBlock,
    '',
    '❓ HOW TO JOIN THE QUEUE ❓',
    '----------------------------------------------------------------',
    '- Check the role list above — if your rank is allowed, press the role button you want.',
    "- You’ll get a private message that says you were added to that role’s queue.",
    '- Do NOT join the game until the attendees post is made in the attendees channel.',
    '',
    '❓ HOW TO LEAVE THE QUEUE / INFORM LATE ARRIVAL ❓',
    '----------------------------------------------------------------',
    '- Click the **Leave Queue** button once you have joined a role.',
    '- After the attendees post is made, changes must be handled by the host/corporate manually.',
    '',
    '----------------------------------------------------------------',
    '╭─────── 💠 LINKS 💠 ───────────╮',
    `• Trello Card: ${card.shortUrl}`,
    '╰─────────────────────────────╯',
  ]
    .filter(Boolean)
    .join('\n');

  const embed = {
    description,
    color: 0x3498db,
  };

  // Buttons: one row for roles, one row for leave-queue
  const customBase = `queue:${card.shortId}`;

  const roleButtons = [];
  for (const [roleKey, roleCfg] of Object.entries(config.roles)) {
    roleButtons.push(
      new ButtonBuilder()
        .setCustomId(`${customBase}:${roleKey}`)
        .setLabel(roleCfg.label)
        .setStyle(ButtonStyle.Primary),
    );
  }

  // Max 5 buttons per row – split if needed
  const rows = [];
  for (let i = 0; i < roleButtons.length; i += 5) {
    rows.push(
      new ActionRowBuilder().addComponents(roleButtons.slice(i, i + 5)),
    );
  }

  // Leave queue button
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${customBase}:leave`)
        .setLabel('Leave Queue')
        .setStyle(ButtonStyle.Danger),
    ),
  );

  const pingRoleId = config.queuePingRoleId;
  const content = pingRoleId ? `<@&${pingRoleId}>` : '';

  const queueMessage = await queueChannel.send({
    content,
    embeds: [embed],
    components: rows,
  });

  // Initialize queue state in memory
  const queues = {};
  for (const key of Object.keys(config.roles)) {
    queues[key] = []; // array of { userId, displayName }
  }

  liveQueues.set(card.shortId, {
    cardShortId: card.shortId,
    cardName: card.name,
    sessionType,
    dueUnix: card.dueUnix,
    hostId,
    hostDisplay,
    queueChannelId: queueChannel.id,
    queueMessageId: queueMessage.id,
    queues,
  });

  console.log(
    `[QUEUE] Opened queue for card ${card.shortId} in channel ${queueChannel.id}`,
  );

  return {
    ok: true,
    cardShortId: card.shortId,
    cardName: card.name,
    channelId: queueChannel.id,
  };
}

/**
 * Button handler – join / leave queues
 */
async function handleQueueButtonInteraction(interaction) {
  const { customId } = interaction;
  if (!customId || !customId.startsWith('queue:')) return false;

  const parts = customId.split(':');
  // queue:<shortId>:<roleKey|leave>
  if (parts.length < 3) return false;

  const shortId = parts[1];
  const action = parts[2];

  const state = liveQueues.get(shortId);
  if (!state) {
    await interaction.reply({
      content:
        'That queue is no longer active or could not be found. Please ask the host to open a new queue.',
      ephemeral: true,
    });
    return true;
  }

  const userId = interaction.user.id;
  const displayName =
    interaction.member?.displayName || interaction.user.username;

  // Leave queue: remove from all roles
  if (action === 'leave') {
    let removed = false;
    for (const roleKey of Object.keys(state.queues)) {
      const arr = state.queues[roleKey];
      const idx = arr.findIndex((e) => e.userId === userId);
      if (idx !== -1) {
        arr.splice(idx, 1);
        removed = true;
      }
    }

    await interaction.reply({
      content: removed
        ? 'You have been removed from the queue.'
        : 'You were not in any queue.',
      ephemeral: true,
    });
    return true;
  }

  const sessionCfg = SESSION_TYPES[state.sessionType];
  if (!sessionCfg || !sessionCfg.roles[action]) {
    await interaction.reply({
      content: 'That role is not valid for this session queue.',
      ephemeral: true,
    });
    return true;
  }

  // Only hold ONE role per person – remove from all roles first
  for (const roleKey of Object.keys(state.queues)) {
    const arr = state.queues[roleKey];
    const idx = arr.findIndex((e) => e.userId === userId);
    if (idx !== -1) arr.splice(idx, 1);
  }

  // Add to target role queue (no capacity enforcement here; capacity applies when selecting attendees)
  const targetQueue = state.queues[action];
  targetQueue.push({ userId, displayName });

  await interaction.reply({
    content: `You have been added to the **${sessionCfg.roles[action].label}** queue.`,
    ephemeral: true,
  });

  return true;
}

/**
 * Attendees helper – called by /sessionattendees
 * For now: purely first-come-first-served; Hyra priority can be layered later.
 */
async function postAttendeesForCard(client, cardInput) {
  const shortId = extractCardShortId(cardInput);
  if (!shortId) {
    return {
      ok: false,
      errorMessage: 'I could not parse that Trello card link or id.',
    };
  }

  const state = liveQueues.get(shortId);
  if (!state) {
    return {
      ok: false,
      errorMessage:
        'No active queue was found for that card. Make sure you opened the queue with /sessionqueue first.',
    };
  }

  const sessionCfg = SESSION_TYPES[state.sessionType];
  if (!sessionCfg) {
    return {
      ok: false,
      errorMessage: 'Unknown session type for that queue.',
    };
  }

  const queueChannel = await client.channels.fetch(state.queueChannelId);
  if (!queueChannel) {
    return {
      ok: false,
      errorMessage:
        'I could not access the queue channel to post attendees. Check my permissions.',
    };
  }

  const r = sessionCfg.roles;
  const q = state.queues;

  // Helper to pick first N from a queue
  const pick = (roleKey) => {
    if (!r[roleKey]) return [];
    const max = r[roleKey].max ?? 0;
    return (q[roleKey] || []).slice(0, max);
  };

  const cohost = pick('cohost');
  const overseer = pick('overseer');

  let bodyLines = [];

  bodyLines.push('╔══════════════════════════════════════╗');
  bodyLines.push('                             ✅  SELECTED ATTENDEES ✅');
  bodyLines.push('╚══════════════════════════════════════╝');
  bodyLines.push('');
  bodyLines.push(`🧊 Host: <@${state.hostId}>`);
  bodyLines.push(
    `🧊 Co-Host: ${cohost[0] ? `<@${cohost[0].userId}>` : 'None selected'}`,
  );
  bodyLines.push(
    `🧊 Overseer: ${
      overseer[0] ? `<@${overseer[0].userId}>` : 'None selected'
    }`,
  );
  bodyLines.push('');
  bodyLines.push('────────────');
  bodyLines.push('');

  if (state.sessionType === 'interview') {
    const interviewers = pick('interviewer');
    const spectators = pick('spectator');

    bodyLines.push('🟡  Interviewers 🟡');
    for (let i = 0; i < r.interviewer.max; i++) {
      const entry = interviewers[i];
      bodyLines.push(
        `${i + 1}. ${entry ? `<@${entry.userId}>` : ''}`.trimEnd(),
      );
    }

    bodyLines.push('');
    bodyLines.push('────────────');
    bodyLines.push('');
    bodyLines.push('⚪  Spectators ⚪');
    for (let i = 0; i < r.spectator.max; i++) {
      const entry = spectators[i];
      bodyLines.push(
        `${i + 1}. ${entry ? `<@${entry.userId}>` : ''}`.trimEnd(),
      );
    }
  } else if (state.sessionType === 'training') {
    const trainers = pick('trainer');
    const supervisors = pick('supervisor');
    const spectators = pick('spectator');

    bodyLines.push('🔴  Trainers 🔴');
    for (let i = 0; i < r.trainer.max; i++) {
      const entry = trainers[i];
      bodyLines.push(
        `${i + 1}. ${entry ? `<@${entry.userId}>` : ''}`.trimEnd(),
      );
    }

    bodyLines.push('');
    bodyLines.push('────────────');
    bodyLines.push('');
    bodyLines.push('🔵  Supervisors 🔵');
    for (let i = 0; i < r.supervisor.max; i++) {
      const entry = supervisors[i];
      bodyLines.push(
        `${i + 1}. ${entry ? `<@${entry.userId}>` : ''}`.trimEnd(),
      );
    }

    bodyLines.push('');
    bodyLines.push('────────────');
    bodyLines.push('');
    bodyLines.push('⚪  Spectators ⚪');
    for (let i = 0; i < r.spectator.max; i++) {
      const entry = spectators[i];
      bodyLines.push(
        `${i + 1}. ${entry ? `<@${entry.userId}>` : ''}`.trimEnd(),
      );
    }
  } else if (state.sessionType === 'massshift') {
    const attendees = pick('attendee');

    bodyLines.push('🟣  Attendees  🟣');
    for (let i = 0; i < r.attendee.max; i++) {
      const entry = attendees[i];
      bodyLines.push(
        `${i + 1}. ${entry ? `<@${entry.userId}>` : ''}`.trimEnd(),
      );
    }
  }

  bodyLines.push('');
  bodyLines.push(
    '🧊 You should now join! Please join within **5 minutes**, or your spot will be given to someone else.',
  );
  bodyLines.push(
    '🧊 Failure to join on time will result in a **written warning**. :(',
  );

  const content = bodyLines.join('\n');

  const msg = await queueChannel.send({
    content,
    allowedMentions: { users: true, roles: true },
  });

  console.log(
    `[QUEUE] Posted attendees for card ${shortId} in channel ${queueChannel.id}`,
  );

  return {
    ok: true,
    channelId: queueChannel.id,
    messageId: msg.id,
  };
}

/**
 * Expose raw state if we ever need it
 */
function getQueueStateForCard(shortId) {
  return liveQueues.get(shortId) || null;
}

module.exports = {
  openQueueForCard,
  handleQueueButtonInteraction,
  postAttendeesForCard,
  getQueueStateForCard,
};
