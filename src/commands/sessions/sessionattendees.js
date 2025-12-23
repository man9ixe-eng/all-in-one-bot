const { SlashCommandBuilder } = require('discord.js');
const { postAttendeesForCard } = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessionattendees')
    .setDescription('Post the selected attendees for an active session queue.')
    .addStringOption(option =>
      option
        .setName('card')
        .setDescription('Trello card link or short ID used when opening the queue')
        .setRequired(true),
    ),
  async execute(interaction) {
    const cardOption = interaction.options.getString('card');

    try {
      await postAttendeesForCard(interaction, cardOption);
    } catch (error) {
      console.error('[SESSIONATTENDEES] Error while executing /sessionattendees:', error);

      if (!interaction.deferred && !interaction.replied) {
        await interaction.reply({
          content: 'There was an error while posting the attendees list.',
          ephemeral: true,
        }).catch(() => {});
      } else {
        await interaction.editReply({
          content: 'There was an error while posting the attendees list.',
        }).catch(() => {});
      }
    }
  },
};
