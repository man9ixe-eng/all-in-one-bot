// src/commands/sessions/sessionqueue.js

const { SlashCommandBuilder } = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');
const { openQueueForCard } = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessionqueue')
    .setDescription('Open a Glace session queue for a Trello session card.')
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName('card')
        .setDescription('Trello card link or short ID (e.g. https://trello.com/c/abcd1234)')
        .setRequired(true),
    ),

  /**
   * /sessionqueue – Tier 4+ (Management and up) opens a joinable queue
   * for the provided Trello session card.
   */
  async execute(interaction) {
    // Fast perm check before we even touch Trello
    if (!atLeastTier(interaction.member, 4)) {
      await interaction.reply({
        content:
          'You must be at least **Tier 4 (Management)** to use `/sessionqueue`.',
        ephemeral: true,
      });
      return;
    }

    const cardOption = interaction.options.getString('card', true);

    // Delegate all heavy work to the queue manager
    await openQueueForCard(interaction, cardOption);
  },
};
z