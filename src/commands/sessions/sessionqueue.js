// src/commands/sessions/sessionqueue.js

const { SlashCommandBuilder } = require('discord.js');
const { openQueueForCard } = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessionqueue')
    .setDescription('Open a staff queue for a Trello session card')
    .addStringOption((opt) =>
      opt
        .setName('card')
        .setDescription('Trello card link or short ID')
        .setRequired(true),
    ),

  async execute(interaction) {
    const cardInput = interaction.options.getString('card', true);

    try {
      // One acknowledgement only
      await interaction.deferReply({ ephemeral: true });

      const result = await openQueueForCard(interaction, cardInput);

      if (!result || !result.ok) {
        const msg =
          (result && result.errorMessage) ||
          'I could not open a queue for that Trello card.\n• Make sure the link is valid.\n• The card name includes [Interview], [Training] or [Mass Shift].';
        await interaction.editReply({ content: msg });
        return;
      }

      const confirm = `✅ Opened queue for **${result.cardName}** in <#${result.channelId}>.`;
      await interaction.editReply({ content: confirm });
    } catch (err) {
      console.error('[SESSIONQUEUE] Error while executing /sessionqueue:', err);

      try {
        if (interaction.deferred && !interaction.replied) {
          await interaction.editReply({
            content:
              'There was an error while trying to open the queue for that card.',
          });
        }
      } catch {
        // ignore
      }
    }
  },
};
