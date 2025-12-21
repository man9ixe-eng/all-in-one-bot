// src/commands/sessions/sessionqueue.js

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const {
  handleManualSessionQueueCommand,
} = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessionqueue')
    .setDescription('Post a session queue for a Trello session card.')
    .addStringOption((opt) =>
      opt
        .setName('card')
        .setDescription('Trello card link or ID')
        .setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),

  async execute(interaction) {
    await handleManualSessionQueueCommand(interaction);
  },
};
