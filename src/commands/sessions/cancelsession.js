// src/commands/sessions/cancelsession.js

const { SlashCommandBuilder } = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');
const { cancelSessionCard } = require('../../utils/trelloClient');
const { deleteSessionAnnouncement } = require('../../utils/sessionAnnouncements');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cancelsession')
    .setDescription('Cancels a Trello session card (applies Canceled label and moves it).')
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
        .setDescription('Reason for cancellation.')
        .setRequired(true),
    ),

  // /cancelsession – Tier 5+ (Senior Management and up)
  async execute(interaction) {
    if (!atLeastTier(interaction.member, 5)) {
      return interaction.reply({
        content: 'You must be at least **Tier 5 (Senior Management)** to use `/cancelsession`.',
        ephemeral: true,
      });
    }

    const cardInput = interaction.options.getString('card', true).trim();
    const reason = interaction.options.getString('reason', true).trim();

    // Accept full Trello link or raw ID
    const match = cardInput.match(/(?:https:\/\/trello\.com\/c\/)?([A-Za-z0-9]+)/);
    const cardId = match ? match[1] : null;

    if (!cardId) {
      return interaction.reply({
        content: 'That does not look like a valid Trello card link or ID.',
        ephemeral: true,
      });
    }

    try {
      const success = await cancelSessionCard(cardId, reason);
      if (!success) {
        return interaction.reply({
          content:
            'I tried to cancel that session on Trello, but something went wrong.\n' +
            'Please double-check the card link/ID and my Trello configuration.',
          ephemeral: true,
        });
      }

      await deleteSessionAnnouncement(interaction.client, cardId).catch(() => {});

      return interaction.reply({
        content: '🚫 Session has been **canceled** on Trello and its notice has been removed.',
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
