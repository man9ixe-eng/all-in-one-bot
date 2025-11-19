// src/commands/moderation/slowmode.js

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');
const { logModerationAction } = require('../../utils/modlog');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('Set or clear slowmode for a channel.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addIntegerOption(option =>
      option
        .setName('seconds')
        .setDescription('Slowmode delay in seconds (0 to disable, up to 21600).')
        .setRequired(true),
    )
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Channel to apply slowmode to (defaults to this channel).')
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
        .setDescription('Reason for changing slowmode.')
        .setRequired(false),
    ),

  /**
   * /slowmode
   * Tier 4+ (Management and up).
   */
  async execute(interaction) {
    if (!atLeastTier(interaction.member, 4)) {
      return interaction.reply({
        content: 'You must be at least **Tier 4 (Management)** to use `/slowmode`.',
        ephemeral: true,
      });
    }

    const seconds = interaction.options.getInteger('seconds', true);
    const channelOption = interaction.options.getChannel('channel');
    const reason = interaction.options.getString('reason') || 'No reason provided';

    if (seconds < 0 || seconds > 21600) {
      return interaction.reply({
        content: 'Slowmode seconds must be between **0** and **21600** (6 hours).',
        ephemeral: true,
      });
    }

    const targetChannel = channelOption || interaction.channel;

    if (!targetChannel || targetChannel.guildId !== interaction.guildId) {
      return interaction.reply({
        content: 'I could not use that channel. Make sure it is in this server.',
        ephemeral: true,
      });
    }

    if (!targetChannel.isTextBased()) {
      return interaction.reply({
        content: 'I can only set slowmode on text channels.',
        ephemeral: true,
      });
    }

    try {
      await targetChannel.setRateLimitPerUser(seconds, reason);

      const human = seconds === 0
        ? 'Disabled slowmode'
        : `Set slowmode to **${seconds}** second(s)`;

      await interaction.reply({
        content: `${human} in ${targetChannel}.\nReason: ${reason}`,
      });

      await logModerationAction(interaction, {
        action: 'Slowmode Change',
        reason,
        details: `${human} in ${targetChannel}.`,
      });
    } catch (err) {
      console.error('[SLOWMODE] Failed to change slowmode:', err);
      await interaction.reply({
        content: 'I could not change slowmode. Check my permissions in that channel.',
        ephemeral: true,
      });
    }
  },
};
