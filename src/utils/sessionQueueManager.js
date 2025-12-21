// src/utils/sessionQueueManager.js

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');

const { atLeastTier } = require('./permissions');
const { trelloRequest } = require('./trelloClient');
const {
  SESSION_INTERVIEW_CHANNEL_ID,
  SESSION_TRAINING_CHANNEL_ID,
  SESSION_MASS_SHIFT_CHANNEL_ID,
  SESSION_INTERVIEW_PING_ROLE_ID,
  SESSION_TRAINING_PING_ROLE_ID,
  SESSION_MASS_SHIFT_PING_ROLE_ID,
  QUEUE_INTERVIEW_CHANNEL_ID,
  QUEUE_TRAINING_CHANNEL_ID,
  QUEUE_MASS_SHIFT_CHANNEL_ID,
  QUEUE_INTERVIEW_PING_ROLE_ID,
  QUEUE_TRAINING_PING_ROLE_ID,
  QUEUE_MASS_SHIFT_PING_ROLE_ID,
} = require('../config/sessionAnnouncements');

// =====================
// SESSION / QUEUE CONFIG
// =====================

const SESSION_CONFIG = {
  interview: {
    name: 'Interview',
    color: 0xffd54f, // soft yellow
    channelId: QUEUE_INTERVIEW_CHANNEL_ID || SESSION_INTERVIEW_CHANNEL_ID || null,
    pingRoleId: QUEUE_INTERVIEW_PING_ROLE_ID || SESSION_INTERVIEW_PING_ROLE_ID || null,
  },
  training: {
    name: 'Training',
    color: 0xef5350, // red-ish
    channelId: QUEUE_TRAINING_CHANNEL_ID || SESSION_TRAINING_CHANNEL_ID || null,
    pingRoleId: QUEUE_TRAINING_PING_ROLE_ID || SESSION_TRAINING_PING_ROLE_ID || null,
  },
  mass_shift: {
    name: 'Mass Shift',
    color: 0xab47bc, // purple-ish
    channelId: QUEUE_MASS_SHIFT_CHANNEL_ID || SESSION_MASS_SHIFT_CHANNEL_ID || null,
    pingRoleId: QUEUE_MASS_SHIFT_PING_ROLE_ID || SESSION_MASS_SHIFT_PING_ROLE_ID || null,
  },
};

// Role slots per session type
// minTier uses your existing tier system (Leadership Intern+, Corporate+, etc.)
const ROLE_SLOTS = {
  interview: {
    cohost: {
      label: 'Co-Host',
      emoji: '🧊',
      max: 1,
      minTier: 5, // Corporate Intern+
    },
    overseer: {
      label: 'Overseer',
      emoji: '🧊',
      max: 1,
      minTier: 5, // Exec Manager+
    },
    interviewer: {
      label: 'Interviewer',
      emoji: '🟡',
      max: 12,
      minTier: 3, // Leadership Intern+
    },
    spectator: {
      label: 'Spectator',
      emoji: '⚪',
      max: 4,
      minTier: 3, // Leadership Intern+
    },
  },

  // ⬇️ Training now includes Supervisor (4)
  training: {
    cohost: {
      label: 'Co-Host',
      emoji: '🧊',
      max: 1,
      minTier: 5, // Corporate Intern+
    },
    overseer: {
      label: 'Overseer',
      emoji: '🧊',
      max: 1,
      minTier: 5, // Exec Manager+
    },
    supervisor: {
      label: 'Supervisor',
      emoji: '🔹',
      max: 4,
      minTier: 4, // Leadership Intern+ (you can change this tier if you want)
    },
    trainer: {
      label: 'Trainer',
      emoji: '🔴',
      max: 8,
      minTier: 3, // Leadership Intern+
    },
    spectator: {
      label: 'Spectator',
      emoji: '⚪',
      max: 4,
      minTier: 3, // Leadership Intern+
    },
  },

  mass_shift: {
    cohost: {
      label: 'Co-Host',
      emoji: '🧊',
      max: 1,
      minTier: 5, // Corporate Intern+
    },
    overseer: {
      label: 'Overseer',
      emoji: '🧊',
      max: 1,
      minTier: 5, // Exec Manager+
    },
    attendee: {
      label: 'Attendee',
      emoji: '🟣',
      max: 15,
      minTier: 3, // Leadership Intern+
    },
  },
};

// In-memory queue state: cardId -> { sessionType, channelId, messageId, slots: { roleKey -> Set(userId) } }
const activeQueues = new Map();

// =====================
// HELPERS
// =====================

function extractCardIdFromUrl(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();

  // Already just a shortlink / id
  if (/^[a-zA-Z0-9]{8,}$/.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split('/').filter(Boolean);
    const idx = parts.indexOf('c');
    if (idx !== -1 && parts[idx + 1]) {
      return parts[idx + 1];
    }
    // Sometimes URLs are just /c/<shortlink>
    if (parts[0] === 'c' && parts[1]) return parts[1];
  } catch {
    // not a valid URL
  }

  return null;
}

function detectSessionTypeFromName(name) {
  if (!name) return null;
  const lower = name.toLowerCase();

  if (lower.includes('[interview]')) return 'interview';
  if (lower.includes('[training]')) return 'training';
  if (lower.includes('[mass shift]') || lower.includes('[mass_shift]')) return 'mass_shift';

  return null;
}

function extractHostFromDesc(desc) {
  if (!desc) return 'Unknown';
  const m = desc.match(/Host:\s*([^\n]+)/i);
  if (!m) return 'Unknown';
  // Typically "man9ixe (123456...)" → just take the name part
  const raw = m[1].trim();
  const idx = raw.indexOf('(');
  return idx === -1 ? raw : raw.slice(0, idx).trim();
}

// Builds the big text block for the queue embed
function buildQueueDescription(sessionType, hostName, dueTs, trelloUrl) {
  const lines = [];

  if (sessionType === 'interview') {
    lines.push('╔══════════════════════════════════════╗');
    lines.push(`                         🟡 INTERVIEW | ${hostName} | <t:${dueTs}:t> 🟡`);
    lines.push('╚══════════════════════════════════════╝');
    lines.push('');
    lines.push(`📌  Host: ${hostName}`);
    lines.push(`📌 Starts: <t:${dueTs}:R>`);
    lines.push(`📌 Time: <t:${dueTs}:t>`);
    lines.push('');
    lines.push('💠 ROLES 💠');
    lines.push('----------------------------------------------------------------');
    lines.push('ℹ️  **Co-Host:** Corporate Intern+');
    lines.push('ℹ️  **Overseer:** Executive Manager+');
    lines.push('ℹ️  **Interviewer (12):** Leadership Intern+');
    lines.push('ℹ️  **Spectator (4):** Leadership Intern+');
    lines.push('');
  } else if (sessionType === 'training') {
    // 🔴 TRAINING – with Supervisor
    lines.push('╔══════════════════════════════════════╗');
    lines.push(`                             🔴  TRAINING | ${hostName} | <t:${dueTs}:t>  🔴`);
    lines.push('╚══════════════════════════════════════╝');
    lines.push('');
    lines.push(`📌  Host: ${hostName}`);
    lines.push(`📌 Starts: <t:${dueTs}:R>`);
    lines.push(`📌 Time: <t:${dueTs}:t>`);
    lines.push('');
    lines.push('💠 ROLES 💠');
    lines.push('----------------------------------------------------------------');
    lines.push('ℹ️  **Co-Host:** Corporate Intern+');
    lines.push('ℹ️  **Overseer:** Executive Manager+');
    lines.push('ℹ️  **Supervisor (4):** Leadership Intern+');
    lines.push('ℹ️  **Trainer (8):** Leadership Intern+');
    lines.push('ℹ️  **Spectator (4):** Leadership Intern+');
    lines.push('');
  } else if (sessionType === 'mass_shift') {
    lines.push('╔══════════════════════════════════════╗');
    lines.push(`                         🟣  MASS SHIFT | ${hostName} | <t:${dueTs}:t>  🟣`);
    lines.push('╚══════════════════════════════════════╝');
    lines.push('');
    lines.push(`📌  Host: ${hostName}`);
    lines.push(`📌 Starts: <t:${dueTs}:R>`);
    lines.push(`📌 Time: <t:${dueTs}:t>`);
    lines.push('');
    lines.push('💠 ROLES 💠');
    lines.push('----------------------------------------------------------------');
    lines.push('ℹ️  **Co-Host:** Corporate Intern+');
    lines.push('ℹ️  **Overseer:** Executive Manager+');
    lines.push('ℹ️  **Attendee (15):** Leadership Intern+');
    lines.push('');
  }

  // Shared "How to join/leave" + link block
  lines.push('❓  HOW TO JOIN THE QUEUE ❓');
  lines.push('----------------------------------------------------------------');
  lines.push('- Check the role list above — if your rank is allowed, press the role button you want.');
  lines.push('- You’ll get a private message that says: “You have been added to the (ROLE) Queue.”');
  lines.push('- Do NOT join until you are pinged in “Session Attendees” **15 minutes before** the session starts.');
  lines.push('- Line up on the number/role you are selected for on "Session Attendees".');
  lines.push('- You have 5 minutes after session attendees is posted to join.');
  lines.push('');
  lines.push('❓ HOW TO LEAVE THE QUEUE/INFORM LATE ARRIVAL ❓');
  lines.push('----------------------------------------------------------------');
  lines.push('- Click the "Leave Que" button, which will show up once you join the que.');
  lines.push('- You can only leave the que BEFORE the session list is posted; after that, go to #session-lounge and PING your host to un-que.');
  lines.push('- If you do not let the host know anything before **5 mins** after an attendees post was made, you will be given a **Written Warning**, and your spot could be given up.');
  lines.push('----------------------------------------------------------------');
  lines.push('╭─────── 💠 LINKS 💠 ───────────╮');
  lines.push(`〰️ Trello Card: ${trelloUrl}`);
  lines.push('╰─────────────────────────────╯');

  return lines.join('\n');
}

function buildButtons(sessionType, cardId) {
  const roleConfig = ROLE_SLOTS[sessionType];
  if (!roleConfig) return [];

  const roleButtons = Object.entries(roleConfig).map(([roleKey, cfg]) =>
    new ButtonBuilder()
      .setCustomId(`queue|${sessionType}|${cardId}|${roleKey}`)
      .setLabel(cfg.label)
      .setStyle(ButtonStyle.Primary),
  );

  const leaveButton = new ButtonBuilder()
    .setCustomId(`queue|${sessionType}|${cardId}|leave`)
    .setLabel('Leave Que')
    .setStyle(ButtonStyle.Secondary);

  const rows = [];
  const firstRow = new ActionRowBuilder();
  const secondRow = new ActionRowBuilder();

  for (let i = 0; i < roleButtons.length; i++) {
    if (i < 3) firstRow.addComponents(roleButtons[i]);
    else secondRow.addComponents(roleButtons[i]);
  }
  secondRow.addComponents(leaveButton);

  if (firstRow.components.length > 0) rows.push(firstRow);
  if (secondRow.components.length > 0) rows.push(secondRow);

  return rows;
}

// =====================
// MAIN: OPEN QUEUE
// =====================

async function openQueueForCard(client, interaction, cardUrl) {
  const cardId = extractCardIdFromUrl(cardUrl);
  if (!cardId) {
    console.warn('[QUEUE] Could not parse Trello card id from:', cardUrl);
    return false;
  }

  const cardRes = await trelloRequest(`/cards/${cardId}`, 'GET', {
    fields: 'name,desc,due,shortUrl',
  });

  if (!cardRes.ok || !cardRes.data) {
    console.warn('[QUEUE] Failed to load Trello card', cardId, cardRes.status, cardRes.data);
    return false;
  }

  const card = cardRes.data;
  const sessionType = detectSessionTypeFromName(card.name);
  if (!sessionType || !SESSION_CONFIG[sessionType]) {
    console.warn('[QUEUE] Could not detect session type for card:', card.name);
    return false;
  }

  const cfg = SESSION_CONFIG[sessionType];
  if (!cfg.channelId) {
    console.warn('[QUEUE] Missing channel config for session type:', sessionType);
    return false;
  }

  const channel = await client.channels.fetch(cfg.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    console.warn('[QUEUE] Configured queue channel is not text-based or not found:', cfg.channelId);
    return false;
  }

  const due = card.due ? new Date(card.due) : null;
  if (!due || Number.isNaN(due.getTime())) {
    console.warn('[QUEUE] Card has no valid due date, cannot open queue:', cardId);
    return false;
  }
  const dueTs = Math.floor(due.getTime() / 1000);

  const hostName = extractHostFromDesc(card.desc || '');
  const trelloUrl = card.shortUrl || card.url || cardUrl;

  const embed = new EmbedBuilder()
    .setColor(cfg.color)
    .setDescription(buildQueueDescription(sessionType, hostName, dueTs, trelloUrl))
    .setFooter({ text: 'Glace Hotels | Session Queue' })
    .setTimestamp();

  const components = buildButtons(sessionType, cardId);
  const content = cfg.pingRoleId ? `<@&${cfg.pingRoleId}>` : null;

  const message = await channel.send({
    content,
    embeds: [embed],
    components,
  });

  // Initialize queue state
  const roleConfig = ROLE_SLOTS[sessionType] || {};
  const slots = {};
  for (const key of Object.keys(roleConfig)) {
    slots[key] = new Set();
  }

  activeQueues.set(cardId, {
    sessionType,
    channelId: message.channel.id,
    messageId: message.id,
    slots,
  });

  console.log('[QUEUE] Opened queue for card', cardId, 'in channel', message.channel.id);

  return true;
}

// =====================
// BUTTON HANDLER
// =====================

async function handleQueueButtonInteraction(interaction) {
  if (!interaction.isButton()) return false;

  const id = interaction.customId || '';
  const parts = id.split('|');
  if (parts.length !== 4 || parts[0] !== 'queue') return false;

  const sessionType = parts[1];
  const cardId = parts[2];
  const roleKey = parts[3];

  const queue = activeQueues.get(cardId);
  if (!queue || queue.sessionType !== sessionType) {
    await interaction.reply({
      content: 'This queue is no longer active or could not be found.',
      ephemeral: true,
    });
    return true;
  }

  if (roleKey === 'leave') {
    const userId = interaction.user.id;
    for (const set of Object.values(queue.slots)) {
      set.delete(userId);
    }

    await interaction.reply({
      content: 'You have been removed from the queue.',
      ephemeral: true,
    });
    return true;
  }

  const roleConfig = ROLE_SLOTS[sessionType] && ROLE_SLOTS[sessionType][roleKey];
  if (!roleConfig) {
    // Not one of our roles – ignore
    return false;
  }

  // Tier check
  if (!atLeastTier(interaction.member, roleConfig.minTier)) {
    await interaction.reply({
      content: `You must be at least **Tier ${roleConfig.minTier}** to join as **${roleConfig.label}**.`,
      ephemeral: true,
    });
    return true;
  }

  const userId = interaction.user.id;

  // Enforce max slots
  const slotSet = queue.slots[roleKey];
  if (slotSet.size >= roleConfig.max && !slotSet.has(userId)) {
    await interaction.reply({
      content: `The **${roleConfig.label}** queue is currently full.`,
      ephemeral: true,
    });
    return true;
  }

  // Remove from any other role slots
  for (const [key, set] of Object.entries(queue.slots)) {
    if (key !== roleKey) set.delete(userId);
  }

  // Add to this slot
  slotSet.add(userId);

  await interaction.reply({
    content: `You have been added to the **${roleConfig.label}** queue.`,
    ephemeral: true,
  });

  return true;
}

module.exports = {
  openQueueForCard,
  handleQueueButtonInteraction,
};

