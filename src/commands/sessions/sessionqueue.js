// src/commands/sessions/sessionqueue.js
const { SlashCommandBuilder } = require('discord.js');
const { openQueueForCard } = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessionqueue')
    .setDescription('Post a queue message for a session Trello card.')
    .addStringOption((option) =>
      option
        .setName('card')
        .setDescription('Trello card link or short URL')
        .setRequired(true),
    ),

  async execute(interaction) {
    try {
      await interaction.deferReply({ ephemeral: true });

      const cardInput = interaction.options.getString('card', true);

      const result = await openQueueForCard(interaction.client, cardInput);

      if (!result || !result.ok) {
        await interaction.editReply(
          'I could not open a queue for that Trello card.\n' +
            '• Make sure the link is valid\n' +
            '• The card has the correct session labels or [Interview], [Training], [Mass Shift] in the name\n' +
            '• The queue channels/roles are configured in SESSION_QUEUECHANNEL_*_ID env vars.',
        );
        return;
      }

      await interaction.editReply(
        `✅ Queue opened in <#${result.channelId}> for Trello card \`${result.shortId}\`.`,
      );
    } catch (err) {
      console.error('[SESSIONQUEUE] Error while executing /sessionqueue:', err);

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(
          'There was an error while executing this command.',
        );
      } else {
        await interaction.reply({
          content: 'There was an error while executing this command.',
          ephemeral: true,
        });
      }
    }
  },
};
