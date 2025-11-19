// src/commands/moderation/clearwarns.js

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');
const { clearWarnings, getWarnings } = require('../../utils/warningsStore');
const { logModerationAction } = require('../../utils/modlog');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clearwarns')
    .setDescription('Clear all warnings for a member.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('The member whose warnings you want to clear.')
        .setRequired(true),
    ),

  /**
   * /clearwarns
   * Tier 5+ (Senior Management and up) can use this.
   */
  async execute(interaction) {
    // Tier 5+ check
    if (!atLeastTier(interaction.member, 5)) {
      return interaction.reply({
        content: 'You must be at least **Tier 5 (Senior Management)** to use `/clearwarns`.',
        ephemeral: true,
      });
    }

    const targetUser = interaction.options.getUser('user', true);
    const guildId = interaction.guild.id;

    const existing = getWarnings(guildId, targetUser.id);
    if (existing.length === 0) {
      return interaction.reply({
        content: `${targetUser.tag} has no warnings to clear.`,
        ephemeral: true,
      });
    }

    const success = clearWarnings(guildId, targetUser.id);

    if (!success) {
      return interaction.reply({
        content: 'Something went wrong while clearing warnings.',
        ephemeral: true,
      });
    }

    await interaction.reply({
      content: `Cleared **${existing.length}** warning(s) for **${targetUser.tag}**.`,
    });

    await logModerationAction(interaction, {
      action: 'Clear Warnings',
      targetUser,
      reason: `Cleared ${existing.length} warning(s).`,
    });
  },
};
