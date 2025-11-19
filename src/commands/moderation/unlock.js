// src/commands/moderation/unlock.js

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');
const { logModerationAction } = require('../../utils/modlog');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('Unlock a channel (restore @everyone ability to send messages).')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    // REQUIRED first
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for unlocking the channel.')
        .setRequired(true),
    )
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Channel to unlock (defaults to this channel).')
        .addChannelTypes(
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement,
          ChannelType.PublicThread,
          ChannelType.PrivateThread,
        )
        .setRequired(false),
    ),

  /**
   * /unlock
   * Tier 5+ (Senior Management and up).
   */
  async execute(interaction) {
    if (!atLeastTier(interaction.member, 5)) {
      return interaction.reply({
        content: 'You must be at least **Tier 5 (Senior Management)** to use `/unlock`.',
        ephemeral: true,
      });
    }

    const reason = interaction.options.getString('reason', true);
    const channelOption = interaction.options.getChannel('channel');
    const targetChannel = channelOption || interaction.channel;

    if (!targetChannel || targetChannel.guildId !== interaction.guildId) {
      return interaction.reply({
        content: 'I could not use that channel. Make sure it is in this server.',
        ephemeral: true,
      });
    }

    if (!targetChannel.isTextBased()) {
      return interaction.reply({
        content: 'I can only unlock text channels.',
        ephemeral: true,
      });
    }

    const everyoneRole = interaction.guild.roles.everyone;

    try {
      // Reset SendMessages to inherit defaults
      await targetChannel.permissionOverwrites.edit(
        everyoneRole,
        { SendMessages: null },
        { reason: `Channel unlocked by ${interaction.user.tag}: ${reason}` },
      );

      await interaction.reply({
        content: `🔓 Unlocked ${targetChannel}.\nReason: ${reason}`,
      });

      await logModerationAction(interaction, {
        action: 'Channel Unlock',
        reason,
        details: `Channel: ${targetChannel}`,
      });
    } catch (err) {
      console.error('[UNLOCK] Failed to unlock channel:', err);
      await interaction.reply({
        content: 'I could not unlock that channel. Check my permissions and role position.',
        ephemeral: true,
      });
    }
  },
};
