// src/commands/moderation/clearwarn.js
// Command name: /clearwarn – clear a specific warning by its number (Tier 6+)

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');
const { getWarnings, removeWarning } = require('../../utils/warningsStore');
const { logModerationAction } = require('../../utils/modlog');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clearwarn')
    .setDescription('Clear a specific warning for a member.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('The member whose warning you want to clear.')
        .setRequired(true),
    )
    .addIntegerOption(option =>
      option
        .setName('number')
        .setDescription('The warning # to clear (as shown in /warnings).')
        .setRequired(true)
        .setMinValue(1),
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for clearing this warning.')
        .setRequired(true),
    ),

  /**
   * /clearwarn
   * Tier 6+ (Corporate and up) can use this.
   */
  async execute(interaction) {
    // Tier 6+ (Corporate / Presidential)
    if (!atLeastTier(interaction.member, 6)) {
      return interaction.reply({
        content: 'You must be at least **Tier 6 (Corporate)** to use `/clearwarn`.',
        ephemeral: true,
      });
    }

    const targetUser = interaction.options.getUser('user', true);
    const warnNumber = interaction.options.getInteger('number', true);
    const clearReason = interaction.options.getString('reason', true);
    const guildId = interaction.guild.id;

    const existing = getWarnings(guildId, targetUser.id);
    if (existing.length === 0) {
      return interaction.reply({
        content: `${targetUser.tag} has no warnings to clear.`,
        ephemeral: true,
      });
    }

    if (warnNumber < 1 || warnNumber > existing.length) {
      return interaction.reply({
        content: `Invalid warning number. ${targetUser.tag} currently has **${existing.length}** warning(s).`,
        ephemeral: true,
      });
    }

    // Convert 1-based to 0-based index
    const index = warnNumber - 1;

    const { removed, remaining } = removeWarning(guildId, targetUser.id, index);
    if (!removed) {
      return interaction.reply({
        content: 'Something went wrong while removing that warning.',
        ephemeral: true,
      });
    }

    const originalReason = removed.reason || 'No original reason stored';
    const remainingCount = remaining.length;

    await interaction.reply({
      content:
        `Cleared warning **#${warnNumber}** for **${targetUser.tag}**.\n` +
        `Original reason: ${originalReason}\n` +
        `Clear reason: ${clearReason}\n` +
        `They now have **${remainingCount}** warning(s) remaining.`,
    });

    await logModerationAction(interaction, {
      action: 'Clear Warning',
      targetUser,
      reason: `Cleared warning #${warnNumber}. Clear reason: ${clearReason}`,
      details: `Original warning reason: ${originalReason}. Remaining warnings: ${remainingCount}`,
    });
  },
};
