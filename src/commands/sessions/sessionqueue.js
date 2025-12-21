// src/commands/sessions/sessionqueue.js

const { SlashCommandBuilder } = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');
const { openQueueForCard } = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessionqueue')
    .setDescription('Manually open a test queue for a Trello session card (temporary helper).')
    .setDMPermission(false)
    .addStringOption(option =>
      option
        .setName('card')
        .setDescription('Trello card link or ID.')
        .setRequired(true),
    ),

  /**
   * /sessionqueue – TEMP TEST COMMAND
   * Tier 4+ only
   */
  async execute(interaction) {
    // Permission check
    if (!atLeastTier(interaction.member, 4)) {
      return interaction.reply({
        content: 'You must be at least **Tier 4 (Management)** to use `/sessionqueue`.',
        ephemeral: true,
      });
    }

    // DO NOT pass "true" as the second parameter – that’s what was throwing
    const cardRefRaw = interaction.options.getString('card'); // safe
    const cardRef = (cardRefRaw || '').trim();

    if (!cardRef) {
      return interaction.reply({
        content:
          'You need to provide a Trello card link or ID.\n' +
          'Example: `/sessionqueue card: https://trello.com/c/XXXXXXX`',
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      // Placeholder stub. Just logs for now.
      await openQueueForCard(interaction.client, cardRef, {
        invokedBy: interaction.user.id,
      });

      await interaction.editReply(
        '✅ `/sessionqueue` ran successfully (queue system is still in placeholder mode).',
      );
    } catch (err) {
      console.error('[SESSIONQUEUE] Error in /sessionqueue:', err);

      try {
        await interaction.editReply({
          content: 'There was an error while running `/sessionqueue`.',
        });
      } catch {
        // ignore
      }
    }
  },
};
