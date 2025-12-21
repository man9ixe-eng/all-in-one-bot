// src/utils/sessionQueueManager.js
//
// Temporary safe version:
// - Exports handleQueueButtonInteraction so button clicks don't crash
// - Exports openQueueForCard so /sessionqueue (or any future use) doesn't crash
// - Does NOT implement real queue logic yet (just a placeholder)

async function handleQueueButtonInteraction(interaction) {
  // Not a button? Not ours.
  if (!interaction.isButton()) return false;

  // Only handle our own queue buttons (we'll use this prefix later)
  if (!interaction.customId || !interaction.customId.startsWith('ghqueue:')) {
    return false;
  }

  // For now, just reply safely so nothing explodes.
  try {
    await interaction.reply({
      content:
        'The Glace session queue system is still being built. ' +
        'Hosts will select attendees manually for now. 💙',
      ephemeral: true,
    });
  } catch {
    // Ignore double-reply or ephemeral errors
  }

  return true; // we handled this button
}

/**
 * openQueueForCard
 *
 * Temporary placeholder so /sessionqueue (or any caller) does not crash.
 * We'll later:
 *  - Fetch full card details from Trello
 *  - Post the pretty embed with buttons
 *  - Store the message ID for later cleanup
 */
async function openQueueForCard(client, cardIdOrCard, options = {}) {
  console.log('[QUEUE] openQueueForCard called (placeholder).', {
    cardRef: cardIdOrCard,
    options,
  });

  // No-op for now: we just don't want runtime errors.
  return;
}

module.exports = {
  handleQueueButtonInteraction,
  openQueueForCard,
};
