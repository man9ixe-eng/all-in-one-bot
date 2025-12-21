const { SlashCommandBuilder } = require('discord.js');
const { postAttendeesForCard } = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessionattendees')
    .setDescription('Post the selected attendees list for a Trello session card.')
    .addStringOption((option) =>
      option
        .setName('card')
        .setDescription('Trello card link or short ID for this session.')
        .setRequired(true),
    ),
  async execute(interaction) {
    const rawCard = interaction.options.getString('card', true);

    try {
      await interaction.deferReply({ ephemeral: true });

      const result = await postAttendeesForCard(interaction.client, rawCard);

      await interaction.editReply({
        content: result.ok
          ? '✅ Posted the attendees list for that Trello card.'
          : result.message || 'I could not post the attendees list for that Trello card.',
      });
    } catch (err) {
      console.error('[SESSIONATTENDEES] Error while executing /sessionattendees:', err);
      const alreadyReplied = interaction.replied || interaction.deferred;
      const msg =
        'There was an error while executing this interaction.\nIf this keeps happening, please contact a developer.';

      if (alreadyReplied) {
        await interaction.followUp({ content: msg, ephemeral: true }).catch(() => {});
      } else {
        await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
      }
    }
  },
};
