// src/commands/sessions/logsession.js
const { SlashCommandBuilder } = require('discord.js');
const { completeSessionCard } = require('../../utils/trelloClient');
const { extractShortId, onSessionCompleted } = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('logsession')
    .setDescription('Marks a Trello session card as completed.')
    .addStringOption(option =>
      option
        .setName('card')
        .setDescription('Trello card link or short ID')
        .setRequired(true)
    ),

  async execute(interaction) {
    const cardInput = interaction.options.getString('card', true).trim();
    const shortId = extractShortId(cardInput);

    if (!shortId) {
      await interaction.reply({
        content: 'I could not parse that Trello card. Please provide the card link or short ID.',
        ephemeral: true,
      });
      return;
    }

    try {
      // Move Trello card to completed list (your existing trelloClient logic)
      await completeSessionCard(shortId, interaction.user.id);

      // Clean up queue + attendees + log list
      await onSessionCompleted(shortId, interaction.client);

      await interaction.reply({
        content: `✅ Session card **${shortId}** has been marked completed and the queue has been cleaned up.`,
        ephemeral: true,
      });
    } catch (err) {
      console.error('[LOGSESSION] Error completing card', shortId, err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'There was an error while logging that session.',
          ephemeral: true,
        });
      }
    }
  },
};
