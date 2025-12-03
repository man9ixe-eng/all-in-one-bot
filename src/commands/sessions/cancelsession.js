// src/commands/sessions/cancelsession.js

const { SlashCommandBuilder } = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');
const { cancelSessionCard } = require('../../utils/trelloClient');

function extractCardIdFromInput(raw) {
  if (!raw) return null;
  const input = raw.trim();

  // If they paste a raw ID (24+ hex chars), just use it
  if (/^[0-9a-fA-F]{8,}$/.test(input)) {
    return input;
  }

  // Try to parse as URL
  try {
    const url = new URL(input);
    const parts = url.pathname.split('/').filter(Boolean); // e.g. ['c', 'abcd1234', 'card-name']

    const cIndex = parts.indexOf('c');
    if (cIndex !== -1 && parts.length > cIndex + 1) {
      // https://trello.com/c/<shortLink>/<slug>
      return parts[cIndex + 1];
    }

    // Fallback: last part of path
    if (parts.length > 0) {
      return parts[parts.length - 1];
    }
  } catch {
    // Not a URL, ignore
  }

  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cancelsession')
    .setDescription('Cancel a scheduled session (mark card canceled and move to Completed).')
    .setDMPermission(false)
    .addStringOption(option =>
      option
        .setName('card')
        .setDescription('Trello card link or ID.')
        .setRequired(true),
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for cancellation.')
        .setRequired(true),
    )
    .addStringOption(option =>
      option
        .setName('logged')
        .setDescription('Was this session already logged?')
        .setRequired(false)
        .addChoices(
          { name: 'Yes', value: 'yes' },
          { name: 'No', value: 'no' },
        ),
    ),

  /**
   * /cancelsession – Tier 5+ by default
   */
  async execute(interaction) {
    if (!atLeastTier(interaction.member, 5)) {
      return interaction.reply({
        content: 'You must be at least **Tier 5 (Senior Management)** to cancel sessions.',
        ephemeral: true,
      });
    }

    const cardInput = interaction.options.getString('card', true);
    const reason = interaction.options.getString('reason', true);
    const logged = interaction.options.getString('logged') || 'no';

    const cardId = extractCardIdFromInput(cardInput);
    if (!cardId) {
      return interaction.reply({
        content:
          'I could not understand that Trello card link or ID.\n' +
          'Please paste the full card URL from Trello or a valid card ID.',
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const ok = await cancelSessionCard({ cardId, reason });

    if (!ok) {
      return interaction.editReply(
        'I tried to update that Trello card but something went wrong.\n' +
          'Please double-check the link/ID and my Trello settings.'
      );
    }

    return interaction.editReply(
      `Session has been **canceled** and moved to the Completed list.\n` +
        `Card ID: \`${cardId}\`\nLogged: **${logged === 'yes' ? 'Yes' : 'No'}**.`
    );
  },
};
