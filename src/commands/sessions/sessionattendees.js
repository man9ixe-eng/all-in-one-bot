// src/commands/sessions/sessionattendees.js
const { SlashCommandBuilder } = require('discord.js');
const { postAttendeesForCard } = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessionattendees')
    .setDescription('Post the selected attendees for a session (LIVE message).')
    .addStringOption((option) =>
      option
        .setName('card')
        .setDescription('Full Trello card URL (with /c/...)')
        .setRequired(true),
    ),

  async execute(interaction) {
    const cardOption = interaction.options.getString('card');
    await postAttendeesForCard(interaction, cardOption);
  },
};
