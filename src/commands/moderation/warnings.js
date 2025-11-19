// src/commands/moderation/warnings.js

const { SlashCommandBuilder } = require('discord.js');
const { getTier } = require('../../utils/permissions');
const { getWarnings } = require('../../utils/warningsStore');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('View warnings for a member.')
    .setDMPermission(false)
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('The member whose warnings you want to view.')
        .setRequired(false),
    ),

  /**
   * /warnings
   * Tier 4+ → can see anyone’s warnings.
   * Tier 3 and below → can ONLY see their own warnings.
   */
  async execute(interaction) {
    const requesterTier = getTier(interaction.member);
    const specifiedUser = interaction.options.getUser('user');
    const targetUser = specifiedUser || interaction.user;

    // Tier 3 or lower can only see their own warnings
    if (requesterTier < 4 && targetUser.id !== interaction.user.id) {
      return interaction.reply({
        content: 'You can only view your **own** warnings.',
        ephemeral: true,
      });
    }

    const guildId = interaction.guild.id;
    const warnings = getWarnings(guildId, targetUser.id);

    if (warnings.length === 0) {
      const msg =
        targetUser.id === interaction.user.id
          ? 'You currently have **no warnings**.'
          : `${targetUser.tag} currently has **no warnings**.`;

      return interaction.reply({
        content: msg,
        ephemeral: true,
      });
    }

    let description = '';
    warnings.forEach((w, index) => {
      const date = new Date(w.timestamp).toLocaleString();
      description += `**#${index + 1}** — ${date}\n`;
      description += `• Moderator: ${w.moderatorTag} (${w.moderatorId})\n`;
      description += `• Reason: ${w.reason}\n\n`;
    });

    const header =
      targetUser.id === interaction.user.id
        ? 'Here are **your** warnings:\n\n'
        : `Warnings for **${targetUser.tag}**:\n\n`;

    await interaction.reply({
      content: header + description,
      ephemeral: true,
    });
  },
};
