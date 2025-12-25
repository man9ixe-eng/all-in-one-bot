// src/commands/sessions/sessionqueue.js
const { SlashCommandBuilder } = require('discord.js');
const { openQueueForCard } = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessionqueue')
    .setDescription('Open a session queue for a Trello card.')
    .addStringOption((option) =>
      option
        .setName('card')
        .setDescription('Trello card URL or short ID')
        .setRequired(true),
    ),

  async execute(interaction) {
    const cardOption = interaction.options.getString('card');
    await openQueueForCard(interaction, cardOption);
  },
};
