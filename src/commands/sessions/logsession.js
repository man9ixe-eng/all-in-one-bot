// src/commands/sessions/logsession.js

const { SlashCommandBuilder } = require('discord.js');
const { extractShortId, onSessionCompleted } = require('../../utils/sessionQueueManager');
const { completeSessionCard } = require('../../utils/trelloClient');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('logsession')
    .setDescription('Mark a session Trello card as completed and log its attendees.')
    .addStringOption(option =>
      option
        .setName('card')
        .setDescription('Trello card link or short ID for the session.')
        .setRequired(true)
    ),
  async execute(interaction) {
    const cardOption = interaction.options.getString('card', true);
    const shortId = extractShortId(cardOption);

    if (!shortId) {
      await interaction.reply({
        content:
          'I could not understand that Trello card. Please provide a valid Trello card link or short ID.',
        ephemeral: true,
      });
      setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
      return;
    }

    try {
      // 1) Mark the Trello card as completed (moves to your completed list etc.)
      await completeSessionCard(shortId);
    } catch (err) {
      console.error('[LOGSESSION] Failed to complete Trello card:', err);
      await interaction.reply({
        content:
          'I could not mark that Trello card as completed. Please check the card and try again.',
        ephemeral: true,
      });
      setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
      return;
    }

    try {
      // 2) Let the queue manager log attendees (embed with usernames) + clean up queue/attendees messages
      await onSessionCompleted(shortId, interaction.client);
    } catch (err) {
      console.error('[LOGSESSION] onSessionCompleted failed:', err);
    }

    await interaction.reply({
      content: '✅ Session has been logged and the queue + attendees messages were cleaned up.',
      ephemeral: true,
    });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
  },
};
