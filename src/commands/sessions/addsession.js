// src/commands/sessions/addsession.js

const { SlashCommandBuilder } = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');
const { createSessionCard } = require('../../utils/trelloClient');
const { logModerationAction } = require('../../utils/modlog');

function buildISOFromDateTime(dateStr, timeStr) {
  // Expect dateStr: YYYY-MM-DD, timeStr: HH:MM
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
  const timeOk = /^\d{2}:\d{2}$/.test(timeStr);
  if (!dateOk || !timeOk) {
    const error = new Error('INVALID_DATETIME');
    error.code = 'INVALID_DATETIME';
    throw error;
  }

  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);

  const d = new Date();
  d.setFullYear(year, month - 1, day);
  d.setHours(hour, minute, 0, 0);

  return d.toISOString();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('addsession')
    .setDescription('Create a Trello session card (Interview / Training / Mass Shift).')
    .setDMPermission(false)
    .addStringOption(option =>
      option
        .setName('type')
        .setDescription('Type of session.')
        .setRequired(true)
        .addChoices(
          { name: 'Interview', value: 'interview' },
          { name: 'Training', value: 'training' },
          { name: 'Mass Shift', value: 'mass_shift' },
        ),
    )
    .addStringOption(option =>
      option
        .setName('title')
        .setDescription('Short title of the session.')
        .setRequired(true),
    )
    .addStringOption(option =>
      option
        .setName('date')
        .setDescription('Date (YYYY-MM-DD).')
        .setRequired(true),
    )
    .addStringOption(option =>
      option
        .setName('time')
        .setDescription('Time (HH:MM, 24-hour).')
        .setRequired(true),
    )
    .addStringOption(option =>
      option
        .setName('notes')
        .setDescription('Extra notes (e.g. host, special instructions).')
        .setRequired(false),
    ),

  /**
   * /addsession – Tier 4+ (Management and up)
   */
  async execute(interaction) {
    if (!atLeastTier(interaction.member, 6)) {
      return interaction.reply({
        content: 'You must be at least **(Corporate)** to use `/addsession`.',
        ephemeral: true,
      });
    }

    const sessionType = interaction.options.getString('type', true);
    const title = interaction.options.getString('title', true);
    const dateStr = interaction.options.getString('date', true);
    const timeStr = interaction.options.getString('time', true);
    const notes = interaction.options.getString('notes') || '';

    let dueISO = null;

    try {
      dueISO = buildISOFromDateTime(dateStr, timeStr);
    } catch (err) {
      if (err.code === 'INVALID_DATETIME') {
        return interaction.reply({
          content:
            'Invalid date/time format.\nPlease use **YYYY-MM-DD** for date and **HH:MM** (24-hour) for time.',
          ephemeral: true,
        });
      }
      console.error('[ADDSESSION] Date/time parse error:', err);
      return interaction.reply({
        content: 'Something went wrong while parsing the date/time.',
        ephemeral: true,
      });
    }

    try {
      const card = await createSessionCard({
        sessionType,
        title,
        dueISO,
        notes,
        hostTag: interaction.user.tag,
        hostId: interaction.user.id,
      });

      const humanType =
        sessionType === 'interview'
          ? 'Interview'
          : sessionType === 'training'
          ? 'Training'
          : 'Mass Shift';

      await interaction.reply({
        content:
          `Created **${humanType}** session card:\n` +
          `${card.shortUrl || card.url || '(no URL returned)'}`,
        ephemeral: true,
      });

      await logModerationAction(interaction, {
        action: 'Session Scheduled',
        reason: `${humanType} – ${title}`,
        details: `Card: ${card.shortUrl || card.url || card.id}`,
      });
    } catch (err) {
      console.error('[ADDSESSION] Failed to create Trello card:', err);
      await interaction.reply({
        content: 'I could not create the Trello card. Check my Trello config and try again.',
        ephemeral: true,
      });
    }
  },
};
