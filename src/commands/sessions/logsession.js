const { SlashCommandBuilder } = require('discord.js');
const { completeSessionCard } = require('../../utils/trelloClient');
const { cleanupQueueForCard } = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('logsession')
    .setDescription('Mark a Trello session card as completed.')
    .addStringOption(option =>
      option
        .setName('card')
        .setDescription('Trello card URL or ID')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const cardInput = interaction.options.getString('card');

    // Extract Trello ID or shortlink
    let cardId = cardInput;
    if (cardInput.includes('trello.com')) {
      const match = cardInput.match(/\/c\/([A-Za-z0-9]+)/);
      if (match) cardId = match[1];
    }

    const success = await completeSessionCard({ cardId });

    if (success) {
      await interaction.editReply('✅ Session successfully marked as completed on Trello.');

      // Now that Trello logging succeeded, clean up queue + attendees posts
      cleanupQueueForCard(interaction.client, cardInput).catch(err =>
        console.error('[LOGSESSION] Failed to cleanup queue for card', err),
      );
    } else {
      await interaction.editReply(
        '⚠️ I tried to log that session on Trello, but something went wrong.\n' +
        'Please double-check the card link/ID and my Trello configuration.'
      );
    }
  },
};
