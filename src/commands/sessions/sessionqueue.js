// src/commands/sessions/sessionqueue.js

const { SlashCommandBuilder } = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');
const { openQueueForCard } = require('../../utils/sessionQueueManager');

function extractCardId(input) {
  const trimmed = (input || '').trim();

  // If it's a Trello URL, grab the /c/<shortLink>
  const cIndex = trimmed.indexOf('/c/');
  if (cIndex !== -1) {
    const part = trimmed.slice(cIndex + 3);
    const seg = part.split(/[/?#]/)[0];
    if (seg) return seg;
  }

  // Otherwise, try to match a Trello id/shortlink-ish token
  const idMatch = trimmed.match(/[0-9a-zA-Z]{8,24}/);
  return idMatch ? idMatch[0] : null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessionqueue')
    .setDescription('Open a queue post for a session Trello card.')
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName('card')
        .setDescription('Trello card link or ID')
        .setRequired(true),
    ),

  async execute(interaction) {
    // Keep perms same style as your other session commands
    if (!atLeastTier(interaction.member, 4)) {
      await interaction.reply({
        content: 'You must be at least **Tier 4 (Management)** to use `/sessionqueue`.',
        ephemeral: true,
      });
      return;
    }

    const raw = interaction.options.getString('card', true).trim();
    console.log('[QUEUE] Raw card option:', raw);

    const cardId = extractCardId(raw);
    if (!cardId) {
      await interaction.reply({
        content:
          'I could not parse a Trello card from that.\n' +
          'Please paste the full card link, e.g. `https://trello.com/c/abcd1234/...`',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const ok = await openQueueForCard(interaction.client, {
      cardId,
      trelloUrl: raw,
    });

    if (!ok) {
      await interaction.editReply({
        content:
          'I could not open a queue for that Trello card.\n' +
          '• Make sure the link is valid\n' +
          '• The card has the correct session labels or `[Interview]`, `[Training]`, `[Mass Shift]` in the name\n' +
          '• The queue/notice channels & ping roles are configured in your env (`SESSION_*` / `QUEUE_*`).',
      });
      return;
    }

    await interaction.editReply({
      content: '✅ Queue post created for that Trello card.',
    });
  },
};
