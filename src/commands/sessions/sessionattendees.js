// src/commands/sessions/sessionattendees.js

const { SlashCommandBuilder } = require('discord.js');
const { finalizeAttendeesForCard } = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessionattendees')
    .setDescription('Close the queue and post the attendees list for a Trello session card.')
    .addStringOption(option =>
      option
        .setName('card')
        .setDescription('Trello card link or short URL (same card used for /sessionqueue)')
        .setRequired(true)
    ),
  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const rawCard = interaction.options.getString('card', true);

    const ok = await finalizeAttendeesForCard({
      client: interaction.client,
      rawCardInput: rawCard,
    });

    if (!ok) {
      await interaction.editReply(
        'I could not generate an attendees list for that Trello card.\n' +
          '• Make sure a queue was opened for this card using `/sessionqueue`\n' +
          '• Make sure the card is an Interview, Training, or Mass Shift\n' +
          '• Make sure the queue has at least one person in it.'
      );
    } else {
      await interaction.editReply('✅ Attendees list has been posted.');
    }
  },
};
