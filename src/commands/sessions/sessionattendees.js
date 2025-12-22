// src/commands/sessions/sessionattendees.js
const { SlashCommandBuilder } = require('discord.js');
const { postAttendeesForCard } = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessionattendees')
    .setDescription('Post the selected attendees list for a session queue.')
    .addStringOption(option =>
      option
        .setName('card')
        .setDescription('Trello card link or short ID used for the queue')
        .setRequired(true)
    ),

  async execute(interaction) {
    try {
      await interaction.deferReply({ ephemeral: true });

      const cardInput = interaction.options.getString('card', true);

      const result = await postAttendeesForCard(interaction, cardInput);

      if (!result.success) {
        await interaction.editReply({
          content: `❌ ${result.error}`,
        });
        return;
      }

      await interaction.editReply({
        content: '✅ Posted the attendees list and logged the session.',
      });
    } catch (err) {
      console.error('[SESSIONATTENDEES] Error while executing /sessionattendees:', err);
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
