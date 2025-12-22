// src/commands/sessions/sessionqueue.js

const { SlashCommandBuilder } = require('discord.js');
const { openQueueForCard } = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessionqueue')
    .setDescription('Open a queue for a session Trello card.')
    .addStringOption(option =>
      option
        .setName('card')
        .setDescription('Trello card link or short ID')
        .setRequired(true)
    ),

  /**
   * /sessionqueue card:<trello link or id>
   */
  async execute(interaction) {
    // Support multiple possible option names just in case old commands differ
    const cardOption =
      interaction.options.getString('card') ||
      interaction.options.getString('link') ||
      interaction.options.getString('trello') ||
      interaction.options.getString('trello_card');

    await openQueueForCard(interaction, cardOption);
  },
};
