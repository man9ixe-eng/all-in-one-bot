// src/commands/sessions/sessionqueue.js

const { SlashCommandBuilder } = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');
const { openQueueForCard } = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessionqueue')
    .setDescription('Open a staff queue for a Trello session card.')
    .setDMPermission(false)
    .addStringOption(option =>
      option
        .setName('card')
        .setDescription('Trello card link for this session.')
        .setRequired(true),
    ),

  async execute(interaction) {
    if (!atLeastTier(interaction.member, 4)) {
      return interaction.reply({
        content: 'You must be at least **Tier 4 (Management)** to use `/sessionqueue`.',
        ephemeral: true,
      });
    }

    const cardUrl = interaction.options.getString('card', true);

    await interaction.deferReply({ ephemeral: true });

    const ok = await openQueueForCard(interaction.client, cardUrl, interaction.user.tag);

    if (!ok) {
      return interaction.editReply(
        'I could not open a queue for that Trello card.\n' +
          '• Make sure the link is valid\n' +
          '• The card has the correct session labels or `[Interview]/[Training]/[Mass Shift]` in the name\n' +
          '• The queue channels/roles are configured in `SESSION_*`/`QUEUE_*` env vars.',
      );
    }

    return interaction.editReply(
      '✅ Queue post created for that session. Staff can now claim roles using the buttons in the queue channel.',
    );
  },
};
