// src/commands/sessions/sessionqueue.js

const { SlashCommandBuilder } = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');
const { openQueueForCard } = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessionqueue')
    .setDescription('Open a session queue for a Trello session card.')
    .setDMPermission(false)
    .addStringOption(option =>
      option
        .setName('card_link')
        .setDescription('Trello card link for the session.')
        .setRequired(true),
    ),

  async execute(interaction) {
    if (!atLeastTier(interaction.member, 4)) {
      return interaction.reply({
        content: 'You must be at least **Tier 4 (Management)** to open a session queue.',
        ephemeral: true,
      });
    }

    const cardLink = interaction.options.getString('card_link', true);

    await interaction.deferReply({ ephemeral: true });

    const result = await openQueueForCard(interaction.client, cardLink);

    if (!result.ok) {
      let msg = 'I could not open a queue for that Trello card.';

      switch (result.error) {
        case 'INVALID_LINK':
          msg = 'That does not look like a valid Trello card link. Please paste the full card URL.';
          break;
        case 'TRELLO_FETCH_FAILED':
          msg = 'I could not load that Trello card from the API. Check your Trello config and card visibility.';
          break;
        case 'UNKNOWN_SESSION_TYPE':
          msg = 'I could not detect the session type from that card. Make sure it is in the Interview, Training, or Mass Shift list.';
          break;
        case 'NO_DUE_DATE':
        case 'INVALID_DUE':
          msg = 'That Trello card has no valid due date set. Please add one first.';
          break;
        case 'NO_QUEUE_CHANNEL':
          msg = 'No queue channel is configured for that session type in `sessionQueue.js`.';
          break;
        case 'QUEUE_ALREADY_EXISTS':
          msg = 'A queue is already open for that session card.';
          break;
        case 'QUEUE_CHANNEL_UNUSABLE':
          msg = 'The configured queue channel is not usable. Check the channel ID in `sessionQueue.js`.';
          break;
      }

      return interaction.editReply({ content: msg });
    }

    return interaction.editReply({
      content:
        '✅ Session queue has been posted.\nStaff can now join using the buttons on the queue message.',
    });
  },
};
