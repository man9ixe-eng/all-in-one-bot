// src/commands/sessions/removesession.js

const { SlashCommandBuilder } = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');
const { removeSessionCard } = require('../../utils/trelloClient');
const { logModerationAction } = require('../../utils/modlog');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('removesession')
    .setDescription('Remove/archive a Trello session card.')
    .setDMPermission(false)
    .addStringOption(option =>
      option
        .setName('card_link')
        .setDescription('Trello card link or ID for the session.')
        .setRequired(true),
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for removing this session.')
        .setRequired(true),
    ),

  /**
   * /removesession – Tier 6+ (Corporate and up)
   */
  async execute(interaction) {
    if (!atLeastTier(interaction.member, 6)) {
      return interaction.reply({
        content: 'You must be at least ** (Corporate)** to use `/removesession`.',
        ephemeral: true,
      });
    }

    const cardLink = interaction.options.getString('card_link', true);
    const reason = interaction.options.getString('reason', true);

    try {
      const card = await removeSessionCard(cardLink, {
        reason,
        actorTag: interaction.user.tag,
        actorId: interaction.user.id,
      });

      await interaction.reply({
        content:
          `Archived the session card.\n` +
          `Card: ${card.shortUrl || card.url || card.id}`,
        ephemeral: true,
      });

      await logModerationAction(interaction, {
        action: 'Session Removed',
        reason,
        details: `Card: ${card.shortUrl || card.url || card.id}`,
      });
    } catch (err) {
      console.error('[REMOVESESSION] Failed to remove session:', err);
      await interaction.reply({
        content:
          'I could not remove that Trello session. Check the card link and my Trello config.',
        ephemeral: true,
      });
    }
  },
};
