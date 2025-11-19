// src/commands/sessions/addsession.js

const { SlashCommandBuilder } = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');
const { createSessionCard } = require('../../utils/trelloClient');
const { logModerationAction } = require('../../utils/modlog');

// Build ISO string from:
// dateStr: "MM/DD/YYYY"  (e.g. "11/19/2025")
// timeStr: "h:mm AM/PM" (e.g. "4:00 PM")
function buildISOFromDateTime(dateStr, timeStr) {
  const date = (dateStr || '').trim();
  const time = (timeStr || '').trim();

  // Date: MM/DD/YYYY
  const dateMatch = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!dateMatch) {
    return null;
  }

  const [, monthStr, dayStr, yearStr] = dateMatch;
  const month = Number(monthStr);
  const day = Number(dayStr);
  const year = Number(yearStr);

  if (
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(year) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  // Time: h:mm AM/PM
  const timeMatch = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!timeMatch) {
    return null;
  }

  const [, hourStr, minuteStr, ampmRaw] = timeMatch;
  let hour = Number(hourStr);
  const minute = Number(minuteStr);
  const ampm = ampmRaw.toUpperCase();

  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 1 ||
    hour > 12 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  // Convert to 24-hour
  let hour24 = hour % 12; // 12 -> 0
  if (ampm === 'PM') {
    hour24 += 12;
  }

  const d = new Date();
  d.setFullYear(year, month - 1, day);
  d.setHours(hour24, minute, 0, 0);

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
        .setDescription('Date (MM/DD/YYYY), e.g. 11/19/2025.')
        .setRequired(true),
    )
    .addStringOption(option =>
      option
        .setName('time')
        .setDescription('Time (h:mm AM/PM), e.g. 4:00 PM.')
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
    if (!atLeastTier(interaction.member, 4)) {
      return interaction.reply({
        content: 'You must be at least **Tier 4 (Management)** to use `/addsession`.',
        ephemeral: true,
      });
    }

    const sessionType = interaction.options.getString('type', true);
    const title = interaction.options.getString('title', true);
    const dateStr = interaction.options.getString('date', true); // MM/DD/YYYY
    const timeStr = interaction.options.getString('time', true); // h:mm AM/PM
    const notes = interaction.options.getString('notes') || '';

    // Build due date
    const dueISO = buildISOFromDateTime(dateStr, timeStr);

    if (!dueISO) {
      return interaction.reply({
        content:
          'Invalid date or time format.\n' +
          '**Use this format exactly:**\n' +
          '• Date: `MM/DD/YYYY` (example: `11/19/2025`)\n' +
          '• Time: `h:mm AM/PM` (example: `4:00 PM`)',
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
