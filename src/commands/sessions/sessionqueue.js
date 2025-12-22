// src/commands/sessions/sessionqueue.js
'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { openQueueForCard } = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessionqueue')
    .setDescription('Open a staff queue for a Trello session card.')
    .addStringOption(option =>
      option
        .setName('card')
        .setDescription('Trello card link or short ID')
        .setRequired(true)
    ),

  async execute(interaction) {
    try {
      await openQueueForCard(interaction);
    } catch (err) {
      console.error('[SESSIONQUEUE] Error while executing /sessionqueue:', err);

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'There was an error while executing this interaction.',
          ephemeral: true
        }).catch(() => {});
      }
    }
  }
};
