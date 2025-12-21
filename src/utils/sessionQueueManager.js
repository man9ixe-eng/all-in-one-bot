// src/utils/sessionQueueManager.js

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

// ======================
// CONFIG
// ======================

// Per-session-type role config and max slots
const QUEUE_ROLE_CONFIG = {
  interview: {
    displayName: 'Interview',
    emoji: '🟡',
    roles: {
      cohost: { label: 'Co-Host', maxSlots: 1 },
      overseer: { label: 'Overseer', maxSlots: 1 },
      interviewer: { label: 'Interviewer', maxSlots: 12 },
      spectator: { label: 'Spectator', maxSlots: 4 },
    },
    pingEnv: 'QUEUE_INTERVIEW_PING_ROLE_ID',
    pingFallback: '@Interview-Ping',
  },
  training: {
    displayName: 'Training',
    emoji: '🔴',
    roles: {
      cohost: { label: 'Co-Host', maxSlots: 1 },
      overseer: { label: 'Overseer', maxSlots: 1 },
      trainer: { label: 'Trainer', maxSlots: 8 },
      supervisor: { label: 'Supervisor', maxSlots: 4 }, // Supervisor (4)
      spectator: { label: 'Spectator', maxSlots: 4 },
    },
    pingEnv: 'QUEUE_TRAINING_PING_ROLE_ID',
    pingFallback: '@Training-Ping',
  },
  mass_shift: {
    displayName: 'Mass Shift',
    emoji: '🟣',
    roles: {
      cohost: { label: 'Co-Host', maxSlots: 1 },
      overseer: { label: 'Overseer', maxSlots: 1 },
      attendee: { label: 'Attendee', maxSlots: 15 },
    },
    pingEnv: 'QUEUE_MASS_SHIFT_PING_ROLE_ID',
    pingFallback: '@mass-shift-ping',
  },
};

// Channel envs (where queue posts go per type)
const QUEUE_CHANNEL_ENVS = {
  interview: 'QUEUE_INTERVIEW_CHANNEL_ID',
  training: 'QUEUE_TRAINING_CHANNEL_ID',
  mass_shift: 'QUEUE_MASS_SHIFT_CHANNEL_ID',
};

// ======================
// IN-MEMORY STORE
// ======================

// messageId -> queue state
const queues = new Map();

// ======================
// HELPERS
// ======================

function extractHostFromDesc(desc) {
  if (!desc) return { hostDisplay: 'Unknown', hostId: null };

  const lines = desc.split('\n');
  const hostLine = lines.find(l => l.toLowerCase().startsWith('host:'));
  if (!hostLine) return { hostDisplay: 'Unknown', hostId: null };

  const idMatch = hostLine.match(/\((\d{10,})\)\s*$/);
  const hostId = idMatch ? idMatch[1] : null;

  if (hostId) {
    return { hostDisplay: `<@${hostId}>`, hostId };
  }

  const cleaned = hostLine.replace(/^Host:\s*/i, '').trim() || 'Unknown';
  return { hostDisplay: cleaned, hostId: null };
}

/**
 * Build the queue embed with your original style per session type.
 * Header is centered using EM spaces and shows real host + time.
 */
function buildQueueEmbed({ card, sessionType }) {
  const cfg = QUEUE_ROLE_CONFIG[sessionType];
  if (!cfg) return null;

  const { hostDisplay } = extractHostFromDesc(card.desc || '');
  const trelloUrl = card.shortUrl || `https://trello.com/c/${card.id}`;
  const due = card.due ? new Date(card.due) : null;
  const dueUnix = due ? Math.floor(due.getTime() / 1000) : null;
  const timeExact = dueUnix ? `<t:${dueUnix}:t>` : 'Time TBA';
  const timeRelative = dueUnix ? `<t:${dueUnix}:R>` : 'TBA';

  // Use EM spaces (U+2003) so Discord doesn’t collapse them
  const pad = '\u2003'.repeat(6);

  let headerText;
  if (sessionType === 'interview') {
    headerText = `🟡 INTERVIEW | ${hostDisplay} | ${timeExact} 🟡`;
  } else if (sessionType === 'training') {
    headerText = `🔴 TRAINING | ${hostDisplay} | ${timeExact} 🔴`;
  } else if (sessionType === 'mass_shift') {
    headerText = `🟣 MASS SHIFT | ${hostDisplay} | ${timeExact} 🟣`;
  } else {
    headerText = `${cfg.emoji} ${cfg.displayName.toUpperCase()} ${cfg.emoji}`;
  }

  const lines = [];

  // Header box
  lines.push('╔══════════════════════════════════════╗');
  lines.push(`${pad}${headerText}`);
  lines.push('╚══════════════════════════════════════╝');
  lines.push('');

  // Host / time (body lines)
  lines.push(`📌  **Host:** ${hostDisplay}`);
  if (dueUnix) {
    lines.push(`📌 **Starts:** ${timeRelative}`);
    lines.push(`📌 **Time:** ${timeExact}`);
  }
  lines.push('');

  // Roles block per type
  lines.push('💠 **ROLES** 💠');
  lines.push('----------------------------------------------------------------');

  if (sessionType === 'interview') {
    lines.push('ℹ️  **Co-Host:** Corporate Intern+');
    lines.push('ℹ️  **Overseer:** Executive Manager+');
    lines.push('ℹ️  **Interviewer (12):** Leadership Intern+');
    lines.push('ℹ️  **Spectator (4):** Leadership Intern+');
  } else if (sessionType === 'training') {
    lines.push('ℹ️  **Co-Host:** Corporate Intern+');
    lines.push('ℹ️  **Overseer:** Executive Manager+');
    lines.push('ℹ️  **Trainer (8):** Leadership Intern+');
    lines.push('ℹ️  **Supervisor (4):** Supervisor+');
    lines.push('ℹ️  **Spectator (4):** Leadership Intern+');
  } else if (sessionType === 'mass_shift') {
    lines.push('ℹ️  **Co-Host:** Corporate Intern+');
    lines.push('ℹ️  **Overseer:** Executive Manager+');
    lines.push('ℹ️  **Attendee (15):** Leadership Intern+');
  }

  lines.push('');
  lines.push('❓  **HOW TO JOIN THE QUEUE** ❓');
  lines.push('----------------------------------------------------------------');
  lines.push('- Check the role list above — if your rank is allowed, press the role button you want.');
  lines.push("- You’ll get a private message that says you were added to that role's queue.");
  lines.push('- Do NOT join the game until the attendees post is made in the attendees channel.');
  lines.push('');

  lines.push('❓ **HOW TO LEAVE THE QUEUE / INFORM LATE ARRIVAL** ❓');
  lines.push('----------------------------------------------------------------');
  lines.push('- Click the **Leave Queue** button once you have joined a role.');
  lines.push('- After the attendees post is made, changes must be handled by the host/corporate manually.');
  lines.push('');

  lines.push('----------------------------------------------------------------');
  lines.push('╭─────── 💠 LINKS 💠 ───────────╮');
  lines.push(`• **Trello Card:** ${trelloUrl}`);
  lines.push('╰─────────────────────────────╯');

  const embed = new EmbedBuilder()
    .setColor(0x87cefa) // icy blue
    .setDescription(lines.join('\n')); // only description => no double title

  return embed;
}

/**
 * Build button rows: one button per role, plus a Leave Queue button.
 */
function buildQueueButtons(sessionType) {
  const cfg = QUEUE_ROLE_CONFIG[sessionType];
  if (!cfg) return [];

  const row1 = new ActionRowBuilder();
  const row2 = new ActionRowBuilder();
  const rowLeave = new ActionRowBuilder();

  const roleKeys = Object.keys(cfg.roles);

  for (const roleKey of roleKeys) {
    const roleCfg = cfg.roles[roleKey];

    const btn = new ButtonBuilder()
      .setCustomId(`queue:join:${roleKey}`)
      .setLabel(roleCfg.label)
      .setStyle(ButtonStyle.Primary);

    if (row1.components.length < 4) {
      row1.addComponents(btn);
    } else {
      row2.addComponents(btn);
    }
  }

  const leaveBtn = new ButtonBuilder()
    .setCustomId('queue:leave')
    .setLabel('Leave Queue')
    .setStyle(ButtonStyle.Secondary);

  rowLeave.addComponents(leaveBtn);

  const rows = [];
  if (row1.components.length > 0) rows.push(row1);
  if (row2.components.length > 0) rows.push(row2);
  rows.push(rowLeave);

  return rows;
}

/**
 * Resolve which channel the queue post should go in for a given sessionType.
 * Uses QUEUE_*_CHANNEL_ID env vars, falls back to the command channel.
 */
async function resolveQueueChannel(interaction, sessionType) {
  const envName = QUEUE_CHANNEL_ENVS[sessionType];
  const channelId = envName ? process.env[envName] : null;

  if (!channelId) {
    console.warn('[QUEUE] Missing channel config for session type:', sessionType, 'env:', envName);
    // Fallback: just use the channel where the command was run
    return interaction.channel;
  }

  try {
    const ch = await interaction.client.channels.fetch(channelId);
    if (!ch) {
      console.warn('[QUEUE] Could not fetch queue channel with id', channelId, 'for type', sessionType);
      return interaction.channel;
    }
    return ch;
  } catch (err) {
    console.error('[QUEUE] Error fetching queue channel', channelId, err);
    return interaction.channel;
  }
}

/**
 * Called by /sessionqueue to open the queue for a Trello card.
 */
async function openQueueForCard(interaction, card, sessionType) {
  const cfg = QUEUE_ROLE_CONFIG[sessionType];
  if (!cfg) {
    console.warn('[QUEUE] Unknown sessionType in openQueueForCard:', sessionType);
    return false;
  }

  const channel = await resolveQueueChannel(interaction, sessionType);
  if (!channel) {
    console.warn('[QUEUE] No channel resolved for queue');
    return false;
  }

  const embed = buildQueueEmbed({ card, sessionType });
  if (!embed) {
    console.warn('[QUEUE] Failed to build embed for sessionType', sessionType);
    return false;
  }

  const components = buildQueueButtons(sessionType);

  // Ping role OUTSIDE the embed so it actually pings
  const pingEnvName = cfg.pingEnv;
  const pingRoleId = process.env[pingEnvName];
  const content = pingRoleId ? `<@&${pingRoleId}>` : cfg.pingFallback;

  const message = await channel.send({
    content,
    embeds: [embed],
    components,
  });

  // Initialize queue state
  const queueState = {
    trelloCardId: card.id,
    sessionType,
    channelId: channel.id,
    guildId: interaction.guildId,
    messageId: message.id,
    createdAt: Date.now(),
    roles: {},
  };

  // Setup per-role queues
  for (const roleKey of Object.keys(cfg.roles)) {
    queueState.roles[roleKey] = [];
  }

  queues.set(message.id, queueState);

  console.log('[QUEUE] Opened queue for card', card.id, 'on message', message.id, 'in channel', channel.id);
  return true;
}

// ======================
// BUTTON HANDLING
// ======================

/**
 * Find queue by message id.
 */
function getQueueByMessageId(messageId) {
  return queues.get(messageId) || null;
}

/**
 * Given a Trello card id, find the queue state (if any).
 */
function getQueueByCardId(cardId) {
  for (const [msgId, state] of queues.entries()) {
    if (state.trelloCardId === cardId) {
      return { messageId: msgId, state };
    }
  }
  return null;
}

/**
 * Handle queue join/leave buttons.
 * Returns true if this interaction was handled by the queue system.
 */
async function handleQueueButtonInteraction(interaction) {
  const customId = interaction.customId || '';
  if (!customId.startsWith('queue:')) return false;

  const parts = customId.split(':'); // queue:join:roleKey or queue:leave
  const action = parts[1];
  const roleKey = parts[2] || null;

  const messageId = interaction.message?.id;
  if (!messageId) {
    await interaction.reply({
      content: 'This queue message is invalid or missing.',
      ephemeral: true,
    });
    return true;
  }

  const queue = getQueueByMessageId(messageId);
  if (!queue) {
    await interaction.reply({
      content: 'This queue is no longer active.',
      ephemeral: true,
    });
    return true;
  }

  const cfg = QUEUE_ROLE_CONFIG[queue.sessionType];
  if (!cfg) {
    await interaction.reply({
      content: 'This queue is misconfigured.',
      ephemeral: true,
    });
    return true;
  }

  const userId = interaction.user.id;

  if (action === 'join') {
    if (!roleKey || !cfg.roles[roleKey]) {
      await interaction.reply({
        content: 'That role is not available in this queue.',
        ephemeral: true,
      });
      return true;
    }

    const roleCfg = cfg.roles[roleKey];

    // Remove from all roles first so they only hold one seat
    let wasInAny = false;
    for (const rKey of Object.keys(queue.roles)) {
      const arr = queue.roles[rKey];
      const idx = arr.indexOf(userId);
      if (idx !== -1) {
        arr.splice(idx, 1);
        wasInAny = true;
      }
    }

    const list = queue.roles[roleKey];

    if (list.includes(userId)) {
      await interaction.reply({
        content: `You are already in the **${roleCfg.label}** queue.`,
        ephemeral: true,
      });
      return true;
    }

    if (list.length >= roleCfg.maxSlots) {
      await interaction.reply({
        content: `The **${roleCfg.label}** queue is currently full.`,
        ephemeral: true,
      });
      return true;
    }

    list.push(userId);

    await interaction.reply({
      content: `You have been added to the **${roleCfg.label}** queue${wasInAny ? ' (and removed from any previous role).' : '.'}`,
      ephemeral: true,
    });
    return true;
  }

  if (action === 'leave') {
    let removed = false;
    for (const rKey of Object.keys(queue.roles)) {
      const arr = queue.roles[rKey];
      const idx = arr.indexOf(userId);
      if (idx !== -1) {
        arr.splice(idx, 1);
        removed = true;
      }
    }

    if (!removed) {
      await interaction.reply({
        content: 'You are not currently in this queue.',
        ephemeral: true,
      });
      return true;
    }

    await interaction.reply({
      content: 'You have been removed from this queue.',
      ephemeral: true,
    });
    return true;
  }

  // Unknown queue:* action
  return false;
}

// ======================
// ATTENDEES SUPPORT
// ======================

/**
 * Build attendees data (per role) from the stored queue for a given Trello card.
 * Used by /sessionattendees – returns users in join order up to maxSlots.
 */
function buildAttendeesFromQueue(cardId) {
  const match = getQueueByCardId(cardId);
  if (!match) return null;

  const { state } = match;
  const cfg = QUEUE_ROLE_CONFIG[state.sessionType];
  if (!cfg) return null;

  const rolesOut = {};

  for (const [roleKey, userIds] of Object.entries(state.roles)) {
    const roleCfg = cfg.roles[roleKey];
    if (!roleCfg) continue;

    const selected = userIds.slice(0, roleCfg.maxSlots);
    rolesOut[roleKey] = {
      label: roleCfg.label,
      users: selected,
    };
  }

  return {
    sessionType: state.sessionType,
    trelloCardId: state.trelloCardId,
    roles: rolesOut,
  };
}

module.exports = {
  openQueueForCard,
  handleQueueButtonInteraction,
  buildAttendeesFromQueue,
};
