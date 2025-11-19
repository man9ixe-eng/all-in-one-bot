// src/commands/sessions/cancelsession.js

const { SlashCommandBuilder } = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');
const { markSessionCanceled } = require('../../utils/trelloClient');
const { logModerationAction } = require('../../utils/modlog');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cancelsession')
    .setDescription('Cancel a scheduled Trello session.')
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
        .setDescription('Reason for canceling this session.')
        .setRequired(true),
    )
    .addBooleanOption(option =>
      option
        .setName('logged')
        .setDescription('Was this session logged in Hyra?')
        .setRequired(true),
    ),

  /**
   * /cancelsession – Tier 4+ (Management and up)
   */
  async execute(interaction) {
    if (!atLeastTier(interaction.member, 6)) {
      return interaction.reply({
        content: 'You must be at least Corporate to use `/cancelsession`.',
        ephemeral: true,
      });
    }

    const cardLink = interaction.options.getString('card_link', true);
    const reason = interaction.options.getString('reason', true);
    const logged = interaction.options.getBoolean('logged', true);

    try {
      const updatedCard = await markSessionCanceled(cardLink, {
        reason,
        logged,
        actorTag: interaction.user.tag,
        actorId: interaction.user.id,
      });

      await interaction.reply({
        content:
          `Marked session as **CANCELED** and moved to Completed list.\n` +
          `Card: ${updatedCard.shortUrl || updatedCard.url || updatedCard.id}`,
        ephemeral: true,
      });

      await logModerationAction(interaction, {
        action: 'Session Canceled',
        reason,
        details:
          `Card: ${updatedCard.shortUrl || updatedCard.url || updatedCard.id}\n` +
          `Logged in Hyra: ${logged ? 'YES' : 'NO'}`,
      });
    } catch (err) {
      console.error('[CANCELSESSION] Failed to cancel session:', err);
      await interaction.reply({
        content:
          'I could not cancel that Trello session. Check the card link and my Trello config.',
        ephemeral: true,
      });
    }
  },
};
