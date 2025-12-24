const { SlashCommandBuilder } = require('discord.js');
const { completeSessionCard } = require('../../utils/trelloClient');
const { logAttendeesForCard, cleanupQueueForCard } = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('logsession')
    .setDescription('Mark a Trello session card as completed and log attendees.')
    .addStringOption(option =>
      option
        .setName('card')
        .setDescription('Trello card URL or short ID')
        .setRequired(true),
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const cardInput = interaction.options.getString('card');

    // Extract Trello card short ID if a URL is provided
    let cardId = cardInput;
    if (cardInput.includes('trello.com')) {
      const match = cardInput.match(/\/c\/([A-Za-z0-9]+)/);
      if (match) {
        cardId = match[1]; // shortlink ID
      }
    }

    // 1) Mark as completed on Trello
    const success = await completeSessionCard({ cardId });

    if (!success) {
      await interaction.editReply(
        '⚠️ I tried to log that session on Trello, but something went wrong.\n' +
        'Please double-check the card link/ID and my Trello configuration.',
      );
      // optional: auto-clean this error msg
      setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
      return;
    }

    // 2) Log attendees in the log channel (embed, usernames only, no pings)
    try {
      await logAttendeesForCard(interaction.client, cardInput);
    } catch (err) {
      console.error('[LOGSESSION] Failed to log attendees for card', cardInput, err);
    }

    // 3) Clean up the queue + attendees posts in the queue channel
    try {
      await cleanupQueueForCard(interaction.client, cardInput);
    } catch (err) {
      console.error('[LOGSESSION] Failed to cleanup queue for card', cardInput, err);
    }

    // 4) Confirm to the user (ephemeral, auto-delete)
    await interaction.editReply(
      '✅ Session successfully marked as completed on Trello.\n' +
      '✅ Attendees logged and the queue/attendees posts have been cleaned up.',
    );
    setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
  },
};
