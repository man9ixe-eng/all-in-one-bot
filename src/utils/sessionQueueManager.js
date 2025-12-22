// src/utils/sessionQueueManager.js
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { trelloRequest } = require('./trelloClient');

// In-memory queue state
// shortId -> {
//   shortId,
//   sessionType,
//   trelloUrl,
//   hostId,
//   hostName,
//   due,
//   queueMessageId,
//   channelId,
//   createdAt,
//   roles: { key: { label, max, queue: [userId, ...] } },
//   closed
// }
const queueState = new Map();

const QUEUE_CONFIG = {
  interview: {
    displayName: 'INTERVIEW',
    channelEnv: 'SESSION_QUEUECHANNEL_INTERVIEW_ID',
    pingRoleEnv: 'SESSION_QUEUE_PING_INTERVIEW_ROLE_ID',
    roleLines: [
      'ℹ️ Co-Host: Corporate Intern+',
      'ℹ️ Overseer: Executive Manager+',
      'ℹ️ Interviewer (12): Leadership Intern+',
      'ℹ️ Spectator (4): Leadership Intern+',
    ],
    roleButtons: [
      { key: 'cohost', label: 'Co-Host', max: 1 },
      { key: 'overseer', label: 'Overseer', max: 1 },
      { key: 'interviewer', label: 'Interviewer', max: 12 },
      { key: 'spectator', label: 'Spectator', max: 4 },
    ],
    attendeesLayout: [
      { type: 'top', key: 'cohost', label: 'Co-Host' },
      { type: 'top', key: 'overseer', label: 'Overseer' },
      { type: 'section', title: '🟡  Interviewers 🟡', key: 'interviewer' },
      { type: 'section', title: '⚪  Spectators ⚪', key: 'spectator' },
    ],
  },
  training: {
    displayName: 'TRAINING',
    channelEnv: 'SESSION_QUEUECHANNEL_TRAINING_ID',
    pingRoleEnv: 'SESSION_QUEUE_PING_TRAINING_ROLE_ID',
    roleLines: [
      'ℹ️ Co-Host: Corporate Intern+',
      'ℹ️ Overseer: Executive Manager+',
      'ℹ️ Trainer (6): Leadership Intern+',
      'ℹ️ Supervisor (4): Supervisor+',
      'ℹ️ Spectator (4): Leadership Intern+',
    ],
    roleButtons: [
      { key: 'cohost', label: 'Co-Host', max: 1 },
      { key: 'overseer', label: 'Overseer', max: 1 },
      { key: 'trainer', label: 'Trainer', max: 6 },
      { key: 'supervisor', label: 'Supervisor', max: 4 },
      { key: 'spectator', label: 'Spectator', max: 4 },
    ],
    attendeesLayout: [
      { type: 'top', key: 'cohost', label: 'Co-Host' },
      { type: 'top', key: 'overseer', label: 'Overseer' },
      { type: 'section', title: '🟡  Trainers 🟡', key: 'trainer' },
      { type: 'section', title: '🟣  Supervisors 🟣', key: 'supervisor' },
      { type: 'section', title: '⚪  Spectators ⚪', key: 'spectator' },
    ],
  },
  massshift: {
    displayName: 'MASS SHIFT',
    channelEnv: 'SESSION_QUEUECHANNEL_MASSSHIFT_ID',
    pingRoleEnv: 'SESSION_QUEUE_PING_MASS_SHIFT_ROLE_ID',
    roleLines: [
      'ℹ️ Co-Host: Corporate Intern+',
      'ℹ️ Overseer: Executive Manager+',
      'ℹ️ Shift Leader (6): Leadership Intern+',
    ],
    roleButtons: [
      { key: 'cohost', label: 'Co-Host', max: 2 },
      { key: 'overseer', label: 'Overseer', max: 2 },
      { key: 'shiftleader', label: 'Shift Leader', max: 6 },
    ],
    attendeesLayout: [
      { type: 'top', key: 'cohost', label: 'Co-Host' },
      { type: 'top', key: 'overseer', label: 'Overseer' },
      { type: 'section', title: '🔹  Shift Leaders 🔹', key: 'shiftleader' },
    ],
  },
};

// ---------- helpers ----------

function extractCardShortId(raw) {
  if (!raw) return null;

  const urlMatch = raw.match(/trello\.com\/c\/([a-zA-Z0-9]+)/);
  if (urlMatch) return urlMatch[1];

  const shortMatch = raw.match(/^[a-zA-Z0-9]{8}$/);
  if (shortMatch) return shortMatch[0];

  const parts = raw.split('/');
  const last = parts[parts.length - 1];
  return last.split('-')[0];
}

async function fetchCardInfo(shortId) {
  try {
    const params = {
      fields: 'id,shortLink,shortUrl,url,name,desc,due,labels',
      label_fields: 'name,color',
    };
    const card = await trelloRequest('GET', `/1/cards/${shortId}`, params);
    return card;
  } catch (err) {
    console.error('[TRELLO] Could not fetch card info:', err);
    return null;
  }
}

function detectSessionType(card) {
  const name = (card.name || '').toLowerCase();
  const labels = (card.labels || []).map((l) => (l.name || '').toLowerCase());

  if (name.includes('[interview]') || labels.includes('interview')) return 'interview';
  if (name.includes('[training]') || labels.includes('training')) return 'training';
  if (
    name.includes('[mass shift]') ||
    name.includes('[mass-shift]') ||
    labels.includes('mass shift')
  ) {
    return 'massshift';
  }

  return null;
}

function parseHostFromCard(card) {
  const desc = card.desc || '';
  const idMatch = desc.match(/Host:\s*.+?\((\d{17,})\)/i);
  const nameMatch = card.name.match(/-\s*([^\-]+)$/); // last " - Name"

  return {
    hostId: idMatch ? idMatch[1] : null,
    hostName: nameMatch ? nameMatch[1].trim() : 'Unknown Host',
  };
}

function formatTimeInfo(card) {
  if (!card.due) {
    return {
      dueDate: null,
      timeLabel: 'Time: TBA',
      startsInText: 'Starts: Time TBA',
    };
  }

  const dueDate = new Date(card.due);
  const now = new Date();
  const diffMs = dueDate - now;
  const diffMinutes = Math.round(diffMs / 60000);

  let startsInText;
  if (diffMinutes <= 0) startsInText = 'Starts: now';
  else if (diffMinutes === 1) startsInText = 'Starts: in 1 minute';
  else startsInText = `Starts: in ${diffMinutes} minutes`;

  const timeLabel = `Time: ${dueDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/New_York',
  })}`;

  return { dueDate, timeLabel, startsInText };
}

function buildQueueButtons(shortId, config) {
  const rows = [];
  const row1 = new ActionRowBuilder();
  const row2 = new ActionRowBuilder();

  config.roleButtons.forEach((role, index) => {
    const btn = new ButtonBuilder()
      .setCustomId(`queue:${shortId}:join:${role.key}`)
      .setLabel(role.label)
      .setStyle(ButtonStyle.Primary);

    if (index < 4) row1.addComponents(btn);
    else row2.addComponents(btn);
  });

  const leaveBtn = new ButtonBuilder()
    .setCustomId(`queue:${shortId}:leave`)
    .setLabel('Leave Queue')
    .setStyle(ButtonStyle.Danger);

  if (row2.components.length < 5) row2.addComponents(leaveBtn);
  else row1.addComponents(leaveBtn);

  if (row1.components.length) rows.push(row1);
  if (row2.components.length) rows.push(row2);

  return rows;
}

function ensureStateForCard(
  shortId,
  sessionType,
  trelloUrl,
  hostId,
  hostName,
  dueDate,
  channelId,
  config,
) {
  const state = {
    shortId,
    sessionType,
    trelloUrl,
    hostId,
    hostName,
    due: dueDate,
    queueMessageId: null,
    channelId,
    createdAt: Date.now(),
    roles: {},
    closed: false,
  };

  for (const role of config.roleButtons) {
    state.roles[role.key] = {
      label: role.label,
      max: role.max,
      queue: [],
    };
  }

  queueState.set(shortId, state);
  return state;
}

// ---------- main: open queue ----------

async function openQueueForCard(client, rawCardInput) {
  const shortId = extractCardShortId(rawCardInput);
  if (!shortId) {
    console.warn('[QUEUE] Could not parse Trello card id from:', rawCardInput);
    return { ok: false, reason: 'invalid-card' };
  }

  console.log('[QUEUE] Raw card option:', rawCardInput);

  const card = await fetchCardInfo(shortId);
  if (!card) {
    console.warn('[QUEUE] Could not fetch Trello card for shortId:', shortId);
    return { ok: false, reason: 'trello-not-found' };
  }

  const sessionType = detectSessionType(card);
  if (!sessionType || !QUEUE_CONFIG[sessionType]) {
    console.warn('[QUEUE] Could not detect session type for card:', card.name);
    return { ok: false, reason: 'unknown-session-type' };
  }

  const config = QUEUE_CONFIG[sessionType];
  const channelId = process.env[config.channelEnv];

  if (!channelId) {
    console.warn('[QUEUE] Missing channel config for session type:', sessionType);
    return { ok: false, reason: `missing-channel-${sessionType}` };
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    console.warn('[QUEUE] Channel not found or not text-based:', channelId);
    return { ok: false, reason: 'invalid-channel' };
  }

  const { hostId, hostName } = parseHostFromCard(card);
  const { dueDate, timeLabel, startsInText } = formatTimeInfo(card);
  const hostTag = hostId ? `<@${hostId}>` : hostName;

  const headerTop = '╔══════════════════════════════════════╗';
  const headerMid = `🟡 ${config.displayName} | ${hostTag} | ${timeLabel.replace('Time: ', '')} 🟡`;
  const headerBottom = '╚══════════════════════════════════════╝';

  const descriptionLines = [
    headerTop,
    headerMid,
    headerBottom,
    '',
    `📌 Host: ${hostTag}`,
    `📌 ${startsInText}`,
    `📌 ${timeLabel}`,
    '',
    '💠 ROLES 💠',
    '----------------------------------------------------------------',
    ...config.roleLines,
    '',
    '❓ HOW TO JOIN THE QUEUE ❓',
    '----------------------------------------------------------------',
    'Check the role list above — if your rank is allowed, press the role button you want.',
    'You’ll get a private confirmation message when you are added.',
    'Do NOT join the game until the attendees post is made in the attendees channel.',
    '',
    '❓ HOW TO LEAVE THE QUEUE / INFORM LATE ARRIVAL ❓',
    '----------------------------------------------------------------',
    'Click the Leave Queue button once you have joined a role.',
    'After the attendees post is made, changes must be handled by the host/corporate manually.',
    '',
    '----------------------------------------------------------------',
    '╭─────── 💠 LINKS 💠 ───────────╮',
    `• Trello Card: ${card.shortUrl || card.url}`,
    '╰─────────────────────────────╯',
  ];

  const embed = new EmbedBuilder()
    .setColor(0xffd166)
    .setDescription(descriptionLines.join('\n'));

  const buttons = buildQueueButtons(shortId, config);

  const pingRoleId = process.env[config.pingRoleEnv];
  const content = pingRoleId ? `<@&${pingRoleId}>` : '';

  const message = await channel.send({
    content,
    embeds: [embed],
    components: buttons,
  });

  const state = ensureStateForCard(
    shortId,
    sessionType,
    card.shortUrl || card.url,
    hostId,
    hostName,
    dueDate,
    channel.id,
    config,
  );
  state.queueMessageId = message.id;

  console.log(
    `[QUEUE] Opened queue for card ${shortId} in channel ${channel.id}`,
  );

  return { ok: true, channelId: channel.id, shortId };
}

// ---------- button handler ----------

async function handleQueueButtonInteraction(interaction) {
  if (!interaction.customId.startsWith('queue:')) return;

  const parts = interaction.customId.split(':');
  const shortId = parts[1];
  const action = parts[2];
  const roleKey = parts[3] || null;

  const state = queueState.get(shortId);
  if (!state || state.closed) {
    await interaction.reply({
      content: 'This queue is no longer active.',
      ephemeral: true,
    });
    return;
  }

  const userId = interaction.user.id;

  if (action === 'leave') {
    let removed = false;
    for (const role of Object.values(state.roles)) {
      const idx = role.queue.indexOf(userId);
      if (idx !== -1) {
        role.queue.splice(idx, 1);
        removed = true;
      }
    }

    await interaction.reply({
      content: removed
        ? 'You have been removed from the queue.'
        : 'You were not in this queue.',
      ephemeral: true,
    });
    return;
  }

  if (action === 'join') {
    const role = state.roles[roleKey];
    if (!role) {
      await interaction.reply({
        content: 'That role no longer exists for this queue.',
        ephemeral: true,
      });
      return;
    }

    let movedFrom = null;
    for (const [key, r] of Object.entries(state.roles)) {
      const idx = r.queue.indexOf(userId);
      if (idx !== -1) {
        if (key === roleKey) {
          await interaction.reply({
            content: `You are already queued as **${role.label}** for this session.`,
            ephemeral: true,
          });
          return;
        }
        r.queue.splice(idx, 1);
        movedFrom = r.label;
      }
    }

    if (role.queue.length >= role.max) {
      await interaction.reply({
        content: `The **${role.label}** queue is currently full.`,
        ephemeral: true,
      });
      return;
    }

    role.queue.push(userId);

    let msg = `You have been added as **${role.label}** for this session.`;
    if (movedFrom) msg += ` (You were moved from **${movedFrom}**.)`;

    await interaction.reply({
      content: msg,
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content: 'Unknown queue action.',
    ephemeral: true,
  });
}

// ---------- attendees post ----------

// Hyra integration is disabled for now to keep this stable.
async function getWeeklySessionCounts(userIds) {
  const result = {};
  for (const id of userIds) result[id] = null;
  return result;
}

function formatSessionsSuffix(count) {
  if (count == null) return '';
  if (count === 1) return ' (1 session)';
  return ` (${count} sessions)`;
}

async function postAttendeesForCard(client, rawCardInput) {
  const shortId = extractCardShortId(rawCardInput);
  if (!shortId) {
    console.warn('[ATTENDEES] Could not parse Trello card id from:', rawCardInput);
    return { ok: false, reason: 'invalid-card' };
  }

  const state = queueState.get(shortId);
  if (!state) {
    console.warn('[ATTENDEES] No queue found for card:', shortId);
    return { ok: false, reason: 'no-queue' };
  }

  const config = QUEUE_CONFIG[state.sessionType];
  if (!config) return { ok: false, reason: 'unknown-session-type' };

  const channel = await client.channels.fetch(state.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    return { ok: false, reason: 'invalid-channel' };
  }

  const selected = {};
  for (const roleCfg of config.roleButtons) {
    const roleState = state.roles[roleCfg.key];
    selected[roleCfg.key] = roleState
      ? roleState.queue.slice(0, roleCfg.max)
      : [];
  }

  const ids = new Set();
  if (state.hostId) ids.add(state.hostId);
  for (const list of Object.values(selected)) {
    for (const id of list) ids.add(id);
  }

  const sessionCounts = await getWeeklySessionCounts([...ids]);

  const lines = [];
  lines.push('╔══════════════════════════════════════╗');
  lines.push('                             ✅  SELECTED ATTENDEES ✅');
  lines.push('╚══════════════════════════════════════╝');
  lines.push('');

  const hostTag = state.hostId ? `<@${state.hostId}>` : state.hostName;
  const hostSessions = sessionCounts[state.hostId] ?? null;
  lines.push(`🧊 Host: ${hostTag}${formatSessionsSuffix(hostSessions)}`);

  for (const layout of config.attendeesLayout.filter((l) => l.type === 'top')) {
    const roleCfg = config.roleButtons.find((r) => r.key === layout.key);
    const userList = selected[layout.key] || [];
    const userId = userList[0];
    if (!roleCfg) continue;

    if (!userId) {
      lines.push(`🧊 ${layout.label}: None selected`);
    } else {
      const suffix = formatSessionsSuffix(sessionCounts[userId] ?? null);
      lines.push(`🧊 ${layout.label}: <@${userId}>${suffix}`);
    }
  }

  lines.push('');
  lines.push('────────────');
  lines.push('');

  for (const layout of config.attendeesLayout.filter((l) => l.type === 'section')) {
    const roleCfg = config.roleButtons.find((r) => r.key === layout.key);
    if (!roleCfg) continue;

    lines.push(layout.title);
    const list = selected[layout.key] || [];

    let index = 1;
    for (const userId of list) {
      const suffix = formatSessionsSuffix(sessionCounts[userId] ?? null);
      lines.push(`${index}. <@${userId}>${suffix}`);
      index++;
    }
    for (; index <= roleCfg.max; index++) {
      lines.push(`${index}.`);
    }

    lines.push('');
    lines.push('────────────');
    lines.push('');
  }

  lines.push(
    '🧊 You should now join! Please join within **5 minutes**, or your spot will be given to someone else.',
  );
  lines.push(
    '🧊 Failure to join on time will result in a **written warning**. :(',
  );

  const content = lines.join('\n');

  // IMPORTANT: no allowedMentions override here – Discord will ping normally,
  // and we avoid the "allowed_mentions.* Only iterables may be used in a SetType" error.
  await channel.send({ content });

  state.closed = true;

  console.log('[QUEUE] Posted attendees for card', shortId);

  return { ok: true, channelId: channel.id, shortId };
}

async function closeQueueForCard(shortId) {
  const state = queueState.get(shortId);
  if (state) state.closed = true;
}

module.exports = {
  handleQueueButtonInteraction,
  openQueueForCard,
  postAttendeesForCard,
  closeQueueForCard,
};
