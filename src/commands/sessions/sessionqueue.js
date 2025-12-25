// src/commands/sessions/sessionqueue.js
const { SlashCommandBuilder } = require('discord.js');
const { openQueueForCard } = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessionqueue')
    .setDescription('Open a queue for a Trello session card.')
    .addStringOption((option) =>
      option
        .setName('card')
        .setDescription('Full Trello card URL (with /c/...)')
        .setRequired(true),
    ),

  async execute(interaction) {
    const cardOption = interaction.options.getString('card');
    await openQueueForCard(interaction, cardOption);
  },
};
