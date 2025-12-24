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
    .addStringOption(option =>
      option
        .setName('card')
        .setDescription('Trello card URL or short ID')
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

    // Extract a usable Trello card short ID for:
    // 1) Trello cancel call
    // 2) Wiring into cancel_log_yes/no_<shortId> buttons
    let cardId = cardInput;
    let shortId = null;

    if (cardInput.includes('trello.com')) {
      // e.g. https://trello.com/c/pBWyFkos/443-name-here
      const match = cardInput.match(/\/c\/([A-Za-z0-9]+)/);
      if (match) {
        shortId = match[1];
        cardId = shortId;
      }
    } else {
      // If it's just something like pBWyFkos
      const match = cardInput.match(/^([A-Za-z0-9]{6,10})$/);
      if (match) {
        shortId = match[1];
        cardId = shortId;
      }
    }

    // 1) Cancel the session card on Trello
    const success = await cancelSessionCard({ cardId, reason });

    if (!success) {
      await interaction.editReply(
        '⚠️ I tried to cancel that session on Trello, but something went wrong.\n' +
        'Please double-check the card link/ID and my Trello configuration.',
      );
      setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
      return;
    }

    // Confirm cancel
    await interaction.editReply('✅ Successfully cancelled the session on Trello.');

    // If we couldn't derive a shortId, we can't tie it back to a queue,
    // so we stop here (Trello is still cancelled).
    if (!shortId) {
      setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
      return;
    }

    // 2) Ask if they want to log attendees (secondary ephemeral prompt with buttons)
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`cancel_log_yes_${shortId}`)
        .setLabel('Yes, log attendees')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`cancel_log_no_${shortId}`)
        .setLabel('No, don’t log')
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.followUp({
      content:
        'This session has been cancelled.\n' +
        'Do you want to **log attendees** for this cancelled session?\n\n' +
        '- **Yes** → I will log the attendees in the log channel and clean up the queue & attendees posts.\n' +
        '- **No** → I will only clean up the queue & attendees posts (no log is created).',
      components: [row],
      ephemeral: true,
    });
  },
};
