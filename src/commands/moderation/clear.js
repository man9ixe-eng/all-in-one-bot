// src/commands/moderation/clear.js

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Bulk delete a number of recent messages in this channel.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(option =>
      option
        .setName('amount')
        .setDescription('How many messages to delete (1–100).')
        .setRequired(true),
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for clearing messages.')
        .setRequired(false),
    ),

  async execute(interaction) {
    // Tier 2+ (Junior Staff and up)
    if (!atLeastTier(interaction.member, 2)) {
      return interaction.reply({
        content: 'You must be at least **Tier 2 (Junior Staff)** to use `/clear`.',
        ephemeral: true,
      });
    }

    const amount = interaction.options.getInteger('amount', true);
    const reason = interaction.options.getString('reason') || 'No reason provided';

    if (amount < 1 || amount > 100) {
      return interaction.reply({
        content: 'Amount must be between **1** and **100**.',
        ephemeral: true,
      });
    }

    const channel = interaction.channel;

    try {
      await interaction.deferReply({ ephemeral: true });

      const deleted = await channel.bulkDelete(amount, true);

      await interaction.editReply(
        `Deleted **${deleted.size}** message(s) in ${channel}.\nReason: ${reason}`,
      );
    } catch (error) {
      console.error(error);
      await interaction.editReply(
        'I could not delete messages here. I might be missing permissions or messages are too old (14+ days).',
      );
    }
  },
};
