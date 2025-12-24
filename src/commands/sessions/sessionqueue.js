// src/commands/sessions/sessionqueue.js
const { SlashCommandBuilder } = require('discord.js');
const { openQueueForCard } = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessionqueue')
    .setDescription('Open a Glace queue for a Trello session card.')
    .addStringOption(option =>
      option
        .setName('card')
        .setDescription('Trello card URL or short ID')
        .setRequired(true),
    ),

  async execute(interaction) {
    try {
      const cardOption = interaction.options.getString('card');

      // Just hand off to the manager – it handles deferReply/ephemeral/etc.
      await openQueueForCard(interaction, cardOption);
    } catch (error) {
      console.error('[SESSIONQUEUE] Error while executing /sessionqueue:', error);

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'There was an error while opening the queue for that card.',
          ephemeral: true,
        }).catch(() => {});
      }
    }
  },
};
