// src/commands/sessions/addsession.js

const { SlashCommandBuilder } = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');
const { createSessionCard } = require('../../utils/trelloClient');

// Map timezone abbreviation → offset in minutes from UTC
// (approx; good enough for sessions)
const TZ_OFFSETS = {
  EST: -300,
  EDT: -240,
  ET: -300,
  CST: -360,
  CDT: -300,
  CT: -360,
  MST: -420,
  MDT: -360,
  MT: -420,
  PST: -480,
  PDT: -420,
  PT: -480,
};

// Build ISO string from:
// dateStr: "MM/DD/YYYY"  (e.g. "11/19/2025")
// timeStr: "h:mm AM/PM [TZ]" (e.g. "11:00 AM EST" or "11:00 AM")
function buildISOFromDateTime(dateStr, timeStr) {
  const date = (dateStr || '').trim();
  const time = (timeStr || '').trim();

  // Date: MM/DD/YYYY
  const dateMatch = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!dateMatch) return null;

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

  // Time: h:mm AM/PM [TZ]
  // Examples that will match:
  // "11:00 AM"
  // "11:00 AM EST"
  // "9:30 pm pst"
  const timeMatch = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)(?:\s+([A-Za-z]{2,5}))?$/i);
  if (!timeMatch) return null;

  const [, hourStr, minuteStr, ampmRaw, tzAbbrRaw] = timeMatch;
  let hour = Number(hourStr);
  const minute = Number(minuteStr);
  const ampm = ampmRaw.toUpperCase();
  const tzAbbr = tzAbbrRaw ? tzAbbrRaw.toUpperCase() : null;

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

  // Determine timezone offset (minutes from UTC)
  let offsetMinutes;
  if (tzAbbr && TZ_OFFSETS[tzAbbr] !== undefined) {
    offsetMinutes = TZ_OFFSETS[tzAbbr];
  } else {
    // Default to Eastern Time if no timezone given
    offsetMinutes = TZ_OFFSETS.ET;
  }

  // Build a "local" time in that timezone, then convert to UTC.
  // We treat the typed time as if it's local in that TZ.
  const localAsUTC = Date.UTC(year, month - 1, day, hour24, minute, 0, 0);
  // local = UTC + offset  →  UTC = local - offset
  const utcMs = localAsUTC - offsetMinutes * 60_000;
  const utcISO = new Date(utcMs).toISOString();

  return utcISO;
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
        .setDescription('Time (h:mm AM/PM [TZ]), e.g. "11:00 AM EST" or "11:00 AM".')
        .setRequired(true),
    )
    .addStringOption(option =>
      option
        .setName('notes')
        .setDescription('Extra notes (e.g. special instructions).')
        .setRequired(false),
    ),

  /**
   * /addsession – Tier 4+ (Management and up)
   */
  async execute(interaction) {
    // 1) Permission check (fast → no defer)
    if (!atLeastTier(interaction.member, 4)) {
      await interaction.reply({
        content: 'You must be at least **Tier 4 (Management)** to use `/addsession`.',
        ephemeral: true,
      });
      return;
    }

    const sessionType = interaction.options.getString('type', true);
    const title = interaction.options.getString('title', true);
    const dateStr = interaction.options.getString('date', true);
    const timeStr = interaction.options.getString('time', true);
    const notes = interaction.options.getString('notes') || '';

    // 2) Validate date/time (still before defer)
    const dueISO = buildISOFromDateTime(dateStr, timeStr);
    if (!dueISO) {
      await interaction.reply({
        content:
          'Invalid date or time format.\n' +
          '**Use this format exactly:**\n' +
          '• Date: `MM/DD/YYYY` (example: `11/19/2025`)\n' +
          '• Time: `h:mm AM/PM [TZ]` (examples: `11:00 AM`, `11:00 AM EST`)',
        ephemeral: true,
      });
      return;
    }

    // 3) Now we know inputs are valid → we can safely defer
    await interaction.deferReply({ ephemeral: true });

    try {
      const ok = await createSessionCard({
        sessionType,
        title,
        dueISO,
        notes,
        hostTag: interaction.user.tag,
        hostId: interaction.user.id,
      });

      if (!ok) {
        console.error('[ADDSESSION] Failed to create Trello card (createSessionCard returned false)');
        await interaction.editReply({
          content:
            'I tried to create the Trello card but something went wrong.\n' +
            'Please check the board manually and verify your Trello IDs in `.env` / Render env.',
        });
        return;
      }

      await interaction.editReply({
        content:
          '✅ Session successfully added to Trello!\n' +
          'Use `/cancelsession` (with the card link) to cancel, or `/logsession` to mark it completed.',
      });
    } catch (err) {
      console.error('[ADDSESSION] Unexpected error while creating session card:', err);
      try {
        await interaction.editReply({
          content: 'There was an unexpected error while running `/addsession`. Please try again.',
        });
      } catch {
        // swallow secondary errors
      }
    }
  },
};
