// src/commands/sessions/sessionqueue.js

const { SlashCommandBuilder } = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');
const { openQueueForCard } = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessionqueue')
    .setDescription('Open a Glace session queue for a Trello session card.')
    .setDMPermission(false)
    .addStringOption(option =>
      option
        .setName('card')
        .setDescription('Trello card link or short ID for the session.')
        .setRequired(true),
    ),

  /**
   * /sessionqueue – Tier 4+ (Management and up)
   */
  async execute(interaction) {
    if (!atLeastTier(interaction.member, 4)) {
      return interaction.reply({
        content:
          'You must be at least **Tier 4 (Management)** to use `/sessionqueue`.',
        ephemeral: true,
      });
    }

    const cardInput = interaction.options.getString('card', true);

    await interaction.deferReply({ ephemeral: true });

    try {
      const ok = await openQueueForCard(interaction.client, cardInput, interaction.user);

      if (!ok) {
        return interaction.editReply(
          'I could not open a queue for that Trello card.\n' +
            '• Make sure the link is valid\n' +
            '• The card has the correct session labels or `[Interview]`, `[Training]`, `[Mass Shift]` in the name\n' +
            '• The queue channels/roles are configured in `QUEUE_*` env vars.',
        );
      }

      return interaction.editReply(
        '✅ Session queue and attendees post created successfully.',
      );
    } catch (error) {
      console.error('[SESSIONQUEUE] Error executing /sessionqueue:', error);

      if (interaction.deferred || interaction.replied) {
        try {
          await interaction.editReply(
            'There was an error while executing this command.',
          );
        } catch {
          // ignore double-edit issues
        }
      } else {
        try {
          await interaction.reply({
            content: 'There was an error while executing this command.',
            ephemeral: true,
          });
        } catch {
          // ignore
        }
      }
    }
  },
};
