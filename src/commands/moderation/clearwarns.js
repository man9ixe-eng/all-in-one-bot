// src/commands/moderation/clearwarns.js
// Command name: /clearwarnall – clear ALL warnings for a user (Tier 6+)

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');
const { clearWarnings, getWarnings } = require('../../utils/warningsStore');
const { logModerationAction } = require('../../utils/modlog');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clearwarnall')
    .setDescription('Clear ALL warnings for a member.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('The member whose warnings you want to clear.')
        .setRequired(true),
    ),

  /**
   * /clearwarnall
   * Tier 6+ (Corporate and up) can use this.
   */
  async execute(interaction) {
    // Tier 6+ (Corporate / Presidential)
    if (!atLeastTier(interaction.member, 6)) {
      return interaction.reply({
        content: 'You must be at least **Tier 6 (Corporate)** to use `/clearwarnall`.',
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
      content: `Cleared **ALL ${existing.length}** warning(s) for **${targetUser.tag}**.`,
    });

    await logModerationAction(interaction, {
      action: 'Clear All Warnings',
      targetUser,
      reason: `Cleared all (${existing.length}) warning(s) for this user.`,
    });
  },
};
