const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { trelloRequest } = require('./trelloClient');
const { getWeeklySessionCounts } = require('./hyraClient');

// In-memory store of active queues keyed by Trello shortLink (e.g. "YFeAVrFM")
const activeQueues = new Map();

/**
 * Try to parse a Trello shortLink (the little ID in the middle of the URL)
 * from either a full card URL or a raw short ID.
 */
function parseCardShortId(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();

  // Full card URL: https://trello.com/c/SHORTID/....
  const urlMatch = trimmed.match(/trello\.com\/c\/([A-Za-z0-9]+)/i);
  if (urlMatch) return urlMatch[1];

  // Just the short id, 7–10 chars alphanumeric is common
  const shortIdMatch = trimmed.match(/^([A-Za-z0-9]{7,10})$/);
  if (shortIdMatch) return shortIdMatch[1];

  return null;
}

/**
 * Fetch Trello card info we need.
 */
async function fetchCardInfo(shortId) {
  // Trello lets you GET /1/cards/{shortLink}
  const res = await trelloRequest(`/1/cards/${shortId}`, {
    method: 'GET',
    searchParams: {
      fields: 'id,idShort,name,desc,due,shortLink,shortUrl,idLabels',
    },
  });

  if (!res || !res.id) return null;

  return {
    id: res.id,
    shortId: res.shortLink || shortId,
    name: res.name || 'Unknown session',
    desc: res.desc || '',
    due: res.due ? new Date(res.due) : null,
    shortUrl: res.shortUrl,
    idLabels: Array.isArray(res.idLabels) ? res.idLabels : [],
  };
}

/**
 * Determine session type ("interview" | "training" | "mass_shift")
 * based on label IDs and/or card name prefix.
 */
function detectSessionType(card, labelIds) {
  const labels = labelIds || [];

  const interviewLabel = process.env.TRELLO_LABEL_INTERVIEW_ID;
  const trainingLabel = process.env.TRELLO_LABEL_TRAINING_ID;
  const massShiftLabel = process.env.TRELLO_LABEL_MASS_SHIFT_ID;

  if (interviewLabel && labels.includes(interviewLabel)) return 'interview';
  if (trainingLabel && labels.includes(trainingLabel)) return 'training';
  if (massShiftLabel && labels.includes(massShiftLabel)) return 'mass_shift';

  const lowerName = (card.name || '').toLowerCase();
  if (lowerName.startsWith('[interview]')) return 'interview';
  if (lowerName.startsWith('[training]')) return 'training';
  if (lowerName.startsWith('[mass shift]') || lowerName.startsWith('[mass-shift]')) return 'mass_shift';

  return null;
}

/**
 * Map session type to channels, ping roles and role-slots.
 * Uses YOUR env names exactly as they are on Render.
 */
function getSessionTypeConfig(sessionType) {
  if (sessionType === 'interview') {
    const queueChannelId =
      process.env.QUEUE_INTERVIEW_CHANNEL_ID ||
      process.env.SESSION_QUEUE_CHANNEL_INTERVIEW_ID ||
      process.env.SESSION_INTERVIEW_CHANNEL_ID;

    const attendeesChannelId =
      process.env.QUEUE_INTERVIEW_ATTENDEES_CHANNEL_ID ||
      process.env.SESSION_ATTENDEES_CHANNEL_INTERVIEW_ID;

    const queuePingRoleId =
      process.env.SESSION_QUEUE_PING_INTERVIEW_ROLE_ID ||
      process.env.SESSION_INTERVIEW_PING_ROLE_ID ||
      process.env.INTERVIEW_SESSION_ROLE_ID;

    if (!queueChannelId || !attendeesChannelId) return null;

    return {
      sessionType: 'interview',
      displayName: 'INTERVIEW',
      colorEmoji: '🟡',
      queueChannelId,
      attendeesChannelId,
      queuePingRoleId,
      roles: {
        cohost: {
          label: 'Co-Host',
          buttonLabel: 'Co-Host',
          style: ButtonStyle.Primary,
          max: 1,
        },
        overseer: {
          label: 'Overseer',
          buttonLabel: 'Overseer',
          style: ButtonStyle.Primary,
          max: 1,
        },
        interviewer: {
          label: 'Interviewer',
          buttonLabel: 'Interviewer',
          style: ButtonStyle.Success,
          max: 12,
        },
        spectator: {
          label: 'Spectator',
          buttonLabel: 'Spectator',
          style: ButtonStyle.Secondary,
          max: 4,
        },
      },
    };
  }

  if (sessionType === 'training') {
    const queueChannelId =
      process.env.QUEUE_TRAINING_CHANNEL_ID ||
      process.env.SESSION_QUEUE_CHANNEL_TRAINING_ID ||
      process.env.SESSION_TRAINING_CHANNEL_ID;

    const attendeesChannelId =
      process.env.QUEUE_TRAINING_ATTENDEES_CHANNEL_ID ||
      process.env.SESSION_ATTENDEES_CHANNEL_TRAINING_ID;

    const queuePingRoleId =
      process.env.SESSION_QUEUE_PING_TRAINING_ROLE_ID ||
      process.env.SESSION_TRAINING_PING_ROLE_ID ||
      process.env.TRAINING_SESSION_ROLE_ID;

    if (!queueChannelId || !attendeesChannelId) return null;

    return {
      sessionType: 'training',
      displayName: 'TRAINING',
      colorEmoji: '🔴',
      queueChannelId,
      attendeesChannelId,
      queuePingRoleId,
      roles: {
        cohost: {
          label: 'Co-Host',
          buttonLabel: 'Co-Host',
          style: ButtonStyle.Primary,
          max: 1,
        },
        overseer: {
          label: 'Overseer',
          buttonLabel: 'Overseer',
          style: ButtonStyle.Primary,
          max: 1,
        },
        trainer: {
          label: 'Trainer',
          buttonLabel: 'Trainer',
          style: ButtonStyle.Success,
          max: 8,
        },
        spectator: {
          label: 'Spectator',
          buttonLabel: 'Spectator',
          style: ButtonStyle.Secondary,
          max: 4,
        },
        supervisor: {
          label: 'Supervisor',
          buttonLabel: 'Supervisor',
          style: ButtonStyle.Secondary,
          max: 4,
        },
      },
    };
  }

  if (sessionType === 'mass_shift') {
    const queueChannelId =
      process.env.QUEUE_MASS_SHIFT_CHANNEL_ID ||
      process.env.SESSION_QUEUE_CHANNEL_MASS_SHIFT_ID ||
      process.env.SESSION_MASS_SHIFT_CHANNEL_ID;

    const attendeesChannelId =
      process.env.QUEUE_MASSSHIFT_ATTENDEES_CHANNEL_ID || // note: MASSSHIFT in env
      process.env.QUEUE_MASS_SHIFT_ATTENDEES_CHANNEL_ID ||
      process.env.SESSION_ATTENDEES_CHANNEL_MASS_SHIFT_ID;

    const queuePingRoleId =
      process.env.SESSION_QUEUE_PING_MASS_SHIFT_ROLE_ID ||
      process.env.SESSION_MASS_SHIFT_PING_ROLE_ID ||
      process.env.MASS_SHIFT_SESSION_ROLE_ID;

    if (!queueChannelId || !attendeesChannelId) return null;

    return {
      sessionType: 'mass_shift',
      displayName: 'MASS SHIFT',
      colorEmoji: '🟣',
      queueChannelId,
      attendeesChannelId,
      queuePingRoleId,
      roles: {
        cohost: {
          label: 'Co-Host',
          buttonLabel: 'Co-Host',
          style: ButtonStyle.Primary,
          max: 1,
        },
        overseer: {
          label: 'Overseer',
          buttonLabel: 'Overseer',
          style: ButtonStyle.Primary,
          max: 1,
        },
        attendee: {
          label: 'Attendee',
          buttonLabel: 'Attendee',
          style: ButtonStyle.Success,
          max: 15,
        },
      },
    };
  }

  return null;
}

/**
 * Parse host Discord ID from the card description.
 * Looks for: Host: some name (123456789012345678)
 */
function parseHostIdFromDesc(desc) {
  if (!desc) return null;
  const match = desc.match(/Host:[^\n]*\((\d{17,20})\)/i);
  return match ? match[1] : null;
}

/**
 * Build the session queue embed for a card.
 */
async function buildQueueEmbed(client, card, sessionCfg, hostId) {
  const dueTs = card.due ? Math.floor(card.due.getTime() / 1000) : null;
  let hostMention = hostId ? `<@${hostId}>` : 'Unknown Host';
  let hostTagDisplay = 'HOST';

  if (hostId) {
    try {
      const user = await client.users.fetch(hostId);
      if (user && user.tag) {
        hostTagDisplay = user.username || user.tag;
      }
    } catch {
      // ignore, fall back
    }
  }

  let headerLine = `${sessionCfg.colorEmoji} ${sessionCfg.displayName} | ${hostTagDisplay} | ${dueTs ? `<t:${dueTs}:t>` : 'TIME'} ${sessionCfg.colorEmoji}`;

  let rolesBlock = '';
  if (sessionCfg.sessionType === 'interview') {
    rolesBlock = [
      'ℹ️  **Co-Host:** Corporate Intern+',
      'ℹ️  **Overseer:** Executive Manager+',
      'ℹ️  **Interviewer (12):** Leadership Intern+',
      'ℹ️  **Spectator (4):** Leadership Intern+',
    ].join('\n');
  } else if (sessionCfg.sessionType === 'training') {
    rolesBlock = [
      'ℹ️  **Co-Host:** Corporate Intern+',
      'ℹ️  **Overseer:** Executive Manager+',
      'ℹ️  **Trainer (8):** Leadership Intern+',
      'ℹ️  **Spectator (4):** Leadership Intern+',
      'ℹ️  **Supervisor (4):** Supervisor+',
    ].join('\n');
  } else if (sessionCfg.sessionType === 'mass_shift') {
    rolesBlock = [
      'ℹ️  **Co-Host:** Corporate Intern+',
      'ℹ️  **Overseer:** Executive Manager+',
      'ℹ️  **Attendee:** Leadership Intern+',
    ].join('\n');
  }

  const descriptionLines = [
    '╔══════════════════════════════════════╗',
    ` ${headerLine}`,
    '╚══════════════════════════════════════╝',
    '',
    `📌  **Host:** ${hostMention}`,
    dueTs ? `📌 **Starts:** <t:${dueTs}:R>` : '📌 **Starts:** Unknown',
    dueTs ? `📌 **Time:** <t:${dueTs}:t>` : '📌 **Time:** Unknown',
    '',
    '💠 **ROLES** 💠',
    '----------------------------------------------------------------',
    rolesBlock,
    '',
    '❓ **HOW TO JOIN THE QUEUE** ❓',
    '----------------------------------------------------------------',
    '- Check the role list above — if your rank is allowed, press the role button you want.',
    '- You’ll get a private message that says you were added to that role\'s queue.',
    '- Do NOT join until you are pinged in **Session Attendees** 15 minutes before the session starts.',
    '',
    '❓ **HOW TO LEAVE THE QUEUE / INFORM LATE ARRIVAL** ❓',
    '----------------------------------------------------------------',
    '- Click the **Leave Queue** button, which will appear after you join.',
    '- After the attendees post is made, changes must be handled in **#session-lounge** by pinging the host/corporate.',
    '',
    '----------------------------------------------------------------',
    '╭─────── 💠 LINKS 💠 ───────────╮',
    `• Trello Card: ${card.shortUrl}`,
    '╰─────────────────────────────╯',
  ];

  const embed = new EmbedBuilder()
    .setDescription(descriptionLines.join('\n'))
    .setColor(0xadd8ff);

  return embed;
}

/**
 * Build the ActionRows with role buttons + leave button.
 */
function buildQueueButtons(sessionCfg, cardShortId) {
  const buttons = [];

  for (const [key, roleDef] of Object.entries(sessionCfg.roles)) {
    const customId = `queue:${cardShortId}:${key}`;
    buttons.push(
      new ButtonBuilder()
        .setCustomId(customId)
        .setLabel(roleDef.buttonLabel)
        .setStyle(roleDef.style),
    );
  }

  // Leave Queue button
  const leaveButton = new ButtonBuilder()
    .setCustomId(`queue:${cardShortId}:leave`)
    .setLabel('Leave Queue')
    .setStyle(ButtonStyle.Danger);

  // Split into rows of max 5 buttons
  const rows = [];
  let currentRow = new ActionRowBuilder();
  for (const btn of buttons) {
    if (currentRow.components.length === 5) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
    }
    currentRow.addComponents(btn);
  }
  if (currentRow.components.length > 0) {
    rows.push(currentRow);
  }

  // Put Leave button on its own row at the bottom
  rows.push(
    new ActionRowBuilder().addComponents(leaveButton),
  );

  return rows;
}

/**
 * Open a queue for a given Trello card (by URL or short id).
 * Does NOT respond to the interaction; the slash command should do that.
 */
async function openQueueForCard(client, rawCardOption) {
  console.log('[QUEUE] Raw card option:', rawCardOption);

  const shortId = parseCardShortId(rawCardOption);
  if (!shortId) {
    console.warn('[QUEUE] Could not parse Trello card id from:', rawCardOption);
    return { ok: false, message: 'I could not parse that Trello card link or ID.' };
  }

  // Fetch card
  const card = await fetchCardInfo(shortId);
  if (!card) {
    console.warn('[QUEUE] Could not fetch Trello card for shortId:', shortId);
    return { ok: false, message: 'I could not load that Trello card from Trello.' };
  }

  const sessionType = detectSessionType(card, card.idLabels);
  if (!sessionType) {
    console.warn('[QUEUE] Could not detect session type for card:', shortId, card.name);
    return {
      ok: false,
      message:
        'I could not determine the session type from that card. Make sure it has the correct labels or [Interview]/[Training]/[Mass Shift] in the name.',
    };
  }

  const cfg = getSessionTypeConfig(sessionType);
  if (!cfg) {
    console.warn('[QUEUE] Missing channel config for session type:', sessionType);
    return {
      ok: false,
      message: `I could not open a queue for that Trello card.\n• Make sure SESSION_*/QUEUE_* env vars are set for ${sessionType}.`,
    };
  }

  const queueChannel = await client.channels.fetch(cfg.queueChannelId).catch(() => null);
  if (!queueChannel || !queueChannel.isTextBased()) {
    console.warn('[QUEUE] Queue channel not found or not text based for type:', sessionType);
    return {
      ok: false,
      message: 'I could not find the queue channel for that session type.',
    };
  }

  const hostId = parseHostIdFromDesc(card.desc);

  const embed = await buildQueueEmbed(client, card, cfg, hostId);
  const components = buildQueueButtons(cfg, card.shortId);

  // 1) Post the embed with buttons
  const sent = await queueChannel.send({
    embeds: [embed],
    components,
  });

  // 2) Then ping the queue role in a separate message (so it appears "under" the embed)
  if (cfg.queuePingRoleId) {
    await queueChannel.send({
      content: `<@&${cfg.queuePingRoleId}>`,
      allowedMentions: { roles: [cfg.queuePingRoleId] },
    });
  }

  // Initialise queue state
  activeQueues.set(card.shortId, {
    card,
    sessionType: cfg.sessionType,
    config: cfg,
    queueMessageId: sent.id,
    queueChannelId: sent.channelId,
    attendeesPosted: false,
    roles: Object.fromEntries(
      Object.keys(cfg.roles).map((key) => [
        key,
        {
          max: cfg.roles[key].max,
          users: [], // { userId, joinedAt }
        },
      ]),
    ),
  });

  console.log('[QUEUE] Opened queue for card', card.shortId, 'in channel', sent.channelId);

  return { ok: true, message: 'Queue opened successfully.' };
}

/**
 * Handle button interactions (join / leave).
 */
async function handleQueueButtonInteraction(interaction) {
  if (!interaction.isButton()) return false;

  const id = interaction.customId;
  if (!id.startsWith('queue:')) return false;

  const parts = id.split(':');
  // queue:<shortId>:<roleKey|leave>
  const shortId = parts[1];
  const action = parts[2];

  const queue = activeQueues.get(shortId);
  if (!queue) {
    await interaction.reply({
      content: 'That queue is no longer active.',
      ephemeral: true,
    });
    return true;
  }

  if (action === 'leave') {
    let removed = false;
    for (const roleState of Object.values(queue.roles)) {
      const before = roleState.users.length;
      roleState.users = roleState.users.filter((u) => u.userId !== interaction.user.id);
      if (roleState.users.length !== before) removed = true;
    }

    if (!removed) {
      await interaction.reply({
        content: 'You are not currently in this queue.',
        ephemeral: true,
      });
      return true;
    }

    await interaction.reply({
      content: 'You have been removed from the queue.',
      ephemeral: true,
    });
    return true;
  }

  // joining a specific role
  const roleKey = action;
  const roleState = queue.roles[roleKey];
  if (!roleState) {
    await interaction.reply({
      content: 'That role is not available for this queue.',
      ephemeral: true,
    });
    return true;
  }

  // remove user from other roles first
  for (const [key, rs] of Object.entries(queue.roles)) {
    if (key === roleKey) continue;
    rs.users = rs.users.filter((u) => u.userId !== interaction.user.id);
  }

  // check capacity
  if (roleState.users.length >= roleState.max) {
    await interaction.reply({
      content: `The **${queue.config.roles[roleKey].label}** queue is currently full.`,
      ephemeral: true,
    });
    return true;
  }

  if (!roleState.users.some((u) => u.userId === interaction.user.id)) {
    roleState.users.push({
      userId: interaction.user.id,
      joinedAt: Date.now(),
    });
  }

  await interaction.reply({
    content: `You have been added to the **${queue.config.roles[roleKey].label}** queue.`,
    ephemeral: true,
  });

  return true;
}

/**
 * Helper to pick selected attendees for each role using Hyra session counts.
 * - Lower session count first
 * - If tied, earlier joinedAt first
 */
async function selectAttendees(queue) {
  let sessionCounts = {};
  try {
    const counts = await getWeeklySessionCounts();
    if (counts && typeof counts === 'object') {
      sessionCounts = counts;
    } else {
      console.warn('[HYRA] getWeeklySessionCounts returned empty/invalid, defaulting to 0 for all.');
    }
  } catch (err) {
    console.error('[HYRA] Failed to fetch weekly session counts:', err);
  }

  const selected = {};
  for (const [roleKey, roleState] of Object.entries(queue.roles)) {
    const users = [...roleState.users];

    users.sort((a, b) => {
      const countA = sessionCounts[a.userId] ?? 0;
      const countB = sessionCounts[b.userId] ?? 0;
      if (countA !== countB) return countA - countB;
      return a.joinedAt - b.joinedAt;
    });

    selected[roleKey] = users.slice(0, roleState.max);
  }

  return { selected, sessionCounts };
}

/**
 * Build the attendees post text for a queue.
 * This is a NORMAL message (no embed) so pings work.
 */
async function buildAttendeesMessage(client, queue) {
  const { selected, sessionCounts } = await selectAttendees(queue);
  const card = queue.card;
  const cfg = queue.config;

  const hostId = parseHostIdFromDesc(card.desc);
  let hostMention = hostId ? `<@${hostId}>` : 'Unknown Host';

  function formatUser(userEntry, index) {
    const userId = userEntry.userId;
    const sessions = sessionCounts[userId] ?? 0;
    return `${index}. <@${userId}> (${sessions} sessions)`;
  }

  const headerTop = '╔══════════════════════════════════════╗';
  const headerMid = '                              ✅  SELECTED ATTENDEES ✅';
  const headerBot = '╚══════════════════════════════════════╝';

  const lines = [headerTop, headerMid, headerBot, ''];

  lines.push(`🧊 **Host:** ${hostMention}`);

  const cohost = selected.cohost?.[0];
  const overseer = selected.overseer?.[0];

  lines.push(`🧊 **Co-Host:** ${cohost ? `<@${cohost.userId}> (${sessionCounts[cohost.userId] ?? 0} sessions)` : 'None'}`);
  lines.push(`🧊 **Overseer:** ${overseer ? `<@${overseer.userId}> (${sessionCounts[overseer.userId] ?? 0} sessions)` : 'None'}`);
  lines.push('');
  lines.push('────────────');
  lines.push('');

  if (cfg.sessionType === 'interview') {
    lines.push('🟡  **Interviewers** 🟡');

    const interviewerList = selected.interviewer || [];
    for (let i = 0; i < cfg.roles.interviewer.max; i++) {
      const entry = interviewerList[i];
      if (entry) {
        lines.push(formatUser(entry, i + 1));
      } else {
        lines.push(`${i + 1}.`);
      }
    }

    lines.push('');
    lines.push('────────────');
    lines.push('');
    lines.push('⚪  **Spectators** ⚪');

    const specList = selected.spectator || [];
    for (let i = 0; i < cfg.roles.spectator.max; i++) {
      const entry = specList[i];
      if (entry) {
        lines.push(formatUser(entry, i + 1));
      } else {
        lines.push(`${i + 1}.`);
      }
    }
  } else if (cfg.sessionType === 'training') {
    lines.push('🔴  **Trainers** 🔴');

    const trainerList = selected.trainer || [];
    for (let i = 0; i < cfg.roles.trainer.max; i++) {
      const entry = trainerList[i];
      if (entry) {
        lines.push(formatUser(entry, i + 1));
      } else {
        lines.push(`${i + 1}.`);
      }
    }

    lines.push('');
    lines.push('────────────');
    lines.push('');
    lines.push('⚪  **Spectators** ⚪');

    const specList = selected.spectator || [];
    for (let i = 0; i < cfg.roles.spectator.max; i++) {
      const entry = specList[i];
      if (entry) {
        lines.push(formatUser(entry, i + 1));
      } else {
        lines.push(`${i + 1}.`);
      }
    }

    lines.push('');
    lines.push('────────────');
    lines.push('');
    lines.push('🟣  **Supervisors** 🟣');

    const supList = selected.supervisor || [];
    for (let i = 0; i < cfg.roles.supervisor.max; i++) {
      const entry = supList[i];
      if (entry) {
        lines.push(formatUser(entry, i + 1));
      } else {
        lines.push(`${i + 1}.`);
      }
    }
  } else if (cfg.sessionType === 'mass_shift') {
    lines.push('🟣  **Attendees** 🟣');

    const attList = selected.attendee || [];
    for (let i = 0; i < cfg.roles.attendee.max; i++) {
      const entry = attList[i];
      if (entry) {
        lines.push(formatUser(entry, i + 1));
      } else {
        lines.push(`${i + 1}.`);
      }
    }
  }

  lines.push('');
  lines.push('🧊 You should now join! Please join within **5 minutes**, or your spot will be given to someone else.');
  lines.push('🧊 Failure to join on time will result in a **written warning**.');

  return lines.join('\n');
}

/**
 * Post the attendees list for a given Trello card (by URL or short id).
 */
async function postAttendeesForCard(client, rawCardOption) {
  const shortId = parseCardShortId(rawCardOption);
  if (!shortId) {
    console.warn('[ATTENDEES] Could not parse Trello card id from:', rawCardOption);
    return { ok: false, message: 'I could not parse that Trello card link or ID.' };
  }

  const queue = activeQueues.get(shortId);
  if (!queue) {
    console.warn('[ATTENDEES] No active queue found for card:', shortId);
    return { ok: false, message: 'There is no active queue for that Trello card (or it was never opened with /sessionqueue).' };
  }

  const attendeesChannel = await client.channels.fetch(queue.config.attendeesChannelId).catch(() => null);
  if (!attendeesChannel || !attendeesChannel.isTextBased()) {
    console.warn('[ATTENDEES] Attendees channel not found or not text based for type:', queue.sessionType);
    return { ok: false, message: 'I could not find the attendees channel for that session type.' };
  }

  const messageText = await buildAttendeesMessage(client, queue);

  await attendeesChannel.send({
    content: messageText,
    allowedMentions: { parse: ['users'] },
  });

  queue.attendeesPosted = true;

  console.log('[QUEUE] Posted attendees for card', shortId);

  return { ok: true, message: 'Attendees list posted.' };
}

module.exports = {
  openQueueForCard,
  handleQueueButtonInteraction,
  postAttendeesForCard,
};
