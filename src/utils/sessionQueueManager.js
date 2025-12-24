const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { trelloRequest } = require('./trelloClient');

// Trello credentials (used only for shortLink lookup here)
const TRELLO_KEY = process.env.TRELLO_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;

// In-memory registry of active queues, keyed by Trello card shortId.
const queues = new Map();

// Limits for each role in the queue.
const ROLE_LIMITS = {
  cohost: 1,
  overseer: 1,
  interviewer: 12,
  spectator: 4,
  supervisor: 4,
};

// Optional: if you want a separate log channel, set this env var
// Otherwise, logs fall back to the same queue channel.
const SESSION_ATTENDEES_LOG_CHANNEL_ID = process.env.SESSION_ATTENDEES_LOG_CHANNEL_ID || null;

function extractShortId(cardOption) {
  if (!cardOption) return null;

  // Full Trello URL, e.g. https://trello.com/c/abcd1234/123-name
  const urlMatch = cardOption.match(/trello\.com\/c\/([a-zA-Z0-9]+)/);
  if (urlMatch) return urlMatch[1];

  // Short ID alone, e.g. abcd1234
  const idMatch = cardOption.match(/^([a-zA-Z0-9]{6,10})$/);
  if (idMatch) return idMatch[1];

  return null;
}

async function fetchCardByShortId(shortId) {
  if (!shortId) {
    console.error('[TRELLO] fetchCardByShortId called with empty shortId');
    return null;
  }

  if (!TRELLO_KEY || !TRELLO_TOKEN) {
    console.error('[TRELLO] Missing TRELLO_KEY or TRELLO_TOKEN env vars');
    return null;
  }

  try {
    const url = new URL(`https://api.trello.com/1/cards/${encodeURIComponent(shortId)}`);
    url.searchParams.set('key', TRELLO_KEY);
    url.searchParams.set('token', TRELLO_TOKEN);

    const res = await fetch(url);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('[TRELLO] fetchCardByShortId error', res.status, text || '(no body)');
      return null;
    }

    const card = await res.json();
    console.log('[TRELLO] Fetched card by shortId', shortId, '→', card.id, card.name);
    return card;
  } catch (error) {
    console.error('[TRELLO] fetchCardByShortId network error', error);
    return null;
  }
}

function detectSessionType(cardName) {
  const name = (cardName || '').toLowerCase();

  if (name.includes('interview')) return 'interview';
  if (name.includes('training')) return 'training';
  if (name.includes('mass shift') || name.includes('massshift') || name.includes(' ms ')) return 'massshift';

  return null;
}

function getSessionConfig(sessionType) {
  if (sessionType === 'interview') {
    return {
      typeLabel: 'INTERVIEW',
      queueChannelId: process.env.SESSION_QUEUECHANNEL_INTERVIEW_ID,
      pingRoleId: process.env.SESSION_QUEUE_PING_INTERVIEW_ROLE_ID,
    };
  }

  if (sessionType === 'training') {
    return {
      typeLabel: 'TRAINING',
      queueChannelId: process.env.SESSION_QUEUECHANNEL_TRAINING_ID,
      pingRoleId: process.env.SESSION_QUEUE_PING_TRAINING_ROLE_ID,
    };
  }

  if (sessionType === 'massshift') {
    return {
      typeLabel: 'MASS SHIFT',
      queueChannelId: process.env.SESSION_QUEUECHANNEL_MASSSHIFT_ID,
      pingRoleId: process.env.SESSION_QUEUE_PING_MASS_SHIFT_ROLE_ID,
    };
  }

  return null;
}

function extractHostFromDesc(desc, fallbackName) {
  if (typeof desc !== 'string') desc = '';

  // Host: name (123456789012345678)
  const match = desc.match(/Host:\s*([^()\n]+?)\s*\(([0-9]{17,})\)/i);
  if (match) {
    return {
      hostName: match[1].trim(),
      hostId: match[2],
    };
  }

  // Fallback: parse from name pattern: [Type] time - Host
  if (fallbackName) {
    const nameMatch = fallbackName.match(/-\s*([^\]]+)$/);
    if (nameMatch) {
      return {
        hostName: nameMatch[1].trim(),
        hostId: null,
      };
    }
  }

  return { hostName: 'Unknown Host', hostId: null };
}

function extractTimeFromName(cardName) {
  if (!cardName) return null;
  // [Interview] 10:50 AM EST - Man9ixe
  const match = cardName.match(/\]\s*(.+?)\s*-\s*[^-]+$/);
  if (match) {
    return match[1].trim();
  }
  return null;
}

function formatMinutesUntil(dueString) {
  if (!dueString) return null;
  const due = new Date(dueString);
  if (Number.isNaN(due.getTime())) return null;

  const now = new Date();
  const diffMs = due.getTime() - now.getTime();
  const diffMinutes = Math.round(diffMs / 60000);

  if (diffMinutes <= 0) return 'Starting now';
  if (diffMinutes === 1) return 'in 1 minute';
  return `in ${diffMinutes} minutes`;
}

function upsertQueue(shortId, data) {
  const existing = queues.get(shortId) || {};
  const merged = {
    shortId,
    sessionType: data.sessionType || existing.sessionType,
    hostId: data.hostId || existing.hostId,
    hostName: data.hostName || existing.hostName,
    channelId: data.channelId || existing.channelId,
    messageId: data.messageId || existing.messageId,
    cardName: data.cardName || existing.cardName,
    cardUrl: data.cardUrl || existing.cardUrl,
    timeText: data.timeText || existing.timeText,
    due: data.due || existing.due || null,
    isClosed: data.isClosed !== undefined ? data.isClosed : (existing.isClosed || false),
    roles: existing.roles || {
      cohost: [],
      overseer: [],
      interviewer: [],
      spectator: [],
      supervisor: [],
    },
  };

  // If caller passed a fresh roles object, override
  if (data.roles) {
    merged.roles = data.roles;
  }

  queues.set(shortId, merged);
  return merged;
}

function addUserToRole(queue, userId, roleKey) {
  // Remove from any existing role first (one spot per queue only)
  for (const entries of Object.values(queue.roles)) {
    const idx = entries.findIndex(entry => entry.userId === userId);
    if (idx !== -1) entries.splice(idx, 1);
  }

  const list = queue.roles[roleKey];
  if (!list) return { ok: false, reason: 'Invalid role.' };

  const limit = ROLE_LIMITS[roleKey] ?? Infinity;
  if (list.length >= limit) {
    return { ok: false, reason: 'That role is already full.' };
  }

  list.push({ userId, claimedAt: Date.now() });
  return { ok: true };
}

function removeUserFromQueue(queue, userId) {
  let removed = false;
  for (const entries of Object.values(queue.roles)) {
    const idx = entries.findIndex(entry => entry.userId === userId);
    if (idx !== -1) {
      entries.splice(idx, 1);
      removed = true;
    }
  }
  return removed;
}

function sortRoleEntries(entries) {
  return [...entries].sort((a, b) => {
    if (a.claimedAt && b.claimedAt) return a.claimedAt - b.claimedAt;
    return 0;
  });
}

async function openQueueForCard(interaction, cardOption) {
  console.log('[QUEUE] Raw card option:', cardOption);

  const shortId = extractShortId(cardOption);
  if (!shortId) {
    await interaction.reply({
      content: 'I could not parse that Trello card. Please provide a valid Trello card link or short ID.',
      ephemeral: true,
    });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const card = await fetchCardByShortId(shortId);
  if (!card) {
    console.log('[QUEUE] Could not fetch Trello card for shortId:', shortId);
    await interaction.editReply({
      content: 'I could not fetch that Trello card. Make sure it exists and I can access it.',
    });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
    return;
  }

  const sessionType = detectSessionType(card.name);
  if (!sessionType) {
    console.log('[QUEUE] Could not detect session type for card:', card.name);
    await interaction.editReply({
      content: 'I could not detect the session type from that card. Make sure the card name includes Interview, Training, or Mass Shift.',
    });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
    return;
  }

  const cfg = getSessionConfig(sessionType);
  if (!cfg || !cfg.queueChannelId) {
    console.log('[QUEUE] Missing channel config for session type:', sessionType);
    await interaction.editReply({
      content: `I am missing a queue channel configuration for **${sessionType}**. Please check your environment variables.`,
    });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
    return;
  }

  const queueChannel = await interaction.client.channels.fetch(cfg.queueChannelId).catch(() => null);
  if (!queueChannel) {
    console.log('[QUEUE] Could not fetch queue channel:', cfg.queueChannelId);
    await interaction.editReply({
      content: 'I could not access the configured queue channel. Please check my permissions.',
    });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
    return;
  }

  const { hostName, hostId } = extractHostFromDesc(card.desc, card.name);
  const timeText = extractTimeFromName(card.name);
  const startsIn = formatMinutesUntil(card.due);
  const cardUrl = card.shortUrl || card.url || cardOption;

  const headerTop = '╔══════════════════════════════════════╗';
  const headerTitle = `🟡 ${cfg.typeLabel} | ${hostName || 'Host'} | ${timeText || 'Time'} 🟡`;
  const headerBottom = '╚══════════════════════════════════════╝';

  const descriptionLines = [
    headerTop,
    headerTitle,
    headerBottom,
    '',
    hostId ? `🧊 Host: <@${hostId}>` : `🧊 Host: ${hostName || 'Unknown'}`,
    timeText ? `🧊 Time: ${timeText}` : null,
    startsIn ? `🧊 Starts: ${startsIn}` : null,
    '',
    '────────────',
    '',
    '🧊 Use the buttons below to join the queue.',
    '🧊 You may only hold **one** spot in the queue.',
    '',
    `🔗 Trello Card: ${cardUrl}`,
  ].filter(Boolean);

  const embed = new EmbedBuilder()
    .setDescription(descriptionLines.join('\n'))
    .setColor(0x6cb2eb);

  const joinRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`queue_join_cohost_${shortId}`)
      .setLabel('Co-Host')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`queue_join_overseer_${shortId}`)
      .setLabel('Overseer')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`queue_join_interviewer_${shortId}`)
      .setLabel('Interviewer')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`queue_join_spectator_${shortId}`)
      .setLabel('Spectator')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`queue_leave_${shortId}`)
      .setLabel('Leave Queue')
      .setStyle(ButtonStyle.Danger),
  );

  const controlRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`queue_close_${shortId}`)
      .setLabel('Close Queue & Post Attendees')
      .setStyle(ButtonStyle.Danger),
  );

  const messagePayload = {
    content: cfg.pingRoleId ? `<@&${cfg.pingRoleId}>` : null,
    embeds: [embed],
    components: [joinRow, controlRow],
  };

  const queueMessage = await queueChannel.send(messagePayload);

  upsertQueue(shortId, {
    sessionType,
    hostId,
    hostName,
    channelId: queueMessage.channel.id,
    messageId: queueMessage.id,
    cardName: card.name,
    cardUrl,
    timeText,
    due: card.due || null,
    roles: {
      cohost: [],
      overseer: [],
      interviewer: [],
      spectator: [],
      supervisor: [],
    },
    isClosed: false,
  });

  console.log('[QUEUE] Opened queue for card', shortId, 'in channel', queueChannel.id);

  const channelMention = `<#${queueChannel.id}>`;
  const confirmText = `✅ Opened queue for **${card.name}** in ${channelMention}`;

  await interaction.editReply({ content: confirmText });
  setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
}

async function handleQueueButtonInteraction(interaction) {
  const customId = interaction.customId;
  if (!customId.startsWith('queue_')) return;

  const parts = customId.split('_');
  const action = parts[1];

  try {
    if (action === 'join') {
      const roleKey = parts[2]; // cohost, overseer, interviewer, spectator, supervisor
      const shortId = parts[3];

      const queue = queues.get(shortId);
      if (!queue || queue.isClosed) {
        await interaction.reply({
          content: 'This queue is no longer active.',
          ephemeral: true,
        });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
        return;
      }

      const addResult = addUserToRole(queue, interaction.user.id, roleKey);
      if (!addResult.ok) {
        await interaction.reply({
          content: addResult.reason,
          ephemeral: true,
        });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
        return;
      }

      await interaction.reply({
        content: `You have been added to the **${roleKey.replace(/^(.)/, (m) => m.toUpperCase())}** queue.`,
        ephemeral: true,
      });
      setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
      return;
    }

    if (action === 'leave') {
      const shortId = parts[2];
      const queue = queues.get(shortId);
      if (!queue) {
        await interaction.reply({
          content: 'This queue is no longer active.',
          ephemeral: true,
        });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
        return;
      }

      const removed = removeUserFromQueue(queue, interaction.user.id);
      await interaction.reply({
        content: removed ? 'You have been removed from the queue.' : 'You are not currently in this queue.',
        ephemeral: true,
      });
      setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
      return;
    }

    if (action === 'close') {
      const shortId = parts[2];
      const queue = queues.get(shortId);
      if (!queue) {
        await interaction.reply({
          content: 'This queue is no longer active.',
          ephemeral: true,
        });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
        return;
      }

      // Only host can close (or you can later relax this)
      if (queue.hostId && interaction.user.id !== queue.hostId) {
        await interaction.reply({
          content: 'Only the host can close this queue.',
          ephemeral: true,
        });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
        return;
      }

      queue.isClosed = true;
      queues.set(shortId, queue);

      // Disable buttons on the original queue message
      try {
        const channel = await interaction.client.channels.fetch(queue.channelId);
        const message = await channel.messages.fetch(queue.messageId);

        const disabledComponents = message.components.map((row) => {
          const newRow = ActionRowBuilder.from(row);
          newRow.components = row.components.map((component) =>
            ButtonBuilder.from(component).setDisabled(true),
          );
          return newRow;
        });

        await message.edit({ components: disabledComponents });
      } catch (err) {
        console.error('[QUEUE] Failed to disable buttons for queue', shortId, err);
      }

      await interaction.reply({
        content: 'Queue closed. Posting attendees...',
        ephemeral: true,
      });
      setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);

      await sendAttendeesForQueue(interaction.client, queue);
      return;
    }
  } catch (error) {
    console.error('[QUEUE] Error handling button interaction:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: 'There was an error while handling that queue interaction.',
        ephemeral: true,
      }).catch(() => {});
    }
  }
}

function buildLiveAttendeesMessage(queue) {
  const sorted = {
    cohost: sortRoleEntries(queue.roles.cohost),
    overseer: sortRoleEntries(queue.roles.overseer),
    interviewer: sortRoleEntries(queue.roles.interviewer),
    spectator: sortRoleEntries(queue.roles.spectator),
    supervisor: sortRoleEntries(queue.roles.supervisor),
  };

  const headerTop = '╔══════════════════════════════════════╗';
  const headerTitle = '                             ✅  SELECTED ATTENDEES ✅';
  const headerBottom = '╚══════════════════════════════════════╝';

  const lines = [
    headerTop,
    headerTitle,
    headerBottom,
    '',
    queue.hostId ? `🧊 Host: <@${queue.hostId}>` : `🧊 Host: ${queue.hostName || 'Unknown'}`,
    sorted.cohost[0] ? `🧊 Co-Host: <@${sorted.cohost[0].userId}>` : '🧊 Co-Host: None selected',
    sorted.overseer[0] ? `🧊 Overseer: <@${sorted.overseer[0].userId}>` : '🧊 Overseer: None selected',
    '',
    '────────────',
    '',
  ];

  lines.push('🟡  Interviewers 🟡');
  if (sorted.interviewer.length === 0) {
    lines.push('None selected.');
  } else {
    sorted.interviewer.forEach((entry, idx) => {
      lines.push(`${idx + 1}. <@${entry.userId}>`);
    });
  }

  lines.push('');
  lines.push('────────────');
  lines.push('');
  lines.push('⚪  Spectators ⚪');
  if (sorted.spectator.length === 0) {
    lines.push('None selected.');
  } else {
    sorted.spectator.forEach((entry, idx) => {
      lines.push(`${idx + 1}. <@${entry.userId}>`);
    });
  }

  if (sorted.supervisor.length > 0) {
    lines.push('');
    lines.push('🔵  Supervisors 🔵');
    sorted.supervisor.forEach((entry, idx) => {
      lines.push(`${idx + 1}. <@${entry.userId}>`);
    });
  }

  lines.push('');
  lines.push('🧊 You should now join! Please join within **5 minutes**, or your spot will be given to someone else.');
  lines.push('🧊 Failure to join on time will result in a **written warning**. :(');

  return lines.join('\n');
}

async function sendAttendeesForQueue(client, queue) {
  if (!queue || !queue.channelId) return;

  const channel = await client.channels.fetch(queue.channelId).catch(() => null);
  if (!channel) return;

  const content = buildLiveAttendeesMessage(queue);

  // LIVE post in the queue channel (with pings)
  await channel.send({ content });

  // Also log to the configured log channel (embed, usernames only, NO pings)
  const logChannelId = SESSION_ATTENDEES_LOG_CHANNEL_ID || queue.channelId;
  const logChannel = await client.channels.fetch(logChannelId).catch(() => null);
  if (!logChannel) return;

  const sorted = {
    cohost: sortRoleEntries(queue.roles.cohost),
    overseer: sortRoleEntries(queue.roles.overseer),
    interviewer: sortRoleEntries(queue.roles.interviewer),
    spectator: sortRoleEntries(queue.roles.spectator),
    supervisor: sortRoleEntries(queue.roles.supervisor),
  };

  async function usernamesFromEntries(entries) {
    const results = [];
    for (const entry of entries) {
      try {
        const user = await client.users.fetch(entry.userId);
        results.push(user.username);
      } catch {
        results.push(`Unknown (${entry.userId})`);
      }
    }
    return results;
  }

  const [cohostNames, overseerNames, interviewerNames, spectatorNames, supervisorNames] =
    await Promise.all([
      usernamesFromEntries(sorted.cohost),
      usernamesFromEntries(sorted.overseer),
      usernamesFromEntries(sorted.interviewer),
      usernamesFromEntries(sorted.spectator),
      usernamesFromEntries(sorted.supervisor),
    ]);

  const fields = [];

  fields.push({
    name: 'Session Info',
    value: [
      queue.cardName ? `• **Card:** ${queue.cardName}` : null,
      queue.timeText ? `• **Time:** ${queue.timeText}` : null,
      queue.cardUrl ? `• **Trello:** ${queue.cardUrl}` : null,
    ].filter(Boolean).join('\n') || 'No additional details.',
  });

  fields.push({
    name: 'Host',
    value: queue.hostName || (queue.hostId ? queue.hostId : 'Unknown'),
    inline: true,
  });

  fields.push({
    name: 'Co-Host',
    value: cohostNames.length ? cohostNames.join('\n') : 'None',
    inline: true,
  });

  fields.push({
    name: 'Overseer',
    value: overseerNames.length ? overseerNames.join('\n') : 'None',
    inline: true,
  });

  fields.push({
    name: 'Interviewers',
    value: interviewerNames.length ? interviewerNames.map((n, i) => `${i + 1}. ${n}`).join('\n') : 'None',
  });

  fields.push({
    name: 'Spectators',
    value: spectatorNames.length ? spectatorNames.map((n, i) => `${i + 1}. ${n}`).join('\n') : 'None',
    inline: true,
  });

  if (supervisorNames.length) {
    fields.push({
      name: 'Supervisors',
      value: supervisorNames.map((n, i) => `${i + 1}. ${n}`).join('\n'),
      inline: true,
    });
  }

  const now = new Date();
  const loggedAt = now.toLocaleString('en-US', { timeZone: 'America/Toronto' });

  const logEmbed = new EmbedBuilder()
    .setTitle('Session Attendees Logged')
    .setDescription(`Logged at **${loggedAt}**`)
    .addFields(fields)
    .setColor(0x6cb2eb);

  await logChannel.send({ embeds: [logEmbed] });
}

async function postAttendeesForCard(interaction, cardOption) {
  console.log('[SESSIONATTENDEES] Requested attendees for card option:', cardOption);

  const shortId = extractShortId(cardOption);
  if (!shortId) {
    await interaction.reply({
      content: 'I could not parse that Trello card. Please provide a valid Trello card link or short ID.',
      ephemeral: true,
    });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
    return;
  }

  const queue = queues.get(shortId);
  if (!queue) {
    await interaction.reply({
      content: 'There is no active queue stored for that Trello card. You must open a queue first.',
      ephemeral: true,
    });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
    return;
  }

  await interaction.reply({
    content: 'Posting attendees...',
    ephemeral: true,
  });
  setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);

  await sendAttendeesForQueue(interaction.client, queue);
}

module.exports = {
  openQueueForCard,
  handleQueueButtonInteraction,
  postAttendeesForCard,
};
