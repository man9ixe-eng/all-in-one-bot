// src/commands/moderation/lock.js

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');
const { logModerationAction } = require('../../utils/modlog');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Lock a channel (prevent @everyone from sending messages).')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Channel to lock (defaults to this channel).')
        .addChannelTypes(
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement,
          ChannelType.PublicThread,
          ChannelType.PrivateThread,
        )
        .setRequired(false),
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for locking the channel.')
        .setRequired(true),
    ),

  /**
   * /lock
   * Tier 5+ (Senior Management and up).
   */
  async execute(interaction) {
    if (!atLeastTier(interaction.member, 5)) {
      return interaction.reply({
        content: 'You must be at least **Tier 5 (Senior Management)** to use `/lock`.',
        ephemeral: true,
      });
    }

    const channelOption = interaction.options.getChannel('channel');
    const reason = interaction.options.getString('reason', true);
    const targetChannel = channelOption || interaction.channel;

    if (!targetChannel || targetChannel.guildId !== interaction.guildId) {
      return interaction.reply({
        content: 'I could not use that channel. Make sure it is in this server.',
        ephemeral: true,
      });
    }

    if (!targetChannel.isTextBased()) {
      return interaction.reply({
        content: 'I can only lock text channels.',
        ephemeral: true,
      });
    }

    const everyoneRole = interaction.guild.roles.everyone;

    try {
      await targetChannel.permissionOverwrites.edit(everyoneRole, {
        SendMessages: false,
      }, { reason: `Channel locked by ${interaction.user.tag}: ${reason}` });

      await interaction.reply({
        content: `🔒 Locked ${targetChannel}.\nReason: ${reason}`,
      });

      await logModerationAction(interaction, {
        action: 'Channel Lock',
        reason,
        details: `Channel: ${targetChannel}`,
      });
    } catch (err) {
      console.error('[LOCK] Failed to lock channel:', err);
      await interaction.reply({
        content: 'I could not lock that channel. Check my permissions and role position.',
        ephemeral: true,
      });
    }
  },
};
