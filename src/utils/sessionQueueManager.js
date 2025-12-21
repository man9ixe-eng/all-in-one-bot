// src/utils/sessionQueueManager.js

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const { QUEUE_CONFIG } = require('../config/sessionAnnouncements');
const {
  TRELLO_BOARD_ID,
  TRELLO_LABEL_INTERVIEW_ID,
  TRELLO_LABEL_TRAINING_ID,
  TRELLO_LABEL_MASS_SHIFT_ID,
} = require('../config/trello');
const { trelloRequest } = require('./trelloClient');

// -------- helpers --------

function getSessionTypeFromCard(card) {
  const labels = Array.isArray(card.idLabels) ? card.idLabels : [];
  const name = (card.name || '').toLowerCase();

  if (TRELLO_LABEL_INTERVIEW_ID && labels.includes(TRELLO_LABEL_INTERVIEW_ID)) {
    return 'interview';
  }
  if (TRELLO_LABEL_TRAINING_ID && labels.includes(TRELLO_LABEL_TRAINING_ID)) {
    return 'training';
  }
  if (TRELLO_LABEL_MASS_SHIFT_ID && labels.includes(TRELLO_LABEL_MASS_SHIFT_ID)) {
    return 'mass_shift';
  }

  if (name.startsWith('[interview]')) return 'interview';
  if (name.startsWith('[training]')) return 'training';
  if (name.startsWith('[mass shift]')) return 'mass_shift';

  return null;
}

// pull card id/shortlink out of a Trello URL
function extractCardIdFromUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    // /c/SHORTID[/slug]
    const idx = parts.indexOf('c');
    if (idx !== -1 && parts[idx + 1]) return parts[idx + 1];
    // fallback: first segment that looks like an id
    for (const p of parts) {
      if (/^[a-zA-Z0-9]{7,}$/.test(p)) return p;
    }
  } catch {
    // not a proper URL? maybe they pasted the short id directly
    if (/^[a-zA-Z0-9]{7,}$/.test(url)) return url;
  }
  return null;
}

function buildQueueEmbed(sessionType, card, hostTag, dueUnix) {
  const trelloUrl = card.shortUrl || card.url || 'N/A';

  const lines = [];

  if (sessionType === 'interview') {
    lines.push('╔══════════════════════════════════════╗');
    lines.push(`                 🟡 INTERVIEW | ${hostTag} | <t:${dueUnix}:t> 🟡`);
    lines.push('╚══════════════════════════════════════╝');
    lines.push('');
    lines.push(`📌  Host: ${hostTag}`);
    lines.push(`📌 Starts: <t:${dueUnix}:R>`);
    lines.push(`📌 Time: <t:${dueUnix}:t>`);
    lines.push('');
    lines.push('💠 ROLES 💠');
    lines.push('----------------------------------------------------------------');
    lines.push('ℹ️  **Co-Host:** Corporate Intern+');
    lines.push('ℹ️  **Overseer:** Executive Manager+');
    lines.push('ℹ️  **Interviewer (12):** Leadership Intern+');
    lines.push('ℹ️  **Spectator (4):** Leadership Intern+');
    lines.push('');
    lines.push('❓  HOW TO JOIN THE QUEUE ❓');
    lines.push('----------------------------------------------------------------');
    lines.push('- Check the role list above — if your rank is allowed, press the role button you want.');
    lines.push('- You’ll get a private message that says: “You have been added to the (ROLE) Queue.”');
    lines.push('- Do NOT join until you are pinged in “Session Attendees” **15 minutes before** the session starts.');
    lines.push('- Line up on the number/role you are selected for on "Session Attendees".');
    lines.push('- You have 5 minutes after the attendees post is made to join.');
    lines.push('');
    lines.push('❓ HOW TO LEAVE THE QUEUE / INFORM LATE ARRIVAL ❓');
    lines.push('----------------------------------------------------------------');
    lines.push('- Click the **Leave Queue** button once you are in the queue.');
    lines.push('- After the attendees list is posted, use **#session-lounge** and ping your host if you need to un-queue.');
    lines.push('- If you do not notify the host within **5 minutes** of the attendees post, you may receive a **Written Warning**, and your spot may be given up.');
    lines.push('----------------------------------------------------------------');
    lines.push('╭─────── 💠 LINKS 💠 ───────────╮');
    lines.push(`〰️ Trello Card: ${trelloUrl}`);
    lines.push('╰─────────────────────────────╯');

    return new EmbedBuilder()
      .setTitle('🟡 Interview Queue')
      .setDescription(lines.join('\n'))
      .setColor(0xf1c40f);
  }

  if (sessionType === 'training') {
    lines.push('╔══════════════════════════════════════╗');
    lines.push(`                 🔴 TRAINING | ${hostTag} | <t:${dueUnix}:t> 🔴`);
    lines.push('╚══════════════════════════════════════╝');
    lines.push('');
    lines.push(`📌  Host: ${hostTag}`);
    lines.push(`📌 Starts: <t:${dueUnix}:R>`);
    lines.push(`📌 Time: <t:${dueUnix}:t>`);
    lines.push('');
    lines.push('💠 ROLES 💠');
    lines.push('----------------------------------------------------------------');
    lines.push('ℹ️  **Co-Host:** Corporate Intern+');
    lines.push('ℹ️  **Overseer:** Executive Manager+');
    lines.push('ℹ️  **Trainer (8):** Leadership Intern+');
    lines.push('ℹ️  **Supervisor (4):** Assistant Manager+');
    lines.push('ℹ️  **Spectator (4):** Leadership Intern+');
    lines.push('');
    lines.push('❓  HOW TO JOIN THE QUEUE ❓');
    lines.push('----------------------------------------------------------------');
    lines.push('- Check the role list above — if your rank is allowed, press the role button you want.');
    lines.push('- You’ll get a private message that says: “You have been added to the (ROLE) Queue.”');
    lines.push('- Do NOT join until you are pinged in “Session Attendees” **15 minutes before** the session starts.');
    lines.push('- Line up on the number/role you are selected for on "Session Attendees".');
    lines.push('- You have 5 minutes after the attendees post is made to join.');
    lines.push('');
    lines.push('❓ HOW TO LEAVE THE QUEUE / INFORM LATE ARRIVAL ❓');
    lines.push('----------------------------------------------------------------');
    lines.push('- Click the **Leave Queue** button once you are in the queue.');
    lines.push('- After the attendees list is posted, use **#session-lounge** and ping your host if you need to un-queue.');
    lines.push('- If you do not notify the host within **5 minutes** of the attendees post, you may receive a **Written Warning**, and your spot may be given up.');
    lines.push('----------------------------------------------------------------');
    lines.push('╭─────── 💠 LINKS 💠 ───────────╮');
    lines.push(`〰️ Trello Card: ${trelloUrl}`);
    lines.push('╰─────────────────────────────╯');

    return new EmbedBuilder()
      .setTitle('🔴 Training Queue')
      .setDescription(lines.join('\n'))
      .setColor(0xe74c3c);
  }

  // mass_shift
  lines.push('╔══════════════════════════════════════╗');
  lines.push(`                 🟣 MASS SHIFT | ${hostTag} | <t:${dueUnix}:t> 🟣`);
  lines.push('╚══════════════════════════════════════╝');
  lines.push('');
  lines.push(`📌  Host: ${hostTag}`);
  lines.push(`📌 Starts: <t:${dueUnix}:R>`);
  lines.push(`📌 Time: <t:${dueUnix}:t>`);
  lines.push('');
  lines.push('💠 ROLES 💠');
  lines.push('----------------------------------------------------------------');
  lines.push('ℹ️  **Co-Host:** Corporate Intern+');
  lines.push('ℹ️  **Overseer:** Executive Manager+');
  lines.push('ℹ️  **Attendee:** Leadership Intern+');
  lines.push('');
  lines.push('❓  HOW TO JOIN THE QUEUE ❓');
  lines.push('----------------------------------------------------------------');
  lines.push('- Check the role list above — if your rank is allowed, press the role button you want.');
  lines.push('- You’ll get a private message that says: “You have been added to the (ROLE) Queue.”');
  lines.push('- Do NOT join until you are pinged in “Session Attendees” **15 minutes before** the session starts.');
  lines.push('- Line up on the number/role you are selected for on "Session Attendees".');
  lines.push('- You have 5 minutes after the attendees post is made to join.');
  lines.push('');
  lines.push('❓ HOW TO LEAVE THE QUEUE / INFORM LATE ARRIVAL ❓');
  lines.push('----------------------------------------------------------------');
  lines.push('- Click the **Leave Queue** button once you are in the queue.');
  lines.push('- After the attendees list is posted, use **#session-lounge** and ping your host if you need to un-queue.');
  lines.push('- If you do not notify the host within **5 minutes** of the attendees post, you may receive a **Written Warning**, and your spot may be given up.');
  lines.push('----------------------------------------------------------------');
  lines.push('╭─────── 💠 LINKS 💠 ───────────╮');
  lines.push(`〰️ Trello Card: ${trelloUrl}`);
  lines.push('╰─────────────────────────────╯');

  return new EmbedBuilder()
    .setTitle('🟣 Mass Shift Queue')
    .setDescription(lines.join('\n'))
    .setColor(0x9b59b6);
}

function buildQueueButtons(sessionType, cardId) {
  const row1 = new ActionRowBuilder();
  const row2 = new ActionRowBuilder();

  // common leave button
  const leaveBtn = new ButtonBuilder()
    .setCustomId(`queue:${sessionType}:leave:${cardId}`)
    .setLabel('Leave Queue')
    .setStyle(ButtonStyle.Danger);

  if (sessionType === 'interview') {
    row1.addComponents(
      new ButtonBuilder()
        .setCustomId(`queue:interview:cohost:${cardId}`)
        .setLabel('Co-Host')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`queue:interview:overseer:${cardId}`)
        .setLabel('Overseer')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`queue:interview:interviewer:${cardId}`)
        .setLabel('Interviewer')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`queue:interview:spectator:${cardId}`)
        .setLabel('Spectator')
        .setStyle(ButtonStyle.Secondary),
    );
    row2.addComponents(leaveBtn);
    return [row1, row2];
  }

  if (sessionType === 'training') {
    row1.addComponents(
      new ButtonBuilder()
        .setCustomId(`queue:training:cohost:${cardId}`)
        .setLabel('Co-Host')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`queue:training:overseer:${cardId}`)
        .setLabel('Overseer')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`queue:training:trainer:${cardId}`)
        .setLabel('Trainer')
        .setStyle(ButtonStyle.Success),
     new ButtonBuilder()
        .setCustomId(`queue:training:supervisor:${cardId}`)
        .setLabel('Supervisor')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`queue:training:spectator:${cardId}`)
        .setLabel('Spectator')
        .setStyle(ButtonStyle.Secondary),
    );
    row2.addComponents(leaveBtn);
    return [row1, row2];
  }

  // mass_shift
  row1.addComponents(
    new ButtonBuilder()
      .setCustomId(`queue:mass_shift:cohost:${cardId}`)
      .setLabel('Co-Host')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`queue:mass_shift:overseer:${cardId}`)
      .setLabel('Overseer')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`queue:mass_shift:attendee:${cardId}`)
      .setLabel('Attendee')
      .setStyle(ButtonStyle.Success),
  );
  row2.addComponents(leaveBtn);
  return [row1, row2];
}

// -------- main entry: /sessionqueue uses this --------

async function openQueueForCard(client, cardUrl, hostTag) {
  if (!TRELLO_BOARD_ID) {
    console.error('[QUEUE] Missing TRELLO_BOARD_ID in config/trello.js');
    return false;
  }

  const cardId = extractCardIdFromUrl(cardUrl);
  if (!cardId) {
    console.error('[QUEUE] Could not parse card id from URL:', cardUrl);
    return false;
  }

  const cardRes = await trelloRequest(`/cards/${cardId}`, 'GET', {
    fields: 'id,name,shortUrl,due,idLabels',
  });

  if (!cardRes.ok || !cardRes.data) {
    console.error('[QUEUE] Failed to fetch card from Trello:', cardRes.status, cardRes.data);
    return false;
  }

  const card = cardRes.data;
  const sessionType = getSessionTypeFromCard(card);

  if (!sessionType) {
    console.error('[QUEUE] Could not detect session type for card:', card.id, card.name);
    return false;
  }

  const cfg = QUEUE_CONFIG[sessionType];
  if (!cfg || !cfg.channelId) {
    console.warn('[QUEUE] Missing channel config for session type:', sessionType);
    return false;
  }

  const channel = await client.channels.fetch(cfg.channelId).catch(() => null);
  if (!channel || !channel.isTextBased || !channel.isTextBased()) {
    console.error('[QUEUE] Queue channel not found or not text-based:', cfg.channelId);
    return false;
  }

  const dueMs = card.due ? new Date(card.due).getTime() : NaN;
  if (Number.isNaN(dueMs)) {
    console.error('[QUEUE] Card has no valid due date:', card.id);
    return false;
  }
  const dueUnix = Math.floor(dueMs / 1000);

  const embed = buildQueueEmbed(sessionType, card, hostTag, dueUnix);
  const components = buildQueueButtons(sessionType, card.id);

  const content = cfg.pingRoleId ? `<@&${cfg.pingRoleId}>` : null;

  await channel.send({
    content,
    embeds: [embed],
    components,
  });

  console.log(
    `[QUEUE] Opened ${sessionType} queue for card ${card.id} in channel ${channel.id}`,
  );
  return true;
}

// -------- button handler --------

async function handleQueueButtonInteraction(interaction) {
  const cid = interaction.customId || '';
  if (!cid.startsWith('queue:')) return false;

  const parts = cid.split(':'); // queue:sessionType:role:cardId
  if (parts.length < 4) {
    await interaction.reply({
      content: 'This queue button is misconfigured.',
      ephemeral: true,
    });
    return true;
  }

  const sessionType = parts[1];
  const role = parts[2];

  // leave
  if (role === 'leave') {
    await interaction.reply({
      content:
        'You have been removed from the queue for this session (logic is simple for now – full priority system will be added later).',
      ephemeral: true,
    });
    return true;
  }

  const prettyRole =
    role === 'cohost'
      ? 'Co-Host'
      : role === 'overseer'
      ? 'Overseer'
      : role === 'interviewer'
      ? 'Interviewer'
      : role === 'trainer'
      ? 'Trainer'
      : role === 'spectator'
      ? 'Spectator'
      : role === 'supervisor'
      ? 'Supervisor'
      : role === 'attendee'
      ? 'Attendee'
      : role;

  await interaction.reply({
    content: `You have been added to the **${prettyRole}** queue for this ${sessionType.replace('_', ' ')} session. (Queue selection logic will prioritize low-session staff later.)`,
    ephemeral: true,
  });

  try {
    await interaction.user.send(
      `You joined the **${prettyRole}** queue for a ${sessionType.replace(
        '_',
        ' ',
      )} session.\nIf you can no longer attend, use the **Leave Queue** button on the session post.`,
    );
  } catch {
    // DMs closed, ignore
  }

  return true;
}

module.exports = {
  openQueueForCard,
  handleQueueButtonInteraction,
};
