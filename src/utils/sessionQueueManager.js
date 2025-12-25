// src/utils/sessionQueueManager.js
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');
const { trelloRequest } = require('./trelloClient');

// In-memory registry of active queues, keyed by Trello card shortId.
const queues = new Map();

/**
 * Limits for each role in the queue.
 * (Using a single limit for the "main" role; text in the embed can say 12/8/15.)
 */
const ROLE_LIMITS = {
  cohost: 1,
  overseer: 1,
  interviewer: 15, // max per card for main role (Interviewers / Trainers / Attendees)
  spectator: 4,
  supervisor: 4,
};

// Optional log channel for attendees.
// If not set, logs fall back to the same queue channel.
const SESSION_ATTENDEES_LOG_CHANNEL_ID =
  process.env.SESSION_ATTENDEES_LOG_CHANNEL_ID || null;

/* ========================================================================== */
/*  BASIC HELPERS                                                             */
/* ========================================================================== */

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
  try {
    // trelloRequest(method, path, params?)
    const card = await trelloRequest('GET', `/1/cards/${shortId}`);
    if (!card) {
      console.warn(`[TRELLO] No card returned for shortId ${shortId}`);
      return null;
    }
    return card;
  } catch (error) {
    console.error('[TRELLO] API error while fetching card', error);
    return null;
  }
}

function detectSessionTypeFromCard(card) {
  const combined = `${card.name || ''}\n${card.desc || ''}`.toLowerCase();

  if (combined.includes('interview')) return 'interview';
  if (combined.includes('training')) return 'training';
  if (
    combined.includes('mass shift') ||
    combined.includes('massshift') ||
    combined.includes(' ms ')
  )
    return 'massshift';

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

  // Format: Host: name (123456789012345678)
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
  // [Interview] 10:50 AM EST - Man9ixe  -> 10:50 AM EST
  const match = cardName.match(/\]\s*(.+?)\s*-\s*[^-]+$/);
  if (match) {
    return match[1].trim();
  }
  return null;
}

function getDiscordTimestamps(dueString) {
  if (!dueString) return { relative: null, timeOnly: null };
  const due = new Date(dueString);
  if (Number.isNaN(due.getTime())) return { relative: null, timeOnly: null };

  const unix = Math.floor(due.getTime() / 1000);
  return {
    relative: `<t:${unix}:R>`,
    timeOnly: `<t:${unix}:t>`,
  };
}

/* ========================================================================== */
/*  WEEKLY COUNTS FROM #SESSION-LOGS                                         */
/* ========================================================================== */

function getStartOfWeekTimestamp() {
  // Week restarts every Monday 00:00 (UTC-based here).
  const now = new Date();
  const day = now.getUTCDay(); // 0 = Sunday, 1 = Monday, ...
  const diffToMonday = (day + 6) % 7; // how many days since Monday
  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  monday.setUTCDate(monday.getUTCDate() - diffToMonday);
  return monday.getTime();
}

async function getWeeklySessionCounts(client) {
  const counts = new Map();

  if (!SESSION_ATTENDEES_LOG_CHANNEL_ID) {
    return counts;
  }

  const logChannel = await client.channels
    .fetch(SESSION_ATTENDEES_LOG_CHANNEL_ID)
    .catch(() => null);

  if (!logChannel) return counts;

  const startOfWeek = getStartOfWeekTimestamp();
  let lastId = null;
  let done = false;

  while (!done) {
    const fetchOptions = { limit: 100 };
    if (lastId) fetchOptions.before = lastId;

    const messages = await logChannel.messages.fetch(fetchOptions).catch(() => null);
    if (!messages || messages.size === 0) break;

    const sortedMessages = [...messages.values()].sort(
      (a, b) => b.createdTimestamp - a.createdTimestamp,
    );

    for (const msg of sortedMessages) {
      if (msg.createdTimestamp < startOfWeek) {
        done = true;
        break;
      }

      if (!msg.embeds || msg.embeds.length === 0) continue;
      const embed = msg.embeds[0];
      if (embed.title !== 'Session Attendees Logged') continue;

      const fields = embed.fields || [];
      for (const field of fields) {
        if (!field || !field.name || !field.value) continue;
        if (field.name === 'Session Info') continue;

        const lines = field.value.split('\n');
        for (let line of lines) {
          let t = line.trim();
          if (!t || t.toLowerCase() === 'none') continue;

          // Strip "1. " style numbering
          t = t.replace(/^\d+\.\s*/, '');

          // Look for "(123456789012345678)" at end
          const idMatch = t.match(/\(([0-9]{17,})\)$/);
          let key;
          if (idMatch) {
            key = idMatch[1]; // user ID
          } else {
            // fallback: treat full line as a username key (lowercased)
            key = t.toLowerCase();
          }

          counts.set(key, (counts.get(key) || 0) + 1);
        }
      }
    }

    const oldest = sortedMessages[sortedMessages.length - 1];
    lastId = oldest?.id;
    if (!lastId) break;
  }

  return counts;
}

/* ========================================================================== */
/*  QUEUE DATA & MUTATION FUNCTIONS                                          */
/* ========================================================================== */

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
    isClosed:
      data.isClosed !== undefined ? data.isClosed : existing.isClosed || false,
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
    const idx = entries.findIndex((entry) => entry.userId === userId);
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
    const idx = entries.findIndex((entry) => entry.userId === userId);
    if (idx !== -1) {
      entries.splice(idx, 1);
      removed = true;
    }
  }
  return removed;
}

function sortRoleEntries(entries, weeklyCounts) {
  return [...entries].sort((a, b) => {
    const countA =
      weeklyCounts && weeklyCounts.has(a.userId)
        ? weeklyCounts.get(a.userId)
        : 0;
    const countB =
      weeklyCounts && weeklyCounts.has(b.userId)
        ? weeklyCounts.get(b.userId)
        : 0;

    // Fewer sessions this week = higher priority (comes first)
    if (countA !== countB) {
      return countA - countB;
    }

    // Tie-breaker: who claimed earlier
    if (a.claimedAt && b.claimedAt) {
      return a.claimedAt - b.claimedAt;
    }

    return 0;
  });
}

/* ========================================================================== */
/*  QUEUE OPENING                                                            */
/* ========================================================================== */

async function openQueueForCard(interaction, cardOption) {
  console.log('[QUEUE] Raw card option:', cardOption);

  const shortId = extractShortId(cardOption);
  if (!shortId) {
    await interaction.reply({
      content:
        'I could not parse that Trello card. Please provide a valid Trello card link or short ID.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const card = await fetchCardByShortId(shortId);
  if (!card) {
    await interaction.editReply({
      content:
        'I could not fetch that Trello card. Make sure it exists and I can access it.',
    });
    return;
  }

  const sessionType = detectSessionTypeFromCard(card);
  if (!sessionType) {
    await interaction.editReply({
      content:
        'I could not detect the session type from that card. Make sure the card mentions Interview, Training, or Mass Shift.',
    });
    return;
  }

  const cfg = getSessionConfig(sessionType);
  if (!cfg || !cfg.queueChannelId) {
    await interaction.editReply({
      content: `I am missing a queue channel configuration for **${sessionType}**. Please check your environment variables.`,
    });
    return;
  }

  const queueChannel = await interaction.client.channels
    .fetch(cfg.queueChannelId)
    .catch(() => null);
  if (!queueChannel) {
    await interaction.editReply({
      content:
        'I could not access the configured queue channel. Please check my permissions.',
    });
    return;
  }

  const { hostName, hostId } = extractHostFromDesc(card.desc, card.name);
  const timeText = extractTimeFromName(card.name);
  const { relative, timeOnly } = getDiscordTimestamps(card.due);
  const cardUrl = card.shortUrl || card.url || cardOption;

  const headerTop = '╔══════════════════════════════════════╗';
  const headerTitle = `🟡 ${cfg.typeLabel} | ${hostName || 'Host'} | ${
    timeText || 'Time'
  } 🟡`;
  const headerBottom = '╚══════════════════════════════════════╝';

  const descriptionLines = [
    headerTop,
    headerTitle,
    headerBottom,
    '',
    hostId ? `📌  Host: <@${hostId}>` : `📌  Host: ${hostName || 'Unknown'}`,
    relative ? `📌  Starts: ${relative}` : null,
    timeOnly ? `📌  Time: ${timeOnly}` : null,
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
    '- You can only leave the queue BEFORE the session list is posted; after that, you must go to #session-lounge and ping your host.',
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
      .setCustomId(`queue_join_interviewer_${shortId}`)
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

  console.log(
    '[QUEUE] Opened queue for card',
    shortId,
    'in channel',
    queueChannel.id,
  );

  const channelMention = `<#${queueChannel.id}>`;
  const confirmText = `✅ Opened queue for **${card.name}** in ${channelMention}`;

  await interaction.editReply({ content: confirmText });
}

/* ========================================================================== */
/*  ATTENDEES MESSAGE (USES STORED ORDER)                                     */
/* ========================================================================== */

function buildLiveAttendeesMessage(queue) {
  const roles = queue.roles || {};
  const cohost = roles.cohost || [];
  const overseer = roles.overseer || [];
  const interviewer = roles.interviewer || [];
  const spectator = roles.spectator || [];
  const supervisor = roles.supervisor || [];

  const headerTop = '╔══════════════════════════════════════╗';
  const headerTitle =
    '                              ✅  SELECTED ATTENDEES ✅';
  const headerBottom = '╚══════════════════════════════════════╝';

  const lines = [
    headerTop,
    headerTitle,
    headerBottom,
    '',
    queue.hostId
      ? `🧊 Host: <@${queue.hostId}>`
      : `🧊 Host: ${queue.hostName || 'Unknown'}`,
    cohost[0]
      ? `🧊 Co-Host: <@${cohost[0].userId}>`
      : '🧊 Co-Host: None selected',
    overseer[0]
      ? `🧊 Overseer: <@${overseer[0].userId}>`
      : '🧊 Overseer: None selected',
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

  if (interviewer.length === 0) {
    lines.push('None selected.');
  } else {
    interviewer.forEach((entry, idx) => {
      lines.push(`${idx + 1}. <@${entry.userId}>`);
    });
  }

  lines.push('');
  lines.push('────────────');
  lines.push('');

  if (queue.sessionType !== 'massshift') {
    lines.push('⚪  Spectators ⚪');
    if (spectator.length === 0) {
      lines.push('None selected.');
    } else {
      spectator.forEach((entry, idx) => {
        lines.push(`${idx + 1}. <@${entry.userId}>`);
      });
    }

    if (supervisor.length > 0) {
      lines.push('');
      lines.push('🔵  Supervisors 🔵');
      supervisor.forEach((entry, idx) => {
        lines.push(`${idx + 1}. <@${entry.userId}>`);
      });
    }
  }

  lines.push('');
  lines.push(
    '🧊 You should now join! Please join within **5 minutes**, or your spot will be given to someone else.',
  );
  lines.push(
    '🧊 Failure to join on time will result in a **written warning**. :(',
  );

  if (queue.sessionType === 'interview') {
    lines.push('https://www.roblox.com/games/71896062227595/GH-Interview-Center');
  } else if (queue.sessionType === 'training') {
    lines.push('https://www.roblox.com/games/88554128028552/GH-Training-Center');
  } else if (queue.sessionType === 'massshift') {
    lines.push(
      'https://www.roblox.com/games/127619749760478/Glace-Hotels-BETA-V1',
    );
  }

  return lines.join('\n');
}

// Reorder roles by weekly counts, then post attendees in queue channel
async function postLiveAttendeesForQueue(client, queue) {
  if (!queue || !queue.channelId) return;

  const channel = await client.channels.fetch(queue.channelId).catch(() => null);
  if (!channel) return;

  let weeklyCounts;
  try {
    weeklyCounts = await getWeeklySessionCounts(client);
  } catch (err) {
    console.error('[QUEUE] Failed to compute weekly session counts:', err);
    weeklyCounts = new Map();
  }

  if (weeklyCounts) {
    queue.roles.cohost = sortRoleEntries(queue.roles.cohost || [], weeklyCounts);
    queue.roles.overseer = sortRoleEntries(
      queue.roles.overseer || [],
      weeklyCounts,
    );
    queue.roles.interviewer = sortRoleEntries(
      queue.roles.interviewer || [],
      weeklyCounts,
    );
    queue.roles.spectator = sortRoleEntries(
      queue.roles.spectator || [],
      weeklyCounts,
    );
    queue.roles.supervisor = sortRoleEntries(
      queue.roles.supervisor || [],
      weeklyCounts,
    );

    queues.set(queue.shortId, queue);
  }

  const content = buildLiveAttendeesMessage(queue);
  const message = await channel.send({ content });

  queue.attendeesMessageId = message.id;
  queues.set(queue.shortId, queue);
}

/* ========================================================================== */
/*  LOGGING ATTENDEES TO #SESSION-LOGS                                       */
/* ========================================================================== */

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

  const roles = queue.roles || {};
  const cohostEntries = roles.cohost || [];
  const overseerEntries = roles.overseer || [];
  const interviewerEntries = roles.interviewer || [];
  const spectatorEntries = roles.spectator || [];
  const supervisorEntries = roles.supervisor || [];

  async function usernamesFromEntries(entries) {
    const results = [];
    for (const entry of entries) {
      try {
        const user = await client.users.fetch(entry.userId);
        results.push(`${user.username} (${user.id})`);
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
    usernamesFromEntries(cohostEntries),
    usernamesFromEntries(overseerEntries),
    usernamesFromEntries(interviewerEntries),
    usernamesFromEntries(spectatorEntries),
    usernamesFromEntries(supervisorNames),
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

  // Host field with ID included where possible.
  let hostDisplay = 'Unknown';
  if (queue.hostId) {
    try {
      const hostUser = await client.users.fetch(queue.hostId);
      hostDisplay = `${hostUser.username} (${hostUser.id})`;
    } catch {
      hostDisplay = queue.hostName || `${queue.hostId}`;
    }
  } else if (queue.hostName) {
    hostDisplay = queue.hostName;
  }

  fields.push({
    name: 'Host',
    value: hostDisplay,
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
  const loggedAt = now.toLocaleString('en-US', {
    timeZone: 'America/Toronto',
  });

  const logEmbed = new EmbedBuilder()
    .setTitle('Session Attendees Logged')
    .setDescription(`Logged at **${loggedAt}**`)
    .addFields(fields)
    .setColor(0x6cb2eb);

  await logChannel.send({ embeds: [logEmbed] });
}

/* ========================================================================== */
/*  CLEANUP & BUTTON HANDLER                                                 */
/* ========================================================================== */

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

/**
 * Handles both:
 * - cancel-session log decision buttons: cancel_log_yes_* / cancel_log_no_*
 * - queue_* buttons
 *
 * Returns true if this interaction was handled here; false otherwise.
 */
async function handleQueueButtonInteraction(interaction) {
  const customId = interaction.customId;
  if (!customId) return false;

  // 1) Cancel-session "log?" decision buttons
  if (customId.startsWith('cancel_log_')) {
    const parts = customId.split('_'); // cancel_log_yes_<shortId> or cancel_log_no_<shortId>
    const decision = parts[2];
    const shortId = parts[3];

    if (decision === 'no') {
      try {
        await cleanupQueueForCard(interaction.client, shortId);
      } catch (err) {
        console.error(
          '[CANCEL_LOG] Failed to cleanup queue for cancelled session (no log):',
          err,
        );
      }

      await interaction
        .update({
          content:
            'Okay, this cancelled session will not be logged, but the queue & attendees posts have been cleaned up.',
          components: [],
        })
        .catch(() => {});
      return true;
    }

    // decision === 'yes'
    try {
      await logAttendeesForCard(interaction.client, shortId);
      await cleanupQueueForCard(interaction.client, shortId);

      await interaction
        .update({
          content:
            'Attendees logged and queue cleaned up for this cancelled session.',
          components: [],
        })
        .catch(() => {});
    } catch (err) {
      console.error(
        '[CANCEL_LOG] Error while logging attendees for cancelled session:',
        err,
      );
      if (!interaction.replied && !interaction.deferred) {
        await interaction
          .reply({
            content:
              'There was an error logging attendees for this cancelled session. The Trello card itself was already cancelled.',
            ephemeral: true,
          })
          .catch(() => {});
      }
    }
    return true;
  }

  // 2) Queue buttons
  if (!customId.startsWith('queue_')) return false;

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
        return true;
      }

      const addResult = addUserToRole(queue, interaction.user.id, roleKey);
      if (!addResult.ok) {
        await interaction.reply({
          content: addResult.reason,
          ephemeral: true,
        });
        return true;
      }

      const roleLabel =
        roleKey === 'interviewer'
          ? queue.sessionType === 'training'
            ? 'Trainer'
            : queue.sessionType === 'massshift'
            ? 'Attendee'
            : 'Interviewer'
          : roleKey.charAt(0).toUpperCase() + roleKey.slice(1);

      await interaction.reply({
        content: `You have been added to the **${roleLabel}** queue.`,
        ephemeral: true,
      });
      return true;
    }

    if (action === 'leave') {
      const shortId = parts[2];
      const queue = queues.get(shortId);
      if (!queue) {
        await interaction.reply({
          content: 'This queue is no longer active.',
          ephemeral: true,
        });
        return true;
      }

      const removed = removeUserFromQueue(queue, interaction.user.id);
      await interaction.reply({
        content: removed
          ? 'You have been removed from the queue.'
          : 'You are not currently in this queue.',
        ephemeral: true,
      });
      return true;
    }

    if (action === 'close') {
      const shortId = parts[2];
      const queue = queues.get(shortId);
      if (!queue) {
        await interaction.reply({
          content: 'This queue is no longer active.',
          ephemeral: true,
        });
        return true;
      }

      // Only host can close
      if (queue.hostId && interaction.user.id !== queue.hostId) {
        await interaction.reply({
          content: 'Only the host can close this queue.',
          ephemeral: true,
        });
        return true;
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

      await postLiveAttendeesForQueue(interaction.client, queue);
      return true;
    }
  } catch (error) {
    console.error('[QUEUE] Error handling button interaction:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction
        .reply({
          content: 'There was an error while handling that queue interaction.',
          ephemeral: true,
        })
        .catch(() => {});
    }
    return true;
  }

  return false;
}

/* ========================================================================== */
/*  /SESSIONATTENDEES HELPER                                                 */
/* ========================================================================== */

async function postAttendeesForCard(interaction, cardOption) {
  console.log('[SESSIONATTENDEES] Requested attendees for card option:', cardOption);

  const shortId = extractShortId(cardOption);
  if (!shortId) {
    await interaction.reply({
      content:
        'I could not parse that Trello card. Please provide a valid Trello card link or short ID.',
      ephemeral: true,
    });
    return;
  }

  const queue = queues.get(shortId);
  if (!queue) {
    await interaction.reply({
      content:
        'There is no active queue stored for that Trello card. You must open a queue first.',
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content: 'Posting attendees...',
    ephemeral: true,
  });

  await postLiveAttendeesForQueue(interaction.client, queue);
}

/* ========================================================================== */

module.exports = {
  openQueueForCard,
  handleQueueButtonInteraction,
  postAttendeesForCard,
  logAttendeesForCard,
  cleanupQueueForCard,
};
