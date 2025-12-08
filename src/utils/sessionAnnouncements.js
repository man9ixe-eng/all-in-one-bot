// src/utils/sessionAnnouncements.js

const {
  TRELLO_LIST_INTERVIEW_ID,
  TRELLO_LIST_TRAINING_ID,
  TRELLO_LIST_MASS_SHIFT_ID,
  TRELLO_LIST_COMPLETED_ID,
  TRELLO_LABEL_SCHEDULED_ID,
  TRELLO_LABEL_COMPLETED_ID,
  TRELLO_LABEL_CANCELED_ID,
} = require('../config/trello');

const {
  SESSION_ANNOUNCEMENTS_CHANNEL_ID,
  INTERVIEW_SESSION_ROLE_ID,
  TRAINING_SESSION_ROLE_ID,
  MASS_SHIFT_SESSION_ROLE_ID,
  GAME_LINK_INTERVIEW,
  GAME_LINK_TRAINING,
  GAME_LINK_MASS_SHIFT,
} = require('../config/sessionAnnouncements');

const {
  setSessionPost,
  getSessionPost,
  clearSessionPost,
} = require('./sessionPostsStore');

const { trelloRequest } = require('./trelloClient');

// Map list → session type
function getSessionTypeByListId(listId) {
  if (listId === TRELLO_LIST_INTERVIEW_ID) return 'interview';
  if (listId === TRELLO_LIST_TRAINING_ID) return 'training';
  if (listId === TRELLO_LIST_MASS_SHIFT_ID) return 'mass_shift';
  return null;
}

// Friendly info by type
function getSessionMeta(type) {
  switch (type) {
    case 'interview':
      return {
        name: 'Interview',
        roleId: INTERVIEW_SESSION_ROLE_ID,
        gameLink: GAME_LINK_INTERVIEW,
      };
    case 'training':
      return {
        name: 'Training',
        roleId: TRAINING_SESSION_ROLE_ID,
        gameLink: GAME_LINK_TRAINING,
      };
    case 'mass_shift':
      return {
        name: 'Mass Shift',
        roleId: MASS_SHIFT_SESSION_ROLE_ID,
        gameLink: GAME_LINK_MASS_SHIFT,
      };
    default:
      return { name: 'Session', roleId: null, gameLink: null };
  }
}

/**
 * Runs every minute:
 * - Looks at the Interview / Training / Mass Shift lists
 * - Finds cards with a due time in the next 30 minutes
 * - That still have SCHEDULED and are not Completed / Canceled
 * - Sends a one-time announcement in SESSION_ANNOUNCEMENTS_CHANNEL_ID
 */
async function runSessionAnnouncementTick(client) {
  if (!SESSION_ANNOUNCEMENTS_CHANNEL_ID) return;

  const listIds = [
    TRELLO_LIST_INTERVIEW_ID,
    TRELLO_LIST_TRAINING_ID,
    TRELLO_LIST_MASS_SHIFT_ID,
  ].filter(Boolean);

  if (listIds.length === 0) return;

  const now = new Date();

  for (const listId of listIds) {
    const type = getSessionTypeByListId(listId);
    const meta = getSessionMeta(type);

    const cardsRes = await trelloRequest(`/lists/${listId}/cards`, 'GET', {
      fields: 'id,name,due,idLabels,shortUrl,url',
    });

    if (!cardsRes.ok || !Array.isArray(cardsRes.data)) {
      continue;
    }

    for (const card of cardsRes.data) {
      if (!card.due) continue;

      const due = new Date(card.due);
      if (isNaN(due.getTime())) continue;

      const diff = due.getTime() - now.getTime(); // ms until due
      const labels = Array.isArray(card.idLabels) ? card.idLabels : [];

      const hasScheduled =
        TRELLO_LABEL_SCHEDULED_ID && labels.includes(TRELLO_LABEL_SCHEDULED_ID);
      const isCompleted =
        TRELLO_LABEL_COMPLETED_ID && labels.includes(TRELLO_LABEL_COMPLETED_ID);
      const isCanceled =
        TRELLO_LABEL_CANCELED_ID && labels.includes(TRELLO_LABEL_CANCELED_ID);

      // Only sessions that are scheduled, not completed/canceled
      if (!hasScheduled || isCompleted || isCanceled) continue;

      // Only within the next 30 minutes (0 < diff <= 30m)
      if (diff <= 0 || diff > 30 * 60 * 1000) continue;

      // Don't re-announce if we already posted for this card
      if (getSessionPost(card.id)) continue;

      try {
        const channel = await client.channels.fetch(
          SESSION_ANNOUNCEMENTS_CHANNEL_ID,
        );
        if (!channel || !channel.isTextBased()) continue;

        const unix = Math.floor(due.getTime() / 1000);
        const rolePing = meta.roleId ? `<@&${meta.roleId}>` : '';
        const trelloUrl =
          card.shortUrl || card.url || `https://trello.com/c/${card.id}`;

        const gameLine = meta.gameLink
          ? `**Game link:** ${meta.gameLink}\n`
          : '';

        const content =
          `${rolePing}\n\n` +
          `A **${meta.name}** session is starting in **30 minutes!**\n\n` +
          `**Name:** ${card.name}\n` +
          `**Starts:** <t:${unix}:T> (<t:${unix}:R>)\n\n` +
          `${gameLine}` +
          `**Trello card:** ${trelloUrl}`;

        const msg = await channel.send({ content });

        setSessionPost(card.id, channel.id, msg.id);
        console.log('[SESSIONS] Announcement posted for card', card.id);
      } catch (err) {
        console.error('[SESSIONS] Failed to send announcement:', err);
      }
    }
  }
}

/**
 * Deletes a stored session announcement message when we
 * /cancelsession or /logsession for that Trello card.
 */
async function deleteSessionAnnouncement(client, cardId) {
  if (!cardId) return;

  const record = getSessionPost(cardId);
  if (!record) return;

  try {
    const channel = await client.channels.fetch(record.channelId);
    if (!channel || !channel.isTextBased()) {
      clearSessionPost(cardId);
      return;
    }

    const msg = await channel.messages
      .fetch(record.messageId)
      .catch(() => null);
    if (msg) {
      await msg.delete().catch(() => {});
    }

    console.log('[SESSIONS] Deleted announcement for card', cardId);
  } catch (err) {
    console.error('[SESSIONS] Failed to delete announcement:', err);
  }

  clearSessionPost(cardId);
}

module.exports = {
  runSessionAnnouncementTick,
  deleteSessionAnnouncement,
};
