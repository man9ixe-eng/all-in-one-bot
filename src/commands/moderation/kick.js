// src/commands/moderation/kick.js

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member from the server.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('The member to kick.')
        .setRequired(true),
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for the kick.')
        .setRequired(false),
    ),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   */
  async execute(interaction) {
    // Tier check: Tier 6+ (Management and up)
    if (!atLeastTier(interaction.member, 6)) {
      return interaction.reply({
        content: 'You do not have permissions to do that.',
        ephemeral: true,
      });
    }

    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') || 'No reason provided';

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      return interaction.reply({
        content: 'I could not find that member in the server.',
        ephemeral: true,
      });
    }

    if (!member.kickable) {
      return interaction.reply({
        content: 'I cannot kick this member. They might have a higher role than me.',
        ephemeral: true,
      });
    }

    if (member.id === interaction.user.id) {
      return interaction.reply({
        content: 'You cannot kick yourself.',
        ephemeral: true,
      });
    }

    try {
      await member.kick(reason);
      await interaction.reply({
        content: `Kicked **${member.user.tag}**.\nReason: ${reason}`,
      });
    } catch (error) {
      console.error(error);
      await interaction.reply({
        content: 'I could not kick that member. Check my permissions and role position.',
        ephemeral: true,
      });
    }
  },
};
