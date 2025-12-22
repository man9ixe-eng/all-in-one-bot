// src/utils/sessionQueueManager.js
'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const {
  getCardByShortId
} = require('./trelloClient');

// In-memory map of active queues: key = trello shortLink
const activeQueues = new Map();

/**
 * Parse a Trello card short id from raw string (URL or short id).
 */
function parseCardShortId(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();

  const match = trimmed.match(/trello\.com\/c\/([A-Za-z0-9]+)/i);
  if (match) return match[1];

  if (/^[A-Za-z0-9]{8}$/.test(trimmed)) return trimmed;

  return null;
}

/**
 * Detect session type from card name/labels.
 * Returns 'interview' | 'training' | 'massshift' | null
 */
function detectSessionType(card) {
  const name = (card.name || '').toLowerCase();

  if (name.includes('[interview]')) return 'interview';
  if (name.includes('[training]')) return 'training';
  if (name.includes('[mass shift]') || name.includes('[massshift]') || name.includes('[ms]')) {
    return 'massshift';
  }

  if (Array.isArray(card.labels)) {
    const labelsString = card.labels
      .map(l => (l.name || '').toLowerCase())
      .join(' ');

    if (labelsString.includes('interview')) return 'interview';
    if (labelsString.includes('training')) return 'training';
    if (labelsString.includes('mass shift') || labelsString.includes('massshift')) {
      return 'massshift';
    }
  }

  return null;
}

/**
 * Get queue channel id based on session type.
 */
function getQueueChannelIdForType(sessionType) {
  switch (sessionType) {
    case 'interview':
      return process.env.SESSION_QUEUECHANNEL_INTERVIEW_ID || null;
    case 'training':
      return process.env.SESSION_QUEUECHANNEL_TRAINING_ID || null;
    case 'massshift':
      return process.env.SESSION_QUEUECHANNEL_MASSSHIFT_ID || null;
    default:
      return null;
  }
}

/**
 * Get ping role id based on session type.
 */
function getQueuePingRoleIdForType(sessionType) {
  switch (sessionType) {
    case 'interview':
      return process.env.SESSION_QUEUE_PING_INTERVIEW_ROLE_ID || null;
    case 'training':
      return process.env.SESSION_QUEUE_PING_TRAINING_ROLE_ID || null;
    case 'massshift':
      return process.env.SESSION_QUEUE_PING_MASS_SHIFT_ROLE_ID || null;
    default:
      return null;
  }
}

/**
 * Parse host discord id from card description.
 * Expected format:
 *   Host: username (123456789012345678)
 */
function parseHostIdFromCard(card) {
  const desc = card.desc || '';
  const match = desc.match(/Host:\s*[^(]+\((\d+)\)/i);
  if (match) return match[1];
  return null;
}

/**
 * Parse time text from card name.
 * Example: "[Interview] 8:30 PM EST - Man9ixe"
 * -> "8:30 PM EST"
 */
function parseTimeFromCardName(name = '') {
  const idx = name.indexOf(']');
  if (idx === -1) return name.trim();

  const rest = name.slice(idx + 1); // " 8:30 PM EST - Man9ixe"
  const dashIdx = rest.lastIndexOf('-');
  if (dashIdx === -1) return rest.trim();

  return rest.slice(0, dashIdx).trim();
}

/**
 * Parse host display name from card name.
 * Example: "[Interview] 8:30 PM EST - Man9ixe" -> "Man9ixe"
 */
function parseHostNameFromCardName(name = '') {
  const dashIdx = name.lastIndexOf('-');
  if (dashIdx === -1) return 'Host';
  return name.slice(dashIdx + 1).trim() || 'Host';
}

/**
 * Compute "Starts: in X minutes" text from card.due (iso string).
 */
function computeStartsText(dueIso) {
  if (!dueIso) return 'Time TBD';

  const now = Date.now();
  const dueMs = new Date(dueIso).getTime();

  const diff = dueMs - now;
  if (Number.isNaN(dueMs)) return 'Time TBD';

  if (diff <= 0) return 'now';

  const mins = Math.round(diff / 60000);
  if (mins <= 1) return 'in 1 minute';

  return `in ${mins} minutes`;
}

/**
 * Build the fancy queue embed + buttons.
 */
function buildQueueEmbedAndComponents(card, sessionType, hostId) {
  const timeText = parseTimeFromCardName(card.name || '');
  const hostName = parseHostNameFromCardName(card.name || '');
  const startsText = computeStartsText(card.due);

  const typeDisplay =
    sessionType === 'massshift'
      ? 'MASS SHIFT'
      : sessionType.toUpperCase();

  const topBorder = '╔══════════════════════════════════════╗';
  const bottomBorder = '╚══════════════════════════════════════╝';

  const headerCore = `🟡 ${typeDisplay} | ${hostName} | ${timeText} 🟡`;
  const totalWidth = topBorder.length;
  const padSize = Math.max(0, Math.floor((totalWidth - headerCore.length) / 2));
  const paddedHeader = `${' '.repeat(padSize)}${headerCore}`;

  const hostMention = hostId ? `<@${hostId}>` : hostName;

  const description =
    `${topBorder}\n` +
    `${paddedHeader}\n` +
    `${bottomBorder}\n\n` +
    `📌 Host: ${hostMention}\n` +
    `📌 Starts: ${startsText}\n` +
    `📌 Time: ${timeText}\n\n` +
    `💠 ROLES 💠\n` +
    `----------------------------------------------------------------\n` +
    `ℹ️ Co-Host: Corporate Intern+\n` +
    `ℹ️ Overseer: Executive Manager+\n` +
    `ℹ️ Interviewer (12): Leadership Intern+\n` +
    `ℹ️ Spectator (4): Leadership Intern+\n\n` +
    `❓ HOW TO JOIN THE QUEUE ❓\n` +
    `----------------------------------------------------------------\n` +
    `Check the role list above — if your rank is allowed, press the role button you want.\n` +
    `You’ll get a private confirmation message that you were added to that role's queue.\n` +
    `Do NOT join the game until the attendees post is made in the attendees channel.\n\n` +
    `❓ HOW TO LEAVE THE QUEUE / INFORM LATE ARRIVAL ❓\n` +
    `----------------------------------------------------------------\n` +
    `Click the **Leave Queue** button once you have joined a role.\n` +
    `After the attendees post is made, changes must be handled by the host/corporate manually.\n\n` +
    `----------------------------------------------------------------\n` +
    `╭─────── 💠 LINKS 💠 ───────────╮\n` +
    `• Trello Card: ${card.shortUrl || card.url}\n` +
    `╰─────────────────────────────╯`;

  const embed = new EmbedBuilder()
    .setDescription(description)
    .setColor(
      sessionType === 'interview'
        ? 0xffd166 // yellow-ish
        : sessionType === 'training'
          ? 0x06d6a0 // green-ish
          : 0x118ab2 // blue-ish
    );

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`queue_join:${card.shortLink || card.id}:cohost`)
      .setLabel('Co-Host')
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId(`queue_join:${card.shortLink || card.id}:overseer`)
      .setLabel('Overseer')
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId(`queue_join:${card.shortLink || card.id}:interviewer`)
      .setLabel('Interviewer')
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId(`queue_join:${card.shortLink || card.id}:spectator`)
      .setLabel('Spectator')
      .setStyle(ButtonStyle.Primary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`queue_leave:${card.shortLink || card.id}`)
      .setLabel('Leave Queue')
      .setStyle(ButtonStyle.Danger)
  );

  return { embed, components: [row1, row2] };
}

/**
 * Helper: ephemeral reply that auto-deletes after 5 seconds.
 */
async function replyAndAutoDelete(interaction, content) {
  try {
    await interaction.reply({ content, ephemeral: true });
    setTimeout(() => {
      interaction.deleteReply().catch(() => {});
    }, 5000);
  } catch (err) {
    console.error('[QUEUE] Failed to send ephemeral reply:', err);
  }
}

/**
 * Helper for already-deferred interactions: edit + auto-delete.
 */
async function editAndAutoDelete(interaction, content) {
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.reply({ content, ephemeral: true });
      setTimeout(() => {
        interaction.deleteReply().catch(() => {});
      }, 5000);
      return;
    }

    await interaction.editReply({ content });
    setTimeout(() => {
      interaction.deleteReply().catch(() => {});
    }, 5000);
  } catch (err) {
    console.error('[QUEUE] Failed to edit ephemeral reply:', err);
  }
}

/**
 * Open a queue for a Trello card (called from /sessionqueue).
 * interaction: ChatInputCommandInteraction
 */
async function openQueueForCard(interaction) {
  const raw = interaction.options.getString('card', true);
  console.log('[QUEUE] Raw card option:', raw);

  const shortId = parseCardShortId(raw);
  if (!shortId) {
    return replyAndAutoDelete(
      interaction,
      'I could not open a queue for that Trello card.\n' +
        '• Make sure the link is valid\n' +
        '• The card has the correct session labels or [Interview]/[Training]/[Mass Shift] in the name\n' +
        '• The queue channels/roles are configured in SESSION_* and QUEUE_* env vars.'
    );
  }

  await interaction.deferReply({ ephemeral: true });

  let card;
  try {
    card = await getCardByShortId(shortId);
  } catch (err) {
    console.error('[QUEUE] Could not fetch Trello card for shortId:', shortId, err);
    return editAndAutoDelete(
      interaction,
      'I could not open a queue for that Trello card.\n' +
        '• Make sure the link is valid\n' +
        '• The card has the correct session labels or [Interview]/[Training]/[Mass Shift] in the name\n' +
        '• The queue channels/roles are configured in SESSION_* and QUEUE_* env vars.'
    );
  }

  const sessionType = detectSessionType(card);
  if (!sessionType) {
    console.log('[QUEUE] Could not detect session type for card:', card && card.name);
    return editAndAutoDelete(
      interaction,
      'I could not open a queue for that Trello card.\n' +
        '• Make sure the card name starts with [Interview], [Training], or [Mass Shift]\n' +
        '• Or that it has the correct Trello labels.'
    );
  }

  const queueChannelId = getQueueChannelIdForType(sessionType);
  if (!queueChannelId) {
    console.log('[QUEUE] Missing channel config for session type:', sessionType);
    return editAndAutoDelete(
      interaction,
      `I could not open a queue for that Trello card.\n• Make sure SESSION_QUEUECHANNEL_* env vars are set for ${sessionType}.`
    );
  }

  const hostId = parseHostIdFromCard(card) || interaction.user.id;
  const queueChannel = await interaction.client.channels.fetch(queueChannelId).catch(() => null);

  if (!queueChannel || !queueChannel.isTextBased()) {
    console.error('[QUEUE] Configured queue channel is invalid or not text-based:', queueChannelId);
    return editAndAutoDelete(
      interaction,
      'I could not open a queue for that Trello card.\n• The configured queue channel is invalid.'
    );
  }

  const { embed, components } = buildQueueEmbedAndComponents(card, sessionType, hostId);

  const queueMessage = await queueChannel.send({
    embeds: [embed],
    components
  });

  const pingRoleId = getQueuePingRoleIdForType(sessionType);
  if (pingRoleId) {
    // Ping is outside the embed so it actually pings.
    await queueChannel.send({ content: `<@&${pingRoleId}>` });
  }

  const key = card.shortLink || shortId;

  activeQueues.set(key, {
    cardShortId: key,
    sessionType,
    hostId,
    channelId: queueChannel.id,
    queueMessageId: queueMessage.id,
    attendeesMessageId: null,
    roles: {
      cohost: { max: 1, members: [] },
      overseer: { max: 1, members: [] },
      interviewer: { max: 12, members: [] },
      spectator: { max: 4, members: [] }
    }
  });

  const channelMention = `<#${queueChannel.id}>`;
  await interaction.editReply({
    content: `✅ Opened queue for ${card.name} in ${channelMention}`
  });
  setTimeout(() => {
    interaction.deleteReply().catch(() => {});
  }, 5000);

  console.log('[QUEUE] Opened queue for card', key, 'in channel', queueChannel.id);
}

/**
 * Handle button interactions for joining/leaving queue roles.
 */
async function handleQueueButtonInteraction(interaction) {
  const customId = interaction.customId || '';
  if (!customId.startsWith('queue_')) return; // Not ours.

  const parts = customId.split(':'); // e.g. queue_join:MRM1L51Q:interviewer
  const action = parts[0]; // 'queue_join' or 'queue_leave'
  const cardShortId = parts[1];
  const roleKey = parts[2];

  const queue = activeQueues.get(cardShortId);
  if (!queue) {
    return replyAndAutoDelete(interaction, 'That queue is no longer active.');
  }

  const userId = interaction.user.id;

  // Helper: remove user from all roles.
  for (const role of Object.values(queue.roles)) {
    const idx = role.members.indexOf(userId);
    if (idx !== -1) {
      role.members.splice(idx, 1);
    }
  }

  if (action === 'queue_leave') {
    return replyAndAutoDelete(interaction, 'You were removed from all roles for this session queue.');
  }

  if (action === 'queue_join') {
    const role = queue.roles[roleKey];
    if (!role) {
      return replyAndAutoDelete(interaction, 'That role is not valid for this queue.');
    }

    if (role.members.includes(userId)) {
      return replyAndAutoDelete(interaction, 'You are already in that role queue.');
    }

    if (role.members.length >= role.max) {
      const label =
        roleKey === 'cohost'
          ? 'Co-Host'
          : roleKey === 'overseer'
            ? 'Overseer'
            : roleKey === 'interviewer'
              ? 'Interviewer'
              : 'Spectator';
      return replyAndAutoDelete(interaction, `The ${label} queue is currently full.`);
    }

    role.members.push(userId);

    const label =
      roleKey === 'cohost'
        ? 'Co-Host'
        : roleKey === 'overseer'
          ? 'Overseer'
          : roleKey === 'interviewer'
            ? 'Interviewer'
            : 'Spectator';

    return replyAndAutoDelete(interaction, `You were added as **${label}** for this session.`);
  }
}

/**
 * Build the selected attendees text message (with pings).
 */
function buildAttendeesMessage(queue) {
  const hostLine = queue.hostId ? `<@${queue.hostId}>` : 'N/A';

  const cohost = queue.roles.cohost.members[0];
  const overseer = queue.roles.overseer.members[0];

  const cohostLine = cohost ? `<@${cohost}>` : 'None selected';
  const overseerLine = overseer ? `<@${overseer}>` : 'None selected';

  const interviewers = queue.roles.interviewer.members;
  const spectators = queue.roles.spectator.members;

  const interviewerLines = [];
  for (let i = 0; i < 12; i++) {
    const userId = interviewers[i];
    interviewerLines.push(`${i + 1}. ${userId ? `<@${userId}>` : ''}`);
  }

  const spectatorLines = [];
  for (let i = 0; i < 4; i++) {
    const userId = spectators[i];
    spectatorLines.push(`${i + 1}. ${userId ? `<@${userId}>` : ''}`);
  }

  const topBorder = '╔══════════════════════════════════════╗';
  const bottomBorder = '╚══════════════════════════════════════╝';

  const headerCore = '✅  SELECTED ATTENDEES ✅';
  const totalWidth = topBorder.length;
  const padSize = Math.max(0, Math.floor((totalWidth - headerCore.length) / 2));
  const paddedHeader = `${' '.repeat(padSize)}${headerCore}`;

  return (
    `${topBorder}\n` +
    `${paddedHeader}\n` +
    `${bottomBorder}\n\n` +
    `🧊 Host: ${hostLine}\n` +
    `🧊 Co-Host: ${cohostLine}\n` +
    `🧊 Overseer: ${overseerLine}\n\n` +
    `────────────\n\n` +
    `🟡  Interviewers 🟡\n` +
    interviewerLines.join('\n') +
    `\n\n` +
    `────────────\n\n` +
    `⚪  Spectators ⚪\n` +
    spectatorLines.join('\n') +
    `\n\n` +
    `🧊 You should now join! Please join within **5 minutes**, or your spot will be given to someone else.\n` +
    `🧊 Failure to join on time will result in a **written warning**. :(`
  );
}

/**
 * /sessionattendees command handler (called from that command).
 * interaction: ChatInputCommandInteraction
 */
async function postAttendeesForCard(interaction) {
  const raw = interaction.options.getString('card', true);
  const shortId = parseCardShortId(raw);

  await interaction.deferReply({ ephemeral: true });

  if (!shortId) {
    return editAndAutoDelete(
      interaction,
      'I could not find that Trello card.\n• Make sure the link or short ID is valid.'
    );
  }

  // Queue key uses card.shortLink; but to be safe, try both the shortId and raw.
  const queue =
    activeQueues.get(shortId) ||
    activeQueues.get(raw.trim());

  if (!queue) {
    return editAndAutoDelete(
      interaction,
      'There is no active queue tracked for that session card.'
    );
  }

  const channel = await interaction.client.channels.fetch(queue.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    return editAndAutoDelete(
      interaction,
      'The queue channel configured for this session could not be found.'
    );
  }

  const messageText = buildAttendeesMessage(queue);

  const attendeesMessage = await channel.send({
    content: messageText
    // No allowed_mentions override -> real pings
  });

  queue.attendeesMessageId = attendeesMessage.id;

  await interaction.editReply({
    content: `✅ Posted selected attendees for this session in <#${channel.id}>.`
  });
  setTimeout(() => {
    interaction.deleteReply().catch(() => {});
  }, 5000);

  console.log('[QUEUE] Posted attendees for card', queue.cardShortId);
}

/**
 * Session announcement tick stub.
 * If index.js calls this, it will keep logging without breaking anything.
 */
async function sessionAnnouncementTick() {
  console.log('[AUTO] Session announcement tick...');
  // You can re-add Trello-based auto announcer here later if needed.
}

module.exports = {
  openQueueForCard,
  handleQueueButtonInteraction,
  postAttendeesForCard,

  // For whatever name index.js might be using:
  sessionAnnouncementTick,
  runSessionAnnouncementTick: sessionAnnouncementTick,
  autoSessionAnnouncementTick: sessionAnnouncementTick
};
