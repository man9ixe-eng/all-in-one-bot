// src/commands/sessions/cancelsession.js
const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { cancelSessionCard } = require('../../utils/trelloClient');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cancelsession')
    .setDescription('Cancel a Trello session card.')
    .addStringOption((option) =>
      option
        .setName('card')
        .setDescription('Trello card URL or short ID')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('Reason for cancellation')
        .setRequired(false),
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const cardInput = interaction.options.getString('card');
    const reason =
      interaction.options.getString('reason') || 'No reason provided.';

    // Extract Trello ID or shortlink for Trello API
    let cardId = cardInput;
    if (cardInput.includes('trello.com')) {
      const match = cardInput.match(/\/c\/([A-Za-z0-9]+)/);
      if (match) cardId = match[1];
    }

    const success = await cancelSessionCard({ cardId, reason });

    if (!success) {
      await interaction.editReply(
        '⚠️ I tried to cancel that session on Trello, but something went wrong.\nPlease double-check the card link/ID and my Trello configuration.',
      );
      return;
    }

    // Trello cancellation successful -> ask if we should log attendees & cleanup.
    const shortIdMatch = cardInput.match(/trello\.com\/c\/([A-Za-z0-9]+)/);
    const shortId = shortIdMatch ? shortIdMatch[1] : null;

    if (!shortId) {
      await interaction.editReply(
        '✅ Successfully canceled the session on Trello.\nHowever, I could not detect the card short ID from your link, so I cannot offer attendee logging for this cancelled session.',
      );
      return;
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`cancel_log_yes_${shortId}`)
        .setLabel('✅ Yes, log attendees & clean up')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`cancel_log_no_${shortId}`)
        .setLabel('🧹 No, just clean up')
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.editReply({
      content:
        '✅ This session has been **cancelled** on Trello.\nDo you want to log the attendees for this cancelled session as well?',
      components: [row],
    });
  },
};
