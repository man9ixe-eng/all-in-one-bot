// src/commands/sessions/addsession.js

const { SlashCommandBuilder } = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');
const { createSessionCard } = require('../../utils/trelloClient');

// Timezone abbreviation → offset (in minutes from UTC)
const TZ_OFFSETS = {
  EST: -300, EDT: -240, ET: -300,
  CST: -360, CDT: -300, CT: -360,
  MST: -420, MDT: -360, MT: -420,
  PST: -480, PDT: -420, PT: -480,
};

// Build ISO string from "MM/DD/YYYY" and "h:mm AM/PM [TZ]"
function buildISOFromDateTime(dateStr, timeStr) {
  const date = (dateStr || '').trim();
  const time = (timeStr || '').trim();

  const dateMatch = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!dateMatch) throw new Error('INVALID_DATE');
  const [, monthStr, dayStr, yearStr] = dateMatch;

  const timeMatch = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)(?:\s+([A-Za-z]{2,5}))?$/i);
  if (!timeMatch) throw new Error('INVALID_TIME');
  const [, hourStr, minuteStr, ampmRaw, tzRaw] = timeMatch;

  let hour = Number(hourStr);
  const minute = Number(minuteStr);
  const ampm = ampmRaw.toUpperCase();
  const tz = tzRaw ? tzRaw.toUpperCase() : 'EST'; // Default EST

  if (ampm === 'PM' && hour !== 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;

  const offset = TZ_OFFSETS[tz] ?? TZ_OFFSETS.EST;
  const local = Date.UTC(Number(yearStr), Number(monthStr) - 1, Number(dayStr), hour, minute);
  const utcISO = new Date(local - offset * 60_000).toISOString();
  return utcISO;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('addsession')
    .setDescription('Create a Trello session card (Interview / Training / Mass Shift).')
    .setDMPermission(false)
    .addStringOption(o =>
      o.setName('type').setDescription('Type of session.').setRequired(true)
        .addChoices(
          { name: 'Interview', value: 'interview' },
          { name: 'Training', value: 'training' },
          { name: 'Mass Shift', value: 'mass_shift' },
        ),
    )
    .addStringOption(o => o.setName('title').setDescription('Short title.').setRequired(true))
    .addStringOption(o => o.setName('date').setDescription('Date (MM/DD/YYYY).').setRequired(true))
    .addStringOption(o => o.setName('time').setDescription('Time (h:mm AM/PM [TZ]).').setRequired(true))
    .addStringOption(o => o.setName('notes').setDescription('Extra notes.').setRequired(false)),

  async execute(interaction) {
    if (!atLeastTier(interaction.member, 4)) {
      return interaction.reply({
        content: 'You must be at least **Tier 4 (Management)** to use `/addsession`.',
        ephemeral: true,
      });
    }

    const sessionType = interaction.options.getString('type', true);
    const title = interaction.options.getString('title', true);
    const dateStr = interaction.options.getString('date', true);
    const timeStr = interaction.options.getString('time', true);
    const notes = interaction.options.getString('notes') || '';

    let dueISO;
    try {
      dueISO = buildISOFromDateTime(dateStr, timeStr);
    } catch (err) {
      return interaction.reply({
        content:
          'Invalid date or time format.\n' +
          '**Use this format exactly:**\n' +
          '• Date: `MM/DD/YYYY`\n' +
          '• Time: `h:mm AM/PM [TZ]` (examples: `11:00 AM`, `11:00 AM EST`)',
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

      const reply = `✅ **${humanType}** session card created successfully!\n🔗 [Open Trello Card](${card.shortUrl || card.url})`;

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: reply, ephemeral: true });
      } else {
        await interaction.followUp({ content: reply, ephemeral: true });
      }

    } catch (err) {
      console.error('[ADDSESSION] Failed to create Trello card:', err);
      const errorMsg =
        '⚠️ I tried to create the Trello card but something went wrong.\n' +
        'Please check Trello config and verify your `.env` values.';
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: errorMsg, ephemeral: true });
      } else {
        await interaction.followUp({ content: errorMsg, ephemeral: true });
      }
    }
  },
};
