// src/commands/sessions/sessionqueue.js
const { SlashCommandBuilder } = require('discord.js');
const { openQueueForCard } = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessionqueue')
    .setDescription('Open the staff queue for a Trello session card.')
    .addStringOption(option =>
      option
        .setName('card')
        .setDescription('Trello card link or short ID')
        .setRequired(true)
    ),

  async execute(interaction) {
    try {
      await interaction.deferReply({ ephemeral: true });

      const cardInput = interaction.options.getString('card', true);

      const result = await openQueueForCard(interaction, cardInput);

      if (!result.success) {
        await interaction.editReply({
          content: `❌ ${result.error}`,
        });
        return;
      }

      const { cardName, queueChannelId } = result;
      const channelMention = queueChannelId ? `<#${queueChannelId}>` : '`(unknown channel)`';

      await interaction.editReply({
        content: `✅ Opened queue for **${cardName}** in ${channelMention}`,
      });
    } catch (err) {
      console.error('[SESSIONQUEUE] Error while executing /sessionqueue:', err);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content:
            '❌ There was an error while executing this command. Please try again or check the logs.',
        });
      } else {
        await interaction.reply({
          content:
            '❌ There was an error while executing this command. Please try again or check the logs.',
          ephemeral: true,
        });
      }
    }
  },
};
