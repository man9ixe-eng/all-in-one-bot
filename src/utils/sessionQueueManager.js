// src/utils/sessionQueueManager.js

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const {
  trelloRequest,
  TRELLO_LABEL_INTERVIEW_ID,
  TRELLO_LABEL_TRAINING_ID,
  TRELLO_LABEL_MASS_SHIFT_ID,
} = require('./trelloClient');

const { getWeeklySessionCounts } = require('./hyraClient');

// In-memory queue state (per-card)
const queueState = new Map();

/**
 * Helper: parse Trello card short ID from link or raw ID.
 */
function parseCardId(raw) {
  if (!raw) return null;
  const input = raw.trim();

  const m = input.match(/https?:\/\/trello\.com\/c\/([A-Za-z0-9]+)/i);
  if (m) return m[1];

  if (/^[A-Za-z0-9]{8,}$/.test(input)) return input;

  return null;
}

/**
 * Detect session type from card (by labels or name).
 */
function detectSessionTypeFromCard(card) {
  const labels = Array.isArray(card.idLabels) ? card.idLabels : [];

  if (TRELLO_LABEL_INTERVIEW_ID && labels.includes(TRELLO_LABEL_INTERVIEW_ID)) {
    return 'interview';
  }
  if (TRELLO_LABEL_TRAINING_ID && labels.includes(TRELLO_LABEL_TRAINING_ID)) {
    return 'training';
  }
  if (TRELLO_LABEL_MASS_SHIFT_ID && labels.includes(TRELLO_LABEL_MASS_SHIFT_ID)) {
    return 'mass_shift';
  }

  const name = (card.name || '').toLowerCase();
  if (name.includes('[interview]')) return 'interview';
  if (name.includes('[training]')) return 'training';
  if (name.includes('[mass shift]') || name.includes('[mass_shift]')) {
    return 'mass_shift';
  }

  return null;
}

/**
 * Per-session-type config:
 *  - queue channel env
 *  - attendees channel env
 *  - ping role env
 *  - slots for each role in the queue
 */
function getSessionConfig(sessionType) {
  switch (sessionType) {
    case 'interview':
      return {
        prettyName: 'INTERVIEW',
        emoji: '🟡',
        queueChannelId: process.env.SESSION_QUEUE_CHANNEL_INTERVIEW_ID,
        attendeesChannelId: process.env.SESSION_ATTENDEES_CHANNEL_INTERVIEW_ID,
        pingRoleId: process.env.SESSION_QUEUE_PING_INTERVIEW_ROLE_ID,
        slots: {
          cohost: { label: 'Co-Host', max: 1 },
          overseer: { label: 'Overseer', max: 1 },
          interviewer: { label: 'Interviewer', max: 12 },
          spectator: { label: 'Spectator', max: 4 },
        },
      };

    case 'training':
      return {
        prettyName: 'TRAINING',
        emoji: '🔴',
        queueChannelId: process.env.SESSION_QUEUE_CHANNEL_TRAINING_ID,
        attendeesChannelId: process.env.SESSION_ATTENDEES_CHANNEL_TRAINING_ID,
        pingRoleId: process.env.SESSION_QUEUE_PING_TRAINING_ROLE_ID,
        slots: {
          cohost: { label: 'Co-Host', max: 1 },
          overseer: { label: 'Overseer', max: 1 },
          trainer: { label: 'Trainer', max: 8 },
          spectator: { label: 'Spectator', max: 4 },
          supervisor: { label: 'Supervisor', max: 4 }, // extra queue role
        },
      };

    case 'mass_shift':
      return {
        prettyName: 'MASS SHIFT',
        emoji: '🟣',
        queueChannelId: process.env.SESSION_QUEUE_CHANNEL_MASS_SHIFT_ID,
        attendeesChannelId: process.env.SESSION_ATTENDEES_CHANNEL_MASS_SHIFT_ID,
        pingRoleId: process.env.SESSION_QUEUE_PING_MASS_SHIFT_ROLE_ID,
        slots: {
          cohost: { label: 'Co-Host', max: 1 },
          overseer: { label: 'Overseer', max: 1 },
          attendee: { label: 'Attendee', max: 15 },
        },
      };

    default:
      return null;
  }
}

/**
 * Parse host info out of the Trello card description:
 * "Host: SOME TAG (1234567890)"
 */
function parseHostFromCard(card, fallbackUser) {
  const desc = card.desc || '';
  const lines = desc.split(/\r?\n/);

  for (const line of lines) {
    const m = line.match(/^\s*Host:\s*(.+?)\s*\((\d+)\)\s*$/i);
    if (m) {
      return {
        hostTagText: m[1],
        hostDiscordId: m[2],
      };
    }
  }

  if (fallbackUser) {
    return {
      hostTagText: fallbackUser.tag || fallbackUser.username,
      hostDiscordId: fallbackUser.id,
    };
  }

  return {
    hostTagText: 'Host',
    hostDiscordId: null,
  };
}

/**
 * Build the queue embed description for each session type.
 */
function buildQueueDescription({
  sessionType,
  prettyName,
  emoji,
  hostMention,
  unixTimestamp,
  trelloUrl,
}) {
  const relative = unixTimestamp ? `<t:${unixTimestamp}:R>` : 'N/A';
  const absolute = unixTimestamp ? `<t:${unixTimestamp}:t>` : 'N/A';

  if (sessionType === 'interview') {
    return [
      '╔══════════════════════════════════════╗',
      `${emoji} ${prettyName} | ${hostMention} | ${absolute} ${emoji}`,
      '╚══════════════════════════════════════╝',
      '',
      `📌 Host: ${hostMention}`,
      `📌 Starts: ${relative}`,
      `📌 Time: ${absolute}`,
      '',
      '💠 ROLES 💠',
      '----------------------------------------------------------------',
      'ℹ️  **Co-Host:** Corporate Intern+',
      'ℹ️  **Overseer:** Executive Manager+',
      'ℹ️  **Interviewer (12):** Leadership Intern+',
      'ℹ️  **Spectator (4):** Leadership Intern+',
      '',
      '❓  HOW TO JOIN THE QUEUE ❓',
      '----------------------------------------------------------------',
      '- Check the role list above — if your rank is allowed, press the role button you want.',
      "- You’ll get a private message that says you were added to that role's queue.",
      '- Do NOT join the game until the attendees post is made in the attendees channel.',
      '',
      '❓ HOW TO LEAVE THE QUEUE / INFORM LATE ARRIVAL ❓',
      '----------------------------------------------------------------',
      '- Click the "Leave Queue" button once you have joined a role.',
      '- After the attendees post is made, changes must be handled by the host/corporate manually.',
      '',
      '----------------------------------------------------------------',
      '╭─────── 💠 LINKS 💠 ───────────╮',
      `• Trello Card: ${trelloUrl}`,
      '╰─────────────────────────────╯',
    ].join('\n');
  }

  if (sessionType === 'training') {
    return [
      '╔══════════════════════════════════════╗',
      `${emoji} ${prettyName} | ${hostMention} | ${absolute} ${emoji}`,
      '╚══════════════════════════════════════╝',
      '',
      `📌 Host: ${hostMention}`,
      `📌 Starts: ${relative}`,
      `📌 Time: ${absolute}`,
      '',
      '💠 ROLES 💠',
      '----------------------------------------------------------------',
      'ℹ️  **Co-Host:** Corporate Intern+',
      'ℹ️  **Overseer:** Executive Manager+',
      'ℹ️  **Trainer (8):** Leadership Intern+',
      'ℹ️  **Spectator (4):** Leadership Intern+',
      'ℹ️  **Supervisor (4):** Supervisor+',
      '',
      '❓  HOW TO JOIN THE QUEUE ❓',
      '----------------------------------------------------------------',
      '- Check the role list above — if your rank is allowed, press the role button you want.',
      "- You’ll get a private message that says you were added to that role's queue.",
      '- Do NOT join the game until the attendees post is made in the attendees channel.',
      '',
      '❓ HOW TO LEAVE THE QUEUE / INFORM LATE ARRIVAL ❓',
      '----------------------------------------------------------------',
      '- Click the "Leave Queue" button once you have joined a role.',
      '- After the attendees post is made, changes must be handled by the host/corporate manually.',
      '',
      '----------------------------------------------------------------',
      '╭─────── 💠 LINKS 💠 ───────────╮',
      `• Trello Card: ${trelloUrl}`,
      '╰─────────────────────────────╯',
    ].join('\n');
  }

  // mass shift
  return [
    '╔══════════════════════════════════════╗',
    `${emoji} ${prettyName} | ${hostMention} | ${absolute} ${emoji}`,
    '╚══════════════════════════════════════╝',
    '',
    `📌 Host: ${hostMention}`,
    `📌 Starts: ${relative}`,
    `📌 Time: ${absolute}`,
    '',
    '💠 ROLES 💠',
    '----------------------------------------------------------------',
    'ℹ️  **Co-Host:** Corporate Intern+',
    'ℹ️  **Overseer:** Executive Manager+',
    'ℹ️  **Attendee:** Leadership Intern+',
    '',
    '❓  HOW TO JOIN THE QUEUE ❓',
    '----------------------------------------------------------------',
    '- Check the role list above — if your rank is allowed, press the role button you want.',
    "- You’ll get a private message that says you were added to that role's queue.",
    '- Do NOT join the game until the attendees post is made in the attendees channel.',
    '',
    '❓ HOW TO LEAVE THE QUEUE / INFORM LATE ARRIVAL ❓',
    '----------------------------------------------------------------',
    '- Click the "Leave Queue" button once you have joined a role.',
    '- After the attendees post is made, changes must be handled by the host/corporate manually.',
    '',
    '----------------------------------------------------------------',
    '╭─────── 💠 LINKS 💠 ───────────╮',
    `• Trello Card: ${trelloUrl}`,
    '╰─────────────────────────────╯',
  ].join('\n');
}

/**
 * Build Discord button rows for the queue.
 */
function buildQueueButtons(sessionType) {
  const row1 = new ActionRowBuilder();
  const row2 = new ActionRowBuilder();

  if (sessionType === 'interview') {
    row1.addComponents(
      new ButtonBuilder()
        .setCustomId('queue:interview:cohost')
        .setLabel('Co-Host')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('queue:interview:overseer')
        .setLabel('Overseer')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('queue:interview:interviewer')
        .setLabel('Interviewer')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('queue:interview:spectator')
        .setLabel('Spectator')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('queue:interview:leave')
        .setLabel('Leave Queue')
        .setStyle(ButtonStyle.Danger),
    );
    return [row1];
  }

  if (sessionType === 'training') {
    row1.addComponents(
      new ButtonBuilder()
        .setCustomId('queue:training:cohost')
        .setLabel('Co-Host')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('queue:training:overseer')
        .setLabel('Overseer')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('queue:training:trainer')
        .setLabel('Trainer')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('queue:training:spectator')
        .setLabel('Spectator')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('queue:training:supervisor')
        .setLabel('Supervisor')
        .setStyle(ButtonStyle.Secondary),
    );

    row2.addComponents(
      new ButtonBuilder()
        .setCustomId('queue:training:leave')
        .setLabel('Leave Queue')
        .setStyle(ButtonStyle.Danger),
    );

    return [row1, row2];
  }

  // mass shift
  row1.addComponents(
    new ButtonBuilder()
      .setCustomId('queue:mass_shift:cohost')
      .setLabel('Co-Host')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('queue:mass_shift:overseer')
      .setLabel('Overseer')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('queue:mass_shift:attendee')
      .setLabel('Attendee')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('queue:mass_shift:leave')
      .setLabel('Leave Queue')
      .setStyle(ButtonStyle.Danger),
  );

  return [row1];
}

/**
 * Ensure queue state shape exists for a card.
 */
function ensureQueueState(cardId, sessionType, meta) {
  let state = queueState.get(cardId);
  if (!state) {
    state = {
      cardId,
      sessionType,
      trelloUrl: meta.trelloUrl,
      dueISO: meta.dueISO,
      hostDiscordId: meta.hostDiscordId,
      hostTagText: meta.hostTagText,
      queueMessageId: meta.queueMessageId || null,
      queueChannelId: meta.queueChannelId || null,
      locked: false,
      roles: {
        cohost: [],
        overseer: [],
        interviewer: [],
        spectator: [],
        trainer: [],
        attendee: [],
        supervisor: [],
      },
    };
    queueState.set(cardId, state);
  } else {
    state.sessionType = sessionType;
    state.trelloUrl = meta.trelloUrl;
    state.dueISO = meta.dueISO;
    state.hostDiscordId = meta.hostDiscordId;
    state.hostTagText = meta.hostTagText;
    if (meta.queueMessageId) state.queueMessageId = meta.queueMessageId;
    if (meta.queueChannelId) state.queueChannelId = meta.queueChannelId;
  }
  return state;
}

/**
 * Handle /sessionqueue directly from the command.
 * - Fetch Trello card
 * - Detect session type
 * - Post queue embed + buttons in correct channel
 * - Ping role as a separate message under the embed
 */
async function handleManualSessionQueueCommand(interaction) {
  const rawOption = interaction.options.getString('card', true);

  const cardId = parseCardId(rawOption);
  if (!cardId) {
    await interaction.reply({
      content: 'I could not understand that Trello card link or ID.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  // Load card details
  const cardRes = await trelloRequest(`/cards/${cardId}`, 'GET', {
    fields: 'name,desc,due,idLabels,shortUrl,url',
  });

  if (!cardRes.ok || !cardRes.data) {
    await interaction.editReply(
      'I could not open a queue for that Trello card.\n' +
        '• Make sure the link is valid\n' +
        '• The card has the correct session labels or [Interview]/[Training]/[Mass Shift] in the name\n' +
        '• The queue channels/roles are configured in SESSION_* and QUEUE_* env vars.',
    );
    return;
  }

  const card = cardRes.data;
  const sessionType = detectSessionTypeFromCard(card);
  if (!sessionType) {
    await interaction.editReply(
      'I could not determine the session type from that card. Please ensure it has the right labels or [Interview]/[Training]/[Mass Shift] in the name.',
    );
    return;
  }

  const cfg = getSessionConfig(sessionType);
  if (!cfg || !cfg.queueChannelId) {
    console.warn('[QUEUE] Missing channel config for session type:', sessionType);
    await interaction.editReply(
      `I could not open a queue for that Trello card.\n` +
        `• Make sure SESSION_QUEUE_CHANNEL_* env vars are set for ${sessionType}.`,
    );
    return;
  }

  const queueChannel = await interaction.client.channels.fetch(cfg.queueChannelId).catch(() => null);
  if (!queueChannel || !queueChannel.isTextBased()) {
    await interaction.editReply('The configured queue channel is invalid or not text-based.');
    return;
  }

  const hostInfo = parseHostFromCard(card, interaction.user);
  const hostMention = hostInfo.hostDiscordId
    ? `<@${hostInfo.hostDiscordId}>`
    : hostInfo.hostTagText;

  const trelloUrl = card.shortUrl || card.url || 'Unknown';
  const dueISO = card.due || null;
  const dueMs = dueISO ? new Date(dueISO).getTime() : null;
  const unix = dueMs && !Number.isNaN(dueMs) ? Math.floor(dueMs / 1000) : null;

  const description = buildQueueDescription({
    sessionType,
    prettyName: cfg.prettyName,
    emoji: cfg.emoji,
    hostMention,
    unixTimestamp: unix,
    trelloUrl,
  });

  const embed = new EmbedBuilder()
    .setDescription(description)
    .setColor(0x87cefa); // light-ish blue

  const components = buildQueueButtons(sessionType);

  const queueMessage = await queueChannel.send({
    embeds: [embed],
    components,
  });

  // Ping under the embed (real ping)
  if (cfg.pingRoleId) {
    await queueChannel.send(`<@&${cfg.pingRoleId}>`);
  }

  // Store state
  ensureQueueState(cardId, sessionType, {
    trelloUrl,
    dueISO,
    hostDiscordId: hostInfo.hostDiscordId,
    hostTagText: hostInfo.hostTagText,
    queueMessageId: queueMessage.id,
    queueChannelId: queueChannel.id,
  });

  await interaction.editReply('✅ Session queue posted successfully.');
}

/**
 * Handle queue button interactions.
 * customId format: queue:<sessionType>:<roleKey>
 */
async function handleQueueButtonInteraction(interaction) {
  const cid = interaction.customId || '';
  if (!cid.startsWith('queue:')) return false;

  const parts = cid.split(':');
  // [ 'queue', sessionType, roleKey ]
  if (parts.length < 3) return false;

  const sessionType = parts[1];
  const roleKey = parts[2];

  // We don't know cardId from the button, but we DO know the message it was pressed on.
  // Find matching state by queueMessageId.
  const msg = interaction.message;
  const state = Array.from(queueState.values()).find(
    (s) => s.queueMessageId === msg.id,
  );

  if (!state) {
    await interaction.reply({
      content: 'This queue is closed or no longer active.',
      ephemeral: true,
    });
    return true;
  }

  if (state.locked) {
    await interaction.reply({
      content: 'This queue has been locked. Please contact the host or a corporate member.',
      ephemeral: true,
    });
    return true;
  }

  if (roleKey === 'leave') {
    // Remove from all role arrays
    let removed = false;
    for (const key of Object.keys(state.roles)) {
      const arr = state.roles[key];
      const before = arr.length;
      state.roles[key] = arr.filter((id) => id !== interaction.user.id);
      if (state.roles[key].length !== before) removed = true;
    }

    await interaction.reply({
      content: removed
        ? 'You have been removed from the queue.'
        : 'You are not currently in the queue.',
      ephemeral: true,
    });
    return true;
  }

  const cfg = getSessionConfig(sessionType);
  if (!cfg) {
    await interaction.reply({
      content: 'This queue is misconfigured. Please contact an administrator.',
      ephemeral: true,
    });
    return true;
  }

  const slotCfg = cfg.slots[roleKey];
  if (!slotCfg) {
    await interaction.reply({
      content: 'That queue role is not available for this session.',
      ephemeral: true,
    });
    return true;
  }

  const arr = state.roles[roleKey] || [];
  // Capacity check
  if (typeof slotCfg.max === 'number' && arr.length >= slotCfg.max) {
    await interaction.reply({
      content: `The ${slotCfg.label} queue is already full.`,
      ephemeral: true,
    });
    return true;
  }

  // Remove from all roles first, then add to the chosen one in join order.
  for (const key of Object.keys(state.roles)) {
    state.roles[key] = state.roles[key].filter((id) => id !== interaction.user.id);
  }
  state.roles[roleKey].push(interaction.user.id);

  await interaction.reply({
    content: `You have been added to the **${slotCfg.label}** queue.`,
    ephemeral: true,
  });

  return true;
}

/**
 * Build attendees text for INTERVIEW sessions.
 * Hyra counts are appended like "(1 session)".
 */
function buildInterviewAttendeesMessage({
  hostMention,
  hostSessions,
  cohostMentions,
  cohostCounts,
  overseerMentions,
  overseerCounts,
  interviewerMentions,
  interviewerCounts,
  spectatorMentions,
  spectatorCounts,
}) {
  const lines = [];

  lines.push('╔══════════════════════════════════════╗');
  lines.push('                              ✅  SELECTED ATTENDEES ✅');
  lines.push('╚══════════════════════════════════════╝');
  lines.push('');
  lines.push(`🧊 Host: ${hostMention}${hostSessions !== null ? ` — ${hostSessions} session${hostSessions === 1 ? '' : 's'}` : ''}`);
  lines.push(
    `🧊 Co-Host: ${
      cohostMentions[0]
        ? `${cohostMentions[0]} — ${cohostCounts[0]} session${cohostCounts[0] === 1 ? '' : 's'}`
        : 'None'
    }`,
  );
  lines.push(
    `🧊 Overseer: ${
      overseerMentions[0]
        ? `${overseerMentions[0]} — ${overseerCounts[0]} session${overseerCounts[0] === 1 ? '' : 's'}`
        : 'None'
    }`,
  );
  lines.push('');
  lines.push('────────────');
  lines.push('');
  lines.push('🟡  Interviewers 🟡');

  for (let i = 0; i < 12; i++) {
    if (interviewerMentions[i]) {
      const sCount = interviewerCounts[i];
      lines.push(
        `${i + 1}. ${interviewerMentions[i]} — ${sCount} session${
          sCount === 1 ? '' : 's'
        }`,
      );
    } else {
      lines.push(`${i + 1}.`);
    }
  }

  lines.push('');
  lines.push('────────────');
  lines.push('');
  lines.push('⚪  Spectators ⚪');

  for (let i = 0; i < 4; i++) {
    if (spectatorMentions[i]) {
      const sCount = spectatorCounts[i];
      lines.push(
        `${i + 1}. ${spectatorMentions[i]} — ${sCount} session${
          sCount === 1 ? '' : 's'
        }`,
      );
    } else {
      lines.push(`${i + 1}.`);
    }
  }

  lines.push('');
  lines.push(
    '🧊 You should now join! Please join within **5 minutes**, or your spot will be given to someone else.',
  );
  lines.push(
    '🧊 Failure to join on time will result in a **written warning**. :(',
  );

  return lines.join('\n');
}

/**
 * Build attendees text for TRAINING sessions.
 * (Trainer + Spectator; supervisor queue exists but not shown separately for now)
 */
function buildTrainingAttendeesMessage({
  hostMention,
  hostSessions,
  cohostMentions,
  cohostCounts,
  overseerMentions,
  overseerCounts,
  trainerMentions,
  trainerCounts,
  spectatorMentions,
  spectatorCounts,
}) {
  const lines = [];

  lines.push('╔══════════════════════════════════════╗');
  lines.push('                              ✅  SELECTED ATTENDEES ✅');
  lines.push('╚══════════════════════════════════════╝');
  lines.push('');
  lines.push(`🧊 Host: ${hostMention}${hostSessions !== null ? ` — ${hostSessions} session${hostSessions === 1 ? '' : 's'}` : ''}`);
  lines.push(
    `🧊 Co-Host: ${
      cohostMentions[0]
        ? `${cohostMentions[0]} — ${cohostCounts[0]} session${cohostCounts[0] === 1 ? '' : 's'}`
        : 'None'
    }`,
  );
  lines.push(
    `🧊 Overseer: ${
      overseerMentions[0]
        ? `${overseerMentions[0]} — ${overseerCounts[0]} session${overseerCounts[0] === 1 ? '' : 's'}`
        : 'None'
    }`,
  );
  lines.push('');
  lines.push('────────────');
  lines.push('');
  lines.push('🔴  Trainers 🔴 ');

  for (let i = 0; i < 8; i++) {
    if (trainerMentions[i]) {
      const sCount = trainerCounts[i];
      lines.push(
        `${i + 1}. ${trainerMentions[i]} — ${sCount} session${
          sCount === 1 ? '' : 's'
        }`,
      );
    } else {
      lines.push(`${i + 1}.`);
    }
  }

  lines.push('');
  lines.push('────────────');
  lines.push('');
  lines.push('⚪  Spectators ⚪');

  for (let i = 0; i < 4; i++) {
    if (spectatorMentions[i]) {
      const sCount = spectatorCounts[i];
      lines.push(
        `${i + 1}. ${spectatorMentions[i]} — ${sCount} session${
          sCount === 1 ? '' : 's'
        }`,
      );
    } else {
      lines.push(`${i + 1}.`);
    }
  }

  lines.push('');
  lines.push(
    '🧊 You should now join! Please join within **5 minutes**, or your spot will be given to someone else.',
  );
  lines.push(
    '🧊 Failure to join on time will result in a **written warning**. :(',
  );

  return lines.join('\n');
}

/**
 * Build attendees text for MASS SHIFT sessions.
 */
function buildMassShiftAttendeesMessage({
  hostMention,
  hostSessions,
  cohostMentions,
  cohostCounts,
  overseerMentions,
  overseerCounts,
  attendeeMentions,
  attendeeCounts,
}) {
  const lines = [];

  lines.push('╔══════════════════════════════════════╗');
  lines.push('                              ✅  SELECTED ATTENDEES ✅');
  lines.push('╚══════════════════════════════════════╝');
  lines.push('');
  lines.push(`🧊 Host: ${hostMention}${hostSessions !== null ? ` — ${hostSessions} session${hostSessions === 1 ? '' : 's'}` : ''}`);
  lines.push(
    `🧊 Co-Host: ${
      cohostMentions[0]
        ? `${cohostMentions[0]} — ${cohostCounts[0]} session${cohostCounts[0] === 1 ? '' : 's'}`
        : 'None'
    }`,
  );
  lines.push(
    `🧊 Overseer: ${
      overseerMentions[0]
        ? `${overseerMentions[0]} — ${overseerCounts[0]} session${overseerCounts[0] === 1 ? '' : 's'}`
        : 'None'
    }`,
  );
  lines.push('');
  lines.push('────────────');
  lines.push('');
  lines.push('🟣  Attendees  🟣');

  for (let i = 0; i < 15; i++) {
    if (attendeeMentions[i]) {
      const sCount = attendeeCounts[i];
      lines.push(
        `${i + 1}. ${attendeeMentions[i]} — ${sCount} session${
          sCount === 1 ? '' : 's'
        }`,
      );
    } else {
      lines.push(`${i + 1}.`);
    }
  }

  lines.push('');
  lines.push(
    '🧊 You should now join! Please join within **5 minutes**, or your spot will be given to someone else.',
  );
  lines.push(
    '🧊 Failure to join on time will result in a **written warning**. :(',
  );

  return lines.join('\n');
}

/**
 * Helper: sort an array of user IDs by Hyra sessions (fewest first),
 * breaking ties by join order.
 */
function sortByHyra(users, hyraMap) {
  return users
    .map((id, index) => ({
      id,
      index,
      sessions: hyraMap.get(String(id)) ?? 0,
    }))
    .sort((a, b) => {
      if (a.sessions !== b.sessions) return a.sessions - b.sessions;
      return a.index - b.index;
    });
}

/**
 * Handle /sessionattendees:
 * - Uses the current queue state
 * - Pulls Hyra weekly session counts
 * - Posts a plain text attendees message in the right channel
 */
async function handleManualSessionAttendeesCommand(interaction) {
  const rawOption = interaction.options.getString('card', true);
  const cardId = parseCardId(rawOption);

  if (!cardId) {
    await interaction.reply({
      content: 'I could not understand that Trello card link or ID.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const state = queueState.get(cardId);
  if (!state) {
    await interaction.editReply(
      'There is no active queue stored for that card. Please run `/sessionqueue` first and let staff join the queue.',
    );
    return;
  }

  const cfg = getSessionConfig(state.sessionType);
  if (!cfg) {
    await interaction.editReply(
      'This session type is not configured correctly for attendees.',
    );
    return;
  }

  const attendeesChannelId =
    cfg.attendeesChannelId || cfg.queueChannelId || interaction.channelId;

  const attendeesChannel = await interaction.client.channels
    .fetch(attendeesChannelId)
    .catch(() => null);

  if (!attendeesChannel || !attendeesChannel.isTextBased()) {
    await interaction.editReply('The attendees channel is invalid or not text-based.');
    return;
  }

  // Get Hyra map
  const hyraMap = await getWeeklySessionCounts();

  const hostMention = state.hostDiscordId
    ? `<@${state.hostDiscordId}>`
    : state.hostTagText || 'Host';

  const hostSessions =
    state.hostDiscordId != null
      ? hyraMap.get(String(state.hostDiscordId)) ?? 0
      : null;

  // Pick from queues with Hyra priority
  function pickRole(roleKey, max) {
    const arr = state.roles[roleKey] || [];
    if (!arr.length) return { mentions: [], counts: [] };

    const sorted = sortByHyra(arr, hyraMap).slice(0, max);
    const mentions = sorted.map((p) => `<@${p.id}>`);
    const counts = sorted.map((p) => p.sessions);
    return { mentions, counts };
  }

  let content = '';

  if (state.sessionType === 'interview') {
    const { mentions: cohostM, counts: cohostC } = pickRole('cohost', 1);
    const { mentions: overseerM, counts: overseerC } = pickRole('overseer', 1);
    const { mentions: interviewerM, counts: interviewerC } = pickRole(
      'interviewer',
      12,
    );
    const { mentions: spectatorM, counts: spectatorC } = pickRole('spectator', 4);

    content = buildInterviewAttendeesMessage({
      hostMention,
      hostSessions,
      cohostMentions: cohostM,
      cohostCounts: cohostC,
      overseerMentions: overseerM,
      overseerCounts: overseerC,
      interviewerMentions: interviewerM,
      interviewerCounts: interviewerC,
      spectatorMentions: spectatorM,
      spectatorCounts: spectatorC,
    });
  } else if (state.sessionType === 'training') {
    const { mentions: cohostM, counts: cohostC } = pickRole('cohost', 1);
    const { mentions: overseerM, counts: overseerC } = pickRole('overseer', 1);
    const { mentions: trainerM, counts: trainerC } = pickRole('trainer', 8);
    const { mentions: spectatorM, counts: spectatorC } = pickRole('spectator', 4);

    content = buildTrainingAttendeesMessage({
      hostMention,
      hostSessions,
      cohostMentions: cohostM,
      cohostCounts: cohostC,
      overseerMentions: overseerM,
      overseerCounts: overseerC,
      trainerMentions: trainerM,
      trainerCounts: trainerC,
      spectatorMentions: spectatorM,
      spectatorCounts: spectatorC,
    });
  } else if (state.sessionType === 'mass_shift') {
    const { mentions: cohostM, counts: cohostC } = pickRole('cohost', 1);
    const { mentions: overseerM, counts: overseerC } = pickRole('overseer', 1);
    const { mentions: attendeeM, counts: attendeeC } = pickRole('attendee', 15);

    content = buildMassShiftAttendeesMessage({
      hostMention,
      hostSessions,
      cohostMentions: cohostM,
      cohostCounts: cohostC,
      overseerMentions: overseerM,
      overseerCounts: overseerC,
      attendeeMentions: attendeeM,
      attendeeCounts: attendeeC,
    });
  } else {
    await interaction.editReply(
      'This session type is not supported for attendees yet.',
    );
    return;
  }

  // Lock the queue so no one can keep changing after attendees are posted.
  state.locked = true;

  await attendeesChannel.send({ content });

  await interaction.editReply('✅ Attendees list posted.');
}

module.exports = {
  handleManualSessionQueueCommand,
  handleManualSessionAttendeesCommand,
  handleQueueButtonInteraction,
};
