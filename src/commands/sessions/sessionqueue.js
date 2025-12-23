const { SlashCommandBuilder } = require('discord.js');
const { openQueueForCard } = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessionqueue')
    .setDescription('Open a staff queue for a Trello session card.')
    .addStringOption(option =>
      option
        .setName('card')
        .setDescription('Trello card link or short ID')
        .setRequired(true),
    ),
  async execute(interaction) {
    const cardOption = interaction.options.getString('card');

    try {
      await openQueueForCard(interaction, cardOption);
    } catch (error) {
      console.error('[SESSIONQUEUE] Error while executing /sessionqueue:', error);

      // Avoid the "Interaction has already been acknowledged" error
      if (!interaction.deferred && !interaction.replied) {
        await interaction.reply({
          content: 'There was an error while opening the session queue.',
          ephemeral: true,
        }).catch(() => {});
      } else {
        await interaction.editReply({
          content: 'There was an error while opening the session queue.',
        }).catch(() => {});
      }
    }
  },
};
