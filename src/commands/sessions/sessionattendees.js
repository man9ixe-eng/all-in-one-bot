// src/commands/sessions/sessionattendees.js

const { SlashCommandBuilder } = require('discord.js');
const { postAttendeesForCard } = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessionattendees')
    .setDescription('Post the selected attendees list for a session.')
    .addStringOption(option =>
      option
        .setName('card')
        .setDescription('Trello card link or short ID')
        .setRequired(true)
    ),

  /**
   * /sessionattendees card:<trello link or id>
   */
  async execute(interaction) {
    const cardOption =
      interaction.options.getString('card') ||
      interaction.options.getString('link') ||
      interaction.options.getString('trello') ||
      interaction.options.getString('trello_card');

    await postAttendeesForCard(interaction, cardOption);
  },
};
