// src/commands/sessions/cancelsession.js

const { SlashCommandBuilder } = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');
const { cancelSessionCard } = require('../../utils/trelloClient');
const { deleteSessionAnnouncement } = require('../../utils/sessionAnnouncements');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cancelsession')
    .setDescription('Cancels a Trello session card (moves it to completed and applies Canceled label).')
    .setDMPermission(false)
    .addStringOption(option =>
      option
        .setName('card')
        .setDescription('Trello card link or ID to cancel.')
        .setRequired(true),
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for cancellation (required).')
        .setRequired(true),
    ),

  /**
   * /cancelsession – Tier 5+ (Senior Management and up)
   */
  async execute(interaction) {
    if (!atLeastTier(interaction.member, 5)) {
      return interaction.reply({
        content: 'You must be at least **Tier 5 (Senior Management)** to use `/cancelsession`.',
        ephemeral: true,
      });
    }

    const cardInput = interaction.options.getString('card', true).trim();
    const reason = interaction.options.getString('reason', true).trim();

    // Accept both full Trello links or raw IDs
    const cardMatch = cardInput.match(/(?:https:\/\/trello\.com\/c\/)?([a-zA-Z0-9]+)/);
    const cardId = cardMatch ? cardMatch[1] : null;

    if (!cardId) {
      return interaction.reply({
        content: 'Invalid Trello card link or ID provided.',
        ephemeral: true,
      });
    }

    try {
      const success = await cancelSessionCard({ cardId, reason });
      if (!success) {
        return interaction.reply({
          content: 'I could not cancel that session. Please verify the Trello card link and try again.',
          ephemeral: true,
        });
      }

      // Delete related announcement if it exists
      await deleteSessionAnnouncement(interaction.client, cardId).catch(() => {});

      return interaction.reply({
        content: `🚫 Successfully **canceled** that session and removed its scheduled announcement.`,
        ephemeral: true,
      });
    } catch (err) {
      console.error('[CANCELSESSION] Error:', err);
      return interaction.reply({
        content: 'There was an error while executing this command.',
        ephemeral: true,
      });
    }
  },
};
