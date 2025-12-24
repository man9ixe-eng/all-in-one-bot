const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { trelloRequest } = require('./trelloClient'); // still imported for consistency, but we use direct fetch here.

const TRELLO_KEY = process.env.TRELLO_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;

// In-memory registry of active queues, keyed by Trello card shortId.
const queues = new Map();

// How many SLOTS we want to pick when the queue closes.
// (Join is unlimited; selection uses these caps.)
const ROLE_SLOTS = {
  interview: {
    cohost: 1,
    overseer: 1,
    interviewer: 12,
    spectator: 4,
  },
  training: {
    cohost: 1,
    overseer: 1,
    supervisor: 4,
    interviewer: 8, // "Trainer"
    spectator: 4,
  },
  massshift: {
    cohost: 1,
    overseer: 1,
    interviewer: 15, // "Attendees"
  },
};

// Logs channel (simple embed, usernames only)
const SESSION_ATTENDEES_LOG_CHANNEL_ID = process.env.SESSION_ATTENDEES_LOG_CHANNEL_ID || null;
// Live ping channel (Selected Attendees). Fallback = queue channel.
const SESSION_ATTENDEES_CHANNEL_ID = process.env.SESSION_ATTENDEES_CHANNEL_ID || null;

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

// Fetch a Trello card by shortLink using direct HTTP, so we don't fight trelloRequest's method/path shape.
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
      typeLabel: 'Interview',
      queueChannelId: process.env.SESSION_QUEUECHANNEL_INTERVIEW_ID,
      pingRoleId: process.env.SESSION_QUEUE_PING_INTERVIEW_ROLE_ID,
      color: 0xffc107, // yellow-ish
      gameLink: 'https://www.roblox.com/games/71896062227595/GH-Interview-Center',
    };
  }

  if (sessionType === 'training') {
    return {
      typeLabel: 'Training',
      queueChannelId: process.env.SESSION_QUEUECHANNEL_TRAINING_ID,
      pingRoleId: process.env.SESSION_QUEUE_PING_TRAINING_ROLE_ID,
      color: 0xe74c3c, // red-ish
      gameLink: 'https://www.roblox.com/games/88554128028552/GH-Training-Center',
    };
  }

  if (sessionType === 'massshift') {
    return {
      typeLabel: 'Mass Shift',
      queueChannelId: process.env.SESSION_QUEUECHANNEL_MASSSHIFT_ID,
      pingRoleId: process.env.SESSION_QUEUE_PING_MASS_SHIFT_ROLE_ID,
      color: 0x9b59b6, // purple
      gameLink: 'https://www.roblox.com/games/127619749760478/Glace-Hotels-BETA-V1',
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
  // [Interview] 10:50 PM EST - Man9ixe
  const match = cardName.match(/\]\s*(.+?)\s*-\s*[^-]+$/);
  if (match) {
    return match[1].trim();
  }
  return null;
}

function getDueTimestamp(dueString) {
  if (!dueString) return null;
  const due = new Date(dueString);
  if (Number.isNaN(due.getTime())) return null;
  return Math.floor(due.getTime() / 1000);
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
    openedAt: data.openedAt || existing.openedAt || Date.now(),
    isClosed: data.isClosed !== undefined ? data.isClosed : (existing.isClosed || false),
    roles: existing.roles || {
      cohost: [],
      overseer: [],
      supervisor: [],
      interviewer: [],
      spectator: [],
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

  if (!queue.roles[roleKey]) {
    queue.roles[roleKey] = [];
  }

  const list = queue.roles[roleKey];

  // Unlimited join – capacity handled only when selecting final attendees.
  list.push({ userId, claimedAt: Date.now() });
  const position = list.findIndex(e => e.userId === userId) + 1;

  return {
    ok: true,
    position,
    totalInRole: list.length,
  };
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

// Build the big queue embed description using your templates per type.
function buildQueueDescription(sessionType, cfg, queueInfo) {
  const { hostName, dueTs, cardName, cardUrl } = queueInfo;

  const startsRel = dueTs ? `<t:${dueTs}:R>` : 'Unknown';
  const startsExact = dueTs ? `<t:${dueTs}:t>` : 'Unknown';

  if (sessionType === 'interview') {
    return [
      '╔══════════════════════════════════════╗',
      `                         🟡 ${cardName} 🟡`,
      '╚══════════════════════════════════════╝',
      '',
      `📌  Host: ${hostName}`,
      `📌 Starts: ${startsRel}`,
      `📌 Time: ${startsExact}`,
      '',
      '💠 ROLES 💠',
      '----------------------------------------------------------------',
      'ℹ️  **Co-Host:** Corporate Intern+',
      'ℹ️  **Overseer:** Executive Manager+',
      'ℹ️  **Interviewers (12):** Leadership Intern+',
      'ℹ️  **Spectators (4):** Leadership Intern+',
      '',
      '❓  HOW TO JOIN THE QUEUE ❓',
      '----------------------------------------------------------------',
      '- Check the role list above — if your rank is allowed, press the role button you want.',
      '- You’ll get a popup that says: “You have been added to the (ROLE) Queue, # in queue.”',
      '- Do NOT join until you are pinged in **Session Attendees** 15 minutes before the session starts.',
      '- Line up on the number/role you are selected for on "Session Attendees".',
      '- You have 5 minutes after Session Attendees is posted to join.',
      '',
      '❓ HOW TO LEAVE THE QUEUE/INFORM LATE ARRIVAL ❓',
      '----------------------------------------------------------------',
      '- Click the "Leave Queue" button, which will show up once you join the queue.',
      '- You can only leave the queue BEFORE the session list is posted. After that, go to #session-lounge and ping your host to un-queue.',
      '- If you do not let the host know anything before **5 minutes** after an attendees post was made, you may receive a **Written Warning**, and your spot could be given up.',
      '----------------------------------------------------------------',
      '╭─────── 💠 LINKS 💠 ───────────╮',
      `〰️ Trello Card: ${cardUrl}`,
      '╰─────────────────────────────╯',
    ].join('\n');
  }

  if (sessionType === 'training') {
    return [
      '╔══════════════════════════════════════╗',
      `                             🔴  ${cardName}  🔴`,
      '╚══════════════════════════════════════╝',
      '',
      `📌  Host: ${hostName}`,
      `📌 Starts: ${startsRel}`,
      `📌 Time: ${startsExact}`,
      '',
      '💠 ROLES 💠',
      '----------------------------------------------------------------',
      'ℹ️  **Co-Host:** Corporate Intern+',
      'ℹ️  **Overseer:** Executive Manager+',
      'ℹ️  **Supervisors (4):** Assistant Manager+',
      'ℹ️  **Trainers (8):** Leadership Intern+',
      'ℹ️  **Spectators (4):** Leadership Intern+',
      '',
      '❓  HOW TO JOIN THE QUEUE ❓',
      '----------------------------------------------------------------',
      '- Check the role list above — if your rank is allowed, press the role button you want.',
      '- You’ll get a popup that says: “You have been added to the (ROLE) Queue, # in queue.”',
      '- Do NOT join until you are pinged in **Session Attendees** 15 minutes before the session starts.',
      '- Line up on the number/role you are selected for on "Session Attendees".',
      '- You have 5 minutes after Session Attendees is posted to join.',
      '',
      '❓ HOW TO LEAVE THE QUEUE/INFORM LATE ARRIVAL ❓',
      '----------------------------------------------------------------',
      '- Click the "Leave Queue" button, which will show up once you join the queue.',
      '- You can only leave the queue BEFORE the session list is posted. After that, go to #session-lounge and ping your host to un-queue.',
      '- If you do not let the host know anything before **5 minutes** after an attendees post was made, you may receive a **Written Warning**, and your spot could be given up.',
      '----------------------------------------------------------------',
      '╭─────── 💠 LINKS 💠 ───────────╮',
      `〰️ Trello Card: ${cardUrl}`,
      '╰─────────────────────────────╯',
    ].join('\n');
  }

  if (sessionType === 'massshift') {
    return [
      '╔══════════════════════════════════════╗',
      `                         🟣  ${cardName}  🟣`,
      '╚══════════════════════════════════════╝',
      '',
      `📌  Host: ${hostName}`,
      `📌 Starts: ${startsRel}`,
      `📌 Time: ${startsExact}`,
      '',
      '💠 ROLES 💠',
      '----------------------------------------------------------------',
      'ℹ️  **Co-Host:** Corporate Intern+',
      'ℹ️  **Overseer:** Executive Manager+',
      'ℹ️  **Attendees (15):** Leadership Intern+',
      '',
      '❓  HOW TO JOIN THE QUEUE ❓',
      '----------------------------------------------------------------',
      '- Check the role list above — if your rank is allowed, press the role button you want.',
      '- You’ll get a popup that says: “You have been added to the (ROLE) Queue, # in queue.”',
      '- Do NOT join until you are pinged in **Session Attendees** 15 minutes before the session starts.',
      '- Line up on the number/role you are selected for on "Session Attendees".',
      '- You have 5 minutes after Session Attendees is posted to join.',
      '',
      '❓ HOW TO LEAVE THE QUEUE/INFORM LATE ARRIVAL ❓',
      '----------------------------------------------------------------',
      '- Click the "Leave Queue" button, which will show up once you join the queue.',
      '- You can only leave the queue BEFORE the session list is posted. After that, go to #session-lounge and ping your host to un-queue.',
      '- If you do not let the host know anything before **5 minutes** after an attendees post was made, you may receive a **Written Warning**, and your spot could be given up.',
      '----------------------------------------------------------------',
      '╭─────── 💠 LINKS 💠 ───────────╮',
      `〰️ Trello Card: ${cardUrl}`,
      '╰─────────────────────────────╯',
    ].join('\n');
  }

  return `${cardName}\n${cardUrl}`;
}

function buildJoinRows(sessionType, shortId) {
  const joinRow = new ActionRowBuilder();
  // Common basic roles
  joinRow.addComponents(
    new ButtonBuilder()
      .setCustomId(`queue_join_cohost_${shortId}`)
      .setLabel('Co-Host')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`queue_join_overseer_${shortId}`)
      .setLabel('Overseer')
      .setStyle(ButtonStyle.Primary),
  );

  if (sessionType === 'training') {
    joinRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`queue_join_supervisor_${shortId}`)
        .setLabel('Supervisor')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`queue_join_interviewer_${shortId}`)
        .setLabel('Trainer')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`queue_join_spectator_${shortId}`)
        .setLabel('Spectator')
        .setStyle(ButtonStyle.Secondary),
    );
  } else if (sessionType === 'interview') {
    joinRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`queue_join_interviewer_${shortId}`)
        .setLabel('Interviewer')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`queue_join_spectator_${shortId}`)
        .setLabel('Spectator')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`queue_join_supervisor_${shortId}`)
        .setLabel('Supervisor')
        .setStyle(ButtonStyle.Secondary),
    );
  } else if (sessionType === 'massshift') {
    joinRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`queue_join_interviewer_${shortId}`)
        .setLabel('Attendee')
        .setStyle(ButtonStyle.Success),
    );
  }

  const controlRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`queue_leave_${shortId}`)
      .setLabel('Leave Queue')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`queue_close_${shortId}`)
      .setLabel('Close Queue & Post Attendees')
      .setStyle(ButtonStyle.Danger),
  );

  return { joinRow, controlRow };
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

  const card = await fetchCardByShortId(shortId);
  if (!card) {
    console.log('[QUEUE] Could not fetch Trello card for shortId:', shortId);
    await interaction.reply({
      content: 'I could not fetch that Trello card. Make sure it exists and I can access it.',
      ephemeral: true,
    });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
    return;
  }

  const sessionType = detectSessionType(card.name);
  if (!sessionType) {
    console.log('[QUEUE] Could not detect session type for card:', card.name);
    await interaction.reply({
      content: 'I could not detect the session type from that card. Make sure the card name includes Interview, Training, or Mass Shift.',
      ephemeral: true,
    });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
    return;
  }

  const cfg = getSessionConfig(sessionType);
  if (!cfg || !cfg.queueChannelId) {
    console.log('[QUEUE] Missing channel config for session type:', sessionType);
    await interaction.reply({
      content: `I am missing a queue channel configuration for **${sessionType}**. Please check your environment variables.`,
      ephemeral: true,
    });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
    return;
  }

  const queueChannel = await interaction.client.channels.fetch(cfg.queueChannelId).catch(() => null);
  if (!queueChannel) {
    console.log('[QUEUE] Could not fetch queue channel:', cfg.queueChannelId);
    await interaction.reply({
      content: 'I could not access the configured queue channel. Please check my permissions.',
      ephemeral: true,
    });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
    return;
  }

  const { hostName, hostId } = extractHostFromDesc(card.desc, card.name);
  const timeText = extractTimeFromName(card.name);
  const dueTs = getDueTimestamp(card.due);
  const cardUrl = card.shortUrl || card.url || cardOption;

  const description = buildQueueDescription(sessionType, cfg, {
    hostName,
    dueTs,
    cardName: card.name,
    cardUrl,
  });

  const embed = new EmbedBuilder()
    .setDescription(description)
    .setColor(cfg.color || 0x6cb2eb);

  const { joinRow, controlRow } = buildJoinRows(sessionType, shortId);

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
    openedAt: Date.now(),
    roles: {
      cohost: [],
      overseer: [],
      supervisor: [],
      interviewer: [],
      spectator: [],
    },
    isClosed: false,
  });

  console.log('[QUEUE] Opened queue for card', shortId, 'in channel', queueChannel.id);

  const channelMention = `<#${queueChannel.id}>`;
  const confirmText = `✅ Opened queue for **${card.name}** in ${channelMention}`;

  await interaction.reply({ content: confirmText, ephemeral: true });
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

      const result = addUserToRole(queue, interaction.user.id, roleKey);

      await interaction.reply({
        content: `You have been added to the **${roleKey.charAt(0).toUpperCase() + roleKey.slice(1)}** queue.\nYou are #${result.position} in this queue.\nCurrently **${result.totalInRole}** people are in this queue.`,
        ephemeral: true,
      });
      setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
      return;
    }

    if (action === 'leave') {
      const shortId = parts[2];
      const queue = queues.get(shortId);
      if (!queue || queue.isClosed) {
        await interaction.reply({
          content: 'This queue is locked or no longer active. Please contact the host if you need to be removed.',
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

      // Only host can close (if hostId is known)
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

// Select final attendees per role based purely on first-come for now.
function selectAttendees(queue) {
  const slots = ROLE_SLOTS[queue.sessionType] || {};
  const selected = {
    cohost: [],
    overseer: [],
    supervisor: [],
    interviewer: [],
    spectator: [],
  };

  for (const roleKey of Object.keys(selected)) {
    const entries = sortRoleEntries(queue.roles[roleKey] || []);
    const limit = slots[roleKey] ?? entries.length;
    selected[roleKey] = entries.slice(0, limit);
  }

  return selected;
}

// Build the Selected Attendees message text (with pings) per type.
function buildAttendeesContent(queue, selected, sessionType, cfg) {
  const hostLine = queue.hostId
    ? `🧊 Host: <@${queue.hostId}>`
    : `🧊 Host: ${queue.hostName || 'Unknown'}`;

  const cohostLine = selected.cohost[0]
    ? `🧊 Co-Host: <@${selected.cohost[0].userId}>`
    : '🧊 Co-Host: None selected';

  const overseerLine = selected.overseer[0]
    ? `🧊 Overseer: <@${selected.overseer[0].userId}>`
    : '🧊 Overseer: None selected';

  const gameLink = cfg.gameLink || '';

  if (sessionType === 'interview') {
    const interviewerLines = [];
    for (let i = 0; i < 12; i++) {
      const entry = selected.interviewer[i];
      interviewerLines.push(`${i + 1}. ${entry ? `<@${entry.userId}>` : ''}`);
    }

    const spectatorLines = [];
    for (let i = 0; i < 4; i++) {
      const entry = selected.spectator[i];
      spectatorLines.push(`${i + 1}. ${entry ? `<@${entry.userId}>` : ''}`);
    }

    return [
      '╔══════════════════════════════════════╗',
      '                              ✅  SELECTED ATTENDEES ✅',
      '╚══════════════════════════════════════╝',
      '',
      hostLine,
      cohostLine,
      overseerLine,
      '',
      '────────────',
      '',
      '🟡  Interviewers 🟡',
      ...interviewerLines,
      '',
      '────────────',
      '',
      '⚪  Spectators ⚪',
      ...spectatorLines,
      '',
      '🧊 You should now join! Please join within **5 minutes**, or your spot will be given to someone else.',
      '🧊 Failure to join on time will result in a **written warning**. :(',
      gameLink ? gameLink : '',
    ].join('\n');
  }

  if (sessionType === 'training') {
    const trainerLines = [];
    for (let i = 0; i < 8; i++) {
      const entry = selected.interviewer[i];
      trainerLines.push(`${i + 1}. ${entry ? `<@${entry.userId}>` : ''}`);
    }

    const spectatorLines = [];
    for (let i = 0; i < 4; i++) {
      const entry = selected.spectator[i];
      spectatorLines.push(`${i + 1}. ${entry ? `<@${entry.userId}>` : ''}`);
    }

    const supervisorLines = [];
    for (let i = 0; i < 4; i++) {
      const entry = selected.supervisor[i];
      supervisorLines.push(`${i + 1}. ${entry ? `<@${entry.userId}>` : ''}`);
    }

    return [
      '╔══════════════════════════════════════╗',
      '                              ✅  SELECTED ATTENDEES ✅',
      '╚══════════════════════════════════════╝',
      '',
      hostLine,
      cohostLine,
      overseerLine,
      '',
      '────────────',
      '',
      '🔵  Supervisors 🔵',
      ...supervisorLines,
      '',
      '────────────',
      '',
      '🔴  Trainers 🔴',
      ...trainerLines,
      '',
      '────────────',
      '',
      '⚪  Spectators ⚪',
      ...spectatorLines,
      '',
      '🧊 You should now join! Please join within **5 minutes**, or your spot will be given to someone else.',
      '🧊 Failure to join on time will result in a **written warning**. :(',
      gameLink ? gameLink : '',
    ].join('\n');
  }

  if (sessionType === 'massshift') {
    const attendeeLines = [];
    for (let i = 0; i < 15; i++) {
      const entry = selected.interviewer[i];
      attendeeLines.push(`${i + 1}. ${entry ? `<@${entry.userId}>` : ''}`);
    }

    return [
      '╔══════════════════════════════════════╗',
      '                              ✅  SELECTED ATTENDEES ✅',
      '╚══════════════════════════════════════╝',
      '',
      hostLine,
      cohostLine,
      overseerLine,
      '',
      '────────────',
      '',
      '🟣  Attendees  🟣',
      ...attendeeLines,
      '',
      '────────────',
      '',
      '🧊 You should now join! Please join within **5 minutes**, or your spot will be given to someone else.',
      '🧊 Failure to join on time will result in a **written warning**. :(',
      gameLink ? gameLink : '',
    ].join('\n');
  }

  return 'Selected attendees.';
}

async function sendAttendeesForQueue(client, queue) {
  if (!queue) return;

  const cfg = getSessionConfig(queue.sessionType) || {};
  const selected = selectAttendees(queue);

  // LIVE "Selected Attendees" post (with pings) → Session Attendees channel or queue channel.
  const liveChannelId = SESSION_ATTENDEES_CHANNEL_ID || queue.channelId;
  const liveChannel = await client.channels.fetch(liveChannelId).catch(() => null);
  if (liveChannel) {
    const content = buildAttendeesContent(queue, selected, queue.sessionType, cfg);
    await liveChannel.send({ content });
  }

  // LOG embed (usernames only, no pings) → SESSION_ATTENDEES_LOG_CHANNEL_ID or same as live.
  const logChannelId = SESSION_ATTENDEES_LOG_CHANNEL_ID || liveChannelId;
  const logChannel = await client.channels.fetch(logChannelId).catch(() => null);
  if (!logChannel) return;

  const sorted = {
    cohost: sortRoleEntries(selected.cohost),
    overseer: sortRoleEntries(selected.overseer),
    supervisor: sortRoleEntries(selected.supervisor),
    interviewer: sortRoleEntries(selected.interviewer),
    spectator: sortRoleEntries(selected.spectator),
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
    supervisorNames,
    interviewerNames,
    spectatorNames,
  ] = await Promise.all([
    usernamesFromEntries(sorted.cohost),
    usernamesFromEntries(sorted.overseer),
    usernamesFromEntries(sorted.supervisor),
    usernamesFromEntries(sorted.interviewer),
    usernamesFromEntries(sorted.spectator),
  ]);

  const fields = [];

  fields.push({
    name: 'Session Info',
    value: [
      queue.sessionType ? `• **Type:** ${queue.sessionType}` : null,
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

  if (queue.sessionType === 'training') {
    fields.push({
      name: 'Supervisors',
      value: supervisorNames.length ? supervisorNames.map((n, i) => `${i + 1}. ${n}`).join('\n') : 'None',
    });
  }

  const roleLabel =
    queue.sessionType === 'training'
      ? 'Trainers'
      : queue.sessionType === 'massshift'
      ? 'Attendees'
      : 'Interviewers';

  fields.push({
    name: roleLabel,
    value: interviewerNames.length ? interviewerNames.map((n, i) => `${i + 1}. ${n}`).join('\n') : 'None',
  });

  fields.push({
    name: 'Spectators',
    value: spectatorNames.length ? spectatorNames.map((n, i) => `${i + 1}. ${n}`).join('\n') : 'None',
    inline: true,
  });

  const now = new Date();
  const loggedAt = now.toLocaleString('en-US', { timeZone: 'America/Toronto' });

  const logEmbed = new EmbedBuilder()
    .setTitle('Session Attendees Logged')
    .setDescription(`Logged at **${loggedAt}**`)
    .addFields(fields)
    .setColor(cfg.color || 0x6cb2eb);

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
