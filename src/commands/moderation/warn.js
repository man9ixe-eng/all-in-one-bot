// src/commands/moderation/warn.js

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');
const { addWarning } = require('../../utils/warningsStore');
const { logModerationAction } = require('../../utils/modlog');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Issue a warning to a member.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('The member to warn.')
        .setRequired(true),
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for the warning.')
        .setRequired(true),
    ),

  /**
   * /warn
   * Tier 4+ (Management and up) can use this.
   */
  async execute(interaction) {
    // Tier 4+ check
    if (!atLeastTier(interaction.member, 4)) {
      return interaction.reply({
        content: 'You must be at least **Tier 4 (Management)** to use `/warn`.',
        ephemeral: true,
      });
    }

    const targetUser = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason', true);

    if (targetUser.id === interaction.user.id) {
      return interaction.reply({
        content: 'You cannot warn yourself.',
        ephemeral: true,
      });
    }

    const guildId = interaction.guild.id;

    // Store warning in JSON
    const warnings = addWarning(guildId, targetUser.id, {
      moderatorId: interaction.user.id,
      moderatorTag: interaction.user.tag,
      reason,
      timestamp: Date.now(),
    });

    await interaction.reply({
      content: `Warned **${targetUser.tag}**.\nReason: ${reason}\nThey now have **${warnings.length}** warning(s).`,
    });

    // Log to mod-log channel
    await logModerationAction(interaction, {
      action: 'Warn',
      targetUser,
      reason,
      details: `Total warnings for this user: ${warnings.length}`,
    });
  },
};
