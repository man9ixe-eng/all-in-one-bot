// src/utils/modlog.js

const { EmbedBuilder } = require('discord.js');
const { MODLOG_CHANNEL_ID } = require('../config/modlog');
const { getTier, getTierLabel } = require('./permissions');

/**
 * Log a moderation action to the configured mod-log channel.
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {{
 *   action: string,
 *   targetUser?: import('discord.js').User,
 *   reason?: string,
 *   details?: string
 * }} options
 */
async function logModerationAction(interaction, options) {
  try {
    const guild = interaction.guild;
    if (!guild) return;

    if (!MODLOG_CHANNEL_ID) {
      console.warn('[MODLOG] MODLOG_CHANNEL_ID is not set in src/config/modlog.js');
      return;
    }

    const channel = guild.channels.cache.get(MODLOG_CHANNEL_ID);
    if (!channel) {
      console.warn(`[MODLOG] Channel ${MODLOG_CHANNEL_ID} not found in guild ${guild.id}`);
      return;
    }

    const staffMember = interaction.member;
    const staffUser = interaction.user;

    const tierNum = getTier(staffMember);
    const tierName = getTierLabel(tierNum); // e.g. "Corporate"

    const embed = new EmbedBuilder()
      .setTitle(`Moderation Action: ${options.action}`)
      .setTimestamp(new Date())
      .setColor(0xffaa00)
      .addFields(
        { name: 'Staff', value: `${staffUser.tag} (${staffUser.id})`, inline: true },
        { name: 'Tier', value: tierName, inline: true },
      );

    if (options.targetUser) {
      embed.addFields({
        name: 'Target',
        value: `${options.targetUser.tag} (${options.targetUser.id})`,
        inline: false,
      });
    }

    if (options.reason) {
      embed.addFields({
        name: 'Reason',
        value: options.reason,
        inline: false,
      });
    }

    if (options.details) {
      embed.addFields({
        name: 'Details',
        value: options.details,
        inline: false,
      });
    }

    await channel.send({ embeds: [embed] });
    console.log(`[MODLOG] Logged ${options.action} for ${options.targetUser?.tag ?? 'N/A'}`);
  } catch (err) {
    console.error('[MODLOG] Failed to send moderation log:', err);
  }
}

module.exports = {
  logModerationAction,
};
