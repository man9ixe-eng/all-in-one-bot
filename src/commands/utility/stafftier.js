// src/commands/utility/stafftier.js

const { SlashCommandBuilder } = require('discord.js');
const { getTier } = require('../../utils/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stafftier')
    .setDescription('Shows what staff tier (1–7) the bot sees you as.')
    .setDMPermission(false),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   */
  async execute(interaction) {
    const member = interaction.member;
    const tier = getTier(member);

    let label;
    switch (tier) {
      case 1: label = 'Tier 1 — Regular member'; break;
      case 2: label = 'Tier 2 — Junior Staff'; break;
      case 3: label = 'Tier 3 — Intern'; break;
      case 4: label = 'Tier 4 — Management'; break;
      case 5: label = 'Tier 5 — Senior Management'; break;
      case 6: label = 'Tier 6 — Corporate'; break;
      case 7: label = 'Tier 7 — Presidential / Owner'; break;
      default: label = `Unknown tier (${tier})`; break;
    }

    await interaction.reply({
      content: `I see you as: **${label}**.`,
      ephemeral: true,
    });
  },
};
