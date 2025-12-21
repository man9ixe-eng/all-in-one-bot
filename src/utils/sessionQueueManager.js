// src/utils/sessionQueueManager.js

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const { trelloRequest } = require('./trelloClient');
const { getWeeklySessionCounts } = require('./hyraClient');
const {
  TRELLO_LABEL_INTERVIEW_ID,
  TRELLO_LABEL_TRAINING_ID,
  TRELLO_LABEL_MASS_SHIFT_ID,
} = require('../config/trello');

// In-memory queue state
// key: cardShortId -> state
const queueStates = new Map();

/**
 * We keep the export names the same so index.js and sessionAnnouncements.js
 * don't need to change:
 *   - openQueueForCard(client, cardInput, options)
 *   - handleQueueButtonInteraction(interaction)
 *   - closeQueueForCardAndPickAttendees(client, cardShortId)
 */

// ------------- Helpers -------------

function parseCardShortId(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();

  // Full Trello URL: https://trello.com/c/SHORTID/whatever
  const m = trimmed.match(/\/c\/([a-zA-Z0-9]+)/);
  if (m) return m[1];

  // Just short id
  if (/^[a-zA-Z0-9]{5,10}$/.test(trimmed)) return trimmed;

  return null;
}

function detectSessionType(card) {
  const name = (card.name || '').toLowerCase();
  const idLabels = Array.isArray(card.idLabels) ? card.idLabels : [];

  if (name.includes('interview')) return 'interview';
  if (name.includes('training')) return 'training';
  if (name.includes('mass shift') || name.includes('mass_shift')) return 'mass_shift';

  if (TRELLO_LABEL_INTERVIEW_ID && idLabels.includes(TRELLO_LABEL_INTERVIEW_ID)) {
    return 'interview';
  }
  if (TRELLO_LABEL_TRAINING_ID && idLabels.includes(TRELLO_LABEL_TRAINING_ID)) {
    return 'training';
  }
  if (TRELLO_LABEL_MASS_SHIFT_ID && idLabels.includes(TRELLO_LABEL_MASS_SHIFT_ID)) {
    return 'mass_shift';
  }

  return null;
}

// Channels and ping roles (we support both old and new env names)
const SESSION_INTERVIEW_QUEUE_CHANNEL_ID =
  process.env.SESSION_INTERVIEW_QUEUE_CHANNEL_ID ||
  process.env.SESSION_INTERVIEW_CHANNEL_ID;

const SESSION_TRAINING_QUEUE_CHANNEL_ID =
  process.env.SESSION_TRAINING_QUEUE_CHANNEL_ID ||
  process.env.SESSION_TRAINING_CHANNEL_ID;

const SESSION_MASS_SHIFT_QUEUE_CHANNEL_ID =
  process.env.SESSION_MASS_SHIFT_QUEUE_CHANNEL_ID ||
  process.env.SESSION_MASS_SHIFT_CHANNEL_ID;

const SESSION_INTERVIEW_ATTENDEES_CHANNEL_ID =
  process.env.SESSION_INTERVIEW_ATTENDEES_CHANNEL_ID ||
  process.env.SESSION_INTERVIEW_ATTENDEES_CHANNEL;

const SESSION_TRAINING_ATTENDEES_CHANNEL_ID =
  process.env.SESSION_TRAINING_ATTENDEES_CHANNEL_ID ||
  process.env.SESSION_TRAINING_ATTENDEES_CHANNEL;

const SESSION_MASS_SHIFT_ATTENDEES_CHANNEL_ID =
  process.env.SESSION_MASS_SHIFT_ATTENDEES_CHANNEL_ID ||
  process.env.SESSION_MASS_SHIFT_ATTENDEES_CHANNEL;

const QUEUE_INTERVIEW_PING_ROLE_ID = process.env.QUEUE_INTERVIEW_PING_ROLE_ID;
const QUEUE_TRAINING_PING_ROLE_ID = process.env.QUEUE_TRAINING_PING_ROLE_ID;
const QUEUE_MASS_SHIFT_PING_ROLE_ID = process.env.QUEUE_MASS_SHIFT_PING_ROLE_ID;

function getChannelsForType(client, sessionType) {
  let queueChannelId;
  let attendeesChannelId;
  let pingRoleId;

  if (sessionType === 'interview') {
    queueChannelId = SESSION_INTERVIEW_QUEUE_CHANNEL_ID;
    attendeesChannelId = SESSION_INTERVIEW_ATTENDEES_CHANNEL_ID;
    pingRoleId = QUEUE_INTERVIEW_PING_ROLE_ID;
  } else if (sessionType === 'training') {
    queueChannelId = SESSION_TRAINING_QUEUE_CHANNEL_ID;
    attendeesChannelId = SESSION_TRAINING_ATTENDEES_CHANNEL_ID;
    pingRoleId = QUEUE_TRAINING_PING_ROLE_ID;
  } else if (sessionType === 'mass_shift') {
    queueChannelId = SESSION_MASS_SHIFT_QUEUE_CHANNEL_ID;
    attendeesChannelId = SESSION_MASS_SHIFT_ATTENDEES_CHANNEL_ID;
    pingRoleId = QUEUE_MASS_SHIFT_PING_ROLE_ID;
  }

  if (!queueChannelId || !attendeesChannelId) {
    console.log('[QUEUE] Missing channel config for session type:', sessionType);
    return null;
  }

  const queueChannel = client.channels.cache.get(queueChannelId);
  const attendeesChannel = client.channels.cache.get(attendeesChannelId);

  if (!queueChannel || !attendeesChannel) {
    console.log('[QUEUE] Could not resolve channels for session type:', sessionType);
    return null;
  }

  return { queueChannel, attendeesChannel, pingRoleId };
}

// Default role definitions per session type
function createRoleConfig(sessionType) {
  if (sessionType === 'interview') {
    return {
      cohost: { label: 'Co-Host', maxSlots: 1, members: [] },
      overseer: { label: 'Overseer', maxSlots: 1, members: [] },
      interviewer: { label: 'Interviewer', maxSlots: 12, members: [] },
      spectator: { label: 'Spectator', maxSlots: 4, members: [] },
    };
  } else if (sessionType === 'training') {
    return {
      cohost: { label: 'Co-Host', maxSlots: 1, members: [] },
      overseer: { label: 'Overseer', maxSlots: 1, members: [] },
      trainer: { label: 'Trainer', maxSlots: 8, members: [] },
      spectator: { label: 'Spectator', maxSlots: 4, members: [] },
    };
  } else if (sessionType === 'mass_shift') {
    return {
      cohost: { label: 'Co-Host', maxSlots: 1, members: [] },
      overseer: { label: 'Overseer', maxSlots: 1, members: [] },
      attendee: { label: 'Attendee', maxSlots: 15, members: [] },
    };
  }

  return {};
}

function makeMemberEntry(user) {
  return {
    userId: user.id,
    mention: `<@${user.id}>`,
    joinedAt: Date.now(),
  };
}

function removeUserFromAllRoles(state, userId) {
  if (!state || !state.roles) return;
  for (const roleKey of Object.keys(state.roles)) {
    const role = state.roles[roleKey];
    if (!role || !Array.isArray(role.members)) continue;
    role.members = role.members.filter(m => m.userId !== userId);
  }
}

// -------- Queue message / attendees formatting --------

function buildQueueMessageContent(sessionType, card, hostMention, dueDate) {
  const unix = dueDate ? Math.floor(dueDate.getTime() / 1000) : null;

  const headerTop = '╔══════════════════════════════════════╗';
  const headerBottom = '╚══════════════════════════════════════╝';

  let middle;
  if (sessionType === 'interview') {
    middle = '🟡 INTERVIEW | HOST | TIME 🟡';
  } else if (sessionType === 'training') {
    middle = '🔴 TRAINING | HOST | TIME 🔴';
  } else {
    middle = '🟣 MASS SHIFT | HOST | TIME 🟣';
  }

  const lines = [
    headerTop,
    `                        ${middle}`,
    headerBottom,
    '',
    `📌 Host: ${hostMention || 'Unknown'}`,
  ];

  if (unix) {
    lines.push(`📌 Starts: <t:${unix}:R>`);
    lines.push(`📌 Time: <t:${unix}:t>`);
  }

  lines.push('', '💠 ROLES 💠', '----------------------------------------------------------------');

  if (sessionType === 'interview') {
    lines.push(
      'ℹ️ **Co-Host:** Corporate Intern+',
      'ℹ️ **Overseer:** Executive Manager+',
      'ℹ️ **Interviewer (12):** Leadership Intern+',
      'ℹ️ **Spectator (4):** Leadership Intern+',
    );
  } else if (sessionType === 'training') {
    lines.push(
      'ℹ️ **Co-Host:** Corporate Intern+',
      'ℹ️ **Overseer:** Executive Manager+',
      'ℹ️ **Trainer (8):** Leadership Intern+',
      'ℹ️ **Spectator (4):** Leadership Intern+',
    );
  } else if (sessionType === 'mass_shift') {
    lines.push(
      'ℹ️ **Co-Host:** Corporate Intern+',
      'ℹ️ **Overseer:** Executive Manager+',
      'ℹ️ **Attendee (15):** Leadership Intern+',
    );
  }

  lines.push(
    '',
    '❓  HOW TO JOIN THE QUEUE ❓',
    '----------------------------------------------------------------',
    '- Check the role list above — if your rank is allowed, press the role button you want.',
    `- You’ll get a private message that says: “You have been added to the (ROLE) Queue.”`,
    '- Do NOT join until you are pinged in “Session Attendees” **15 minutes before** the session starts.',
    '- Line up on the number/role you are selected for on "Session Attendees".',
    '- You have 5 minutes after the attendees post is made to join.',
    '',
    '❓ HOW TO LEAVE THE QUEUE / INFORM LATE ARRIVAL ❓',
    '----------------------------------------------------------------',
    '- Click the "Leave Queue" button, which will show up once you join the queue.',
    '- After the attendees post is made, changes must be handled by the host/corporate manually.',
    '',
    '----------------------------------------------------------------',
    '╭─────── 💠 LINKS 💠 ───────────╮',
    `〰️ **Trello Card:** ${card.shortUrl || card.url}`,
    '╰─────────────────────────────╯',
  );

  return lines.join('\n');
}

function formatAttendeesBlock(sessionType, hostMention, selections, countsMap, trelloUrl) {
  const lines = [];

  lines.push('╔══════════════════════════════════════╗');
  lines.push('                              ✅  SELECTED ATTENDEES ✅');
  lines.push('╚══════════════════════════════════════╝');
  lines.push('');

  const hostLine = hostMention ? hostMention : 'Not set';

  const coHost = selections.cohost[0];
  const overseer = selections.overseer[0];

  function fmt(member) {
    if (!member) return 'None';
    const id = member.userId || member.id;
    const mention = member.mention || (id ? `<@${id}>` : 'Unknown');
    const count = countsMap.get(String(id)) ?? 0;
    return `${mention} (${count})`;
  }

  lines.push(`🧊 Host: ${hostLine}`);
  lines.push(`🧊 Co-Host: ${fmt(coHost)}`);
  lines.push(`🧊 Overseer: ${fmt(overseer)}`);
  lines.push('');
  lines.push('────────────');
  lines.push('');

  if (sessionType === 'interview') {
    lines.push('🟡  Interviewers 🟡');
    selections.interviewer.forEach((m, idx) => {
      lines.push(`${idx + 1}. ${fmt(m)}`);
    });
    for (let i = selections.interviewer.length; i < 12; i++) {
      lines.push(`${i + 1}.`);
    }
    lines.push('');
    lines.push('────────────');
    lines.push('');
    lines.push('⚪  Spectators ⚪');
    selections.spectator.forEach((m, idx) => {
      lines.push(`${idx + 1}. ${fmt(m)}`);
    });
    for (let i = selections.spectator.length; i < 4; i++) {
      lines.push(`${i + 1}.`);
    }
  } else if (sessionType === 'training') {
    lines.push('🔴  Trainers 🔴');
    selections.trainer.forEach((m, idx) => {
      lines.push(`${idx + 1}. ${fmt(m)}`);
    });
    for (let i = selections.trainer.length; i < 8; i++) {
      lines.push(`${i + 1}.`);
    }
    lines.push('');
    lines.push('────────────');
    lines.push('');
    lines.push('⚪  Spectators ⚪');
    selections.spectator.forEach((m, idx) => {
      lines.push(`${idx + 1}. ${fmt(m)}`);
    });
    for (let i = selections.spectator.length; i < 4; i++) {
      lines.push(`${i + 1}.`);
    }
  } else if (sessionType === 'mass_shift') {
    lines.push('🟣  Attendees 🟣');
    selections.attendee.forEach((m, idx) => {
      lines.push(`${idx + 1}. ${fmt(m)}`);
    });
    for (let i = selections.attendee.length; i < 15; i++) {
      lines.push(`${i + 1}.`);
    }
  }

  lines.push('');
  lines.push('────────────');
  lines.push('');
  lines.push('🧊 You should now join! Please join within **5 minutes**, or your spot will be given to someone else.');
  lines.push('🧊 Failure to join on time will result in a **written warning**. :(');
  lines.push('');
  if (trelloUrl) {
    lines.push(`🔗 Trello Card: ${trelloUrl}`);
  }

  return lines.join('\n');
}

// ------------- Core open / close logic -------------

async function openQueueForCard(client, cardInput, options = {}) {
  const cardShortId = parseCardShortId(cardInput);
  console.log('[QUEUE] Raw card option:', cardInput);

  if (!cardShortId) {
    console.log('[QUEUE] Could not parse Trello card id from:', cardInput);
    return false;
  }

  // Avoid opening duplicate queues
  if (queueStates.has(cardShortId)) {
    const state = queueStates.get(cardShortId);
    if (!state.closed) {
      console.log('[QUEUE] Queue already open for card', cardShortId);
      return true;
    }
  }

  // Load card details
  const cardRes = await trelloRequest(`/cards/${cardShortId}`, 'GET', {
    fields: 'name,desc,due,idLabels,shortUrl,url',
  });

  if (!cardRes.ok || !cardRes.data) {
    console.error('[QUEUE] Failed to load Trello card', cardShortId, cardRes.status, cardRes.data);
    return false;
  }

  const card = cardRes.data;
  const sessionType = detectSessionType(card);

  if (!sessionType) {
    console.log('[QUEUE] Could not detect session type for card', cardShortId);
    return false;
  }

  const chans = getChannelsForType(client, sessionType);
  if (!chans) return false;
  const { queueChannel, attendeesChannel, pingRoleId } = chans;

  // Parse host from card description: "Host: username (DISCORD_ID)"
  let hostDiscordId = null;
  let hostLabel = 'Unknown';
  const desc = card.desc || '';
  const hostMatch = desc.match(/Host:\s*(.+?)\s*\((\d{15,})\)/i);
  if (hostMatch) {
    hostLabel = hostMatch[1].trim();
    hostDiscordId = hostMatch[2].trim();
  }

  let hostMention = hostDiscordId ? `<@${hostDiscordId}>` : hostLabel;

  const dueDate = card.due ? new Date(card.due) : null;
  const content = buildQueueMessageContent(sessionType, card, hostMention, dueDate);

  // Buttons for roles
  const rows = [];

  if (sessionType === 'interview') {
    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`queue:join:cohost:${cardShortId}`)
        .setLabel('Co-Host')
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId(`queue:join:overseer:${cardShortId}`)
        .setLabel('Overseer')
        .setStyle(ButtonStyle.Secondary),
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`queue:join:interviewer:${cardShortId}`)
        .setLabel('Interviewer')
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId(`queue:join:spectator:${cardShortId}`)
        .setLabel('Spectator')
        .setStyle(ButtonStyle.Secondary),
    );

    const row3 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`queue:leave:${cardShortId}`)
        .setLabel('Leave Queue')
        .setStyle(ButtonStyle.Danger),
    );

    rows.push(row1, row2, row3);
  } else if (sessionType === 'training') {
    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`queue:join:cohost:${cardShortId}`)
        .setLabel('Co-Host')
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId(`queue:join:overseer:${cardShortId}`)
        .setLabel('Overseer')
        .setStyle(ButtonStyle.Secondary),
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`queue:join:trainer:${cardShortId}`)
        .setLabel('Trainer')
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId(`queue:join:spectator:${cardShortId}`)
        .setLabel('Spectator')
        .setStyle(ButtonStyle.Secondary),
    );

    const row3 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`queue:leave:${cardShortId}`)
        .setLabel('Leave Queue')
        .setStyle(ButtonStyle.Danger),
    );

    rows.push(row1, row2, row3);
  } else if (sessionType === 'mass_shift') {
    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`queue:join:cohost:${cardShortId}`)
        .setLabel('Co-Host')
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId(`queue:join:overseer:${cardShortId}`)
        .setLabel('Overseer')
        .setStyle(ButtonStyle.Secondary),
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`queue:join:attendee:${cardShortId}`)
        .setLabel('Attendee')
        .setStyle(ButtonStyle.Success),
    );

    const row3 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`queue:leave:${cardShortId}`)
        .setLabel('Leave Queue')
        .setStyle(ButtonStyle.Danger),
    );

    rows.push(row1, row2, row3);
  }

  const pingContent = pingRoleId ? `<@&${pingRoleId}>\n${content}` : content;

  const msg = await queueChannel.send({
    content: pingContent,
    components: rows,
  });

  const state = {
    cardShortId,
    sessionType,
    cardUrl: card.shortUrl || card.url,
    hostDiscordId,
    hostMention,
    guildId: msg.guildId,
    queueChannelId: msg.channelId,
    queueMessageId: msg.id,
    attendeesChannelId: attendeesChannel.id,
    attendeesMessageId: null,
    roles: createRoleConfig(sessionType),
    closed: false,
  };

  queueStates.set(cardShortId, state);

  console.log('[QUEUE] Opened queue for card', cardShortId, 'in channel', msg.channelId);

  return true;
}

/**
 * Called by announcement tick or /sessionattendees to close queue and post attendees.
 * If the queue state doesn't exist, it still tries to build from empty sets.
 */
async function closeQueueForCardAndPickAttendees(client, cardShortId) {
  const state = queueStates.get(cardShortId);
  if (!state) {
    console.log('[QUEUE] No queue state for card', cardShortId, 'but attempting to post attendees anyway.');
  } else if (state.closed) {
    console.log('[QUEUE] Queue already closed for card', cardShortId);
    return true;
  } else {
    console.log('[QUEUE] Closing queue for card', cardShortId);
    state.closed = true;
  }

  const effectiveState = state || {
    cardShortId,
    sessionType: 'interview',
    roles: createRoleConfig('interview'),
    attendeesChannelId: SESSION_INTERVIEW_ATTENDEES_CHANNEL_ID,
    cardUrl: null,
    hostMention: 'Unknown',
  };

  // Get weekly session counts from Hyra
  let countsMap = new Map();
  try {
    countsMap = await getWeeklySessionCounts();
  } catch (err) {
    console.error('[QUEUE] Failed to load Hyra stats:', err);
  }

  // Selection algorithm: sort by (sessions asc, joinedAt asc)
  const selections = {};
  const roles = effectiveState.roles || {};

  for (const [key, def] of Object.entries(roles)) {
    if (!def || !Array.isArray(def.members)) {
      selections[key] = [];
      continue;
    }

    const sorted = def.members.slice().sort((a, b) => {
      const aId = String(a.userId || a.id || '');
      const bId = String(b.userId || b.id || '');
      const aCount = countsMap.get(aId) ?? 0;
      const bCount = countsMap.get(bId) ?? 0;

      if (aCount !== bCount) return aCount - bCount;
      return (a.joinedAt || 0) - (b.joinedAt || 0);
    });

    selections[key] = sorted.slice(0, def.maxSlots || sorted.length);
  }

  const attendeesChannel = client.channels.cache.get(effectiveState.attendeesChannelId);
  if (!attendeesChannel) {
    console.error('[QUEUE] Could not resolve attendees channel for card', cardShortId);
    return false;
  }

  const text = formatAttendeesBlock(
    effectiveState.sessionType,
    effectiveState.hostMention,
    selections,
    countsMap,
    effectiveState.cardUrl,
  );

  const pingLine = '@everyone';
  const msg = await attendeesChannel.send({
    content: pingLine + '\n' + text,
  });

  if (state) {
    state.attendeesMessageId = msg.id;
  }

  console.log('[QUEUE] Posted attendees for card', cardShortId);
  return true;
}

// ------------- Button handler -------------

async function handleQueueButtonInteraction(interaction) {
  if (!interaction.isButton()) return false;

  const customId = interaction.customId || '';
  if (!customId.startsWith('queue:')) return false;

  const parts = customId.split(':'); // queue:join:role:cardId or queue:leave:cardId
  const action = parts[1];
  const roleKey = action === 'join' ? parts[2] : null;
  const cardShortId = action === 'join' ? parts[3] : parts[2];

  const state = queueStates.get(cardShortId);
  if (!state || state.closed) {
    await interaction.reply({
      content: 'This queue is no longer active.',
      ephemeral: true,
    });
    return true;
  }

  const member = interaction.member;
  const userId = interaction.user.id;

  if (action === 'leave') {
    removeUserFromAllRoles(state, userId);
    await interaction.reply({
      content: 'You have been removed from all queues for this session.',
      ephemeral: true,
    });
    return true;
  }

  if (action === 'join') {
    const def = state.roles[roleKey];
    if (!def) {
      await interaction.reply({
        content: 'That queue role no longer exists for this session.',
        ephemeral: true,
      });
      return true;
    }

    // Check capacity
    if (def.members.length >= (def.maxSlots || 9999)) {
      await interaction.reply({
        content: `The ${def.label} queue is currently full.`,
        ephemeral: true,
      });
      return true;
    }

    // Remove from any other role first
    removeUserFromAllRoles(state, userId);

    def.members.push(makeMemberEntry(interaction.user));

    await interaction.reply({
      content: `You have been added to the **${def.label}** queue.`,
      ephemeral: true,
    });
    return true;
  }

  return false;
}

module.exports = {
  openQueueForCard,
  handleQueueButtonInteraction,
  closeQueueForCardAndPickAttendees,
};
