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
        .setDescription('Trello card URL or short ID')
        .setRequired(true),
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const cardInput = interaction.options.getString('card');

    // Extract Trello ID or shortlink for Trello API
    let cardId = cardInput;
    if (cardInput.includes('trello.com')) {
      const match = cardInput.match(/\/c\/([A-Za-z0-9]+)/);
      if (match) cardId = match[1];
    }

    // 1) Log attendees (if any queue exists for this card)
    try {
      await logAttendeesForCard(interaction.client, cardInput);
    } catch (err) {
      console.error('[LOGSESSION] Failed to log attendees for card', err);
    }

    // 2) Clean up queue & attendees posts
    try {
      await cleanupQueueForCard(interaction.client, cardInput);
    } catch (err) {
      console.error('[LOGSESSION] Failed to cleanup queue for card', err);
    }

    // 3) Mark Trello card as completed
    const success = await completeSessionCard({ cardId });

    if (success) {
      await interaction.editReply(
        '✅ Session successfully marked as completed on Trello.\nAttendees (if any) were logged and the session queue messages were cleaned up.',
      );
    } else {
      await interaction.editReply(
        '⚠️ I tried to mark that session as completed on Trello, but something went wrong.\nIf a queue existed, attendees were still logged and queue messages were cleaned up.',
      );
    }
  },
};
