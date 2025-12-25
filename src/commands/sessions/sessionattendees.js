// src/commands/sessions/sessionattendees.js
const { SlashCommandBuilder } = require('discord.js');
const { postAttendeesForCard } = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessionattendees')
    .setDescription('Post the selected attendees list for a session queue.')
    .addStringOption((option) =>
      option
        .setName('card')
        .setDescription('Trello card URL or short ID')
        .setRequired(true),
    ),

  async execute(interaction) {
    const cardOption = interaction.options.getString('card');
    await postAttendeesForCard(interaction, cardOption);
  },
};
