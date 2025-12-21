// src/utils/sessionQueueManager.js

async function handleQueueButtonInteraction(interaction) {
  if (!interaction.isButton()) return false;

  if (!interaction.customId || !interaction.customId.startsWith('ghqueue:')) {
    return false;
  }

  try {
    await interaction.reply({
      content:
        'The Glace session queue system is still being built. ' +
        'Hosts will select attendees manually for now. 💙',
      ephemeral: true,
    });
  } catch {
    // ignore double-reply issues
  }

  return true;
}

async function openQueueForCard(client, cardIdOrCard, options = {}) {
  console.log('[QUEUE] openQueueForCard called (placeholder).', {
    cardRef: cardIdOrCard,
    options,
  });
  return;
}

module.exports = {
  handleQueueButtonInteraction,
  openQueueForCard,
};
