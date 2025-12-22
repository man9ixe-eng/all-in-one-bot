// src/utils/sessionQueueManager.js

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

// Trello auth
const TRELLO_KEY = process.env.TRELLO_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;

// Queue ping + channels (DO NOT change these names – matching your envs)
const SESSION_QUEUE_PING_INTERVIEW_ROLE_ID = process.env.SESSION_QUEUE_PING_INTERVIEW_ROLE_ID;
const SESSION_QUEUE_PING_MASS_SHIFT_ROLE_ID = process.env.SESSION_QUEUE_PING_MASS_SHIFT_ROLE_ID;
const SESSION_QUEUE_PING_TRAINING_ROLE_ID = process.env.SESSION_QUEUE_PING_TRAINING_ROLE_ID;

const SESSION_QUEUECHANNEL_INTERVIEW_ID = process.env.SESSION_QUEUECHANNEL_INTERVIEW_ID;
const SESSION_QUEUECHANNEL_MASSSHIFT_ID = process.env.SESSION_QUEUECHANNEL_MASSSHIFT_ID;
const SESSION_QUEUECHANNEL_TRAINING_ID = process.env.SESSION_QUEUECHANNEL_TRAINING_ID;

// Where the log copy goes (embed, no pings)
const SESSION_ATTENDEES_LOG_CHANNEL_ID = process.env.SESSION_ATTENDEES_LOG_CHANNEL_ID || null;

// In-memory queue store: shortLink → queue object
const activeQueues = new Map();

/* -----------------------------------------------------
 * Helper: Trello card shortLink
 * ---------------------------------------------------*/
function extractTrelloShortLink(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();

  // If it’s a URL
  try {
    const url = new URL(trimmed);
    if (url.hostname.includes('trello.com')) {
      const parts = url.pathname.split('/').filter(Boolean); // ['c','SHORT','...']
      const idx = parts.indexOf('c');
      if (idx !== -1 && parts[idx + 1]) {
        return parts[idx + 1];
      }
    }
  } catch {
    // not a URL, ignore
  }

  // Otherwise, last part before any dashes
  const lastSeg = trimmed.split('/').pop() || trimmed;
  return lastSeg.split('-')[0];
}

/* -----------------------------------------------------
 * Helper: Trello fetch (simple, no fancy wrapper)
 * ---------------------------------------------------*/
async function fetchCardInfo(shortLink) {
  if (!TRELLO_KEY || !TRELLO_TOKEN) {
    console.error('[TRELLO] Missing TRELLO_KEY or TRELLO_TOKEN.');
    return null;
  }

  const url =
    `https://api.trello.com/1/cards/${encodeURIComponent(shortLink)}` +
    `?key=${encodeURIComponent(TRELLO_KEY)}` +
    `&token=${encodeURIComponent(TRELLO_TOKEN)}` +
    `&fields=name,desc,due,url,shortLink,idList,labels`;

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('[TRELLO] Error fetching card:', res.status, text);
    return null;
  }

  return res.json();
}

/* -----------------------------------------------------
 * Parse metadata from card
 * ---------------------------------------------------*/
function parseSessionMetadataFromCard(card) {
  const meta = {
    sessionType: null,
    sessionTypeLabel: null,
    hostDiscordId: null,
    hostNameFromCard: null,
    timeLabel: null,
    startsInLabel: null,
    cardName: card.name,
    cardUrl: card.url,
    shortLink: card.shortLink,
  };

  // 1) Session type by prefix or labels
  if (card.name.startsWith('[Interview]')) {
    meta.sessionType = 'interview';
    meta.sessionTypeLabel = 'Interview';
  } else if (card.name.startsWith('[Training]')) {
    meta.sessionType = 'training';
    meta.sessionTypeLabel = 'Training';
  } else if (card.name.startsWith('[Mass Shift]') || card.name.startsWith('[MassShift]')) {
    meta.sessionType = 'massshift';
    meta.sessionTypeLabel = 'Mass Shift';
  }

  if (!meta.sessionType && Array.isArray(card.labels)) {
    for (const label of card.labels) {
      const n = (label.name || '').toLowerCase();
      if (n.includes('interview')) {
        meta.sessionType = 'interview';
        meta.sessionTypeLabel = 'Interview';
        break;
      }
      if (n.includes('training')) {
        meta.sessionType = 'training';
        meta.sessionTypeLabel = 'Training';
        break;
      }
      if (n.includes('mass') && n.includes('shift')) {
        meta.sessionType = 'massshift';
        meta.sessionTypeLabel = 'Mass Shift';
        break;
      }
    }
  }

  // 2) Host + time from card name after [Type]
  //    e.g. "[Interview] 8:30 PM EST - Man9ixe"
  const nameWithoutPrefix = card.name.replace(/^\[[^\]]+\]\s*/, '');
  const dashParts = nameWithoutPrefix.split(' - '); // stricter split
  if (dashParts.length >= 2) {
    meta.timeLabel = dashParts[0].trim();                  // "8:30 PM EST"
    meta.hostNameFromCard = dashParts.slice(1).join(' - ').trim(); // "Man9ixe"
  } else {
    // No " - host" pattern, treat whole thing as time text
    meta.timeLabel = nameWithoutPrefix.trim() || null;
  }

  // 3) Host Discord ID from description "Host: name (1234567890)"
  if (typeof card.desc === 'string') {
    const idMatch = card.desc.match(/\((\d{17,})\)/);
    if (idMatch) {
      meta.hostDiscordId = idMatch[1];
    }
  }

  // 4) Human readable "starts in"
  if (card.due) {
    const dueDate = new Date(card.due);
    const now = new Date();
    const diffMs = dueDate.getTime() - now.getTime();
    if (diffMs <= 0) {
      meta.startsInLabel = 'now';
    } else {
      const diffMins = Math.round(diffMs / 60000);
      if (diffMins < 60) {
        meta.startsInLabel = `in ${diffMins} minute${diffMins === 1 ? '' : 's'}`;
      } else {
        const hours = Math.floor(diffMins / 60);
        const mins = diffMins % 60;
        if (mins === 0) {
          meta.startsInLabel = `in ${hours} hour${hours === 1 ? '' : 's'}`;
        } else {
          meta.startsInLabel = `in ${hours}h ${mins}m`;
        }
      }
    }
  }

  return meta;
}

/* -----------------------------------------------------
 * Queue config per type
 * ---------------------------------------------------*/
function getQueueConfig(sessionType) {
  if (sessionType === 'interview') {
    return {
      queueChannelId: SESSION_QUEUECHANNEL_INTERVIEW_ID,
      pingRoleId: SESSION_QUEUE_PING_INTERVIEW_ROLE_ID,
      roles: {
        cohost:      { key: 'cohost',      label: 'Co-Host',      emoji: '🤝', max: 1  },
        overseer:    { key: 'overseer',    label: 'Overseer',     emoji: '👁️', max: 1  },
        interviewer: { key: 'interviewer', label: 'Interviewer',  emoji: '📝', max: 12 },
        spectator:   { key: 'spectator',   label: 'Spectator',    emoji: '👀', max: 4  },
      },
    };
  }

  if (sessionType === 'training') {
    return {
      queueChannelId: SESSION_QUEUECHANNEL_TRAINING_ID,
      pingRoleId: SESSION_QUEUE_PING_TRAINING_ROLE_ID,
      roles: {
        cohost:    { key: 'cohost',    label: 'Co-Host',    emoji: '🤝', max: 1  },
        overseer:  { key: 'overseer',  label: 'Overseer',   emoji: '👁️', max: 1  },
        trainer:   { key: 'trainer',   label: 'Trainer',    emoji: '📚', max: 6  },
        assistant: { key: 'assistant', label: 'Assistant',  emoji: '🧊', max: 6  },
        spectator: { key: 'spectator', label: 'Spectator',  emoji: '👀', max: 6  },
      },
    };
  }

  if (sessionType === 'massshift') {
    return {
      queueChannelId: SESSION_QUEUECHANNEL_MASSSHIFT_ID,
      pingRoleId: SESSION_QUEUE_PING_MASS_SHIFT_ROLE_ID,
      roles: {
        cohost:       { key: 'cohost',       label: 'Co-Host',       emoji: '🤝', max: 2  },
        overseer:     { key: 'overseer',     label: 'Overseer',      emoji: '👁️', max: 2  },
        hostassistant:{ key: 'hostassistant',label: 'Host Assistant',emoji: '🧊', max: 6  },
        operations:   { key: 'operations',   label: 'Operations',    emoji: '🏨', max: 10 },
      },
    };
  }

  return null;
}

function initAssignments(config) {
  const assignments = {};
  for (const key of Object.keys(config.roles)) {
    assignments[key] = [];
  }
  return assignments;
}

/* -----------------------------------------------------
 * Display helpers
 * ---------------------------------------------------*/
function buildHeaderBlock(meta) {
  const typeLabel = (meta.sessionTypeLabel || 'Session').toUpperCase();

  const hostLabel = meta.hostNameFromCard || 'Host';
  const timeLabel = meta.timeLabel || 'Time';

  const line = `🟡 ${typeLabel} | ${hostLabel} | ${timeLabel} 🟡`;

  return [
    '╔══════════════════════════════════════╗',
    line,
    '╚══════════════════════════════════════╝',
  ].join('\n');
}

function buildQueueDescription(queue) {
  const { meta, config, assignments } = queue;

  const headerBlock = buildHeaderBlock(meta);

  const hostMention = meta.hostDiscordId ? `<@${meta.hostDiscordId}>` : (meta.hostNameFromCard || 'TBA');
  const startsIn = meta.startsInLabel || 'soon';
  const time = meta.timeLabel || 'TBA';

  const lines = [];

  lines.push(headerBlock, '');
  lines.push(`📌 **Host:** ${hostMention}`);
  lines.push(`📌 **Starts:** ${startsIn}`);
  lines.push(`📌 **Time:** ${time}`);
  lines.push('');
  lines.push('💠 **ROLES** 💠');
  lines.push('----------------------------------------------------------------');

  for (const key of Object.keys(config.roles)) {
    const roleCfg = config.roles[key];
    const current = assignments[key]?.length || 0;
    lines.push(
      `ℹ️ **${roleCfg.label}** (${current}/${roleCfg.max})`
    );
  }

  lines.push('');
  lines.push('❓ **HOW TO JOIN THE QUEUE** ❓');
  lines.push('----------------------------------------------------------------');
  lines.push('Check the role list above — if your rank is allowed, press the role button you want.');
  lines.push('You’ll get a message (only visible to you) that you were added to that role\'s queue.');
  lines.push('Do **NOT** join the game until the attendees post is made in the attendees channel.');
  lines.push('');
  lines.push('❓ **HOW TO LEAVE THE QUEUE / INFORM LATE ARRIVAL** ❓');
  lines.push('----------------------------------------------------------------');
  lines.push('Click the **Leave Queue** button once you have joined a role.');
  lines.push('After the attendees post is made, changes must be handled by the host/corporate manually.');
  lines.push('');
  lines.push('----------------------------------------------------------------');
  lines.push('╭─────── 💠 LINKS 💠 ───────────╮');
  lines.push(`• Trello Card: ${meta.cardUrl}`);
  lines.push('╰─────────────────────────────╯');

  return lines.join('\n');
}

function buildQueueEmbed(queue) {
  const description = buildQueueDescription(queue);
  return new EmbedBuilder()
    .setColor(0xfee75c)
    .setDescription(description);
}

function buildQueueComponents(queue) {
  const { meta, config, closed } = queue;
  const shortLink = meta.shortLink;

  const rows = [];

  const joinRow = new ActionRowBuilder();
  for (const key of Object.keys(config.roles)) {
    const roleCfg = config.roles[key];
    joinRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`queue_join:${shortLink}:${key}`)
        .setStyle(ButtonStyle.Primary)
        .setLabel(roleCfg.label)
        .setEmoji(roleCfg.emoji)
        .setDisabled(!!closed)
    );
  }
  rows.push(joinRow);

  const controlRow = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`queue_leave:${shortLink}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel('Leave Queue')
        .setEmoji('🚪')
        .setDisabled(!!closed),
      new ButtonBuilder()
        .setCustomId(`queue_close:${shortLink}`)
        .setStyle(ButtonStyle.Danger)
        .setLabel('Close Queue')
        .setEmoji('🔒')
        .setDisabled(!!closed)
    );

  rows.push(controlRow);

  return rows;
}

/* -----------------------------------------------------
 * OPEN QUEUE (called from /sessionqueue)
 * ---------------------------------------------------*/
async function openQueueForCard(cardOption, client) {
  console.log('[QUEUE] Raw card option:', cardOption);

  const shortLink = extractTrelloShortLink(cardOption);
  if (!shortLink) {
    return {
      success: false,
      message:
        'I could not open a queue for that Trello card.\n• Make sure the link or code is valid.',
    };
  }

  const card = await fetchCardInfo(shortLink);
  if (!card) {
    return {
      success: false,
      message:
        'I could not open a queue for that Trello card.\n• Trello may not be reachable or the card does not exist.',
    };
  }

  const meta = parseSessionMetadataFromCard(card);
  if (!meta.sessionType) {
    return {
      success: false,
      message:
        'I could not open a queue for that Trello card.\n• The name must start with [Interview], [Training], or [Mass Shift] (or have those labels).',
    };
  }

  const config = getQueueConfig(meta.sessionType);
  if (!config || !config.queueChannelId) {
    return {
      success: false,
      message:
        `I could not open a queue for that Trello card.\n• Make sure SESSION_QUEUECHANNEL_* env vars are set for ${meta.sessionType}.`,
    };
  }

  // Get the queue channel
  const queueChannel = await client.channels.fetch(config.queueChannelId).catch(() => null);
  if (!queueChannel || !queueChannel.isTextBased()) {
    return {
      success: false,
      message:
        'I could not open a queue because the configured queue channel is invalid or missing.',
    };
  }

  // Try to refine hostNameFromCard from guild (displayName), if possible
  if (meta.hostDiscordId && queueChannel.guild) {
    try {
      const member = await queueChannel.guild.members.fetch(meta.hostDiscordId);
      meta.hostNameFromCard = member.displayName || member.user.username || meta.hostNameFromCard;
    } catch {
      // ignore if fetch fails, keep whatever we parsed
    }
  }

  const assignments = initAssignments(config);

  const queue = {
    meta,
    config,
    queueChannelId: queueChannel.id,
    queueMessageId: null,
    assignments,
    createdAt: new Date(),
    closed: false,
  };

  const embed = buildQueueEmbed(queue);
  const components = buildQueueComponents(queue);

  const message = await queueChannel.send({
    content: config.pingRoleId ? `<@&${config.pingRoleId}>` : null,
    embeds: [embed],
    components,
    allowedMentions: config.pingRoleId
      ? { parse: [], roles: [config.pingRoleId] }
      : { parse: [] },
  });

  queue.queueMessageId = message.id;
  activeQueues.set(meta.shortLink, queue);

  console.log(
    `[QUEUE] Opened queue for card ${meta.shortLink} in channel ${queueChannel.id}`
  );

  return {
    success: true,
    cardShortLink: meta.shortLink,
    cardName: meta.cardName,
    queueChannelId: queueChannel.id,
    sessionType: meta.sessionType,
  };
}

/* -----------------------------------------------------
 * Update queue message
 * ---------------------------------------------------*/
async function updateQueueMessage(queue, client) {
  try {
    const channel = await client.channels.fetch(queue.queueChannelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    const msg = await channel.messages.fetch(queue.queueMessageId).catch(() => null);
    if (!msg) return;

    const embed = buildQueueEmbed(queue);
    const components = buildQueueComponents(queue);

    await msg.edit({ embeds: [embed], components });
  } catch (err) {
    console.error('[QUEUE] Failed to update queue message:', err);
  }
}

/* -----------------------------------------------------
 * Attendees posting helpers
 * ---------------------------------------------------*/
async function resolveDisplayName(guild, userId) {
  if (!guild) return `<@${userId}>`;
  try {
    const member = await guild.members.fetch(userId);
    return member.displayName || member.user.username || `<@${userId}>`;
  } catch {
    return `<@${userId}>`;
  }
}

async function postAttendeesForQueue(queue, client) {
  const { meta, config, assignments } = queue;

  // 1) Visible attendees post in queue channel WITH pings
  const queueChannel = await client.channels.fetch(queue.queueChannelId).catch(() => null);
  if (queueChannel && queueChannel.isTextBased()) {
    const hostMention = meta.hostDiscordId ? `<@${meta.hostDiscordId}>` : (meta.hostNameFromCard || 'TBA');

    const cohostId = (assignments.cohost || [])[0];
    const overseerId = (assignments.overseer || [])[0];

    const cohostMention = cohostId ? `<@${cohostId}>` : 'None selected';
    const overseerMention = overseerId ? `<@${overseerId}>` : 'None selected';

    const interviewerList = assignments.interviewer || [];
    const spectatorList = assignments.spectator || [];

    const maxInterviewers = config.roles.interviewer?.max ?? 0;
    const maxSpectators = config.roles.spectator?.max ?? 0;

    const interviewerLines = [];
    for (let i = 0; i < maxInterviewers; i++) {
      const userId = interviewerList[i];
      interviewerLines.push(
        userId ? `${i + 1}. <@${userId}>` : `${i + 1}.`
      );
    }

    const spectatorLines = [];
    for (let i = 0; i < maxSpectators; i++) {
      const userId = spectatorList[i];
      spectatorLines.push(
        userId ? `${i + 1}. <@${userId}>` : `${i + 1}.`
      );
    }

    const text =
      '╔══════════════════════════════════════╗\n' +
      '                             ✅  SELECTED ATTENDEES ✅\n' +
      '╚══════════════════════════════════════╝\n' +
      '\n' +
      `🧊 Host: ${hostMention}\n` +
      `🧊 Co-Host: ${cohostMention}\n` +
      `🧊 Overseer: ${overseerMention}\n` +
      '\n' +
      '────────────\n' +
      '\n' +
      '🟡  Interviewers 🟡\n' +
      (maxInterviewers ? interviewerLines.join('\n') : 'None configured for this session type') +
      '\n\n' +
      '────────────\n' +
      '\n' +
      '⚪  Spectators ⚪\n' +
      (maxSpectators ? spectatorLines.join('\n') : 'None configured for this session type') +
      '\n\n' +
      '🧊 You should now join! Please join within **5 minutes**, or your spot will be given to someone else.\n' +
      '🧊 Failure to join on time will result in a **written warning**. :(';

    await queueChannel.send({
      content: text,
      allowedMentions: { parse: ['users'] },
    });
  }

  // 2) Log embed in SESSION_ATTENDEES_LOG_CHANNEL_ID (NO pings)
  if (SESSION_ATTENDEES_LOG_CHANNEL_ID) {
    const logChannel = await client.channels
      .fetch(SESSION_ATTENDEES_LOG_CHANNEL_ID)
      .catch(() => null);

    if (logChannel && logChannel.isTextBased()) {
      const guild = logChannel.guild || null;

      const now = new Date();
      const dateStr = now.toLocaleDateString('en-US', {
        timeZone: 'America/Toronto',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
      const timeStr = now.toLocaleTimeString('en-US', {
        timeZone: 'America/Toronto',
        hour: 'numeric',
        minute: '2-digit',
      });

      const hostName = meta.hostDiscordId
        ? await resolveDisplayName(guild, meta.hostDiscordId)
        : (meta.hostNameFromCard || 'TBA');

      const cohostNames = [];
      for (const id of assignments.cohost || []) {
        cohostNames.push(await resolveDisplayName(guild, id));
      }

      const overseerNames = [];
      for (const id of assignments.overseer || []) {
        overseerNames.push(await resolveDisplayName(guild, id));
      }

      const interviewerNames = [];
      for (const id of assignments.interviewer || []) {
        interviewerNames.push(await resolveDisplayName(guild, id));
      }

      const spectatorNames = [];
      for (const id of assignments.spectator || []) {
        spectatorNames.push(await resolveDisplayName(guild, id));
      }

      const descLines = [];

      descLines.push(
        `**Logged at:** ${dateStr} • ${timeStr} EST`,
        `**Session:** ${meta.cardName}`,
        `**Trello Card:** ${meta.cardUrl}`,
        '',
        `**Host:** ${hostName}`,
        `**Co-Host:** ${cohostNames[0] || 'None selected'}`,
        `**Overseer:** ${overseerNames[0] || 'None selected'}`,
        '',
        '**Interviewers**'
      );

      if (interviewerNames.length) {
        interviewerNames.forEach((n, i) => descLines.push(`${i + 1}. ${n}`));
      } else {
        descLines.push('None selected');
      }

      descLines.push('', '**Spectators**');

      if (spectatorNames.length) {
        spectatorNames.forEach((n, i) => descLines.push(`${i + 1}. ${n}`));
      } else {
        descLines.push('None selected');
      }

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`Session Attendees • ${meta.sessionTypeLabel || 'Session'}`)
        .setDescription(descLines.join('\n'));

      await logChannel.send({ embeds: [embed] });
    }
  }
}

/* -----------------------------------------------------
 * Public helper so /sessionattendees can call it
 * ---------------------------------------------------*/
async function postAttendeesForCard(cardOption, client) {
  const shortLink = extractTrelloShortLink(cardOption);
  const queue = activeQueues.get(shortLink);

  if (!queue) {
    console.warn('[QUEUE] postAttendeesForCard: no active queue for', shortLink);
    return {
      success: false,
      message:
        'I could not find an active queue for that Trello card.\n• Make sure you opened the queue with /sessionqueue first.',
    };
  }

  await postAttendeesForQueue(queue, client);
  console.log(`[QUEUE] Posted attendees for card ${shortLink}`);
  return { success: true };
}

/* -----------------------------------------------------
 * Button handler
 * ---------------------------------------------------*/
async function handleQueueButtonInteraction(interaction) {
  const customId = interaction.customId || '';
  if (!customId.startsWith('queue_')) return;

  const parts = customId.split(':'); // queue_action:shortLink:roleKey?
  const action = parts[1];
  const shortLink = parts[2];
  const roleKey = parts[3];

  const queue = activeQueues.get(shortLink);
  if (!queue) {
    const msg = await interaction.reply({
      content: 'This queue is no longer active.',
      ephemeral: true,
    }).catch(() => null);
    if (msg) {
      setTimeout(() => msg.delete().catch(() => {}), 5000);
    }
    return;
  }

  const { config, assignments, meta } = queue;
  const userId = interaction.user.id;

  try {
    if (action === 'join') {
      await interaction.deferUpdate();

      const roleCfg = config.roles[roleKey];
      if (!roleCfg) {
        const msg = await interaction.followUp({
          content: 'That role is not available in this queue.',
          ephemeral: true,
        });
        setTimeout(() => msg.delete().catch(() => {}), 5000);
        return;
      }

      // Remove user from any role first (claim-first but only one role at a time)
      for (const key of Object.keys(assignments)) {
        const idx = assignments[key].indexOf(userId);
        if (idx !== -1) assignments[key].splice(idx, 1);
      }

      const list = assignments[roleKey];
      if (list.length >= roleCfg.max) {
        const msg = await interaction.followUp({
          content: `That role is already full for this queue.`,
          ephemeral: true,
        });
        setTimeout(() => msg.delete().catch(() => {}), 5000);
        return;
      }

      list.push(userId); // claim-first ordering

      await updateQueueMessage(queue, interaction.client);

      const msg = await interaction.followUp({
        content: `✅ You have been added to the **${roleCfg.label}** queue for **${meta.cardName}**.`,
        ephemeral: true,
      });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
      return;
    }

    if (action === 'leave') {
      await interaction.deferUpdate();

      let removed = false;
      for (const key of Object.keys(assignments)) {
        const idx = assignments[key].indexOf(userId);
        if (idx !== -1) {
          assignments[key].splice(idx, 1);
          removed = true;
        }
      }

      await updateQueueMessage(queue, interaction.client);

      const msg = await interaction.followUp({
        content: removed
          ? '✅ You have been removed from the queue.'
          : 'You were not in this queue.',
        ephemeral: true,
      });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
      return;
    }

    if (action === 'close') {
      await interaction.deferUpdate();

      // Only host can close
      if (meta.hostDiscordId && interaction.user.id !== meta.hostDiscordId) {
        const msg = await interaction.followUp({
          content: 'Only the host of this session can close this queue.',
          ephemeral: true,
        });
        setTimeout(() => msg.delete().catch(() => {}), 5000);
        return;
      }

      queue.closed = true;
      await updateQueueMessage(queue, interaction.client);
      await postAttendeesForQueue(queue, interaction.client);

      activeQueues.delete(shortLink);

      const msg = await interaction.followUp({
        content: '✅ Queue closed and attendees posted.',
        ephemeral: true,
      });
      setTimeout(() => msg.delete().catch(() => {}), 5000);
      return;
    }
  } catch (err) {
    console.error('[QUEUE] Error in handleQueueButtonInteraction:', err);
    if (!interaction.deferred && !interaction.replied) {
      await interaction.reply({
        content: 'There was an error while updating the queue.',
        ephemeral: true,
      }).catch(() => {});
    }
  }
}

module.exports = {
  openQueueForCard,
  handleQueueButtonInteraction,
  postAttendeesForCard,
};
