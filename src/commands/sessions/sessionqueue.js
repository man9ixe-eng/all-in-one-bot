// src/commands/sessions/sessionqueue.js

const { SlashCommandBuilder } = require('discord.js');
const { openQueueForCard } = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessionqueue')
    .setDescription('Open a Glace session queue for a Trello session card.')
    .addStringOption(option =>
      option
        .setName('card')
        .setDescription('Trello card link or short URL (e.g. https://trello.com/c/... )')
        .setRequired(true)
    ),
  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const rawCard = interaction.options.getString('card', true);
    console.log('[QUEUE] Raw card option:', rawCard);

    const ok = await openQueueForCard({
      client: interaction.client,
      rawCardInput: rawCard,
    });

    if (!ok) {
      await interaction.editReply(
        'I could not open a queue for that Trello card.\n' +
          '• Make sure the link is valid\n' +
          '• The card has the correct session labels or [Interview], [Training], [Mass Shift] in the name\n' +
          '• The queue / attendees channels are configured in QUEUE_* and ATTENDEES_* env vars.'
      );
    } else {
      await interaction.editReply(
        '✅ Session queue opened successfully.'
      );
    }
  },
};
