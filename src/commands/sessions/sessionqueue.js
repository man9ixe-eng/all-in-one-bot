// src/commands/sessions/sessionqueue.js

const { SlashCommandBuilder } = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');
const { trelloRequest } = require('../../utils/trelloClient');
const { openQueueForCard } = require('../../utils/sessionQueueManager');

// Parse Trello card ID from a URL or raw id
function parseTrelloCardId(raw) {
  if (!raw) return null;
  let s = raw.trim();

  // Full URL like https://trello.com/c/ABCDE123/...
  const m = s.match(/trello\.com\/c\/([A-Za-z0-9]+)/i);
  if (m) return m[1];

  // If it's just an ID-looking string
  if (/^[A-Za-z0-9]{8,}$/.test(s)) return s;

  return null;
}

// Detect session type from card name
function detectSessionTypeFromName(name) {
  if (!name) return null;
  const lower = name.toLowerCase();
  if (lower.startsWith('[interview]')) return 'interview';
  if (lower.startsWith('[training]')) return 'training';
  if (lower.startsWith('[mass shift]')) return 'mass_shift';
  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessionqueue')
    .setDescription('Open a queue post for a Trello session card.')
    .setDMPermission(false)
    .addStringOption(option =>
      option
        .setName('card')
        .setDescription('Trello card link or id for this session.')
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

    const cardRaw = interaction.options.getString('card', true);

    const cardId = parseTrelloCardId(cardRaw);
    if (!cardId) {
      return interaction.reply({
        content:
          'I could not parse that as a Trello card.\n' +
          'Please paste a valid card link (like `https://trello.com/c/...`) or a card ID.',
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    // Fetch card from Trello
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

    const ok = await openQueueForCard(interaction, card, sessionType);
    if (!ok) {
      return interaction.editReply({
        content:
          'I could not open a queue for that Trello card.\n' +
          '• Make sure the link is valid\n' +
          '• The card name starts with [Interview], [Training] or [Mass Shift]\n',
      });
    }

    return interaction.editReply({
      content: '✅ Queue opened in this channel for that session.',
    });
  },
};
