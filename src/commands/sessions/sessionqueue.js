// src/commands/sessions/sessionqueue.js

const { SlashCommandBuilder } = require('discord.js');
const { openQueueForCard } = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessionqueue')
    .setDescription('Open a queue for a scheduled session Trello card.')
    .addStringOption(option =>
      option
        .setName('card')
        .setDescription('Trello card link or short ID for the session.')
        .setRequired(true)
    ),

  async execute(interaction) {
    const trelloCardUrl = interaction.options.getString('card', true);

    // Acknowledge fast so Discord doesn’t time out
    await interaction.deferReply({ ephemeral: true });

    try {
      const result = await openQueueForCard({
        client: interaction.client,
        trelloCardUrl,
      });

      if (!result || !result.ok) {
        await interaction.editReply({
          content:
            (result && result.message) ||
            'I could not open a queue for that Trello card.',
        });
        return;
      }

      await interaction.editReply({
        content: '✅ Queue opened successfully for that session.',
      });
    } catch (err) {
      console.error('[SESSIONQUEUE] Error in /sessionqueue:', err);
      try {
        await interaction.editReply({
          content:
            'There was an error while opening the queue. Please check the logs or try again.',
        });
      } catch {
        // ignore
      }
    }
  },
};
