// src/utils/sessionQueueManager.js

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const { trelloRequest } = require('./trelloClient');
const {
  TRELLO_LABEL_INTERVIEW_ID,
  TRELLO_LABEL_TRAINING_ID,
  TRELLO_LABEL_MASS_SHIFT_ID,
} = require('../config/trello');

const {
  QUEUE_INTERVIEW_CHANNEL_ID,
  QUEUE_TRAINING_CHANNEL_ID,
  QUEUE_MASS_SHIFT_CHANNEL_ID,
  ATTENDEES_INTERVIEW_CHANNEL_ID,
  ATTENDEES_TRAINING_CHANNEL_ID,
  ATTENDEES_MASS_SHIFT_CHANNEL_ID,
  HYRA_API_KEY,
  HYRA_WORKSPACE_ID,
} = process.env;

// ===== IN-MEMORY STATE =====

// key: Trello shortLink (like "YFeAVrFM")
const queues = new Map();

// key: Discord message ID -> cardShortId
const messageToCard = new Map();

// ===== SESSION TYPE CONFIG =====

const SESSION_TYPE_CONFIG = {
  interview: {
    label: 'Interview',
    queueChannelEnv: 'QUEUE_INTERVIEW_CHANNEL_ID',
    attendeesChannelEnv: 'ATTENDEES_INTERVIEW_CHANNEL_ID',
    getQueueChannelId: () => QUEUE_INTERVIEW_CHANNEL_ID,
    getAttendeesChannelId: () =>
      ATTENDEES_INTERVIEW_CHANNEL_ID || QUEUE_INTERVIEW_CHANNEL_ID,
    buttons: [
      { key: 'cohost', customId: 'queue_interview_cohost', label: 'Co-Host', style: ButtonStyle.Primary, max: 1 },
      { key: 'overseer', customId: 'queue_interview_overseer', label: 'Overseer', style: ButtonStyle.Primary, max: 1 },
      { key: 'interviewer', customId: 'queue_interview_interviewer', label: 'Interviewer', style: ButtonStyle.Success, max: 12 },
      { key: 'spectator', customId: 'queue_interview_spectator', label: 'Spectator', style: ButtonStyle.Secondary, max: 4 },
    ],
  },
  training: {
    label: 'Training',
    queueChannelEnv: 'QUEUE_TRAINING_CHANNEL_ID',
    attendeesChannelEnv: 'ATTENDEES_TRAINING_CHANNEL_ID',
    getQueueChannelId: () => QUEUE_TRAINING_CHANNEL_ID,
    getAttendeesChannelId: () =>
      ATTENDEES_TRAINING_CHANNEL_ID || QUEUE_TRAINING_CHANNEL_ID,
    buttons: [
      { key: 'cohost', customId: 'queue_training_cohost', label: 'Co-Host', style: ButtonStyle.Primary, max: 1 },
      { key: 'overseer', customId: 'queue_training_overseer', label: 'Overseer', style: ButtonStyle.Primary, max: 1 },
      { key: 'trainer', customId: 'queue_training_trainer', label: 'Trainer', style: ButtonStyle.Success, max: 8 },
      { key: 'supervisor', customId: 'queue_training_supervisor', label: 'Supervisor', style: ButtonStyle.Success, max: 4 },
      { key: 'spectator', customId: 'queue_training_spectator', label: 'Spectator', style: ButtonStyle.Secondary, max: 4 },
    ],
  },
  mass_shift: {
    label: 'Mass Shift',
    queueChannelEnv: 'QUEUE_MASS_SHIFT_CHANNEL_ID',
    attendeesChannelEnv: 'ATTENDEES_MASS_SHIFT_CHANNEL_ID',
    getQueueChannelId: () => QUEUE_MASS_SHIFT_CHANNEL_ID,
    getAttendeesChannelId: () =>
      ATTENDEES_MASS_SHIFT_CHANNEL_ID || QUEUE_MASS_SHIFT_CHANNEL_ID,
    buttons: [
      { key: 'cohost', customId: 'queue_mass_cohost', label: 'Co-Host', style: ButtonStyle.Primary, max: 1 },
      { key: 'overseer', customId: 'queue_mass_overseer', label: 'Overseer', style: ButtonStyle.Primary, max: 1 },
      { key: 'attendee', customId: 'queue_mass_attendee', label: 'Attendee', style: ButtonStyle.Success, max: 15 },
    ],
  },
};

// ===== HELPERS =====

function extractCardShortId(raw) {
  if (!raw) return null;
  raw = String(raw).trim();

  const match = raw.match(/trello\.com\/c\/([A-Za-z0-9]+)/i);
  if (match) return match[1];

  if (/^[A-Za-z0-9]{8,}$/.test(raw)) return raw;
  return null;
}

function detectSessionType(card) {
  const name = (card.name || '').toLowerCase();
  const labels = card.idLabels || [];

  if (labels.includes(TRELLO_LABEL_INTERVIEW_ID)) return 'interview';
  if (labels.includes(TRELLO_LABEL_TRAINING_ID)) return 'training';
  if (labels.includes(TRELLO_LABEL_MASS_SHIFT_ID)) return 'mass_shift';

  if (name.includes('[interview')) return 'interview';
  if (name.includes('[training')) return 'training';
  if (name.includes('[mass shift') || name.includes('[mass_shift')) return 'mass_shift';

  return null;
}

function parseCardMeta(card) {
  let hostTag = 'Unknown host';
  let hostId = null;

  if (card.desc) {
    const m = card.desc.match(/Host:\s*(.+?)\s*\((\d{15,})\)/i);
    if (m) {
      hostTag = m[1].trim();
      hostId = m[2];
    }
  }

  const dueISO = card.due || null;
  const dueMs = dueISO ? new Date(dueISO).getTime() : NaN;
  const dueUnix = Number.isNaN(dueMs) ? null : Math.floor(dueMs / 1000);

  return { hostTag, hostId, dueISO, dueUnix };
}

function buildQueueHeader(sessionTypeLabel, hostDisplay, dueUnix, trelloUrl) {
  const top = '╔══════════════════════════════════════╗';
  const bottom = '╚══════════════════════════════════════╝';

  let titleEmoji = '🟡';
  if (sessionTypeLabel === 'Training') titleEmoji = '🔴';
  if (sessionTypeLabel === 'Mass Shift') titleEmoji = '🟣';

  const titleLine =
    `${titleEmoji} ${sessionTypeLabel.toUpperCase()} | HOST | TIME ${titleEmoji}`;

  // crude center: pad with spaces
  const maxWidth = 38;
  const pad = Math.max(0, Math.floor((maxWidth - titleLine.length) / 2));
  const centered = ' '.repeat(pad) + titleLine;

  const startsText = dueUnix ? `<t:${dueUnix}:R>` : 'Unknown';
  const timeText = dueUnix ? `<t:${dueUnix}:t>` : 'Unknown';

  return [
    top,
    centered,
    bottom,
    '',
    `📌 Host: ${hostDisplay}`,
    `📌 Starts: ${startsText}`,
    `📌 Time: ${timeText}`,
    '',
    '💠 ROLES 💠',
    '----------------------------------------------------------------',
  ].join('\n');
}

function buildQueueBody(sessionType, trelloUrl) {
  if (sessionType === 'interview') {
    return [
      'ℹ️  **Co-Host:** Corporate Intern+',
      'ℹ️  **Overseer:** Executive Manager+',
      'ℹ️  **Interviewer (12):** Leadership Intern+',
      'ℹ️  **Spectator (4):** Leadership Intern+',
      '',
      '❓  HOW TO JOIN THE QUEUE ❓',
      '----------------------------------------------------------------',
      'Check the role list above — if your rank is allowed, press the role button you want.',
      'You’ll get a private message that says you were added to that role\'s queue.',
      'Do NOT join the game until the attendees post is made in the attendees channel.',
      '',
      '❓ HOW TO LEAVE THE QUEUE / INFORM LATE ARRIVAL ❓',
      '----------------------------------------------------------------',
      'Click the "Leave Queue" button once you have joined a role.',
      'After the attendees post is made, changes must be handled by the host/corporates manually.',
      '',
      '----------------------------------------------------------------',
      '╭─────── 💠 LINKS 💠 ───────────╮',
      `• Trello Card: ${trelloUrl}`,
      '╰─────────────────────────────╯',
    ].join('\n');
  }

  if (sessionType === 'training') {
    return [
      'ℹ️  **Co-Host:** Corporate Intern+',
      'ℹ️  **Overseer:** Executive Manager+',
      'ℹ️  **Trainer (8):** Leadership Intern+',
      'ℹ️  **Supervisor (4):** Supervisor+',
      'ℹ️  **Spectator (4):** Leadership Intern+',
      '',
      '❓  HOW TO JOIN THE QUEUE ❓',
      '----------------------------------------------------------------',
      'Check the role list above — if your rank is allowed, press the role button you want.',
      'You’ll get a private message that says you were added to that role\'s queue.',
      'Do NOT join the game until the attendees post is made in the attendees channel.',
      '',
      '❓ HOW TO LEAVE THE QUEUE / INFORM LATE ARRIVAL ❓',
      '----------------------------------------------------------------',
      'Click the "Leave Queue" button once you have joined a role.',
      'After the attendees post is made, changes must be handled by the host/corporates manually.',
      '',
      '----------------------------------------------------------------',
      '╭─────── 💠 LINKS 💠 ───────────╮',
      `• Trello Card: ${trelloUrl}`,
      '╰─────────────────────────────╯',
    ].join('\n');
  }

  // mass shift
  return [
    'ℹ️  **Co-Host:** Corporate Intern+',
    'ℹ️  **Overseer:** Executive Manager+',
    'ℹ️  **Attendee:** Leadership Intern+',
    '',
    '❓  HOW TO JOIN THE QUEUE ❓',
    '----------------------------------------------------------------',
    'Check the role list above — if your rank is allowed, press the role button you want.',
    'You’ll get a private message that says you were added to that role\'s queue.',
    'Do NOT join the game until the attendees post is made in the attendees channel.',
    '',
    '❓ HOW TO LEAVE THE QUEUE / INFORM LATE ARRIVAL ❓',
    '----------------------------------------------------------------',
    'Click the "Leave Queue" button once you have joined a role.',
    'After the attendees post is made, changes must be handled by the host/corporates manually.',
    '',
    '----------------------------------------------------------------',
    '╭─────── 💠 LINKS 💠 ───────────╮',
    `• Trello Card: ${trelloUrl}`,
    '╰─────────────────────────────╯',
  ].join('\n');
}

function roleLabelFor(sessionType, roleKey) {
  if (sessionType === 'interview') {
    if (roleKey === 'cohost') return 'Co-Host';
    if (roleKey === 'overseer') return 'Overseer';
    if (roleKey === 'interviewer') return 'Interviewer';
    if (roleKey === 'spectator') return 'Spectator';
  }
  if (sessionType === 'training') {
    if (roleKey === 'cohost') return 'Co-Host';
    if (roleKey === 'overseer') return 'Overseer';
    if (roleKey === 'trainer') return 'Trainer';
    if (roleKey === 'supervisor') return 'Supervisor';
    if (roleKey === 'spectator') return 'Spectator';
  }
  if (sessionType === 'mass_shift') {
    if (roleKey === 'cohost') return 'Co-Host';
    if (roleKey === 'overseer') return 'Overseer';
    if (roleKey === 'attendee') return 'Attendee';
  }
  return roleKey;
}

function customIdToRoleKey(customId) {
  if (!customId.startsWith('queue_')) return null;
  if (customId === 'queue_leave') return 'leave';

  const parts = customId.split('_'); // e.g. ["queue", "training", "trainer"]
  const key = parts[2];
  return key || null;
}

function removeUserFromAllRoles(state, userId) {
  let removed = false;
  for (const role of Object.values(state.roles)) {
    const before = role.members.length;
    role.members = role.members.filter(m => m.userId !== userId);
    if (role.members.length !== before) removed = true;
  }
  return removed;
}

// ===== HYRA (OPTIONAL) =====

async function getWeeklySessionCounts() {
  if (!HYRA_API_KEY || !HYRA_WORKSPACE_ID) {
    // No config -> gracefully default to 0 for everyone
    return {};
  }

  try {
    const url = new URL(
      `https://api.hyra.io/v1/workspaces/${HYRA_WORKSPACE_ID}/staff/dashboard`
    );
    // If Hyra requires a query (period=week or similar), you can adjust here:
    // url.searchParams.set('period', 'week');

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${HYRA_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    if (!res.ok || !data) {
      console.error('[HYRA] API error', res.status, data);
      console.error('[HYRA] getWeeklySessionCounts: failed to retrieve staff dashboard.');
      return {};
    }

    // This part depends on Hyra's actual JSON structure.
    // Adjust mapping once you know the real keys.
    const counts = {};
    const staffArray = data.staff || data.data || [];
    for (const s of staffArray) {
      const discordId = s.discordId || s.discord_id;
      if (!discordId) continue;

      const sessions =
        s.sessionsThisWeek ??
        s.sessions_this_week ??
        s.sessions ??
        0;

      counts[String(discordId)] = sessions;
    }

    return counts;
  } catch (err) {
    console.error('[HYRA] Network error', err);
    return {};
  }
}

function countFor(weeklyCounts, userId) {
  return weeklyCounts[String(userId)] ?? 0;
}

// ===== QUEUE OPEN (USED BY /sessionqueue) =====

async function openQueueForCard({ client, rawCardInput }) {
  const cardShortId = extractCardShortId(rawCardInput);
  if (!cardShortId) {
    console.warn('[QUEUE] Could not parse Trello card id from:', rawCardInput);
    return false;
  }

  const cardRes = await trelloRequest(`/cards/${cardShortId}`, 'GET', {
    fields: 'id,name,shortLink,idLabels,due,desc',
  });

  if (!cardRes.ok || !cardRes.data) {
    console.error('[QUEUE] Failed to load Trello card', cardShortId, cardRes.status, cardRes.data);
    return false;
  }

  const card = cardRes.data;
  const sessionType = detectSessionType(card);

  if (!sessionType) {
    console.warn('[QUEUE] Could not determine session type for card:', cardShortId);
    return false;
  }

  const typeConfig = SESSION_TYPE_CONFIG[sessionType];
  if (!typeConfig) {
    console.warn('[QUEUE] No type config for', sessionType);
    return false;
  }

  const queueChannelId = typeConfig.getQueueChannelId();
  const attendeesChannelId = typeConfig.getAttendeesChannelId();

  if (!queueChannelId) {
    console.warn('[QUEUE] Missing channel config for session type:', sessionType);
    return false;
  }

  const queueChannel = await client.channels.fetch(queueChannelId).catch(() => null);
  if (!queueChannel) {
    console.error('[QUEUE] Failed to fetch queue channel', queueChannelId);
    return false;
  }

  const { hostTag, hostId, dueISO, dueUnix } = parseCardMeta(card);
  const hostDisplay = hostId ? `<@${hostId}>` : hostTag;
  const trelloUrl = card.shortUrl || card.url || `https://trello.com/c/${card.shortLink || cardShortId}`;

  const header = buildQueueHeader(typeConfig.label, hostDisplay, dueUnix, trelloUrl);
  const body = buildQueueBody(sessionType, trelloUrl);
  const content = `${header}\n\n${body}`;

  // Build buttons (max 5 per row)
  const joinRow = new ActionRowBuilder().addComponents(
    ...typeConfig.buttons.map(btn =>
      new ButtonBuilder()
        .setCustomId(btn.customId)
        .setLabel(btn.label)
        .setStyle(btn.style)
    )
  );

  const leaveRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('queue_leave')
      .setLabel('Leave Queue')
      .setStyle(ButtonStyle.Danger)
  );

  const queueMessage = await queueChannel.send({
    content,
    components: [joinRow, leaveRow],
  });

  const rolesState = {};
  for (const btn of typeConfig.buttons) {
    rolesState[btn.key] = {
      key: btn.key,
      max: btn.max,
      members: [], // { userId, joinedAt }
    };
  }

  const state = {
    cardShortId: card.shortLink || cardShortId,
    cardId: card.id,
    sessionType,
    hostId,
    hostDisplay,
    dueISO,
    dueUnix,
    queueChannelId,
    attendeesChannelId,
    queueMessageId: queueMessage.id,
    queueMessageChannelId: queueMessage.channelId,
    createdAt: Date.now(),
    isClosed: false,
    roles: rolesState,
  };

  queues.set(state.cardShortId, state);
  messageToCard.set(queueMessage.id, state.cardShortId);

  console.log(
    `[QUEUE] Opened queue for card ${state.cardShortId} in channel ${queueChannelId}`
  );
  return true;
}

// ===== ATTENDEES GENERATION (USED BY /sessionattendees) =====

function formatUserWithCount(userId, count) {
  return `<@${userId}> (${count} session${count === 1 ? '' : 's'})`;
}

function buildAttendeesMessage(state, weeklyCounts) {
  const hostLine = state.hostId
    ? `<@${state.hostId}> (${countFor(weeklyCounts, state.hostId)} sessions)`
    : state.hostDisplay;

  const getSelected = (roleKey) => {
    const role = state.roles[roleKey];
    if (!role) return [];

    const members = [...role.members];
    members.sort((a, b) => {
      const aCount = countFor(weeklyCounts, a.userId);
      const bCount = countFor(weeklyCounts, b.userId);
      if (aCount !== bCount) return aCount - bCount; // less sessions first
      return a.joinedAt - b.joinedAt; // earlier join first
    });

    return members.slice(0, role.max);
  };

  if (state.sessionType === 'interview') {
    const cohost = getSelected('cohost')[0] || null;
    const overseer = getSelected('overseer')[0] || null;
    const interviewers = getSelected('interviewer');
    const spectators = getSelected('spectator');

    const lines = [];

    lines.push('╔══════════════════════════════════════╗');
    lines.push('                              ✅  SELECTED ATTENDEES ✅');
    lines.push('╚══════════════════════════════════════╝');
    lines.push('');
    lines.push(`🧊 Host: ${hostLine}`);
    lines.push(
      `🧊 Co-Host: ${
        cohost ? formatUserWithCount(cohost.userId, countFor(weeklyCounts, cohost.userId)) : '—'
      }`
    );
    lines.push(
      `🧊 Overseer: ${
        overseer ? formatUserWithCount(overseer.userId, countFor(weeklyCounts, overseer.userId)) : '—'
      }`
    );
    lines.push('');
    lines.push('────────────');
    lines.push('');
    lines.push('🟡  Interviewers 🟡');

    const maxInterviewers = state.roles.interviewer.max;
    for (let i = 0; i < maxInterviewers; i++) {
      const entry = interviewers[i];
      if (entry) {
        const c = countFor(weeklyCounts, entry.userId);
        lines.push(`${i + 1}. ${formatUserWithCount(entry.userId, c)}`);
      } else {
        lines.push(`${i + 1}. —`);
      }
    }

    lines.push('');
    lines.push('────────────');
    lines.push('');
    lines.push('⚪  Spectators ⚪');

    const maxSpectators = state.roles.spectator.max;
    for (let i = 0; i < maxSpectators; i++) {
      const entry = spectators[i];
      if (entry) {
        const c = countFor(weeklyCounts, entry.userId);
        lines.push(`${i + 1}. ${formatUserWithCount(entry.userId, c)}`);
      } else {
        lines.push(`${i + 1}. —`);
      }
    }

    lines.push('');
    lines.push(
      '🧊 You should now join! Please join within **5 minutes**, or your spot will be given to someone else.'
    );
    lines.push(
      '🧊 Failure to join on time will result in a **written warning**. :('
    );

    return lines.join('\n');
  }

  if (state.sessionType === 'training') {
    const cohost = getSelected('cohost')[0] || null;
    const overseer = getSelected('overseer')[0] || null;
    const trainers = getSelected('trainer');
    const supervisors = getSelected('supervisor');
    const spectators = getSelected('spectator');

    const lines = [];

    lines.push('╔══════════════════════════════════════╗');
    lines.push('                              ✅  SELECTED ATTENDEES ✅');
    lines.push('╚══════════════════════════════════════╝');
    lines.push('');
    lines.push(`🧊 Host: ${hostLine}`);
    lines.push(
      `🧊 Co-Host: ${
        cohost ? formatUserWithCount(cohost.userId, countFor(weeklyCounts, cohost.userId)) : '—'
      }`
    );
    lines.push(
      `🧊 Overseer: ${
        overseer ? formatUserWithCount(overseer.userId, countFor(weeklyCounts, overseer.userId)) : '—'
      }`
    );
    lines.push('');
    lines.push('────────────');
    lines.push('');
    lines.push('🔴  Trainers 🔴');

    const maxTrainers = state.roles.trainer.max;
    for (let i = 0; i < maxTrainers; i++) {
      const entry = trainers[i];
      if (entry) {
        const c = countFor(weeklyCounts, entry.userId);
        lines.push(`${i + 1}. ${formatUserWithCount(entry.userId, c)}`);
      } else {
        lines.push(`${i + 1}. —`);
      }
    }

    lines.push('');
    lines.push('────────────');
    lines.push('');
    lines.push('🟦  Supervisors 🟦');

    const maxSup = state.roles.supervisor.max;
    for (let i = 0; i < maxSup; i++) {
      const entry = supervisors[i];
      if (entry) {
        const c = countFor(weeklyCounts, entry.userId);
        lines.push(`${i + 1}. ${formatUserWithCount(entry.userId, c)}`);
      } else {
        lines.push(`${i + 1}. —`);
      }
    }

    lines.push('');
    lines.push('────────────');
    lines.push('');
    lines.push('⚪  Spectators ⚪');

    const maxSpectators = state.roles.spectator.max;
    for (let i = 0; i < maxSpectators; i++) {
      const entry = spectators[i];
      if (entry) {
        const c = countFor(weeklyCounts, entry.userId);
        lines.push(`${i + 1}. ${formatUserWithCount(entry.userId, c)}`);
      } else {
        lines.push(`${i + 1}. —`);
      }
    }

    lines.push('');
    lines.push(
      '🧊 You should now join! Please join within **5 minutes**, or your spot will be given to someone else.'
    );
    lines.push(
      '🧊 Failure to join on time will result in a **written warning**. :('
    );

    return lines.join('\n');
  }

  // mass shift
  const cohost = (state.roles.cohost && getSelected('cohost')[0]) || null;
  const overseer = (state.roles.overseer && getSelected('overseer')[0]) || null;
  const attendees = getSelected('attendee');

  const lines = [];

  lines.push('╔══════════════════════════════════════╗');
  lines.push('                              ✅  SELECTED ATTENDEES ✅');
  lines.push('╚══════════════════════════════════════╝');
  lines.push('');
  lines.push(`🧊 Host: ${hostLine}`);
  lines.push(
    `🧊 Co-Host: ${
      cohost ? formatUserWithCount(cohost.userId, countFor(weeklyCounts, cohost.userId)) : '—'
    }`
  );
  lines.push(
    `🧊 Overseer: ${
      overseer ? formatUserWithCount(overseer.userId, countFor(weeklyCounts, overseer.userId)) : '—'
    }`
  );
  lines.push('');
  lines.push('────────────');
  lines.push('');
  lines.push('🟣  Attendees  🟣');

  const maxAttendees = state.roles.attendee.max;
  for (let i = 0; i < maxAttendees; i++) {
    const entry = attendees[i];
    if (entry) {
      const c = countFor(weeklyCounts, entry.userId);
      lines.push(`${i + 1}. ${formatUserWithCount(entry.userId, c)}`);
    } else {
      lines.push(`${i + 1}. —`);
    }
  }

  lines.push('');
  lines.push(
    '🧊 You should now join! Please join within **5 minutes**, or your spot will be given to someone else.'
  );
  lines.push(
    '🧊 Failure to join on time will result in a **written warning**. :('
  );

  return lines.join('\n');
}

async function finalizeAttendeesForCard({ client, rawCardInput }) {
  const cardShortId = extractCardShortId(rawCardInput);
  if (!cardShortId) {
    console.warn('[QUEUE] Could not parse Trello card id from:', rawCardInput);
    return false;
  }

  const state = queues.get(cardShortId);
  if (!state) {
    console.warn('[QUEUE] No active queue for card', cardShortId);
    return false;
  }

  if (state.isClosed) {
    console.warn('[QUEUE] Queue already closed for card', cardShortId);
    return false;
  }

  state.isClosed = true;

  // Disable buttons visually (optional, but nice UX)
  try {
    const channel = await client.channels.fetch(state.queueMessageChannelId);
    const message = await channel.messages.fetch(state.queueMessageId);

    const disabledComponents = message.components.map(row => {
      const newRow = new ActionRowBuilder();
      newRow.addComponents(
        row.components.map(comp =>
          ButtonBuilder.from(comp).setDisabled(true)
        )
      );
      return newRow;
    });

    await message.edit({ components: disabledComponents });
  } catch (err) {
    console.warn('[QUEUE] Failed to disable buttons for card', cardShortId, err);
  }

  const attendeesChannelId = state.attendeesChannelId || state.queueChannelId;
  const attendeesChannel = await client.channels.fetch(attendeesChannelId).catch(() => null);
  if (!attendeesChannel) {
    console.error('[QUEUE] Could not fetch attendees channel', attendeesChannelId);
    return false;
  }

  const weeklyCounts = await getWeeklySessionCounts();
  const content = buildAttendeesMessage(state, weeklyCounts);

  await attendeesChannel.send({ content });

  console.log('[QUEUE] Posted attendees for card', cardShortId);
  return true;
}

// ===== BUTTON HANDLER =====

async function handleQueueButtonInteraction(interaction) {
  const customId = interaction.customId;
  if (!customId || !customId.startsWith('queue_')) return false;

  const messageId = interaction.message.id;
  const cardShortId = messageToCard.get(messageId);
  if (!cardShortId) {
    await interaction.reply({
      content: 'This queue is no longer active or has expired.',
      ephemeral: true,
    });
    return true;
  }

  const state = queues.get(cardShortId);
  if (!state) {
    await interaction.reply({
      content: 'This queue is no longer active or has expired.',
      ephemeral: true,
    });
    return true;
  }

  if (state.isClosed) {
    await interaction.reply({
      content: 'This queue has already been closed. Please check the attendees post.',
      ephemeral: true,
    });
    return true;
  }

  const roleKey = customIdToRoleKey(customId);
  const userId = interaction.user.id;

  // Leave queue
  if (roleKey === 'leave') {
    const hadAny = removeUserFromAllRoles(state, userId);
    if (hadAny) {
      await interaction.reply({
        content: 'You have been removed from all queues for this session.',
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: 'You are not currently in any queue for this session.',
        ephemeral: true,
      });
    }
    return true;
  }

  const roleState = state.roles[roleKey];
  if (!roleState) {
    await interaction.reply({
      content: 'That role is not available in this queue.',
      ephemeral: true,
    });
    return true;
  }

  // SINGLE ROLE ONLY: remove from other roles first
  removeUserFromAllRoles(state, userId);

  if (roleState.members.some(m => m.userId === userId)) {
    await interaction.reply({
      content: `You are already in the **${roleLabelFor(state.sessionType, roleKey)}** queue.`,
      ephemeral: true,
    });
    return true;
  }

  if (roleState.members.length >= roleState.max) {
    await interaction.reply({
      content: `The **${roleLabelFor(state.sessionType, roleKey)}** queue is already full.`,
      ephemeral: true,
    });
    return true;
  }

  roleState.members.push({ userId, joinedAt: Date.now() });

  await interaction.reply({
    content: `You have been added to the **${roleLabelFor(state.sessionType, roleKey)}** queue.`,
    ephemeral: true,
  });

  // DM is optional; ignore failures
  try {
    const dm = await interaction.user.createDM();
    await dm.send(
      `You have been added to the **${roleLabelFor(
        state.sessionType,
        roleKey
      )}** queue.\nTrello Card: https://trello.com/c/${state.cardShortId}`
    );
  } catch {
    // ignore
  }

  return true;
}

module.exports = {
  handleQueueButtonInteraction,
  openQueueForCard,
  finalizeAttendeesForCard,
};
