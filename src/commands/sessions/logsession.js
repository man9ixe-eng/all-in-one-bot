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

  /**
   * /logsession – Tier 4+ (Management and up)
   */
  async execute(interaction) {
    if (!atLeastTier(interaction.member, 4)) {
      return interaction.reply({
        content: 'You must be at least **Tier 4 (Management)** to use `/logsession`.',
        ephemeral: true,
      });
    }

    const cardInput = interaction.options.getString('card', true).trim();
    const cardMatch = cardInput.match(/(?:https:\/\/trello\.com\/c\/)?([a-zA-Z0-9]+)/);
    const cardId = cardMatch ? cardMatch[1] : null;

    if (!cardId) {
      return interaction.reply({
        content: 'Invalid Trello card link or ID provided.',
        ephemeral: true,
      });
    }

    try {
      const success = await completeSessionCard({ cardId });
      if (!success) {
        return interaction.reply({
          content:
            'I could not mark that session as completed. Please verify the Trello card link and try again.',
          ephemeral: true,
        });
      }

      await deleteSessionAnnouncement(interaction.client, cardId).catch(() => {});

      return interaction.reply({
        content: `✅ Successfully marked the session as **completed** and removed its scheduled announcement.`,
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
