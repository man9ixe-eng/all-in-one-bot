// src/utils/sessionQueueManager.js

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');

// In-memory registry of active queues, keyed by Trello shortId.
const queues = new Map();

/**
 * Limits per role inside a queue.
 */
const ROLE_LIMITS = {
  cohost: 1,
  overseer: 1,
  interviewer: 15,
  spectator: 4,
  supervisor: 4,
};

// Optional: where attendee log embeds go.
// If not set, logs go into the queue channel itself.
const SESSION_ATTENDEES_LOG_CHANNEL_ID =
  process.env.SESSION_ATTENDEES_LOG_CHANNEL_ID || null;

/* ============================================================================
 *  BASIC HELPERS (NO TRELLO CALLS)
 * ========================================================================== */

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

function detectSessionTypeFromString(str) {
  if (!str) return null;
  const lower = String(str).toLowerCase();

  if (lower.includes('interview')) return 'interview';
  if (lower.includes('training')) return 'training';
  if (
    lower.includes('mass shift') ||
    lower.includes('massshift') ||
    lower.includes(' ms ')
  ) {
    return 'massshift';
  }

  return null;
}

function parseTimeFromSlugParts(parts) {
  // Example slug parts: ["451","training","800","am","est","man9ixe"]
  const idx = parts.findIndex(
    (p) => p.toLowerCase() === 'am' || p.toLowerCase() === 'pm',
  );
  if (idx > 0 && idx + 1 < parts.length) {
    const meridiem = parts[idx].toUpperCase(); // AM/PM
    const tz = parts[idx + 1].toUpperCase(); // EST, PST, etc.
    const timeNum = parts[idx - 1]; // "800" or "1000"

    if (/^\d{3,4}$/.test(timeNum)) {
      let hoursStr;
      let minsStr;
      if (timeNum.length === 3) {
        hoursStr = timeNum.charAt(0);
        minsStr = timeNum.slice(1);
      } else {
        hoursStr = timeNum.slice(0, 2);
        minsStr = timeNum.slice(2);
      }
      const hours = String(parseInt(hoursStr, 10));
      return `${hours}:${minsStr} ${meridiem} ${tz}`;
    }

    return `${timeNum.toUpperCase()} ${meridiem} ${tz}`;
  }

  return null;
}

/**
 * Build meta for the session purely from the Trello link/text + the user.
 */
function buildCardMeta(cardOption, interaction) {
  const sessionType = detectSessionTypeFromString(cardOption);

  const cardUrl = cardOption;
  let hostId = interaction.user.id;
  let hostName = interaction.user.username;
  let timeText = null;

  // Try to pull a slug like: /c/SHORTID/451-training-800-am-est-man9ixe
  let slug = null;
  const slugMatch = cardOption.match(
    /trello\.com\/c\/[a-zA-Z0-9]+\/([^?#\s]+)/,
  );
  if (slugMatch) {
    slug = slugMatch[1];
  }

  if (slug) {
    const parts = slug.split('-');
    if (parts.length >= 2) {
      // Last part is usually the host's name (e.g. "man9ixe")
      hostName = parts[parts.length - 1];
      const maybeTime = parseTimeFromSlugParts(parts);
      if (maybeTime) timeText = maybeTime;
    }
  }

  const typeLabel =
    sessionType === 'training'
      ? 'Training'
      : sessionType === 'massshift'
      ? 'Mass Shift'
      : 'Interview';

  let cardName = `[${typeLabel}]`;
  if (timeText) cardName += ` ${timeText}`;
  cardName += ` - ${hostName}`;

  return { sessionType, cardUrl, hostId, hostName, timeText, cardName };
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

/**
 * For now: stub that returns no weekly counts to keep everything extremely stable.
 * (Everyone is equal priority, ordered by when they joined the queue.)
 */
async function getWeeklySessionCounts(_client) {
  return new Map();
}

/* ============================================================================
 *  QUEUE DATA STRUCTURE
 * ========================================================================== */

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
  // Remove from any existing role first (one spot per queue only).
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
  const isMap = weeklyCounts instanceof Map;

  return [...entries].sort((a, b) => {
    const countA = isMap && weeklyCounts.has(a.userId)
      ? weeklyCounts.get(a.userId)
      : 0;
    const countB = isMap && weeklyCounts.has(b.userId)
      ? weeklyCounts.get(b.userId)
      : 0;

    // Fewer sessions this week = higher priority.
    if (countA !== countB) return countA - countB;

    // Tie-breaker: claimed earlier in this queue.
    if (a.claimedAt && b.claimedAt) {
      return a.claimedAt - b.claimedAt;
    }

    return 0;
  });
}

/* ============================================================================
 *  OPEN QUEUE (NO TRELLO CALLS)
 * ========================================================================== */

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

  const meta = buildCardMeta(cardOption, interaction);
  const sessionType = meta.sessionType;

  if (!sessionType) {
    await interaction.editReply({
      content:
        'I could not detect the session type from that card. Make sure the link or text includes Interview, Training, or Mass Shift.',
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

  const headerTop = '╔══════════════════════════════════════╗';
  const headerTitle = `🟡 ${cfg.typeLabel} | ${meta.hostName} | ${
    meta.timeText || 'Time TBA'
  } 🟡`;
  const headerBottom = '╚══════════════════════════════════════╝';

  const descriptionLines = [
    headerTop,
    headerTitle,
    headerBottom,
    '',
    `📌  Host: <@${meta.hostId}>`,
    meta.timeText ? `📌  Time: ${meta.timeText}` : null,
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
    `〰️ Trello Card: ${meta.cardUrl}`,
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
    hostId: meta.hostId,
    hostName: meta.hostName,
    channelId: queueMessage.channel.id,
    messageId: queueMessage.id,
    attendeesMessageId: null,
    cardName: meta.cardName,
    cardUrl: meta.cardUrl,
    timeText: meta.timeText,
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
  await interaction.editReply({
    content: `✅ Opened queue for **${meta.cardName}** in ${channelMention}`,
  });
}

/* ============================================================================
 *  ATTENDEES MESSAGE
 * ========================================================================== */

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

/* ============================================================================
 *  LOGGING ATTENDEES TO #SESSION-LOGS
 * ========================================================================== */

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
    usernamesFromEntries(supervisorEntries),
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

/* ============================================================================
 *  CLEANUP & BUTTON HANDLER
 * ========================================================================== */

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
 * Handles:
 *  - cancel_log_yes_<shortId> / cancel_log_no_<shortId>
 *  - queue_join_* / queue_leave_* / queue_close_*
 *
 * Returns true if handled; false if this interaction is not ours.
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
      // Just cleanup queue + attendees
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

      // Only the host can close the queue
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

/* ============================================================================
 *  /SESSIONATTENDEES HELPER
 * ========================================================================== */

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

/* ============================================================================
 *  EXPORTS
 * ========================================================================== */

module.exports = {
  openQueueForCard,
  handleQueueButtonInteraction,
  postAttendeesForCard,
  logAttendeesForCard,
  cleanupQueueForCard,
};
