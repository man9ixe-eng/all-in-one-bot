const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

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

// Optional: separate log channel for attendees (embed).
// If not set, logs fall back to the queue channel.
const SESSION_ATTENDEES_LOG_CHANNEL_ID = process.env.SESSION_ATTENDEES_LOG_CHANNEL_ID || null;

// Extract Trello shortId from a URL or raw id
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

// Fetch card directly from Trello using global fetch
async function fetchCardByShortId(shortId) {
  try {
    const key = process.env.TRELLO_API_KEY;
    const token = process.env.TRELLO_TOKEN;
    if (!key || !token) {
      console.warn('[TRELLO] Missing API key or token in environment.');
      return null;
    }

    const url = `https://api.trello.com/1/cards/${shortId}?key=${key}&token=${token}`;

    const res = await fetch(url);
    if (!res.ok) {
      console.error('[TRELLO] API error while fetching card:', res.status, await res.text());
      return null;
    }

    const card = await res.json();
    if (!card) {
      console.warn('[TRELLO] No card returned for shortId', shortId);
      return null;
    }

    return card;
  } catch (error) {
    console.error('[TRELLO] API error while fetching card', error);
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
      color: 0xffc107, // yellow-ish
      queueChannelId: process.env.SESSION_QUEUECHANNEL_INTERVIEW_ID,
      pingRoleId: process.env.SESSION_QUEUE_PING_INTERVIEW_ROLE_ID,
    };
  }

  if (sessionType === 'training') {
    return {
      typeLabel: 'TRAINING',
      color: 0xf44336, // red-ish
      queueChannelId: process.env.SESSION_QUEUECHANNEL_TRAINING_ID,
      pingRoleId: process.env.SESSION_QUEUE_PING_TRAINING_ROLE_ID,
    };
  }

  if (sessionType === 'massshift') {
    return {
      typeLabel: 'MASS SHIFT',
      color: 0x9c27b0, // purple-ish
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
    attendeesMessageId: data.attendeesMessageId || existing.attendeesMessageId || null,
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
  return { ok: true, position: list.length };
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

/**
 * /sessionqueue handler
 */
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
    hostId ? `📌  Host: <@${hostId}>` : `📌  Host: ${hostName || 'Unknown'}`,
    startsIn ? `📌  Starts: ${startsIn}` : null,
    timeText ? `📌  Time: ${timeText}` : null,
    '',
    '💠 ROLES 💠',
    '----------------------------------------------------------------',
  ];

  if (sessionType === 'interview') {
    descriptionLines.push(
      'ℹ️  **Co-Host:** Corporate Intern+',
      'ℹ️  **Overseer:** Executive Manager+',
      'ℹ️  **Interviewer (12):** Leadership Intern+',
      'ℹ️  **Spectator (4):** Leadership Intern+',
    );
  } else if (sessionType === 'training') {
    descriptionLines.push(
      'ℹ️  **Co-Host:** Corporate Intern+',
      'ℹ️  **Overseer:** Executive Manager+',
      'ℹ️  **Supervisor (4):** Assistant Manager+',
      'ℹ️  **Trainer (8):** Leadership Intern+',
      'ℹ️  **Spectator (4):** Leadership Intern+',
    );
  } else if (sessionType === 'massshift') {
    descriptionLines.push(
      'ℹ️  **Co-Host:** Corporate Intern+',
      'ℹ️  **Overseer:** Executive Manager+',
      'ℹ️  **Attendees (15):** Leadership Intern+',
    );
  }

  descriptionLines.push(
    '',
    '❓  HOW TO JOIN THE QUEUE ❓',
    '----------------------------------------------------------------',
    '- Check the role list above — if your rank is allowed, press the role button you want.',
    '- You’ll get a popup that says: “You have been added to the (ROLE) Queue.”',
    '- Do NOT join until you are pinged in “Session Attendees” **15 minutes before** the session starts.',
    '- Line up on the number/role you are selected for on "Session Attendees".',
    '- You have 5 minutes after session attendees is posted to join.',
    '',
    '❓ HOW TO LEAVE THE QUEUE/INFORM LATE ARRIVAL ❓',
    '----------------------------------------------------------------',
    '- Click the "Leave Queue" button, which will show up once you join the queue.',
    '- You can only leave the queue BEFORE the session list is posted, at that point, you would have to go to #session-lounge and PING your host with a message stating you need to un-queue.',
    '- If you do not let the host know anything before **5 minutes** after an attendees post was made, you will be given a **Written Warning, and your spot could be given up.**',
    '----------------------------------------------------------------',
    '╭─────── 💠 LINKS 💠 ───────────╮',
    `〰️ Trello Card: ${cardUrl}`,
    '╰─────────────────────────────╯',
  );

  const embed = new EmbedBuilder()
    .setDescription(descriptionLines.filter(Boolean).join('\n'))
    .setColor(cfg.color || 0x6cb2eb);

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
      .setCustomId(
        sessionType === 'training'
          ? `queue_join_interviewer_${shortId}` // reused as "Trainer"
          : sessionType === 'massshift'
            ? `queue_join_interviewer_${shortId}` // reused as "Attendee"
            : `queue_join_interviewer_${shortId}`, // Interviewer
      )
      .setLabel(
        sessionType === 'training'
          ? 'Trainer'
          : sessionType === 'massshift'
            ? 'Attendee'
            : 'Interviewer',
      )
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
    attendeesMessageId: null,
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

/* -------------------- LIVE ATTENDEES MESSAGE -------------------- */

function buildLiveAttendeesMessage(queue) {
  const sorted = {
    cohost: sortRoleEntries(queue.roles.cohost),
    overseer: sortRoleEntries(queue.roles.overseer),
    interviewer: sortRoleEntries(queue.roles.interviewer),
    spectator: sortRoleEntries(queue.roles.spectator),
    supervisor: sortRoleEntries(queue.roles.supervisor),
  };

  const headerTop = '╔══════════════════════════════════════╗';
  const headerTitle = '                              ✅  SELECTED ATTENDEES ✅';
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

  if (queue.sessionType === 'training') {
    lines.push('🔴  Trainers 🔴');
  } else if (queue.sessionType === 'massshift') {
    lines.push('🟣  Attendees 🟣');
  } else {
    lines.push('🟡  Interviewers 🟡');
  }

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

  if (queue.sessionType !== 'massshift') {
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
  }

  lines.push('');
  lines.push('🧊 You should now join! Please join within **5 minutes**, or your spot will be given to someone else.');
  lines.push('🧊 Failure to join on time will result in a **written warning**. :(');

  // Roblox place links per type
  if (queue.sessionType === 'interview') {
    lines.push('https://www.roblox.com/games/71896062227595/GH-Interview-Center');
  } else if (queue.sessionType === 'training') {
    lines.push('https://www.roblox.com/games/88554128028552/GH-Training-Center');
  } else if (queue.sessionType === 'massshift') {
    lines.push('https://www.roblox.com/games/127619749760478/Glace-Hotels-BETA-V1');
  }

  return lines.join('\n');
}

// LIVE post in the queue channel (with pings)
async function postLiveAttendeesForQueue(client, queue) {
  if (!queue || !queue.channelId) return;

  const channel = await client.channels.fetch(queue.channelId).catch(() => null);
  if (!channel) return;

  const content = buildLiveAttendeesMessage(queue);
  const message = await channel.send({ content });

  // Store attendees message id so we can clean it up later
  queue.attendeesMessageId = message.id;
  queues.set(queue.shortId, queue);
}

/* -------------------- LOG EMBED (USERNAMES ONLY) -------------------- */

async function logAttendeesForCard(client, cardOptionOrShortId) {
  const shortId = extractShortId(cardOptionOrShortId);
  if (!shortId) {
    console.warn('[LOG] Could not parse shortId from', cardOptionOrShortId);
    return;
  }

  const queue = queues.get(shortId);
  if (!queue) {
    console.warn('[LOG] No queue stored for shortId', shortId);
    return;
  }

  const logChannelId = SESSION_ATTENDEES_LOG_CHANNEL_ID || queue.channelId;
  const logChannel = await client.channels.fetch(logChannelId).catch(() => null);
  if (!logChannel) {
    console.warn('[LOG] Could not fetch log channel for attendees');
    return;
  }

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

  const [
    cohostNames,
    overseerNames,
    interviewerNames,
    spectatorNames,
    supervisorNames,
  ] = await Promise.all([
    usernamesFromEntries(sorted.cohost),
    usernamesFromEntries(sorted.overseer),
    usernamesFromEntries(sorted.interviewer),
    usernamesFromEntries(sorted.spectator),
    usernamesFromEntries(sorted.supervisor),
  ]);

  const fields = [];

  fields.push({
    name: 'Session Info',
    value:
      [
        queue.cardName ? `• **Card:** ${queue.cardName}` : null,
        queue.timeText ? `• **Time:** ${queue.timeText}` : null,
        queue.cardUrl ? `• **Trello:** ${queue.cardUrl}` : null,
      ]
        .filter(Boolean)
        .join('\n') || 'No additional details.',
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

  const mainRoleTitle =
    queue.sessionType === 'training'
      ? 'Trainers'
      : queue.sessionType === 'massshift'
        ? 'Attendees'
        : 'Interviewers';

  fields.push({
    name: mainRoleTitle,
    value: interviewerNames.length
      ? interviewerNames.map((n, i) => `${i + 1}. ${n}`).join('\n')
      : 'None',
  });

  if (queue.sessionType !== 'massshift') {
    fields.push({
      name: 'Spectators',
      value: spectatorNames.length
        ? spectatorNames.map((n, i) => `${i + 1}. ${n}`).join('\n')
        : 'None',
      inline: true,
    });
  }

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

/* -------------------- CLEANUP QUEUE + ATTENDEES -------------------- */

async function cleanupQueueForCard(client, cardOptionOrShortId) {
  const shortId = extractShortId(cardOptionOrShortId);
  if (!shortId) return;

  const queue = queues.get(shortId);
  if (!queue) return;

  const channel = await client.channels.fetch(queue.channelId).catch(() => null);
  if (channel) {
    if (queue.messageId) {
      try {
        const msg = await channel.messages.fetch(queue.messageId);
        await msg.delete().catch(() => {});
      } catch {
        // ignore
      }
    }

    if (queue.attendeesMessageId) {
      try {
        const amsg = await channel.messages.fetch(queue.attendeesMessageId);
        await amsg.delete().catch(() => {});
      } catch {
        // ignore
      }
    }
  }

  queues.delete(shortId);
}

/* -------------------- BUTTON HANDLER -------------------- */

async function handleQueueButtonInteraction(interaction) {
  const customId = interaction.customId;

  // First: handle cancel-session log decision buttons
  if (customId.startsWith('cancel_log_')) {
    const parts = customId.split('_'); // cancel_log_yes_<shortId> or cancel_log_no_<shortId>
    const decision = parts[2];
    const shortId = parts[3];

    if (decision === 'no') {
      // Clean up queue + attendees posts even if they don't want a log
      try {
        await cleanupQueueForCard(interaction.client, shortId);
      } catch (err) {
        console.error('[CANCEL_LOG] Failed to cleanup queue for cancelled session (no log):', err);
      }

      await interaction.update({
        content: 'Okay, this cancelled session will not be logged, but the queue & attendees posts have been cleaned up.',
        components: [],
      }).catch(() => {});
      setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
      return;
    }

    // decision === 'yes'
    try {
      await logAttendeesForCard(interaction.client, shortId);
      await cleanupQueueForCard(interaction.client, shortId);

      await interaction.update({
        content: 'Attendees logged and queue cleaned up for this cancelled session.',
        components: [],
      }).catch(() => {});
      setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
    } catch (err) {
      console.error('[CANCEL_LOG] Error while logging attendees for cancelled session:', err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'There was an error logging attendees for this cancelled session. The Trello card itself was already cancelled.',
          ephemeral: true,
        }).catch(() => {});
      }
    }
    return;
  }

  // Then: handle queue_* buttons
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

      const roleLabel =
        roleKey === 'interviewer'
          ? (queue.sessionType === 'training'
              ? 'Trainer'
              : queue.sessionType === 'massshift'
                ? 'Attendee'
                : 'Interviewer')
          : roleKey.charAt(0).toUpperCase() + roleKey.slice(1);

      await interaction.reply({
        content: `You have been added to the **${roleLabel}** queue. You are currently **#${addResult.position}** in this queue.`,
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

      // Only host can close
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

      // ONLY post live attendees here (no logging)
      await postLiveAttendeesForQueue(interaction.client, queue);
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

/* -------------------- /sessionattendees COMMAND HELPER -------------------- */

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

  await postLiveAttendeesForQueue(interaction.client, queue);
}

module.exports = {
  extractShortId,
  openQueueForCard,
  handleQueueButtonInteraction,
  postAttendeesForCard,
  logAttendeesForCard,
  cleanupQueueForCard,
};
