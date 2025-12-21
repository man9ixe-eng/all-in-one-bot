// src/commands/sessions/sessionattendees.js

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');
const { trelloRequest } = require('../../utils/trelloClient');
const { buildAttendeesFromQueue } = require('../../utils/sessionQueueManager');

// Same parser as in sessionqueue
function parseTrelloCardId(raw) {
  if (!raw) return null;
  let s = raw.trim();

  const m = s.match(/trello\.com\/c\/([A-Za-z0-9]+)/i);
  if (m) return m[1];

  if (/^[A-Za-z0-9]{8,}$/.test(s)) return s;

  return null;
}

// Get "Host: ..." line from desc and convert to a pretty string
function extractHostFromDesc(desc) {
  if (!desc) return 'Unknown';

  const lines = desc.split('\n');
  const hostLine = lines.find(l => l.toLowerCase().startsWith('host:'));
  if (!hostLine) return 'Unknown';

  // If it contains an ID in parentheses, turn it into a mention
  const idMatch = hostLine.match(/\((\d{10,})\)\s*$/);
  if (idMatch) {
    const id = idMatch[1];
    return `<@${id}>`;
  }

  return hostLine.replace(/^Host:\s*/i, '').trim() || 'Unknown';
}

function detectSessionTypeFromName(name) {
  if (!name) return null;
  const lower = name.toLowerCase();
  if (lower.startsWith('[interview]')) return 'interview';
  if (lower.startsWith('[training]')) return 'training';
  if (lower.startsWith('[mass shift]')) return 'mass_shift';
  return null;
}

function formatList(label, users, count) {
  const lines = [];
  lines.push(label);

  if (!users || users.length === 0) {
    for (let i = 1; i <= count; i++) {
      lines.push(`${i}.`);
    }
    return lines;
  }

  for (let i = 0; i < count; i++) {
    const num = i + 1;
    const userId = users[i];
    if (userId) {
      lines.push(`${num}. <@${userId}>`);
    } else {
      lines.push(`${num}.`);
    }
  }

  return lines;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessionattendees')
    .setDescription('Generate a selected-attendees post from the current queue for a Trello session card.')
    .setDMPermission(false)
    .addStringOption(option =>
      option
        .setName('card')
        .setDescription('Trello card link or id for this session.')
        .setRequired(true),
    ),

  /**
   * /sessionattendees – Tier 4+ (Management and up)
   */
  async execute(interaction) {
    if (!atLeastTier(interaction.member, 4)) {
      return interaction.reply({
        content: 'You must be at least **Tier 4 (Management)** to use `/sessionattendees`.',
        ephemeral: true,
      });
    }

    const raw = interaction.options.getString('card', true);
    const cardId = parseTrelloCardId(raw);

    if (!cardId) {
      return interaction.reply({
        content:
          'I could not parse that as a Trello card.\n' +
          'Please paste a valid card link (like `https://trello.com/c/...`) or a card ID.',
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    // 1) Fetch card
    const cardRes = await trelloRequest(`/cards/${cardId}`, 'GET', {
      fields: 'name,desc,due,shortUrl',
    });

    if (!cardRes.ok || !cardRes.data) {
      return interaction.editReply({
        content:
          'I could not load that Trello card from the API.\n' +
          'Please double-check the link/ID and your Trello credentials.',
      });
    }

    const card = cardRes.data;
    const sessionType = detectSessionTypeFromName(card.name);

    if (!sessionType) {
      return interaction.editReply({
        content:
          'I could not detect the session type from that card.\n' +
          'Make sure the card name starts with `[Interview]`, `[Training]`, or `[Mass Shift]`.',
      });
    }

    // 2) Get attendees data from queue
    const attendees = buildAttendeesFromQueue(card.id);
    if (!attendees) {
      return interaction.editReply({
        content:
          'No active queue data was found for that card.\n' +
          'Make sure you opened the queue with `/sessionqueue` and staff actually joined.',
      });
    }

    const hostDisplay = extractHostFromDesc(card.desc || '');
    const trelloUrl = card.shortUrl || `https://trello.com/c/${card.id}`;

    const dueUnix = card.due ? Math.floor(new Date(card.due).getTime() / 1000) : null;

    let title = '✅ SELECTED ATTENDEES';
    const lines = [
      '╔══════════════════════════════════════╗',
      '                              ✅  SELECTED ATTENDEES ✅',
      '╚══════════════════════════════════════╝',
      '',
      `🧊 **Host:** ${hostDisplay}`,
      '🧊 **Co-Host:**',
      '🧊 **Overseer:**',
      '',
      '────────────',
      '',
    ];

    if (sessionType === 'interview') {
      const interviewers = attendees.roles.interviewer?.users || [];
      const spectators = attendees.roles.spectator?.users || [];

      lines.push(
        '🟡  **Interviewers** 🟡',
        ...formatList('', interviewers, 12).slice(1), // skip the empty label from helper
        '',
        '────────────',
        '',
        '⚪  **Spectators** ⚪',
        ...formatList('', spectators, 4).slice(1),
      );
    } else if (sessionType === 'training') {
      const trainers = attendees.roles.trainer?.users || [];
      const supervisors = attendees.roles.supervisor?.users || [];
      const spectators = attendees.roles.spectator?.users || [];

      lines.push(
        '🔴  **Trainers** 🔴',
        ...formatList('', trainers, 8).slice(1),
        '',
        '────────────',
        '',
        '🟡  **Supervisors** 🟡',
        ...formatList('', supervisors, 4).slice(1),
        '',
        '────────────',
        '',
        '⚪  **Spectators** ⚪',
        ...formatList('', spectators, 4).slice(1),
      );
    } else if (sessionType === 'mass_shift') {
      const attendeesList = attendees.roles.attendee?.users || [];

      lines.push(
        '🟣  **Attendees**  🟣',
        ...formatList('', attendeesList, 15).slice(1),
      );
    }

    lines.push(
      '',
      '🧊 You should now join! Please join within **5 minutes**, or your spot may be given to someone else.',
      '🧊 Failure to join on time may result in a **written warning**. :(',
      '',
      '╭─────── 💠 LINKS 💠 ───────────╮',
      `〰️ **Trello Card:** ${trelloUrl}`,
      '╰─────────────────────────────╯',
    );

    const embed = new EmbedBuilder()
      .setColor(0x87CEFA)
      .setTitle(title)
      .setDescription(lines.join('\n'));

    await interaction.channel.send({ embeds: [embed] });

    return interaction.editReply({
      content: '✅ Attendees post has been created in this channel.',
    });
  },
};
