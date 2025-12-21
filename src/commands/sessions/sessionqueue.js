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
   * - Just calls openQueueForCard (stub) and always replies ephemerally
   * - Tier 4+ only so random LRs can’t spam it
   */
  async execute(interaction) {
    // Permission gate
    if (!atLeastTier(interaction.member, 4)) {
      return interaction.reply({
        content: 'You must be at least **Tier 4 (Management)** to use `/sessionqueue`.',
        ephemeral: true,
      });
    }

    const cardRefRaw = interaction.options.getString('card', true);
    const cardRef = cardRefRaw.trim();

    if (!cardRef) {
      return interaction.reply({
        content: 'Please provide a valid Trello card link or ID.',
        ephemeral: true,
      });
    }

    // Make sure Discord sees *something* quickly
    await interaction.deferReply({ ephemeral: true });

    try {
      // This is the placeholder we defined in sessionQueueManager.js.
      // It just logs and returns right now.
      await openQueueForCard(interaction.client, cardRef, {
        invokedBy: interaction.user.id,
      });

      await interaction.editReply(
        '✅ `/sessionqueue` ran successfully (queue system is still in placeholder mode).',
      );
    } catch (err) {
      console.error('[SESSIONQUEUE] Error in /sessionqueue:', err);

      if (interaction.deferred || interaction.replied) {
        // We already deferred, so we edit the reply instead of replying again.
        try {
          await interaction.editReply({
            content: 'There was an error while running `/sessionqueue`.',
          });
        } catch {
          // ignore
        }
      } else {
        // Fallback (shouldn’t really happen, but just in case)
        try {
          await interaction.reply({
            content: 'There was an error while running `/sessionqueue`.',
            ephemeral: true,
          });
        } catch {
          // ignore
        }
      }
    }
  },
};
