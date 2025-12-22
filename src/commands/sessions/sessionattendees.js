// src/commands/sessions/sessionattendees.js

const { SlashCommandBuilder } = require('discord.js');
const { postAttendeesForCard } = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessionattendees')
    .setDescription('Post the selected attendees list based on an open queue')
    .addStringOption((opt) =>
      opt
        .setName('card')
        .setDescription('Trello card link or short ID used for the queue')
        .setRequired(true),
    ),

  async execute(interaction) {
    const cardInput = interaction.options.getString('card', true);

    try {
      const result = await postAttendeesForCard(
        interaction.client,
        cardInput,
      );

      if (!result.ok) {
        const msg =
          result.errorMessage ||
          'I could not post attendees for that Trello card.';
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: msg, ephemeral: true });
        } else if (interaction.deferred) {
          await interaction.editReply({ content: msg });
        }
        return;
      }

      const confirm = `✅ Posted attendees list for that card.`;
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: confirm, ephemeral: true });
      } else {
        await interaction.editReply({ content: confirm });
      }
    } catch (err) {
      console.error(
        '[SESSIONATTENDEES] Error while executing /sessionattendees:',
        err,
      );

      if (!interaction.replied && !interaction.deferred) {
        try {
          await interaction.reply({
            content:
              'There was an error while trying to post the attendees list for that card.',
            ephemeral: true,
          });
        } catch {
          // ignore
        }
      }
    }
  },
};
