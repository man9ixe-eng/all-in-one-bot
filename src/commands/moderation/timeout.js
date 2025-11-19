// src/commands/moderation/timeout.js

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');
const { logModerationAction } = require('../../utils/modlog');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Timeout (mute) a member for a set number of minutes.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('The member to timeout.')
        .setRequired(true),
    )
    .addIntegerOption(option =>
      option
        .setName('minutes')
        .setDescription('Duration in minutes (1–10080).')
        .setRequired(true),
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for the timeout.')
        .setRequired(false),
    ),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   */
  async execute(interaction) {
    // Tier 4+ (Management and up)
    if (!atLeastTier(interaction.member, 4)) {
      return interaction.reply({
        content: 'You must be at least **Tier 4 (Management)** to use `/timeout`.',
        ephemeral: true,
      });
    }

    const user = interaction.options.getUser('user', true);
    const minutes = interaction.options.getInteger('minutes', true);
    const reason = interaction.options.getString('reason') || 'No reason provided';

    if (minutes < 1 || minutes > 10080) {
      return interaction.reply({
        content: 'Minutes must be between **1** and **10080** (7 days).',
        ephemeral: true,
      });
    }

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      return interaction.reply({
        content: 'I could not find that member in the server.',
        ephemeral: true,
      });
    }

    if (!member.moderatable) {
      return interaction.reply({
        content: 'I cannot timeout this member. They might have a higher role than me.',
        ephemeral: true,
      });
    }

    if (member.id === interaction.user.id) {
      return interaction.reply({
        content: 'You cannot timeout yourself.',
        ephemeral: true,
      });
    }

    const ms = minutes * 60 * 1000;

    try {
      await member.timeout(ms, reason);
      await interaction.reply({
        content: `Timed out **${member.user.tag}** for **${minutes}** minute(s).\nReason: ${reason}`,
      });

      // Mod log
      await logModerationAction(interaction, {
        action: 'Timeout',
        targetUser: member.user,
        reason,
        details: `Duration: ${minutes} minute(s).`,
      });
    } catch (error) {
      console.error(error);
      await interaction.reply({
        content: 'I could not timeout that member. Check my permissions and role position.',
        ephemeral: true,
      });
    }
  },
};
