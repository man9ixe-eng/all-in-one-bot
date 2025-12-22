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
      const result = await openQueueForCard(interaction, cardInput);

      if (!result.ok) {
        const msg =
          result.errorMessage ||
          'I could not open a queue for that Trello card.';
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: msg, ephemeral: true });
        } else if (interaction.deferred) {
          await interaction.editReply({ content: msg });
        }
        return;
      }

      const confirm = `✅ Opened queue for **${result.cardName}** in <#${result.channelId}>.`;
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: confirm, ephemeral: true });
      } else {
        await interaction.editReply({ content: confirm });
      }
    } catch (err) {
      console.error('[SESSIONQUEUE] Error while executing /sessionqueue:', err);

      if (!interaction.replied && !interaction.deferred) {
        try {
          await interaction.reply({
            content:
              'There was an error while trying to open the queue for that card.',
            ephemeral: true,
          });
        } catch {
          // ignore
        }
      }
    }
  },
};
