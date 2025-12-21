// src/utils/sessionQueueManager.js

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { trelloRequest } = require('./trelloClient');

// In-memory queue store: messageId -> queue state
// This resets if the bot restarts (we'll add persistence later if needed)
const queues = new Map();

/**
 * Configuration for each session type and its roles.
 * This controls:
 *  - the roles shown as buttons
 *  - the max slots per role
 *  - labels used in attendees embed
 */
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
  },
  training: {
    displayName: 'Training',
    emoji: '🔴',
    roles: {
      cohost: { label: 'Co-Host', maxSlots: 1 },
      overseer: { label: 'Overseer', maxSlots: 1 },
      trainer: { label: 'Trainer', maxSlots: 8 },
      supervisor: { label: 'Supervisor', maxSlots: 4 }, // your extra role
      spectator: { label: 'Spectator', maxSlots: 4 },
    },
  },
  mass_shift: {
    displayName: 'Mass Shift',
    emoji: '🟣',
    roles: {
      cohost: { label: 'Co-Host', maxSlots: 1 },
      overseer: { label: 'Overseer', maxSlots: 1 },
      attendee: { label: 'Attendee', maxSlots: 15 },
    },
  },
};

/**
 * Small helper: parse host info out of the Trello card description.
 * We expect a line like: "Host: SomeUser#0000 (1234567890)"
 */
function extractHostFromDesc(desc) {
  if (!desc) return { hostLine: 'Unknown', hostId: null };

  const lines = desc.split('\n');
  const hostLine = lines.find(l => l.toLowerCase().startsWith('host:'));
  if (!hostLine) return { hostLine: 'Unknown', hostId: null };

  // Try to grab the ID in parentheses at the end
  const idMatch = hostLine.match(/\((\d{10,})\)\s*$/);
  const hostId = idMatch ? idMatch[1] : null;

  return { hostLine: hostLine.replace(/^Host:\s*/i, '').trim(), hostId };
}

/**
 * Detect session type from Trello card name or labels.
 * For now we only use the name, since you already format it as:
 *   [Interview] ...
 *   [Training] ...
 *   [Mass Shift] ...
 */
function detectSessionType(card) {
  if (!card || !card.name) return null;
  const name = card.name.toLowerCase();

  if (name.startsWith('[interview]')) return 'interview';
  if (name.startsWith('[training]')) return 'training';
  if (name.startsWith('[mass shift]')) return 'mass_shift';

  return null;
}

/**
 * Build the queue embed per session type.
 */
function buildQueueEmbed({ card, sessionType, channel, guild }) {
  const cfg = QUEUE_ROLE_CONFIG[sessionType];
  if (!cfg) return null;

  const { hostLine, hostId } = extractHostFromDesc(card.desc || '');
  const hostDisplay = hostId ? `<@${hostId}>` : hostLine || 'Unknown';
  const trelloUrl = card.shortUrl || `https://trello.com/c/${card.id}`;
  const dueUnix = card.due ? Math.floor(new Date(card.due).getTime() / 1000) : null;

  // Header / title
  const title = `${cfg.emoji} ${cfg.displayName.toUpperCase()} | ${hostDisplay}`;

  // Role explanation block per type
  let rolesBlockLines = [];

  if (sessionType === 'interview') {
    rolesBlockLines = [
      '💠 **ROLES**',
      '────────────────────────────────────────',
      'ℹ️ **Co-Host:** Corporate Intern+',
      'ℹ️ **Overseer:** Executive Manager+',
      'ℹ️ **Interviewer (12):** Leadership Intern+',
      'ℹ️ **Spectator (4):** Leadership Intern+',
    ];
  } else if (sessionType === 'training') {
    rolesBlockLines = [
      '💠 **ROLES**',
      '────────────────────────────────────────',
      'ℹ️ **Co-Host:** Corporate Intern+',
      'ℹ️ **Overseer:** Executive Manager+',
      'ℹ️ **Trainer (8):** Leadership Intern+',
      'ℹ️ **Supervisor (4):** Supervisor+',
      'ℹ️ **Spectator (4):** Leadership Intern+',
    ];
  } else if (sessionType === 'mass_shift') {
    rolesBlockLines = [
      '💠 **ROLES**',
      '────────────────────────────────────────',
      'ℹ️ **Co-Host:** Corporate Intern+',
      'ℹ️ **Overseer:** Executive Manager+',
      'ℹ️ **Attendee (15):** Leadership Intern+',
    ];
  }

  const lines = [
    '╔══════════════════════════════════════╗',
    `        ${cfg.emoji} ${cfg.displayName.toUpperCase()} | ${hostDisplay} ${cfg.emoji}`,
    '╚══════════════════════════════════════╝',
    '',
    `📌 **Host:** ${hostDisplay}`,
  ];

  if (dueUnix) {
    lines.push(
      `📌 **Starts:** <t:${dueUnix}:R>`,
      `📌 **Time:** <t:${dueUnix}:t>`,
    );
  }

  lines.push('', ...rolesBlockLines);

  // Generic instructions
  lines.push(
    '',
    '❓ **HOW TO JOIN THE QUEUE**',
    '────────────────────────────────────────',
    '- If your rank is allowed, press the matching button below.',
    '- You\'ll get a confirmation reply when you are added.',
    '- Don\'t join the game until the attendees list is posted.',
    '',
    '❓ **HOW TO LEAVE THE QUEUE**',
    '────────────────────────────────────────',
    '- Press **Leave Queue** to remove yourself.',
    '- After the attendees list is posted, changes must be handled by the host/corporate manually.',
    '',
    '╭─────── 💠 LINKS 💠 ───────────╮',
    `〰️ **Trello Card:** ${trelloUrl}`,
    '╰─────────────────────────────╯',
  );

  const embed = new EmbedBuilder()
    .setColor(0x87CEFA) // light icy blue
    .setTitle(title)
    .setDescription(lines.join('\n'));

  return embed;
}

/**
 * Build button rows for the queue.
 * We don't encode the messageId in the customId; instead we rely on interaction.message.id.
 */
function buildQueueButtons(sessionType) {
  const cfg = QUEUE_ROLE_CONFIG[sessionType];
  if (!cfg) return [];

  const row1 = new ActionRowBuilder();
  const row2 = new ActionRowBuilder();

  const roleOrder = Object.keys(cfg.roles);

  for (const roleKey of roleOrder) {
    const roleCfg = cfg.roles[roleKey];
    const btn = new ButtonBuilder()
      .setCustomId(`queue:join:${roleKey}`)
      .setLabel(roleCfg.label)
      .setStyle(ButtonStyle.Primary);

    // First 4 buttons go on row1, rest on row2
    if (row1.components.length < 4) {
      row1.addComponents(btn);
    } else {
      row2.addComponents(btn);
    }
  }

  // Leave button on its own row
  const leaveBtn = new ButtonBuilder()
    .setCustomId('queue:leave')
    .setLabel('Leave Queue')
    .setStyle(ButtonStyle.Secondary);

  const rowLeave = new ActionRowBuilder().addComponents(leaveBtn);

  const rows = [];
  if (row1.components.length > 0) rows.push(row1);
  if (row2.components.length > 0) rows.push(row2);
  rows.push(rowLeave);

  return rows;
}

/**
 * Called by /sessionqueue to actually open the queue post.
 *
 * @param {ChatInputCommandInteraction} interaction
 * @param {object} card Trello card data (from trelloRequest)
 * @param {string} sessionType 'interview' | 'training' | 'mass_shift'
 */
async function openQueueForCard(interaction, card, sessionType) {
  const cfg = QUEUE_ROLE_CONFIG[sessionType];
  if (!cfg) {
    console.warn('[QUEUE] Unknown sessionType in openQueueForCard:', sessionType);
    return false;
  }

  const channel = interaction.channel;
  if (!channel) {
    console.warn('[QUEUE] No channel found on interaction');
    return false;
  }

  const embed = buildQueueEmbed({
    card,
    sessionType,
    channel,
    guild: interaction.guild,
  });

  if (!embed) {
    console.warn('[QUEUE] Failed to build embed for sessionType', sessionType);
    return false;
  }

  const components = buildQueueButtons(sessionType);

  const message = await channel.send({
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

  const roleKeys = Object.keys(cfg.roles);
  for (const r of roleKeys) {
    queueState.roles[r] = []; // array of userIds in join order
  }

  queues.set(message.id, queueState);

  console.log('[QUEUE] Opened queue for card', card.id, 'on message', message.id);

  return true;
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
 * Handle button clicks for the queue system.
 * Called from index.js when interaction.isButton() is true.
 *
 * Returns true if this interaction was handled by the queue system.
 */
async function handleQueueButtonInteraction(interaction) {
  const customId = interaction.customId || '';
  if (!customId.startsWith('queue:')) return false;

  const parts = customId.split(':'); // queue:join:roleKey  OR queue:leave
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

  const queue = queues.get(messageId);
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

    // Ensure user is only in one role at a time: remove from all first
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

  // Unknown queue:* button
  return false;
}

/**
 * Build attendees data (per role) from the stored queue for a given Trello card.
 * For v1 we just return them in join order up to maxSlots.
 */
function buildAttendeesFromQueue(cardId) {
  const match = getQueueByCardId(cardId);
  if (!match) return null;

  const { state } = match;
  const cfg = QUEUE_ROLE_CONFIG[state.sessionType];
  if (!cfg) return null;

  const result = {};

  for (const [roleKey, userIds] of Object.entries(state.roles)) {
    const roleCfg = cfg.roles[roleKey];
    if (!roleCfg) continue;

    const selected = userIds.slice(0, roleCfg.maxSlots);
    result[roleKey] = {
      label: roleCfg.label,
      users: selected,
    };
  }

  return {
    sessionType: state.sessionType,
    trelloCardId: state.trelloCardId,
    roles: result,
  };
}

module.exports = {
  openQueueForCard,
  handleQueueButtonInteraction,
  buildAttendeesFromQueue,
};
