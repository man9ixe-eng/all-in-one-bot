// src/commands/sessions/logsession.js

const { SlashCommandBuilder } = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');
const { completeSessionCard } = require('../../utils/trelloClient');
const { deleteSessionAnnouncement } = require('../../utils/sessionAnnouncements');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('logsession')
    .setDescription('Marks a Trello session card as completed.')
    .setDMPermission(false)
    .addStringOption(option =>
      option
        .setName('card')
        .setDescription('Trello card link or ID.')
        .setRequired(true),
    ),

  // /logsession – Tier 4+ (Management and up)
  async execute(interaction) {
    if (!atLeastTier(interaction.member, 4)) {
      return interaction.reply({
        content: 'You must be at least **Tier 4 (Management)** to use `/logsession`.',
        ephemeral: true,
      });
    }

    const cardInput = interaction.options.getString('card', true).trim();

    // Accept both full Trello links and raw IDs
    const match = cardInput.match(/(?:https:\/\/trello\.com\/c\/)?([A-Za-z0-9]+)/);
    const cardId = match ? match[1] : null;

    if (!cardId) {
      return interaction.reply({
        content: 'That does not look like a valid Trello card link or ID.',
        ephemeral: true,
      });
    }

    try {
      const success = await completeSessionCard(cardId);
      if (!success) {
        return interaction.reply({
          content:
            'I could not mark that session as completed. Please verify the Trello card and try again.',
          ephemeral: true,
        });
      }

      await deleteSessionAnnouncement(interaction.client, cardId).catch(() => {});

      return interaction.reply({
        content:
          '✅ Session has been marked as **completed** on Trello and its notice has been removed.',
        ephemeral: true,
      });
    } catch (err) {
      console.error('[LOGSESSION] Error:', err);
      return interaction.reply({
        content: 'There was an error while executing this command.',
        ephemeral: true,
      });
    }
  },
};
