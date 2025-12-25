// src/commands/sessions/logsession.js
const { SlashCommandBuilder } = require('discord.js');
const { completeSessionCard } = require('../../utils/trelloClient');
const {
  logAttendeesForCard,
  cleanupQueueForCard,
} = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('logsession')
    .setDescription('Mark a Trello session card as completed and log attendees.')
    .addStringOption((option) =>
      option
        .setName('card')
        .setDescription('Trello card URL or ID')
        .setRequired(true),
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const cardInput = interaction.options.getString('card');

    // Extract Trello ID (short link) from full URL or plain ID
    let cardId = cardInput;
    if (cardInput.includes('trello.com')) {
      const match = cardInput.match(/\/c\/([A-Za-z0-9]+)/);
      if (match) cardId = match[1];
    }

    const success = await completeSessionCard({ cardId });

    if (!success) {
      await interaction.editReply(
        '⚠️ I tried to log that session on Trello, but something went wrong.\nPlease double-check the card link/ID and my Trello configuration.',
      );
      return;
    }

    // Log attendees based on the queue (priority already applied by queue system)
    try {
      await logAttendeesForCard(interaction.client, cardInput);
      await cleanupQueueForCard(interaction.client, cardInput);
    } catch (err) {
      console.error('[LOGSESSION] Error while logging/cleaning queue:', err);
    }

    await interaction.editReply(
      '✅ Session successfully marked as completed on Trello.\n✅ Attendees logged and queue messages cleaned up.',
    );
  },
};
