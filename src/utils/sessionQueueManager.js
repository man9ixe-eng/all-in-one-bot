// src/utils/sessionQueueManager.js
// Handles posting the queue embed + buttons AND
// posting the attendees skeleton as a plain text message.

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');

const { trelloRequest } = require('./trelloClient');
const {
  QUEUE_INTERVIEW_CHANNEL_ID,
  QUEUE_TRAINING_CHANNEL_ID,
  QUEUE_MASSSHIFT_CHANNEL_ID,
  QUEUE_INTERVIEW_ATTENDEES_CHANNEL_ID,
  QUEUE_TRAINING_ATTENDEES_CHANNEL_ID,
  QUEUE_MASSSHIFT_ATTENDEES_CHANNEL_ID,
  QUEUE_INTERVIEW_PING_ROLE_ID,
  QUEUE_TRAINING_PING_ROLE_ID,
  QUEUE_MASSSHIFT_PING_ROLE_ID,
} = require('../config/sessionQueue');

// In-memory queue state (per queue message)
const queueState = new Map();

/**
 * Parse Trello card ID/shortlink from a user-provided string.
 * Accepts:
 *  - Full Trello URL (with or without trailing path)
 *  - Short link
 *  - Full card ID
 */
function parseCardIdFromInput(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();

  // URL case
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const url = new URL(trimmed);
      const parts = url.pathname.split('/').filter(Boolean);
      // e.g. /c/SHORTID or /c/SHORTID/whatever
      const cIndex = parts.indexOf('c');
      if (cIndex !== -1 && parts.length > cIndex + 1) {
        return parts[cIndex + 1];
      }
    } catch {
      // fall through
    }
  }

  // Otherwise assume it's already a Trello card id or shortlink
  return trimmed;
}

/**
 * Detect session type from the card name.
 * We rely on the [Interview]/[Training]/[Mass Shift] prefix.
 */
function detectSessionType(card) {
  if (!card || !card.name) return null;
  const name = card.name.toLowerCase();

  if (name.includes('[interview]')) return 'interview';
  if (name.includes('[training]')) return 'training';
  if (name.includes('[mass shift]') || name.includes('[mass_shift]') || name.includes('[massshift]')) {
    return 'mass_shift';
  }
  return null;
}

function getQueueChannelId(sessionType) {
  switch (sessionType) {
    case 'interview':
      return QUEUE_INTERVIEW_CHANNEL_ID || null;
    case 'training':
      return QUEUE_TRAINING_CHANNEL_ID || null;
    case 'mass_shift':
      return QUEUE_MASSSHIFT_CHANNEL_ID || null;
    default:
      return null;
  }
}

function getAttendeesChannelId(sessionType) {
  switch (sessionType) {
    case 'interview':
      return QUEUE_INTERVIEW_ATTENDEES_CHANNEL_ID || null;
    case 'training':
      return QUEUE_TRAINING_ATTENDEES_CHANNEL_ID || null;
    case 'mass_shift':
      return QUEUE_MASSSHIFT_ATTENDEES_CHANNEL_ID || null;
    default:
      return null;
  }
}

function getQueuePingRoleId(sessionType) {
  switch (sessionType) {
    case 'interview':
      return QUEUE_INTERVIEW_PING_ROLE_ID || null;
    case 'training':
      return QUEUE_TRAINING_PING_ROLE_ID || null;
    case 'mass_shift':
      return QUEUE_MASSSHIFT_PING_ROLE_ID || null;
    default:
      return null;
  }
}

/**
 * Try to parse a host from the card description.
 * Desc format from createSessionCard:
 *  Session Type: ...
 *  Host: username (123456789012345678)
 */
function parseHostFromDesc(desc, fallbackUser) {
  const fallbackName = fallbackUser?.tag || fallbackUser?.username || 'Host';
  const fallbackMention = fallbackUser ? `<@${fallbackUser.id}>` : fallbackName;

  if (typeof desc !== 'string') {
    return { name: fallbackName, mention: fallbackMention };
  }

  const hostLineMatch = desc.match(/^Host:\s*(.+)$/m);
  if (!hostLineMatch) {
    return { name: fallbackName, mention: fallbackMention };
  }

  const line = hostLineMatch[1].trim();
  const idMatch = line.match(/\((\d{17,})\)/);
  let namePart = line;
  let id = null;

  if (idMatch) {
    id = idMatch[1];
    namePart = line.replace(idMatch[0], '').trim();
  }

  if (id) {
    return {
      name: namePart || fallbackName,
      mention: `<@${id}>`,
    };
  }

  return {
    name: namePart || fallbackName,
    mention: fallbackMention,
  };
}

/**
 * Human-readable role names for ephemeral replies.
 */
function prettyRoleName(roleKey) {
  switch (roleKey) {
    case 'cohost':
      return 'Co-Host';
    case 'overseer':
      return 'Overseer';
    case 'interviewer':
      return 'Interviewer';
    case 'spectator':
      return 'Spectator';
    case 'trainer':
      return 'Trainer';
    case 'attendee':
      return 'Attendee';
    default:
      return roleKey;
  }
}

/**
 * Build the queue embed body for a given session type.
 */
function buildQueueEmbed({ sessionType, hostDisplay, hostMention, dueEpoch, trelloUrl }) {
  const timeTag = dueEpoch ? `<t:${dueEpoch}:t>` : 'TBA';
  const startsTag = dueEpoch ? `<t:${dueEpoch}:R>` : 'TBA';

  const headerLine =
    sessionType === 'interview'
      ? `🟡 INTERVIEW | ${hostDisplay} | ${timeTag} 🟡`
      : sessionType === 'training'
      ? `🔴 TRAINING | ${hostDisplay} | ${timeTag} 🔴`
      : `🟣 MASS SHIFT | ${hostDisplay} | ${timeTag} 🟣`;

  let rolesBlock;
  if (sessionType === 'interview') {
    rolesBlock = [
      'ℹ️ **Co-Host:** Corporate Intern+',
      'ℹ️ **Overseer:** Executive Manager+',
      'ℹ️ **Interviewer (12):** Leadership Intern+',
      'ℹ️ **Spectator (4):** Leadership Intern+',
    ].join('\n');
  } else if (sessionType === 'training') {
    rolesBlock = [
      'ℹ️ **Co-Host:** Corporate Intern+',
      'ℹ️ **Overseer:** Executive Manager+',
      'ℹ️ **Trainer (8):** Leadership Intern+',
      'ℹ️ **Spectator (4):** Leadership Intern+',
    ].join('\n');
  } else {
    // mass shift
    rolesBlock = [
      'ℹ️ **Co-Host:** Corporate Intern+',
      'ℹ️ **Overseer:** Executive Manager+',
      'ℹ️ **Attendee:** Leadership Intern+',
    ].join('\n');
  }

  const lines = [
    '╔══════════════════════════════════════╗',
    headerLine,
    '╚══════════════════════════════════════╝',
    '',
    `📌 Host: ${hostMention || hostDisplay}`,
    `📌 Starts: ${startsTag}`,
    `📌 Time: ${timeTag}`,
    '',
    '💠 ROLES 💠',
    '----------------------------------------------------------------',
    rolesBlock,
    '',
    '❓ HOW TO JOIN THE QUEUE ❓',
    '----------------------------------------------------------------',
    '- Check the role list above — if your rank is allowed, press the role button you want.',
    "- You\'ll get a private message (ephemeral reply) confirming you were added to that role\'s queue.",
    '- Do NOT join the game until the attendees post is made in the attendees channel.',
    '',
    '❓ HOW TO LEAVE THE QUEUE / INFORM LATE ARRIVAL ❓',
    '----------------------------------------------------------------',
    '- Click the **Leave Queue** button once you have joined a role.',
    '- After the attendees post is made, changes must be handled by the host/corporate manually.',
    '',
    '----------------------------------------------------------------',
    '╭─────── 💠 LINKS 💠 ───────────╮',
    `• Trello Card: ${trelloUrl}`,
    '╰─────────────────────────────╯',
  ];

  return new EmbedBuilder().setDescription(lines.join('\n'));
}

/**
 * Build button rows for a given session type.
 * - Join buttons per role (Co-Host, Overseer, etc.)
 * - One global "Leave Queue" button.
 */
function buildQueueButtons(sessionType) {
  const buttons = [];

  if (sessionType === 'interview') {
    buttons.push(
      new ButtonBuilder()
        .setCustomId('queue_join:interview:cohost')
        .setLabel('Co-Host')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('queue_join:interview:overseer')
        .setLabel('Overseer')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('queue_join:interview:interviewer')
        .setLabel('Interviewer')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('queue_join:interview:spectator')
        .setLabel('Spectator')
        .setStyle(ButtonStyle.Secondary),
    );
  } else if (sessionType === 'training') {
    buttons.push(
      new ButtonBuilder()
        .setCustomId('queue_join:training:cohost')
        .setLabel('Co-Host')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('queue_join:training:overseer')
        .setLabel('Overseer')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('queue_join:training:trainer')
        .setLabel('Trainer')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('queue_join:training:spectator')
        .setLabel('Spectator')
        .setStyle(ButtonStyle.Secondary),
    );
  } else {
    // mass shift
    buttons.push(
      new ButtonBuilder()
        .setCustomId('queue_join:mass_shift:cohost')
        .setLabel('Co-Host')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('queue_join:mass_shift:overseer')
        .setLabel('Overseer')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('queue_join:mass_shift:attendee')
        .setLabel('Attendee')
        .setStyle(ButtonStyle.Success),
    );
  }

  const rows = [];

  if (buttons.length > 0) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(0, 3)));
  }
  if (buttons.length > 3) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(3)));
  }

  // Global "Leave Queue" button
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('queue_leave_all')
        .setLabel('Leave Queue')
        .setStyle(ButtonStyle.Danger),
    ),
  );

  return rows;
}

/**
 * Create per-message queue metadata, with role limits.
 */
function initQueueMetaForMessage(messageId, sessionType, cardId, dueEpoch) {
  const baseRoles = {
    cohost: new Set(),
    overseer: new Set(),
    interviewer: new Set(),
    spectator: new Set(),
    trainer: new Set(),
    attendee: new Set(),
  };

  let limits;
  if (sessionType === 'interview') {
    limits = { cohost: 1, overseer: 1, interviewer: 12, spectator: 4 };
  } else if (sessionType === 'training') {
    limits = { cohost: 1, overseer: 1, trainer: 8, spectator: 4 };
  } else {
    // mass shift
    limits = { cohost: 1, overseer: 1, attendee: 15 };
  }

  const meta = {
    sessionType,
    cardId,
    dueEpoch: dueEpoch || null,
    roles: baseRoles,
    limits,
  };

  queueState.set(messageId, meta);
  return meta;
}

/**
 * Post the ATTENDEES SKELETON in the correct channel as a normal message.
 * This is the one that should ping and look exactly like your layout.
 */
async function postAttendeesSkeleton({ client, sessionType, card, hostMention, dueEpoch }) {
  const channelId = getAttendeesChannelId(sessionType);
  if (!channelId) {
    console.warn('[QUEUE] No attendees channel configured for', sessionType);
    return;
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    console.warn('[QUEUE] Attendees channel invalid or not text-based:', channelId);
    return;
  }

  const trelloUrl =
    card.shortUrl || `https://trello.com/c/${card.idShort || card.id}`;
  const timeTag = dueEpoch ? `<t:${dueEpoch}:t>` : 'TBA';

  let contentLines;

  if (sessionType === 'interview') {
    contentLines = [
      '╔══════════════════════════════════════╗',
      `🟡 INTERVIEW | ${hostMention} | ${timeTag} 🟡`,
      '╚══════════════════════════════════════╝',
      '',
      `🧊 Host: ${hostMention}`,
      '🧊 Co-Host:',
      '🧊 Overseer:',
      '',
      '────────────',
      '',
      '🟡  Interviewers 🟡',
      '1.',
      '2.',
      '3.',
      '4.',
      '5.',
      '6.',
      '7.',
      '8.',
      '9.',
      '10.',
      '11.',
      '12.',
      '',
      '────────────',
      '',
      '⚪  Spectators ⚪',
      '1.',
      '2.',
      '3.',
      '4.',
      '',
      '🧊 You should now join! Please join within **5 minutes**, or your spot will be given to someone else.',
      '🧊 Failure to join on time will result in a **written warning**. :(',
      '',
      `Trello Card: ${trelloUrl}`,
    ];
  } else if (sessionType === 'training') {
    contentLines = [
      '╔══════════════════════════════════════╗',
      `🔴 TRAINING | ${hostMention} | ${timeTag} 🔴`,
      '╚══════════════════════════════════════╝',
      '',
      `🧊 Host: ${hostMention}`,
      '🧊 Co-Host:',
      '🧊 Overseer:',
      '',
      '────────────',
      '',
      '🔴  Trainers 🔴',
      '1.',
      '2.',
      '3.',
      '4.',
      '5.',
      '6.',
      '7.',
      '8.',
      '',
      '────────────',
      '',
      '⚪  Spectators ⚪',
      '1.',
      '2.',
      '3.',
      '4.',
      '',
      '🧊 You should now join! Please join within **5 minutes**, or your spot will be given to someone else.',
      '🧊 Failure to join on time will result in a **written warning**. :(',
      '',
      `Trello Card: ${trelloUrl}`,
    ];
  } else {
    // mass shift
    contentLines = [
      '╔══════════════════════════════════════╗',
      `🟣 MASS SHIFT | ${hostMention} | ${timeTag} 🟣`,
      '╚══════════════════════════════════════╝',
      '',
      `🧊 Host: ${hostMention}`,
      '🧊 Co-Host:',
      '🧊 Overseer:',
      '',
      '────────────',
      '',
      '🟣  Attendees 🟣',
      '1.',
      '2.',
      '3.',
      '4.',
      '5.',
      '6.',
      '7.',
      '8.',
      '9.',
      '10.',
      '11.',
      '12.',
      '13.',
      '14.',
      '15.',
      '',
      '────────────',
      '',
      '🧊 You should now join! Please join within **5 minutes**, or your spot will be given to someone else.',
      '🧊 Failure to join on time will result in a **written warning**. :(',
      '',
      `Trello Card: ${trelloUrl}`,
    ];
  }

  const pingRoleId = getQueuePingRoleId(sessionType);
  let finalContent = contentLines.join('\n');
  if (pingRoleId) {
    finalContent += `\n\n<@&${pingRoleId}>`;
  }

  await channel.send({
    content: finalContent,
    allowedMentions: pingRoleId ? { roles: [pingRoleId] } : undefined,
  });
}

/**
 * Open a session queue for a Trello card.
 * - Posts queue embed + buttons in the QUEUE_* channel
 * - Posts attendees skeleton in the ATTENDEES_* channel (plain text)
 */
async function openQueueForCard(client, cardInput, openerUser) {
  console.log('[QUEUE] Raw card option:', cardInput);
  const cardIdOrShort = parseCardIdFromInput(cardInput);
  if (!cardIdOrShort) {
    console.warn('[QUEUE] Could not parse Trello card id from:', cardInput);
    return false;
  }

  const cardRes = await trelloRequest(`/cards/${cardIdOrShort}`, 'GET', {
    fields: 'name,desc,due,shortUrl,idLabels,idShort',
  });

  if (!cardRes.ok || !cardRes.data) {
    console.error(
      '[QUEUE] Failed to fetch Trello card:',
      cardIdOrShort,
      cardRes.status,
      cardRes.data,
    );
    return false;
  }

  const card = cardRes.data;
  const sessionType = detectSessionType(card);
  if (!sessionType) {
    console.warn('[QUEUE] Could not detect session type for card:', cardIdOrShort);
    return false;
  }

  const queueChannelId = getQueueChannelId(sessionType);
  if (!queueChannelId) {
    console.warn('[QUEUE] Missing channel config for session type:', sessionType);
    return false;
  }

  const queueChannel = await client.channels.fetch(queueChannelId).catch(() => null);
  if (!queueChannel || !queueChannel.isTextBased()) {
    console.error('[QUEUE] Queue channel invalid or not text-based:', queueChannelId);
    return false;
  }

  const trelloUrl =
    card.shortUrl || `https://trello.com/c/${card.idShort || cardIdOrShort}`;
  const dueEpoch = card.due ? Math.floor(new Date(card.due).getTime() / 1000) : null;

  const hostInfo = parseHostFromDesc(card.desc, openerUser);
  const hostDisplay = hostInfo.name;
  const hostMention = hostInfo.mention;

  const embed = buildQueueEmbed({
    sessionType,
    hostDisplay,
    hostMention,
    dueEpoch,
    trelloUrl,
  });

  const components = buildQueueButtons(sessionType);

  const pingRoleId = getQueuePingRoleId(sessionType);
  const content = pingRoleId ? `<@&${pingRoleId}>` : '';

  const message = await queueChannel.send({
    content: content || undefined,
    embeds: [embed],
    components,
    allowedMentions: pingRoleId ? { roles: [pingRoleId] } : undefined,
  });

  initQueueMetaForMessage(
    message.id,
    sessionType,
    card.id || cardIdOrShort,
    dueEpoch,
  );

  // Drop the attendees skeleton as a normal message (in its own channel)
  await postAttendeesSkeleton({
    client,
    sessionType,
    card,
    hostMention,
    dueEpoch,
  });

  console.log(
    '[QUEUE] Opened queue for card',
    cardIdOrShort,
    'as message',
    message.id,
  );
  return true;
}

/**
 * Handle button interactions for join / leave.
 */
async function handleQueueButtonInteraction(interaction) {
  if (!interaction.isButton()) return false;

  const id = interaction.customId;

  // Global leave
  if (id === 'queue_leave_all') {
    const meta = queueState.get(interaction.message.id);
    if (!meta) {
      await interaction.reply({
        content: 'This queue is no longer active.',
        ephemeral: true,
      });
      return true;
    }

    const userId = interaction.user.id;
    let removed = false;
    for (const set of Object.values(meta.roles)) {
      if (set && set.has && set.has(userId)) {
        set.delete(userId);
        removed = true;
      }
    }

    await interaction.reply({
      content: removed
        ? 'You have been removed from this session queue.'
        : 'You are not currently in this queue.',
      ephemeral: true,
    });

    return true;
  }

  // Join buttons
  if (!id.startsWith('queue_join:')) {
    return false;
  }

  const parts = id.split(':'); // ['queue_join', 'sessionType', 'roleKey']
  if (parts.length !== 3) return false;

  const sessionType = parts[1];
  const roleKey = parts[2];

  const meta = queueState.get(interaction.message.id);
  if (!meta || meta.sessionType !== sessionType) {
    await interaction.reply({
      content: 'This queue is no longer active or is misconfigured.',
      ephemeral: true,
    });
    return true;
  }

  const limit = meta.limits[roleKey];
  const roleSet = meta.roles[roleKey];

  if (!limit || !roleSet) {
    await interaction.reply({
      content: 'That role is not available for this session.',
      ephemeral: true,
    });
    return true;
  }

  const userId = interaction.user.id;

  // Only allow one role per user: remove from all roles first
  for (const set of Object.values(meta.roles)) {
    if (set && set.has && set.has(userId)) {
      set.delete(userId);
    }
  }

  // Check capacity
  if (roleSet.size >= limit) {
    await interaction.reply({
      content: `The **${prettyRoleName(roleKey)}** queue is currently full.`,
      ephemeral: true,
    });
    return true;
  }

  roleSet.add(userId);

  await interaction.reply({
    content: `You have been added to the **${prettyRoleName(
      roleKey,
    )}** queue.`,
    ephemeral: true,
  });

  return true;
}

module.exports = {
  openQueueForCard,
  handleQueueButtonInteraction,
};
