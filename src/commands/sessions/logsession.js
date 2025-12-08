// src/commands/sessions/logsession.js

const { SlashCommandBuilder } = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');
const { completeSessionCard } = require('../../utils/trelloClient');
<<<<<<< HEAD
const { deleteSessionAnnouncement } = require('../../utils/sessionAnnouncements');
=======
const { deleteSessionAnnouncement } = require('../../utils/sessionAutomation');
const { logModerationAction } = require('../../utils/modlog');
>>>>>>> dc15838f735a5c8333e499f72f63d8183400845f

// Extract a Trello card ID/shortID from a raw string or URL
function extractCardId(input) {
  if (!input) return null;
  const trimmed = input.trim();

  const urlMatch = trimmed.match(/trello\.com\/c\/([A-Za-z0-9]+)/i);
  if (urlMatch) return urlMatch[1];

  const idMatch = trimmed.match(/([A-Za-z0-9]{8,24})/);
  if (idMatch) return idMatch[1];

  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('logsession')
<<<<<<< HEAD
    .setDescription('Marks a Trello session card as completed.')
=======
    .setDescription('Mark a session as completed and move its Trello card.')
>>>>>>> dc15838f735a5c8333e499f72f63d8183400845f
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName('card')
<<<<<<< HEAD
        .setDescription('Trello card link or ID.')
        .setRequired(true),
=======
        .setDescription('Trello card link or ID')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('notes')
        .setDescription('Optional notes for the log / modlog')
        .setRequired(false),
>>>>>>> dc15838f735a5c8333e499f72f63d8183400845f
    ),

  /**
   * /logsession – Tier 4+ (Management and up)
   */
  async execute(interaction) {
    if (!atLeastTier(interaction.member, 4)) {
      return interaction.reply({
<<<<<<< HEAD
        content: 'You must be at least **Tier 4 (Management)** to use `/logsession`.',
=======
        content:
          'You must be at least **Tier 4 (Management)** to use `/logsession`.',
>>>>>>> dc15838f735a5c8333e499f72f63d8183400845f
        ephemeral: true,
      });
    }

<<<<<<< HEAD
    const cardInput = interaction.options.getString('card', true).trim();
    const cardMatch = cardInput.match(/(?:https:\/\/trello\.com\/c\/)?([a-zA-Z0-9]+)/);
    const cardId = cardMatch ? cardMatch[1] : null;

    if (!cardId) {
      return interaction.reply({
        content: 'Invalid Trello card link or ID provided.',
        ephemeral: true,
      });
    }

    try {
      const success = await completeSessionCard({ cardId });
      if (!success) {
        return interaction.reply({
          content:
            'I could not mark that session as completed. Please verify the Trello card link and try again.',
          ephemeral: true,
        });
      }

      await deleteSessionAnnouncement(interaction.client, cardId).catch(() => {});

      return interaction.reply({
        content: `✅ Successfully marked the session as **completed** and removed its scheduled announcement.`,
        ephemeral: true,
      });
    } catch (err) {
      console.error('[LOGSESSION] Error:', err);
      return interaction.reply({
        content: 'There was an error while executing this command.',
=======
    const cardInput = interaction.options.getString('card', true);
    const notes = interaction.options.getString('notes') || '';

    const cardId = extractCardId(cardInput);
    if (!cardId) {
      return interaction.reply({
        content:
          'I could not detect a valid Trello card ID from your input.\n' +
          'Please provide a Trello card link or ID.',
>>>>>>> dc15838f735a5c8333e499f72f63d8183400845f
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const success = await completeSessionCard({ cardId });

    if (!success) {
      return interaction.editReply({
        content:
          'I tried to mark that session as completed on Trello, but something went wrong.\n' +
          'Please double-check the card and my Trello configuration.',
      });
    }

    // Delete any “session starting soon” post tied to this card
    await deleteSessionAnnouncement(interaction.client, cardId).catch(() => {});

    const trelloUrl = `https://trello.com/c/${cardId}`;

    await interaction.editReply({
      content:
        `✅ Session has been **logged as completed** and moved to the completed list.\n` +
        `Card: ${trelloUrl}`,
    });

    const logReason =
      notes.trim().length > 0 ? notes.trim() : 'No additional notes.';

    await logModerationAction(interaction, {
      action: 'Session Completed',
      reason: logReason,
      details: `Card: ${trelloUrl}`,
    }).catch(() => {});
  },
};
