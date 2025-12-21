// src/commands/sessions/sessionqueue.js

const { SlashCommandBuilder } = require('discord.js');
const { openQueueForCard } = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessionqueue')
    .setDescription('Manually open a session queue for a Trello card.')
    .addStringOption(opt =>
      opt
        .setName('card')
        .setDescription('Trello card link or short ID')
        .setRequired(true),
    ),

  async execute(interaction) {
    const card = interaction.options.getString('card', true);

    try {
      const ok = await openQueueForCard(interaction.client, card, { force: true });

      if (ok) {
        await interaction.reply({
          content: '✅ Queue opened for that Trello card (or was already open).',
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content:
            'I could not open a queue for that Trello card.\n' +
            '• Make sure the link is valid\n' +
            '• The card has the correct session labels or [Interview], [Training], [Mass Shift] in the name\n' +
            '• The queue channels/roles are configured in SESSION_* and QUEUE_* env vars.',
          ephemeral: true,
        });
      }
    } catch (err) {
      console.error('[SESSIONQUEUE] Error while executing /sessionqueue:', err);

      if (!interaction.replied && !interaction.deferred) {
        try {
          await interaction.reply({
            content: 'There was an error while executing this interaction.',
            ephemeral: true,
          });
        } catch {
          // ignore
        }
      }
    }
  },
};
