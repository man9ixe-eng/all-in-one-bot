const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { cancelSessionCard } = require('../../utils/trelloClient');
const { extractShortId } = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cancelsession')
    .setDescription('Cancel a Trello session card.')
    .addStringOption(option =>
      option
        .setName('card')
        .setDescription('Trello card URL or ID')
        .setRequired(true),
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for cancellation')
        .setRequired(false),
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

    const shortId = extractShortId(cardInput) || cardId;

    const success = await cancelSessionCard({ cardId, reason });

    if (!success) {
      await interaction.editReply(
        '⚠️ I tried to cancel that session on Trello, but something went wrong.\nPlease double-check the card link/ID and my Trello configuration.',
      );
      return;
    }

    await interaction.editReply('✅ Successfully canceled the session on Trello.');

    // Ask if they want to log attendees for this cancelled session
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`cancel_log_yes_${shortId}`)
        .setLabel('✅ Yes, log attendees & clean up')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`cancel_log_no_${shortId}`)
        .setLabel('🚫 No, just clean up')
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.followUp({
      content:
        'This session has been cancelled.\n' +
        'Do you want to log attendees for this cancelled session?\n' +
        '• **Yes** – I will log attendees into the log channel and delete the queue + attendees posts.\n' +
        '• **No** – I will just delete the queue + attendees posts.',
      components: [row],
      ephemeral: true,
    });
  },
};
