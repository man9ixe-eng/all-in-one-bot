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
        .setDescription('Trello card URL or ID')
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

    // Extract Trello ID / short link
    let cardId = cardInput;
    let shortId = null;

    if (cardInput.includes('trello.com')) {
      const match = cardInput.match(/\/c\/([A-Za-z0-9]+)/);
      if (match) {
        cardId = match[1];
        shortId = match[1];
      }
    } else {
      const match = cardInput.match(/^([A-Za-z0-9]{6,10})$/);
      if (match) {
        cardId = match[1];
        shortId = match[1];
      }
    }

    if (!shortId) {
      shortId = cardId;
    }

    const success = await cancelSessionCard({ cardId, reason });

    if (!success) {
      await interaction.editReply(
        '⚠️ I tried to cancel that session on Trello, but something went wrong.\nPlease double-check the card link/ID and my Trello configuration.',
      );
      return;
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`cancel_log_yes_${shortId}`)
        .setLabel('Yes, log attendees')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`cancel_log_no_${shortId}`)
        .setLabel('No, just clean up')
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.editReply({
      content:
        '✅ Session has been cancelled on Trello.\nDo you want to log attendees for this cancelled session?',
      components: [row],
    });
  },
};
