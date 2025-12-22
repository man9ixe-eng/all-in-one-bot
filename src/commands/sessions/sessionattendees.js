// src/commands/sessions/sessionattendees.js

const { SlashCommandBuilder } = require('discord.js');
const { postAttendeesForCard } = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessionattendees')
    .setDescription('Post the selected attendees for an existing session queue.')
    .addStringOption(option =>
      option
        .setName('card')
        .setDescription('Trello card link (or short code)')
        .setRequired(true)
    ),

  async execute(interaction) {
    const cardOption = interaction.options.getString('card', true).trim();

    try {
      await interaction.deferReply({ ephemeral: true });

      const result = await postAttendeesForCard(cardOption, interaction.client);

      if (!result || !result.success) {
        const message =
          result?.message ||
          'I could not post attendees for that Trello card.';
        await interaction.editReply({ content: message });
        return;
      }

      await interaction.editReply({
        content: '✅ Posted attendees list.',
      });

      setTimeout(() => {
        interaction.deleteReply().catch(() => {});
      }, 5000);
    } catch (err) {
      console.error(
        '[SESSIONATTENDEES] Error while executing /sessionattendees:',
        err
      );

      if (interaction.deferred || interaction.replied) {
        await interaction
          .editReply({
            content:
              'There was an error while posting the attendees list for that card.',
          })
          .catch(() => {});
      } else {
        await interaction
          .reply({
            content:
              'There was an error while posting the attendees list for that card.',
            ephemeral: true,
          })
          .catch(() => {});
      }
    }
  },
};
