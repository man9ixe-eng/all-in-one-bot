const { SlashCommandBuilder } = require('discord.js');
const { cancelSessionCard } = require('../../utils/trelloClient');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cancelsession')
    .setDescription('Cancel a Trello session card.')
    .addStringOption(option =>
      option
        .setName('card')
        .setDescription('Trello card URL or ID')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for cancellation')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const cardInput = interaction.options.getString('card');
    const reason = interaction.options.getString('reason') || 'No reason provided.';

    // Extract Trello ID or shortlink
    let cardId = cardInput;
    if (cardInput.includes('trello.com')) {
      const match = cardInput.match(/\/c\/([A-Za-z0-9]+)/);
      if (match) cardId = match[1];
    }

    const success = await cancelSessionCard({ cardId, reason });

    if (success) {
      await interaction.editReply('✅ Successfully canceled the session on Trello.');

      // Prompt about logging attendees AFTER we know it’s cancelled
      await interaction.followUp({
        content:
          'This session has been cancelled.\n' +
          'Do you want to log attendees for this cancelled session?\n' +
          '• If **yes**, run `/sessionattendees` with the same Trello card, then `/logsession` (this will also clean up the queue & attendees posts).\n' +
          '• If **no**, you can ignore this message.',
        ephemeral: true,
      });
    } else {
      await interaction.editReply(
        '⚠️ I tried to cancel that session on Trello, but something went wrong.\n' +
        'Please double-check the card link/ID and my Trello configuration.'
      );
    }
  },
};
