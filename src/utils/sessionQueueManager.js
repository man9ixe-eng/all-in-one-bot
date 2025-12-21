// src/utils/sessionQueueManager.js
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const {
  initQueueState,
  getQueueState,
  addToQueue,
  removeFromQueue,
  setClosed,
} = require('./sessionQueueStore');

// Read queue-related config directly from env to avoid touching other configs
const {
  QUEUE_INTERVIEW_CHANNEL_ID,
  QUEUE_INTERVIEW_ATTENDEES_CHANNEL_ID,
  QUEUE_INTERVIEW_PING_ROLE_ID,

  QUEUE_TRAINING_CHANNEL_ID,
  QUEUE_TRAINING_ATTENDEES_CHANNEL_ID,
  QUEUE_TRAINING_PING_ROLE_ID,

  QUEUE_MASS_SHIFT_CHANNEL_ID,
  QUEUE_MASS_SHIFT_ATTENDEES_CHANNEL_ID,
  QUEUE_MASS_SHIFT_PING_ROLE_ID,
} = process.env;

// Per-session-type config: title emoji + roles + caps
const QUEUE_CONFIG = {
  interview: {
    label: 'Interview',
    emoji: '🟡',
    queueChannelId: QUEUE_INTERVIEW_CHANNEL_ID,
    attendeesChannelId: QUEUE_INTERVIEW_ATTENDEES_CHANNEL_ID,
    pingRoleId: QUEUE_INTERVIEW_PING_ROLE_ID,
    roles: {
      cohost: { label: 'Co-Host', max: 1 },
      overseer: { label: 'Overseer', max: 1 },
      interviewer: { label: 'Interviewer', max: 12 },
      spectator: { label: 'Spectator', max: 4 },
    },
  },
  training: {
    label: 'Training',
    emoji: '🔴',
    queueChannelId: QUEUE_TRAINING_CHANNEL_ID,
    attendeesChannelId: QUEUE_TRAINING_ATTENDEES_CHANNEL_ID,
    pingRoleId: QUEUE_TRAINING_PING_ROLE_ID,
    roles: {
      cohost: { label: 'Co-Host', max: 1 },
      overseer: { label: 'Overseer', max: 1 },
      supervisor: { label: 'Supervisor', max: 4 }, // per your note
      trainer: { label: 'Trainer', max: 8 },
      spectator: { label: 'Spectator', max: 4 },
    },
  },
  mass_shift: {
    label: 'Mass Shift',
    emoji: '🟣',
    queueChannelId: QUEUE_MASS_SHIFT_CHANNEL_ID,
    attendeesChannelId: QUEUE_MASS_SHIFT_ATTENDEES_CHANNEL_ID,
    pingRoleId: QUEUE_MASS_SHIFT_PING_ROLE_ID,
    roles: {
      cohost: { label: 'Co-Host', max: 1 },
      overseer: { label: 'Overseer', max: 1 },
      attendee: { label: 'Attendee', max: 15 },
    },
  },
};

function getQueueConfig(sessionType) {
  return QUEUE_CONFIG[sessionType] || null;
}

function toUnix(dueISO) {
  if (!dueISO) return null;
  const t = new Date(dueISO).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor(t / 1000);
}

/**
 * Build the queue embed text block for each session type
 */
function buildQueueDescription(sessionType, hostId, dueISO, trelloUrl) {
  const cfg = getQueueConfig(sessionType);
  const unix = toUnix(dueISO);
  const rel = unix ? `<t:${unix}:R>` : 'N/A';
  const timeShort = unix ? `<t:${unix}:t>` : 'N/A';
  const hostMention = hostId ? `<@${hostId}>` : 'TBA';

  if (sessionType === 'interview') {
    return `╔══════════════════════════════════════╗
🟡 INTERVIEW | ${hostMention} | ${timeShort} 🟡
╚══════════════════════════════════════╝

📌 Host: ${hostMention}
📌 Starts: ${rel}
📌 Time: ${timeShort}

💠 ROLES 💠
----------------------------------------------------------------
ℹ️ **Co-Host:** Corporate Intern+
ℹ️ **Overseer:** Executive Manager+
ℹ️ **Interviewer (12):** Leadership Intern+
ℹ️ **Spectator (4):** Leadership Intern+

❓ HOW TO JOIN THE QUEUE ❓
----------------------------------------------------------------
- Check the role list above — if your rank is allowed, press the role button you want.
- You’ll get a private message that says: "You have been added to the (ROLE) Queue."
- Do NOT join until you are pinged in "Session Attendees" **15 minutes before** the session starts.
- Line up on the number/role you are selected for on "Session Attendees".
- You have 5 minutes after the attendees post is made to join.

❓ HOW TO LEAVE THE QUEUE / INFORM LATE ARRIVAL ❓
----------------------------------------------------------------
- Click the **Leave Queue** button once you have joined a role.
- After the attendees post is made, changes must be handled by the host/corporate manually.
----------------------------------------------------------------
╭─────── 💠 LINKS 💠 ───────────╮
〰️ **Trello Card:** ${trelloUrl}
╰─────────────────────────────╯

@🔔 Interview Session Pings`;
  }

  if (sessionType === 'training') {
    return `╔══════════════════════════════════════╗
🔴 TRAINING | ${hostMention} | ${timeShort} 🔴
╚══════════════════════════════════════╝

📌 Host: ${hostMention}
📌 Starts: ${rel}
📌 Time: ${timeShort}

💠 ROLES 💠
----------------------------------------------------------------
ℹ️ **Co-Host:** Corporate Intern+
ℹ️ **Overseer:** Executive Manager+
ℹ️ **Supervisor (4):** Supervisor+
ℹ️ **Trainer (8):** Leadership Intern+
ℹ️ **Spectator (4):** Leadership Intern+

❓ HOW TO JOIN THE QUEUE ❓
----------------------------------------------------------------
- Check the role list above — if your rank is allowed, press the role button you want.
- You’ll get a private message that says: "You have been added to the (ROLE) Queue."
- Do NOT join until you are pinged in "Session Attendees" **15 minutes before** the session starts.
- Line up on the number/role you are selected for on "Session Attendees".
- You have 5 minutes after the attendees post is made to join.

❓ HOW TO LEAVE THE QUEUE / INFORM LATE ARRIVAL ❓
----------------------------------------------------------------
- Click the **Leave Queue** button once you have joined a role.
- After the attendees post is made, changes must be handled by the host/corporate manually.
----------------------------------------------------------------
╭─────── 💠 LINKS 💠 ───────────╮
〰️ **Trello Card:** ${trelloUrl}
╰─────────────────────────────╯

@🔴 Training Session Pings`;
  }

  // mass_shift
  return `╔══════════════════════════════════════╗
🟣 MASS SHIFT | ${hostMention} | ${timeShort} 🟣
╚══════════════════════════════════════╝

📌 Host: ${hostMention}
📌 Starts: ${rel}
📌 Time: ${timeShort}

💠 ROLES 💠
----------------------------------------------------------------
ℹ️ **Co-Host:** Corporate Intern+
ℹ️ **Overseer:** Executive Manager+
ℹ️ **Attendee (15):** Leadership Intern+

❓ HOW TO JOIN THE QUEUE ❓
----------------------------------------------------------------
- Check the role list above — if your rank is allowed, press the role button you want.
- You’ll get a private message that says: "You have been added to the (ROLE) Queue."
- Do NOT join until you are pinged in "Session Attendees" **15 minutes before** the session starts.
- Line up on the number/role you are selected for on "Session Attendees".
- You have 5 minutes after the attendees post is made to join.

❓ HOW TO LEAVE THE QUEUE / INFORM LATE ARRIVAL ❓
----------------------------------------------------------------
- Click the **Leave Queue** button once you have joined a role.
- After the attendees post is made, changes must be handled by the host/corporate manually.
----------------------------------------------------------------
╭─────── 💠 LINKS 💠 ───────────╮
〰️ **Trello Card:** ${trelloUrl}
╰─────────────────────────────╯

@🟣 Mass Shift Pings`;
}

/**
 * Attendees skeleton (plain message so pings work)
 */
function buildAttendeesSkeleton(sessionType, hostId, trelloUrl, pingRoleId) {
  const hostMention = hostId ? `<@${hostId}>` : 'TBA';
  const ping = pingRoleId ? `<@&${pingRoleId}>` : '';

  if (sessionType === 'interview') {
    return `╔══════════════════════════════════════╗
                              ✅  SELECTED ATTENDEES ✅
╚══════════════════════════════════════╝

🧊 Host: ${hostMention}
🧊 Co-Host:
🧊 Overseer:

────────────

🟡  Interviewers 🟡
1.
2.
3.
4.
5.
6.
7.
8.
9.
10.
11.
12.

────────────

⚪  Spectators ⚪
1.
2.
3.
4.

🧊 You should now join! Please join within **5 minutes**, or your spot will be given to someone else.
🧊 Failure to join on time will result in a **written warning**. :(

╭─────── 💠 LINKS 💠 ───────────╮
〰️ Trello Card: ${trelloUrl}
╰─────────────────────────────╯

${ping}`.trim();
  }

  if (sessionType === 'training') {
    return `╔══════════════════════════════════════╗
                              ✅  SELECTED ATTENDEES ✅
╚══════════════════════════════════════╝

🧊 Host: ${hostMention}
🧊 Co-Host:
🧊 Overseer:

────────────

🟠  Supervisors 🟠
1.
2.
3.
4.

────────────

🔴  Trainers 🔴 
1.
2.
3.
4.
5.
6.
7.
8.

────────────

⚪  Spectators ⚪
1.
2.
3.
4.

🧊 You should now join! Please join within **5 minutes**, or your spot will be given to someone else.
🧊 Failure to join on time will result in a **written warning**. :(

╭─────── 💠 LINKS 💠 ───────────╮
〰️ Trello Card: ${trelloUrl}
╰─────────────────────────────╯

${ping}`.trim();
  }

  // mass_shift
  return `╔══════════════════════════════════════╗
                              ✅  SELECTED ATTENDEES ✅
╚══════════════════════════════════════╝

🧊 Host: ${hostMention}
🧊 Co-Host:
🧊 Overseer:

────────────

🟣  Attendees  🟣  
1.
2.
3.
4.
5.
6.
7.
8.
9.
10.
11.
12.
13.
14.
15.

🧊 You should now join! Please join within **5 minutes**, or your spot will be given to someone else.
🧊 Failure to join on time will result in a **written warning**. :(

╭─────── 💠 LINKS 💠 ───────────╮
〰️ Trello Card: ${trelloUrl}
╰─────────────────────────────╯

${ping}`.trim();
}

/**
 * Build role + leave buttons for this card
 */
function buildQueueComponents(cardId, sessionType) {
  const cfg = getQueueConfig(sessionType);
  if (!cfg) return [];

  const roleButtons = [];

  for (const [key, roleCfg] of Object.entries(cfg.roles)) {
    roleButtons.push(
      new ButtonBuilder()
        .setCustomId(`queue:${cardId}:${key}`)
        .setLabel(roleCfg.label)
        .setStyle(ButtonStyle.Primary),
    );
  }

  const rows = [];
  if (roleButtons.length > 0) {
    const row = new ActionRowBuilder();
    for (const btn of roleButtons) {
      row.addComponents(btn);
    }
    rows.push(row);
  }

  const leaveRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`queue:${cardId}:leave`)
      .setLabel('Leave Queue')
      .setStyle(ButtonStyle.Secondary),
  );
  rows.push(leaveRow);

  return rows;
}

/**
 * Called by /sessionqueue – posts queue embed + attendees skeleton,
 * initializes queue store.
 */
async function openQueueForCard(client, {
  cardId,
  sessionType,
  trelloUrl,
  dueISO,
  hostTag,
  hostId,
}) {
  const cfg = getQueueConfig(sessionType);
  if (!cfg) {
    console.warn('[QUEUE] Unsupported session type:', sessionType);
    return { ok: false, reason: 'unsupported_type' };
  }

  if (!cfg.queueChannelId || !cfg.attendeesChannelId) {
    console.warn('[QUEUE] Missing channel config for session type:', sessionType);
    return { ok: false, reason: 'missing_channel' };
  }

  const queueChannel = await client.channels.fetch(cfg.queueChannelId).catch(() => null);
  const attendeesChannel = await client.channels.fetch(cfg.attendeesChannelId).catch(() => null);

  if (!queueChannel || !attendeesChannel) {
    console.warn('[QUEUE] Could not fetch queue/attendees channel for type:', sessionType);
    return { ok: false, reason: 'bad_channel' };
  }

  const desc = buildQueueDescription(sessionType, hostId, dueISO, trelloUrl);
  const embed = new EmbedBuilder()
    .setDescription(desc)
    .setColor(0x2b2d31); // neutral dark

  const components = buildQueueComponents(cardId, sessionType);

  // Ping outside the embed so it actually notifies
  const queueContent = cfg.pingRoleId ? `<@&${cfg.pingRoleId}>` : null;

  const queueMessage = await queueChannel.send({
    content: queueContent,
    embeds: [embed],
    components,
  });

  const attendeesText = buildAttendeesSkeleton(
    sessionType,
    hostId,
    trelloUrl,
    cfg.pingRoleId,
  );

  const attendeesMessage = await attendeesChannel.send({
    content: attendeesText,
  });

  const roleKeys = Object.keys(cfg.roles);

  initQueueState(
    cardId,
    sessionType,
    queueChannel.id,
    queueMessage.id,
    attendeesChannel.id,
    attendeesMessage.id,
    roleKeys,
    {
      trelloUrl,
      dueISO,
      hostTag,
      hostId,
    },
  );

  console.log('[QUEUE] Opened queue for card', cardId, 'type:', sessionType);

  return { ok: true };
}

/**
 * Handle button clicks for join / leave
 */
async function handleQueueButtonInteraction(interaction) {
  if (!interaction.isButton()) return false;

  const customId = interaction.customId || '';
  if (!customId.startsWith('queue:')) return false;

  const parts = customId.split(':');
  if (parts.length < 3) return false;

  const cardId = parts[1];
  const action = parts[2];

  await interaction.deferReply({ ephemeral: true });

  try {
    const state = getQueueState(cardId);
    if (!state) {
      await interaction.editReply('That queue is no longer active or could not be found.');
      return true;
    }

    if (state.closed) {
      await interaction.editReply('This queue is closed. Please check the attendees post for final spots.');
      return true;
    }

    const cfg = getQueueConfig(state.sessionType);
    if (!cfg) {
      await interaction.editReply('This queue is misconfigured for this session type.');
      return true;
    }

    const userId = interaction.user.id;

    if (action === 'leave') {
      const res = removeFromQueue(cardId, userId);
      if (!res.ok) {
        if (res.code === 'notFound') {
          await interaction.editReply('You are not currently in this queue.');
        } else {
          await interaction.editReply('This queue is no longer active.');
        }
        return true;
      }

      await interaction.editReply('You have been removed from the queue.');
      return true;
    }

    const roleCfg = cfg.roles[action];
    if (!roleCfg) {
      await interaction.editReply('That queue role is not valid anymore.');
      return true;
    }

    const addRes = addToQueue(cardId, action, userId, roleCfg.max);
    if (!addRes.ok) {
      if (addRes.code === 'full') {
        await interaction.editReply(`The **${roleCfg.label}** queue is already full for this ${cfg.label}.`);
      } else if (addRes.code === 'already') {
        await interaction.editReply(`You are already in the **${roleCfg.label}** queue for this ${cfg.label}.`);
      } else if (addRes.code === 'closed') {
        await interaction.editReply('This queue is closed. Please check the attendees post for final spots.');
      } else {
        await interaction.editReply('Could not add you to that queue. Please try again in a moment.');
      }
      return true;
    }

    await interaction.editReply(
      `You have been added to the **${roleCfg.label}** queue for this ${cfg.label}.`,
    );

    // Later we will update the attendees message + Hyra logic here.
    return true;
  } catch (err) {
    console.error('[QUEUE] Error while processing button interaction:', err);
    try {
      await interaction.editReply('There was an error while processing that queue action.');
    } catch {
      // ignore
    }
    return true;
  }
}

module.exports = {
  openQueueForCard,
  handleQueueButtonInteraction,
  setClosed, // exported for future /lockqueue etc.
};
