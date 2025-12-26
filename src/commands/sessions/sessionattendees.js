// src/commands/sessions/sessionattendees.js

const { SlashCommandBuilder } = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');
const { postAttendeesForCard } = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessionattendees')
    .setDescription('Post or re-post the attendees list for an existing session queue.')
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName('card')
        .setDescription('Trello card link or short ID that has a queue open.')
        .setRequired(true),
    ),

  /**
   * /sessionattendees – Tier 4+ can manually post the live attendees message
   * using the queue data already stored in memory.
   */
  async execute(interaction) {
    if (!atLeastTier(interaction.member, 4)) {
      await interaction.reply({
        content:
          'You must be at least **Tier 4 (Management)** to use `/sessionattendees`.',
        ephemeral: true,
      });
      return;
    }

    const cardOption = interaction.options.getString('card', true);

    await postAttendeesForCard(interaction, cardOption);
  },
};
