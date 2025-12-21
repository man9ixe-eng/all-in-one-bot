// src/commands/sessions/sessionqueue.js
const { SlashCommandBuilder } = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');
const { trelloRequest } = require('../../utils/trelloClient');
const { openQueueForCard } = require('../../utils/sessionQueueManager');

// Extract Trello card id / shortLink from a URL or raw id
function parseCardId(raw) {
  if (!raw) return null;
  const input = raw.trim();

  // Full URL cases:
  // https://trello.com/c/SHORT/...
  // https://trello.com/card/SHORT/...
  const match = input.match(/trello\.com\/[c|card]+\/([a-zA-Z0-9]+)/);
  if (match && match[1]) {
    return match[1];
  }

  // If it's just the short id (8+ chars)
  if (/^[a-zA-Z0-9]{8,}$/.test(input)) {
    return input;
  }

  return null;
}

function detectSessionTypeFromCard(card) {
  const name = (card.name || '').toLowerCase();

  if (name.startsWith('[interview]')) return 'interview';
  if (name.startsWith('[training]')) return 'training';
  if (name.startsWith('[mass shift]')) return 'mass_shift';

  if (Array.isArray(card.labels)) {
    const labelNames = card.labels
      .map(l => (l.name || '').toLowerCase());

    if (labelNames.some(n => n.includes('interview'))) return 'interview';
    if (labelNames.some(n => n.includes('training'))) return 'training';
    if (labelNames.some(n => n.includes('mass'))) return 'mass_shift';
  }

  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessionqueue')
    .setDescription('Open a queue for a Trello session card.')
    .setDMPermission(false)
    .addStringOption(option =>
      option
        .setName('card')
        .setDescription('Trello card link or short URL for the session.')
        .setRequired(true),
    ),

  /**
   * /sessionqueue – Tier 4+ (Management and up)
   */
  async execute(interaction) {
    if (!atLeastTier(interaction.member, 4)) {
      return interaction.reply({
        content: 'You must be at least **Tier 4 (Management)** to use `/sessionqueue`.',
        ephemeral: true,
      });
    }

    const rawCard = interaction.options.getString('card', true);
    const cardId = parseCardId(rawCard);

    if (!cardId) {
      return interaction.reply({
        content:
          'I could not parse a Trello card from that.\n' +
          'Please provide either:\n' +
          '• A full Trello card link (e.g. `https://trello.com/c/AbCdEf12/...`)\n' +
          '• Or the short card id (e.g. `AbCdEf12`)',
        ephemeral: true,
      });
    }

    // Load card from Trello
    const cardRes = await trelloRequest(`/cards/${cardId}`, 'GET', {
      fields: 'name,desc,due,labels,url,shortUrl',
      label_fields: 'name,color',
    });

    if (!cardRes.ok || !cardRes.data) {
      console.error('[QUEUE] Failed to fetch Trello card for queue:', cardId, cardRes.status, cardRes.data);
      return interaction.reply({
        content:
          'I could not open a queue for that Trello card.\n' +
          '• Make sure the link is valid\n' +
          '• The card has the correct session labels or `[Interview]`, `[Training]`, `[Mass Shift]` in the name\n' +
          '• The queue channels/roles are configured in `QUEUE_*` env vars.',
        ephemeral: true,
      });
    }

    const card = cardRes.data;
    const sessionType = detectSessionTypeFromCard(card);

    if (!sessionType) {
      return interaction.reply({
        content:
          'I could not detect the session type from that Trello card.\n' +
          'Make sure the card name starts with `[Interview]`, `[Training]`, or `[Mass Shift]` ' +
          'or has the correct labels on Trello.',
        ephemeral: true,
      });
    }

    if (!card.due) {
      return interaction.reply({
        content:
          'That Trello card does not have a due date/time set.\n' +
          'Please add a due date on Trello before opening a queue.',
        ephemeral: true,
      });
    }

    const trelloUrl = card.url || card.shortUrl || rawCard;

    const result = await openQueueForCard(interaction.client, {
      cardId,
      sessionType,
      trelloUrl,
      dueISO: card.due,
      hostTag: interaction.user.tag,
      hostId: interaction.user.id,
    });

    if (!result.ok) {
      if (result.reason === 'missing_channel' || result.reason === 'bad_channel') {
        return interaction.reply({
          content:
            'I could not open a queue for that Trello card.\n' +
            '• Make sure the link is valid\n' +
            '• The card has the correct session labels or `[Interview]`, `[Training]`, `[Mass Shift]` in the name\n' +
            '• The queue channels/roles are configured in `QUEUE_*` env vars.',
          ephemeral: true,
        });
      }

      return interaction.reply({
        content:
          'I could not open a queue for that Trello card due to an internal error.\n' +
          'Please check the logs or your configuration and try again.',
        ephemeral: true,
      });
    }

    return interaction.reply({
      content: '✅ Queue opened for that session. The queue + attendees skeleton have been posted.',
      ephemeral: true,
    });
  },
};
