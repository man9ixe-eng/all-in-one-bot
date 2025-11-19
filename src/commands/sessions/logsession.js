// src/commands/sessions/logsession.js

const { SlashCommandBuilder } = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');
const { markSessionCompleted } = require('../../utils/trelloClient');
const { logModerationAction } = require('../../utils/modlog');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('logsession')
    .setDescription('Mark a Trello session as completed.')
    .setDMPermission(false)
    .addStringOption(option =>
      option
        .setName('card_link')
        .setDescription('Trello card link or ID for the session.')
        .setRequired(true),
    )
    .addStringOption(option =>
      option
        .setName('notes')
        .setDescription('Optional notes (e.g. attendees, passes).')
        .setRequired(false),
    ),

  /**
   * /logsession – Tier 4+ (Management and up)
   */
  async execute(interaction) {
    if (!atLeastTier(interaction.member, 6)) {
      return interaction.reply({
        content: 'You must be at least Corproate to use `/logsession`.',
        ephemeral: true,
      });
    }

    const cardLink = interaction.options.getString('card_link', true);
    const notes = interaction.options.getString('notes') || '';

    try {
      const updatedCard = await markSessionCompleted(cardLink, {
        reason: notes,
        actorTag: interaction.user.tag,
        actorId: interaction.user.id,
      });

      await interaction.reply({
        content:
          `Marked session as **COMPLETED** and moved to Completed list.\n` +
          `Card: ${updatedCard.shortUrl || updatedCard.url || updatedCard.id}`,
        ephemeral: true,
      });

      await logModerationAction(interaction, {
        action: 'Session Completed',
        reason: notes || 'No notes provided',
        details: `Card: ${updatedCard.shortUrl || updatedCard.url || updatedCard.id}`,
      });
    } catch (err) {
      console.error('[LOGSESSION] Failed to complete session:', err);
      await interaction.reply({
        content:
          'I could not log that Trello session. Check the card link and my Trello config.',
        ephemeral: true,
      });
    }
  },
};
