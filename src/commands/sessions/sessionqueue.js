// src/commands/sessions/sessionqueue.js

const { SlashCommandBuilder } = require('discord.js');
const { openQueueForCard } = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessionqueue')
    .setDescription('Open a session queue for a Trello card.')
    .addStringOption(option =>
      option
        .setName('card')
        .setDescription('Trello card link (or short code)')
        .setRequired(true)
    ),

  async execute(interaction) {
    const cardOption = interaction.options.getString('card', true).trim();

    console.log('[QUEUE] Raw card option:', cardOption);

    try {
      await interaction.deferReply({ ephemeral: true });

      const result = await openQueueForCard(cardOption, interaction.client);

      if (!result || !result.success) {
        const message =
          result?.message ||
          'I could not open a queue for that Trello card.';
        await interaction.editReply({ content: message });
        return;
      }

      const { cardName, queueChannelId } = result;
      let channelMention = '#unknown-channel';

      if (queueChannelId) {
        channelMention = `<#${queueChannelId}>`;
      }

      const confirmMessage =
        `✅ Opened queue for **${cardName}** in ${channelMention}.`;

      await interaction.editReply({ content: confirmMessage });

      // Delete the ephemeral confirmation after ~5 seconds
      setTimeout(() => {
        interaction.deleteReply().catch(() => {});
      }, 5000);
    } catch (err) {
      console.error('[SESSIONQUEUE] Error while executing /sessionqueue:', err);

      if (interaction.deferred || interaction.replied) {
        await interaction
          .editReply({
            content:
              'There was an error while trying to open that queue. Please check the Trello card link and try again.',
          })
          .catch(() => {});
      } else {
        await interaction
          .reply({
            content:
              'There was an error while trying to open that queue. Please check the Trello card link and try again.',
            ephemeral: true,
          })
          .catch(() => {});
      }
    }
  },
};
