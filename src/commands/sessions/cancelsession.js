// src/commands/sessions/cancelsession.js

const { SlashCommandBuilder } = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');
const { cancelSessionCard } = require('../../utils/trelloClient');
const { deleteSessionAnnouncement } = require('../../utils/sessionAutomation');
const { logModerationAction } = require('../../utils/modlog');

// Extract a Trello card ID/shortID from a raw string or URL
function extractCardId(input) {
  if (!input) return null;
  const trimmed = input.trim();

  // URL like https://trello.com/c/abcd1234/...
  const urlMatch = trimmed.match(/trello\.com\/c\/([A-Za-z0-9]+)/i);
  if (urlMatch) return urlMatch[1];

  // Fallback: grab a 8–24 char alphanumeric chunk
  const idMatch = trimmed.match(/([A-Za-z0-9]{8,24})/);
  if (idMatch) return idMatch[1];

  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cancelsession')
    .setDescription('Cancel a scheduled session by Trello card link or ID.')
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName('card')
        .setDescription('Trello card link or ID')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('Reason for cancellation')
        .setRequired(true),
    ),

  /**
   * /cancelsession – Tier 4+ (Management and up)
   */
  async execute(interaction) {
    if (!atLeastTier(interaction.member, 4)) {
      return interaction.reply({
        content:
          'You must be at least **Tier 4 (Management)** to use `/cancelsession`.',
        ephemeral: true,
      });
    }

    const cardInput = interaction.options.getString('card', true);
    const reason = interaction.options.getString('reason', true);

    const cardId = extractCardId(cardInput);
    if (!cardId) {
      return interaction.reply({
        content:
          'I could not detect a valid Trello card ID from your input.\n' +
          'Please provide a Trello card link or ID.',
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const success = await cancelSessionCard({ cardId, reason });

    if (!success) {
      return interaction.editReply({
        content:
          'I tried to cancel that session on Trello, but something went wrong.\n' +
          'Please double-check the card and my Trello configuration.',
      });
    }

    // Delete any “session starting soon” post tied to this card
    await deleteSessionAnnouncement(interaction.client, cardId).catch(() => {});

    const trelloUrl = `https://trello.com/c/${cardId}`;

    await interaction.editReply({
      content:
        `✅ Session has been **canceled** and moved to the completed list.\n` +
        `Card: ${trelloUrl}`,
    });

    // Log to modlog, if configured
    await logModerationAction(interaction, {
      action: 'Session Canceled',
      reason,
      details: `Card: ${trelloUrl}`,
    }).catch(() => {});
  },
};
