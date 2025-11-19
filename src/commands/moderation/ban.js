// src/commands/moderation/ban.js

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member from the server.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('The member to ban.')
        .setRequired(true),
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for the ban.')
        .setRequired(false),
    ),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   */
  async execute(interaction) {
    // Tier check: Tier 6+ (Corporate and up)
    if (!atLeastTier(interaction.member, 6)) {
      return interaction.reply({
        content: 'You do not have the permission to execute this command.',
        ephemeral: true,
      });
    }

    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') || 'No reason provided';

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    if (member && !member.bannable) {
      return interaction.reply({
        content: 'I cannot ban this member. They might have a higher role than me.',
        ephemeral: true,
      });
    }

    if (user.id === interaction.user.id) {
      return interaction.reply({
        content: 'You cannot ban yourself.',
        ephemeral: true,
      });
    }

    try {
      await interaction.guild.members.ban(user.id, { reason });
      await interaction.reply({
        content: `Banned **${user.tag}**.\nReason: ${reason}`,
      });
    } catch (error) {
      console.error(error);
      await interaction.reply({
        content: 'I could not ban that member. Check my permissions and role position.',
        ephemeral: true,
      });
    }
  },
};
