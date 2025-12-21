// src/utils/sessionQueueManager.js

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const { trelloRequest } = require('./trelloClient');
const { SESSION_CONFIG } = require('../config/sessionAnnouncements');
const {
  TRELLO_LIST_INTERVIEW_ID,
  TRELLO_LIST_TRAINING_ID,
  TRELLO_LIST_MASS_SHIFT_ID,
  TRELLO_LABEL_INTERVIEW_ID,
  TRELLO_LABEL_TRAINING_ID,
  TRELLO_LABEL_MASS_SHIFT_ID,
} = require('../config/trello');
const { atLeastTier } = require('./permissions');

// In-memory queue state (resets on bot restart)
const queueState = new Map();

/**
 * Queue limits + minimum tiers per role.
 * Tiers come from your atLeastTier system:
 *   Tier 4 = Management / LI+
 *   Tier 5 = Senior Management / EM+
 *   Tier 6 = Corporate Intern+
 */
const QUEUE_LIMITS = {
  interview: {
    roles: {
      cohost:    { label: 'Co-Host',      max: 1,  minTier: 6 }, // Corporate Intern+
      overseer:  { label: 'Overseer',     max: 1,  minTier: 5 }, // Executive Manager+
      interviewer: { label: 'Interviewer', max: 12, minTier: 4 }, // Leadership Intern+
      spectator: { label: 'Spectator',    max: 4,  minTier: 4 }, // Leadership Intern+
    },
  },
  training: {
    roles: {
      cohost:    { label: 'Co-Host',    max: 1,  minTier: 6 }, // Corporate Intern+
      overseer:  { label: 'Overseer',   max: 1,  minTier: 5 }, // Executive Manager+
      trainer:   { label: 'Trainer',    max: 8,  minTier: 4 }, // Leadership Intern+
      spectator: { label: 'Spectator',  max: 4,  minTier: 4 }, // Leadership Intern+
    },
  },
  mass_shift: {
    roles: {
      cohost:   { label: 'Co-Host',   max: 1,  minTier: 6 }, // Corporate Intern+
      overseer: { label: 'Overseer',  max: 1,  minTier: 5 }, // Executive Manager+
      attendee: { label: 'Attendee',  max: 15, minTier: 4 }, // LI+ (15 slots)
    },
  },
};

// --- helpers ---

function extractCardIdFromInput(input) {
  if (!input) return null;
  const trimmed = input.trim();

  // Typical Trello URLs: https://trello.com/c/<shortId>/<slug>
  const match = trimmed.match(/trello\.com\/c\/([A-Za-z0-9]+)/i);
  if (match && match[1]) return match[1];

  // If they just paste an ID/shortlink
  return trimmed;
}

function detectSessionTypeFromCard(card) {
  if (!card) return null;
  const listId = card.idList;
  const labelIds = Array.isArray(card.idLabels) ? card.idLabels : [];

  // Prefer list IDs
  if (listId === TRELLO_LIST_INTERVIEW_ID) return 'interview';
  if (listId === TRELLO_LIST_TRAINING_ID) return 'training';
  if (listId === TRELLO_LIST_MASS_SHIFT_ID) return 'mass_shift';

  // Fall back to labels
  if (labelIds.includes(TRELLO_LABEL_INTERVIEW_ID)) return 'interview';
  if (labelIds.includes(TRELLO_LABEL_TRAINING_ID)) return 'training';
  if (labelIds.includes(TRELLO_LABEL_MASS_SHIFT_ID)) return 'mass_shift';

  // Fallback to name scraping
  const name = (card.name || '').toLowerCase();
  if (name.includes('interview')) return 'interview';
  if (name.includes('training')) return 'training';
  if (name.includes('mass shift') || name.includes('mass-shift')) return 'mass_shift';

  return null;
}

function extractHostFromCard(card) {
  if (!card) return 'Unknown';

  // Try card name: e.g. "[Interview] 7:00 PM EST | Man9ixe"
  if (card.name && card.name.includes('|')) {
    const parts = card.name.split('|');
    const hostPart = parts[parts.length - 1].trim();
    if (hostPart.length > 0) return hostPart;
  }

  // Try description "Host:" line
  if (card.desc) {
    const lines = card.desc.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      const m = trimmed.match(/^\*?\*?Host\*?\*?:\s*(.+)$/i);
      if (m && m[1]) {
        return m[1].trim();
      }
    }
  }

  return 'Unknown';
}

function getSessionConfig(sessionType) {
  if (!SESSION_CONFIG || !SESSION_CONFIG[sessionType]) return null;
  const base = SESSION_CONFIG[sessionType];

  // If you ever add queue-specific channels/roles, you can extend here
  return {
    channelId: base.queueChannelId || base.channelId,
    pingRoleId: base.queuePingRoleId || base.pingRoleId,
  };
}

function buildQueueEmbed({ sessionType, host, dueUnix, cardUrl }) {
  const hostText = host || 'Unknown';
  const relative = `<t:${dueUnix}:R>`;
  const timeText = `<t:${dueUnix}:t>`;

  if (sessionType === 'interview') {
    const desc = [
      '╔══════════════════════════════════════╗',
      `                         🟡 INTERVIEW | ${hostText} | ${timeText} 🟡`,
      '╚══════════════════════════════════════╝',
      '',
      `📌  Host: ${hostText}`,
      `📌 Starts: ${relative}`,
      `📌 Time: ${timeText}`,
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
      '- You’ll get a private message that says: "You have been added to the (ROLE) Queue."',
      '- Do NOT join until you are pinged in "Session Attendees" **15 minutes before** the session starts.',
      '- Line up on the number/role you are selected for on "Session Attendees".',
      '- You have 5 minutes after the attendees post is made to join.',
      '',
      '❓ HOW TO LEAVE THE QUEUE / INFORM LATE ARRIVAL ❓',
      '----------------------------------------------------------------',
      '- Click the "Leave Queue" button after you have joined.',
      '- You can only leave the queue BEFORE the attendees list is posted. After that, ping your host in `#session-lounge`.',
      '- If you do not let the host know anything within **5 minutes** after the attendees post, you may receive a **written warning** and your spot can be given to someone else.',
      '----------------------------------------------------------------',
      '╭─────── 💠 LINKS 💠 ───────────╮',
      `〰️ Trello Card: ${cardUrl}`,
      '╰──────────────────────────────╯',
    ].join('\n');

    return new EmbedBuilder()
      .setColor(0xffd166)
      .setDescription(desc);
  }

  if (sessionType === 'training') {
    const desc = [
      '╔══════════════════════════════════════╗',
      `                             🔴  TRAINING | ${hostText} | ${timeText}  🔴`,
      '╚══════════════════════════════════════╝',
      '',
      `📌  Host: ${hostText}`,
      `📌 Starts: ${relative}`,
      `📌 Time: ${timeText}`,
      '',
      '💠 ROLES 💠',
      '----------------------------------------------------------------',
      'ℹ️  **Co-Host:** Corporate Intern+',
      'ℹ️  **Overseer:** Executive Manager+',
      'ℹ️  **Trainer (8):** Leadership Intern+',
      'ℹ️  **Spectator (4):** Leadership Intern+',
      '',
      '❓  HOW TO JOIN THE QUEUE ❓',
      '----------------------------------------------------------------',
      '- Check the role list above — if your rank is allowed, press the role button you want.',
      '- You’ll get a private message that says: "You have been added to the (ROLE) Queue."',
      '- Do NOT join until you are pinged in "Session Attendees" **15 minutes before** the session starts.',
      '- Line up on the number/role you are selected for on "Session Attendees".',
      '- You have 5 minutes after the attendees post is made to join.',
      '',
      '❓ HOW TO LEAVE THE QUEUE / INFORM LATE ARRIVAL ❓',
      '----------------------------------------------------------------',
      '- Click the "Leave Queue" button after you have joined.',
      '- You can only leave the queue BEFORE the attendees list is posted. After that, ping your host in `#session-lounge`.',
      '- If you do not let the host know anything within **5 minutes** after the attendees post, you may receive a **written warning** and your spot can be given to someone else.',
      '----------------------------------------------------------------',
      '╭─────── 💠 LINKS 💠 ───────────╮',
      `〰️ Trello Card: ${cardUrl}`,
      '╰──────────────────────────────╯',
    ].join('\n');

    return new EmbedBuilder()
      .setColor(0xff6b6b)
      .setDescription(desc);
  }

  if (sessionType === 'mass_shift') {
    const desc = [
      '╔══════════════════════════════════════╗',
      `                         🟣  MASS SHIFT | ${hostText} | ${timeText}  🟣`,
      '╚══════════════════════════════════════╝',
      '',
      `📌  Host: ${hostText}`,
      `📌 Starts: ${relative}`,
      `📌 Time: ${timeText}`,
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
      '- You’ll get a private message that says: "You have been added to the (ROLE) Queue."',
      '- Do NOT join until you are pinged in "Session Attendees" **15 minutes before** the session starts.',
      '- Line up on the number/role you are selected for on "Session Attendees".',
      '- You have 5 minutes after the attendees post is made to join.',
      '',
      '❓ HOW TO LEAVE THE QUEUE / INFORM LATE ARRIVAL ❓',
      '----------------------------------------------------------------',
      '- Click the "Leave Queue" button after you have joined.',
      '- You can only leave the queue BEFORE the attendees list is posted. After that, ping your host in `#session-lounge`.',
      '- If you do not let the host know anything within **5 minutes** after the attendees post, you may receive a **written warning** and your spot can be given to someone else.',
      '----------------------------------------------------------------',
      '╭─────── 💠 LINKS 💠 ───────────╮',
      `〰️ Trello Card: ${cardUrl}`,
      '╰──────────────────────────────╯',
    ].join('\n');

    return new EmbedBuilder()
      .setColor(0xa56bff)
      .setDescription(desc);
  }

  // Fallback
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setDescription('Session queue.');
}

function buildQueueButtons(sessionType, cardId) {
  const limits = QUEUE_LIMITS[sessionType];
  if (!limits) return [];

  const row = new ActionRowBuilder();

  const addBtn = (key, label, style) => {
    if (!limits.roles[key]) return;
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`queue:${sessionType}:${key}:${cardId}`)
        .setLabel(label)
        .setStyle(style),
    );
  };

  if (sessionType === 'interview') {
    addBtn('cohost', 'Co-Host', ButtonStyle.Primary);
    addBtn('overseer', 'Overseer', ButtonStyle.Primary);
    addBtn('interviewer', 'Interviewer', ButtonStyle.Success);
    addBtn('spectator', 'Spectator', ButtonStyle.Secondary);
  } else if (sessionType === 'training') {
    addBtn('cohost', 'Co-Host', ButtonStyle.Primary);
    addBtn('overseer', 'Overseer', ButtonStyle.Primary);
    addBtn('trainer', 'Trainer', ButtonStyle.Success);
    addBtn('spectator', 'Spectator', ButtonStyle.Secondary);
  } else if (sessionType === 'mass_shift') {
    addBtn('cohost', 'Co-Host', ButtonStyle.Primary);
    addBtn('overseer', 'Overseer', ButtonStyle.Primary);
    addBtn('attendee', 'Attendee', ButtonStyle.Success);
  }

  // Leave Queue button (always present)
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`queue:${sessionType}:leave:${cardId}`)
      .setLabel('Leave Queue')
      .setStyle(ButtonStyle.Danger),
  );

  return [row];
}

function ensureStateRoles(sessionType, state) {
  const limits = QUEUE_LIMITS[sessionType];
  if (!limits) return;
  if (!state.roles) state.roles = {};
  for (const key of Object.keys(limits.roles)) {
    if (!state.roles[key]) state.roles[key] = new Set();
  }
}

// --- public: open queue ---

/**
 * Open a queue for a Trello card.
 * options: { cardInput: string }
 *   cardInput can be a Trello URL or a card id/shortlink.
 *
 * Returns true on success, false on error.
 */
async function openQueueForCard(client, { cardInput }) {
  const cardId = extractCardIdFromInput(cardInput);
  if (!cardId) {
    console.error('[QUEUE] No cardId parsed from input:', cardInput);
    return false;
  }

  if (queueState.has(cardId)) {
    console.log('[QUEUE] Queue already open for card:', cardId);
    return true;
  }

  const cardRes = await trelloRequest(`/cards/${cardId}`, 'GET', {
    fields: 'name,desc,due,idList,idLabels,url',
  });

  if (!cardRes.ok || !cardRes.data) {
    console.error('[QUEUE] Failed to load Trello card for queue:', cardId, cardRes.status, cardRes.data);
    return false;
  }

  const card = cardRes.data;
  const sessionType = detectSessionTypeFromCard(card);

  if (!sessionType) {
    console.error('[QUEUE] Could not detect session type for card', cardId);
    return false;
  }

  const cfg = getSessionConfig(sessionType);
  if (!cfg || !cfg.channelId) {
    console.error('[QUEUE] Missing channel config for session type:', sessionType);
    return false;
  }

  const channel = await client.channels.fetch(cfg.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    console.error('[QUEUE] Cannot access queue channel:', cfg.channelId);
    return false;
  }

  const host = extractHostFromCard(card);
  const due = card.due ? new Date(card.due) : null;
  const dueUnix = due && !Number.isNaN(due.getTime())
    ? Math.floor(due.getTime() / 1000)
    : Math.floor(Date.now() / 1000) + 1800;

  const embed = buildQueueEmbed({
    sessionType,
    host,
    dueUnix,
    cardUrl: card.url,
  });

  const components = buildQueueButtons(sessionType, cardId);

  const content = cfg.pingRoleId ? `<@&${cfg.pingRoleId}>` : '';

  const message = await channel.send({
    content,
    embeds: [embed],
    components,
  });

  const state = {
    sessionType,
    guildId: message.guildId,
    channelId: message.channelId,
    messageId: message.id,
    trelloUrl: card.url,
    dueUnix,
    roles: {},
    open: true,
  };

  ensureStateRoles(sessionType, state);
  queueState.set(cardId, state);

  console.log('[QUEUE] Opened queue for card', cardId, 'type:', sessionType);

  return true;
}

// --- public: handle button presses ---

async function handleQueueButtonInteraction(interaction) {
  if (!interaction.isButton()) return false;
  const id = interaction.customId;
  if (!id.startsWith('queue:')) return false;

  const parts = id.split(':'); // queue:sessionType:roleKey:cardId
  if (parts.length !== 4) return false;

  const [, sessionType, roleKey, cardId] = parts;

  const state = queueState.get(cardId);
  if (!state || state.sessionType !== sessionType) {
    await interaction.reply({
      content: 'This queue is no longer active or could not be found.',
      ephemeral: true,
    });
    return true;
  }

  const limits = QUEUE_LIMITS[sessionType];
  if (!limits) {
    await interaction.reply({
      content: 'This queue is not configured correctly.',
      ephemeral: true,
    });
    return true;
  }

  const member = interaction.member
    || (interaction.guild && await interaction.guild.members.fetch(interaction.user.id));

  if (!member) {
    await interaction.reply({
      content: 'Could not resolve your server member profile.',
      ephemeral: true,
    });
    return true;
  }

  ensureStateRoles(sessionType, state);

  // Leave queue
  if (roleKey === 'leave') {
    let removed = false;
    for (const set of Object.values(state.roles)) {
      if (set.has(member.id)) {
        set.delete(member.id);
        removed = true;
      }
    }

    if (!removed) {
      await interaction.reply({
        content: 'You are not currently in this session queue.',
        ephemeral: true,
      });
      return true;
    }

    await interaction.reply({
      content: 'You have left the queue for this session.',
      ephemeral: true,
    });
    return true;
  }

  const roleConfig = limits.roles[roleKey];
  if (!roleConfig) {
    await interaction.reply({
      content: 'That queue role is not available for this session.',
      ephemeral: true,
    });
    return true;
  }

  // Tier gate using your existing system
  if (!atLeastTier(member, roleConfig.minTier)) {
    await interaction.reply({
      content: `You must be at least **Tier ${roleConfig.minTier}+** to claim \`${roleConfig.label}\` in this queue.`,
      ephemeral: true,
    });
    return true;
  }

  // One role per card: remove from all other role queues first
  for (const [k, set] of Object.entries(state.roles)) {
    if (k !== roleKey && set.has(member.id)) {
      set.delete(member.id);
    }
  }

  const setForRole = state.roles[roleKey];
  if (setForRole.size >= roleConfig.max) {
    await interaction.reply({
      content: `The \`${roleConfig.label}\` queue is already full.`,
      ephemeral: true,
    });
    return true;
  }

  setForRole.add(member.id);

  // DM confirmation (best-effort)
  try {
    await interaction.user.send(
      `You have been added to the **${roleConfig.label}** queue for this session.\n` +
      (state.trelloUrl ? `Trello: ${state.trelloUrl}` : ''),
    );
  } catch (err) {
    console.warn('[QUEUE] Failed to DM user about queue join:', err?.message || err);
  }

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
