// src/commands/sessions/sessionattendees.js

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const {
  handleManualSessionAttendeesCommand,
} = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessionattendees')
    .setDescription('Post the selected attendees list for a session, based on the current queue & Hyra data.')
    .addStringOption((opt) =>
      opt
        .setName('card')
        .setDescription('Trello card link or ID')
        .setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),

  async execute(interaction) {
    await handleManualSessionAttendeesCommand(interaction);
  },
};
