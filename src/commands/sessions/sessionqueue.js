const { SlashCommandBuilder } = require('discord.js');
const { openQueueForCard } = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessionqueue')
    .setDescription('Open a staff queue for a Trello session card.')
    .addStringOption((option) =>
      option
        .setName('card')
        .setDescription('Trello card link or short ID for this session.')
        .setRequired(true),
    ),
  async execute(interaction) {
    const rawCard = interaction.options.getString('card', true);

    try {
      const result = await openQueueForCard(interaction.client, rawCard);

      if (result.ok) {
        await interaction.reply({
          content: '✅ Queue opened successfully for that Trello card.',
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: result.message || 'There was a problem opening that queue.',
          ephemeral: true,
        });
      }
    } catch (err) {
      console.error('[SESSIONQUEUE] Error while executing /sessionqueue:', err);
      const alreadyReplied = interaction.replied || interaction.deferred;
      const msg =
        'There was an error while executing this interaction.\nIf this keeps happening, please contact a developer.';

      if (alreadyReplied) {
        await interaction.followUp({ content: msg, ephemeral: true }).catch(() => {});
      } else {
        await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
      }
    }
  },
};
