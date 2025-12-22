// src/commands/sessions/sessionattendees.js
'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { postAttendeesForCard } = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessionattendees')
    .setDescription('Post the selected attendees list for a session queue.')
    .addStringOption(option =>
      option
        .setName('card')
        .setDescription('Trello card link or short ID')
        .setRequired(true)
    ),

  async execute(interaction) {
    try {
      await postAttendeesForCard(interaction);
    } catch (err) {
      console.error('[SESSIONATTENDEES] Error while executing /sessionattendees:', err);

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'There was an error while executing this interaction.',
          ephemeral: true
        }).catch(() => {});
      }
    }
  }
};
