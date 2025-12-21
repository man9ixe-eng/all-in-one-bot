// src/commands/sessions/sessionqueue.js

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');
const { openQueueForCard } = require('../../utils/sessionQueueManager');

/**
 * Try to extract a Trello card short ID from whatever the user typed.
 * Accepts:
 *  - Short ID: DwQbr3P5
 *  - Full link: https://trello.com/c/DwQbr3P5
 *  - Link wrapped in < > or with extra text: "<https://trello.com/c/DwQbr3P5> some text"
 */
function parseCardIdFromInput(input) {
  const raw = (input || '').trim();
  console.log('[QUEUE] Raw card option:', raw);

  if (!raw) return null;

  // Strip single surrounding < > if Discord wrapped the link
  let text = raw.replace(/^<|>$/g, '');

  // If it contains a URL anywhere, try to pull that URL out
  const urlMatch = text.match(/https?:\/\/\S+/);
  if (urlMatch) {
    text = urlMatch[0];
  }

  // Case 1: looks like a pure short ID (no slashes, just letters/numbers)
  if (/^[A-Za-z0-9]+$/.test(text) && text.length >= 8 && text.length <= 16) {
    return text;
  }

  // Case 2: try to treat it as a Trello URL
  try {
    const url = new URL(text);
    if (url.hostname.includes('trello.com')) {
      const parts = url.pathname.split('/').filter(Boolean); // e.g. ["c", "DwQbr3P5"]
      const cIndex = parts.indexOf('c');
      if (cIndex !== -1 && parts[cIndex + 1]) {
        return parts[cIndex + 1];
      }
      // Fallback: last path segment if it looks like an ID
      const last = parts[parts.length - 1];
      if (last && /^[A-Za-z0-9]+$/.test(last)) {
        return last;
      }
    }
  } catch (e) {
    // not a URL, ignore
  }

  console.log('[QUEUE] Could not parse Trello card id from:', raw);
  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessionqueue')
    .setDescription('Open a staff queue for a Trello session card.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(option =>
      option
        .setName('card')
        .setDescription('Trello card link or short ID (e.g. https://trello.com/c/DwQbr3P5)')
        .setRequired(true),
    ),

  async execute(interaction) {
    // You can change this to your tier system if you want,
    // right now this just uses ManageGuild perms as gate.
    if (!atLeastTier(interaction.member, 4)) {
      return interaction.reply({
        content: 'You must be at least **Tier 4 (Management)** to open a session queue.',
        ephemeral: true,
      });
    }

    const cardInput = interaction.options.getString('card', true);
    const cardId = parseCardIdFromInput(cardInput);

    if (!cardId) {
      return interaction.reply({
        content:
          'I could not read that Trello card link.\n' +
          'Please paste either:\n' +
          '• The full Trello card URL (like `https://trello.com/c/DwQbr3P5`)\n' +
          '• Or just the short ID (like `DwQbr3P5`).',
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const ok = await openQueueForCard(interaction.client, interaction.guild, cardId);

    if (!ok) {
      return interaction.editReply({
        content:
          'I could not open a queue for that Trello card.\n' +
          '• Make sure the link is valid\n' +
          '• The card has the correct session labels or `[Interview]`, `[Training]`, `[Mass Shift]` in the name\n' +
          '• The queue channels/roles are configured in `SESSION_*` and `QUEUE_*` env vars.',
      });
    }

    return interaction.editReply({
      content: '✅ Queue post created successfully for that session.',
    });
  },
};
