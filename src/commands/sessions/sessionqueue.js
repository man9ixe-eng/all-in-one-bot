// src/commands/sessions/sessionqueue.js

const { SlashCommandBuilder } = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');
const { openQueueForCard } = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessionqueue')
    .setDescription('Open a Glace session queue post for a Trello session card.')
    .setDMPermission(false)
    .addStringOption(option =>
      option
        .setName('card')
        .setDescription('Trello card link or ID for the session.')
        .setRequired(true),
    ),

  async execute(interaction) {
    // Permission check: Tier 6+ (Corporate Intern+)
    if (!atLeastTier(interaction.member, 6)) {
      return interaction.reply({
        content: 'You must be at least **Tier 6 (Corporate Intern+)** to use `/sessionqueue`.',
        ephemeral: true,
      });
    }

    const cardInput = interaction.options.getString('card', true);

    try {
      // Try to open the queue for this Trello card
      const ok = await openQueueForCard(interaction.client, { cardInput });

      if (!ok) {
        return interaction.reply({
          content:
            'I couldn’t open a queue for that Trello card.\n' +
            'Make sure:\n' +
            '• The card is a valid **Interview / Training / Mass Shift** session card\n' +
            '• The list + label IDs in `.env`/Render are correct\n' +
            '• `SESSION_CONFIG` has a queue channel set for that session type.',
          ephemeral: true,
        });
      }

      // Success – queue embed was posted in the configured channel
      return interaction.reply({
        content:
          '✅ Queue post created for that session.\n' +
          'Check the appropriate **session queue channel** for the buttons.',
        ephemeral: true,
      });
    } catch (err) {
      console.error('[SESSIONQUEUE] Unexpected error while opening queue:', err);

      // Try to tell the user something went wrong
      try {
        await interaction.reply({
          content: 'There was an error while opening the queue for that card.',
          ephemeral: true,
        });
      } catch {
        // ignore (avoid double-reply crash)
      }
    }
  },
};

