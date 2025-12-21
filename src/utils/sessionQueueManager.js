// src/utils/sessionQueueManager.js

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');
const { trelloRequest } = require('./trelloClient');

// Fallback to SESSION_* notice channels/roles if dedicated QUEUE_* vars are not set
const {
  QUEUE_INTERVIEW_CHANNEL_ID,
  QUEUE_TRAINING_CHANNEL_ID,
  QUEUE_MASS_SHIFT_CHANNEL_ID,
  QUEUE_INTERVIEW_PING_ROLE_ID,
  QUEUE_TRAINING_PING_ROLE_ID,
  QUEUE_MASS_SHIFT_PING_ROLE_ID,

  SESSION_INTERVIEW_NOTICE_CHANNEL_ID,
  SESSION_TRAINING_NOTICE_CHANNEL_ID,
  SESSION_MASS_SHIFT_NOTICE_CHANNEL_ID,
  SESSION_INTERVIEW_PING_ROLE_ID,
  SESSION_TRAINING_PING_ROLE_ID,
  SESSION_MASS_SHIFT_PING_ROLE_ID,
} = process.env;

function getSessionTypeFromCard(card) {
  const name = (card.name || '').toLowerCase();

  if (name.includes('[interview]')) return 'interview';
  if (name.includes('[training]')) return 'training';
  if (name.includes('[mass shift]') || name.includes('[massshift]')) return 'mass_shift';

  return null;
}

function getQueueConfigForType(sessionType) {
  switch (sessionType) {
    case 'interview':
      return {
        channelId:
          QUEUE_INTERVIEW_CHANNEL_ID || SESSION_INTERVIEW_NOTICE_CHANNEL_ID,
        pingRoleId:
          QUEUE_INTERVIEW_PING_ROLE_ID || SESSION_INTERVIEW_PING_ROLE_ID,
        header: '🟡 INTERVIEW | HOST | TIME 🟡',
        color: 0xf1c40f,
        rolesBlock: [
          'ℹ️  **Co-Host:** Corporate Intern+',
          'ℹ️  **Overseer:** Executive Manager+',
          'ℹ️  **Interviewer (12):** Leadership Intern+',
          'ℹ️  **Spectator (4):** Leadership Intern+',
        ].join('\n'),
      };

    case 'training':
      return {
        channelId:
          QUEUE_TRAINING_CHANNEL_ID || SESSION_TRAINING_NOTICE_CHANNEL_ID,
        pingRoleId:
          QUEUE_TRAINING_PING_ROLE_ID || SESSION_TRAINING_PING_ROLE_ID,
        header: '🔴  TRAINING | HOST | TIME  🔴',
        color: 0xe74c3c,
        // Supervisor (4) added here
        rolesBlock: [
          'ℹ️  **Co-Host:** Corporate Intern+',
          'ℹ️  **Overseer:** Executive Manager+',
          'ℹ️  **Supervisor (4):** Leadership Intern+',
          'ℹ️  **Trainer (8):** Leadership Intern+',
          'ℹ️  **Spectator (4):** Leadership Intern+',
        ].join('\n'),
      };

    case 'mass_shift':
      return {
        channelId:
          QUEUE_MASS_SHIFT_CHANNEL_ID || SESSION_MASS_SHIFT_NOTICE_CHANNEL_ID,
        pingRoleId:
          QUEUE_MASS_SHIFT_PING_ROLE_ID || SESSION_MASS_SHIFT_PING_ROLE_ID,
        header: '🟣  MASS SHIFT | HOST | TIME  🟣',
        color: 0x9b59b6,
        rolesBlock: [
          'ℹ️  **Co-Host:** Corporate Intern+',
          'ℹ️  **Overseer:** Executive Manager+',
          'ℹ️  **Attendee:** Leadership Intern+',
        ].join('\n'),
      };

    default:
      return null;
  }
}

function extractHostFromDesc(desc) {
  if (!desc) return 'Unknown';

  const lines = desc.split('\n');
  const hostLine = lines.find((line) =>
    line.toLowerCase().startsWith('host:'),
  );
  if (!hostLine) return 'Unknown';

  const raw = hostLine.split(':').slice(1).join(':').trim();
  return raw || 'Unknown';
}

function getUnixFromDue(dueISO) {
  if (!dueISO) return null;
  const ms = Date.parse(dueISO);
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 1000);
}

async function openQueueForCard(client, { cardId, trelloUrl }) {
  if (!cardId) {
    console.log('[QUEUE] No cardId passed into openQueueForCard');
    return false;
  }

  // 1) Load card from Trello
  const cardRes = await trelloRequest(`/cards/${cardId}`, 'GET', {
    fields: 'name,due,desc',
  });

  if (!cardRes.ok || !cardRes.data) {
    console.error(
      '[QUEUE] Failed to fetch Trello card for queue:',
      cardId,
      cardRes.status,
      cardRes.data,
    );
    return false;
  }

  const card = cardRes.data;

  // 2) Determine session type
  const sessionType = getSessionTypeFromCard(card);
  if (!sessionType) {
    console.log(
      '[QUEUE] Could not determine session type from card name:',
      card.name,
    );
    return false;
  }

  // 3) Resolve config (channel, ping role, text)
  const cfg = getQueueConfigForType(sessionType);
  if (!cfg || !cfg.channelId) {
    console.log('[QUEUE] Missing channel config for session type:', sessionType);
    return false;
  }

  const channel = await client.channels.fetch(cfg.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    console.log(
      '[QUEUE] Could not find text channel for queue, id:',
      cfg.channelId,
    );
    return false;
  }

  const hostDisplay = extractHostFromDesc(card.desc);
  const dueUnix = getUnixFromDue(card.due);
  const startsRelative = dueUnix ? `<t:${dueUnix}:R>` : '`Unknown`';
  const startsTime = dueUnix ? `<t:${dueUnix}:t>` : '`Unknown`';

  // 4) Build embed description with your layout
  const descriptionLines = [
    '╔══════════════════════════════════════╗',
    `                         ${cfg.header}`,
    '╚══════════════════════════════════════╝',
    '',
    `📌  **Host:** ${hostDisplay}`,
    `📌 **Starts:** ${startsRelative}`,
    `📌 **Time:** ${startsTime}`,
    '',
    '💠 ROLES 💠',
    '----------------------------------------------------------------',
    cfg.rolesBlock,
    '',
    '❓  HOW TO JOIN THE QUEUE ❓',
    '----------------------------------------------------------------',
    '- Check the role list above — if your rank is allowed, press the role button you want.',
    '- You’ll get a private message that says: “You have been added to the (ROLE) Queue.”',
    '- Do NOT join until you are pinged in “Session Attendees” **15 minutes before** the session starts.',
    '- Line up on the number/role you are selected for on "Session Attendees".',
    '- You have 5 minutes after session attendees is posted to join.',
    '',
    '❓ HOW TO LEAVE THE QUEUE / INFORM LATE ARRIVAL ❓',
    '----------------------------------------------------------------',
    '- Click the "Leave Que" button, which will show up once you join the que.',
    '- You can only leave the que BEFORE the session list is posted; after that, go to `#session-lounge` and ping your host.',
    '- If you do not let the host know anything before **5 mins** after an attendees post is made,',
    '  you will be given a **Written Warning**, and your spot may be given up.',
    '----------------------------------------------------------------',
    '╭─────── 💠 LINKS 💠 ───────────╮',
    `〰️ **Trello Card:** ${trelloUrl || `https://trello.com/c/${card.id}`}`,
    '╰─────────────────────────────╯',
  ];

  const embed = new EmbedBuilder()
    .setDescription(descriptionLines.join('\n'))
    .setColor(cfg.color);

  // 5) Components (buttons)
  const components = [];

  if (sessionType === 'interview') {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`queue:cohost:${card.id}`)
          .setLabel('Co-Host')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`queue:overseer:${card.id}`)
          .setLabel('Overseer')
          .setStyle(ButtonStyle.Primary),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`queue:interviewer:${card.id}`)
          .setLabel('Interviewer')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`queue:spectator:${card.id}`)
          .setLabel('Spectator')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`queue:leave:${card.id}`)
          .setLabel('Leave Que')
          .setStyle(ButtonStyle.Danger),
      ),
    );
  } else if (sessionType === 'training') {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`queue:cohost:${card.id}`)
          .setLabel('Co-Host')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`queue:overseer:${card.id}`)
          .setLabel('Overseer')
          .setStyle(ButtonStyle.Primary),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`queue:supervisor:${card.id}`)
          .setLabel('Supervisor')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`queue:trainer:${card.id}`)
          .setLabel('Trainer')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`queue:spectator:${card.id}`)
          .setLabel('Spectator')
          .setStyle(ButtonStyle.Secondary),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`queue:leave:${card.id}`)
          .setLabel('Leave Que')
          .setStyle(ButtonStyle.Danger),
      ),
    );
  } else if (sessionType === 'mass_shift') {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`queue:cohost:${card.id}`)
          .setLabel('Co-Host')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`queue:overseer:${card.id}`)
          .setLabel('Overseer')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`queue:attendee:${card.id}`)
          .setLabel('Attendee')
          .setStyle(ButtonStyle.Success),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`queue:leave:${card.id}`)
          .setLabel('Leave Que')
          .setStyle(ButtonStyle.Danger),
      ),
    );
  }

  const content = cfg.pingRoleId ? `<@&${cfg.pingRoleId}>` : undefined;

  const msg = await channel.send({
    content,
    embeds: [embed],
    components,
  });

  console.log(
    '[QUEUE] Posted queue message for card',
    card.id,
    'in channel',
    channel.id,
    'msg',
    msg.id,
  );

  return true;
}

// Button handler – placeholder so nothing explodes when clicked
async function handleQueueButtonInteraction(interaction) {
  if (!interaction.isButton()) return false;

  const customId = interaction.customId || '';
  if (!customId.startsWith('queue:')) return false;

  const parts = customId.split(':'); // queue:<roleKey>:<cardId>
  const roleKey = parts[1] || 'unknown';
  const cardId = parts[2] || 'unknown';

  await interaction.reply({
    content:
      `Queue buttons are wired, but the full claim logic isn't live yet.\n` +
      `You clicked **${roleKey}** for card \`${cardId}\`.`,
    ephemeral: true,
  });

  return true;
}

module.exports = {
  openQueueForCard,
  handleQueueButtonInteraction,
};
