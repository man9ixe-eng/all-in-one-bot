const { SlashCommandBuilder } = require('discord.js');
const { completeSessionCard } = require('../../utils/trelloClient');
const {
  logAttendeesForCard,
  cleanupQueueForCard,
  extractShortId,
} = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('logsession')
    .setDescription('Mark a Trello session card as completed and log attendees.')
    .addStringOption(option =>
      option
        .setName('card')
        .setDescription('Trello card URL or ID')
        .setRequired(true),
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

    const shortId = extractShortId(cardInput) || cardId;

    const success = await completeSessionCard({ cardId });

    if (!success) {
      await interaction.editReply(
        '⚠️ I tried to log that session on Trello, but something went wrong.\nPlease double-check the card link/ID and my Trello configuration.',
      );
      return;
    }

    // Trello success: now log attendees + clean up queue/attendees posts
    try {
      await logAttendeesForCard(interaction.client, shortId);
    } catch (err) {
      console.error('[LOGSESSION] Error while logging attendees:', err);
    }

    try {
      await cleanupQueueForCard(interaction.client, shortId);
    } catch (err) {
      console.error('[LOGSESSION] Error while cleaning up queue for logged session:', err);
    }

    await interaction.editReply('✅ Session successfully marked as completed on Trello and attendees logged. Queue + attendees posts cleaned up.');
  },
};
