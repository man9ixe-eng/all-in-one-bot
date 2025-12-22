// src/commands/sessions/sessionattendees.js
const { SlashCommandBuilder } = require('discord.js');
const { postAttendeesForCard } = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessionattendees')
    .setDescription('Post the selected attendees list for a session queue.')
    .addStringOption((option) =>
      option
        .setName('card')
        .setDescription('Trello card link or short URL (same one used for /sessionqueue)')
        .setRequired(true),
    ),

  async execute(interaction) {
    try {
      await interaction.deferReply({ ephemeral: true });

      const cardInput = interaction.options.getString('card', true);

      const result = await postAttendeesForCard(interaction.client, cardInput);

      if (!result || !result.ok) {
        const reason = result && result.reason;

        if (reason === 'no-queue') {
          await interaction.editReply(
            'I could not post attendees for that Trello card.\n' +
              '• Make sure you already opened a queue for this card using `/sessionqueue`.',
          );
        } else if (reason === 'invalid-card') {
          await interaction.editReply(
            'I could not understand that Trello link. Please use the full card URL or short URL.',
          );
        } else {
          await interaction.editReply(
            'I could not post attendees for that Trello card. Check that the queue exists and try again.',
          );
        }

        return;
      }

      await interaction.editReply(
        `✅ Attendees post sent in <#${result.channelId}> for Trello card \`${result.shortId}\`.`,
      );
    } catch (err) {
      console.error(
        '[SESSIONATTENDEES] Error while executing /sessionattendees:',
        err,
      );

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
