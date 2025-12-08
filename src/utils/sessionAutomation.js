// src/utils/sessionAutomation.js

const {
  TRELLO_KEY,
  TRELLO_TOKEN,
  TRELLO_LIST_INTERVIEW_ID,
  TRELLO_LIST_TRAINING_ID,
  TRELLO_LIST_MASS_SHIFT_ID,
  TRELLO_LIST_IN_PROGRESS_ID,
  TRELLO_LABEL_SCHEDULED_ID,
  TRELLO_LABEL_COMPLETED_ID,
  TRELLO_LABEL_CANCELED_ID,
  TRELLO_LABEL_IN_PROGRESS_ID,
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

// Simple Trello HTTP helper
async function trelloRequest(path, method = 'GET', query = {}) {
  if (!TRELLO_KEY || !TRELLO_TOKEN) {
    console.error('[TRELLO] Missing KEY/TOKEN');
    return { ok: false, status: 0, data: null };
  }

  const url = new URL(`https://api.trello.com/1${path}`);
  url.searchParams.set('key', TRELLO_KEY);
  url.searchParams.set('token', TRELLO_TOKEN);

  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) {
      url.searchParams.set(k, String(v));
    }
  }

  try {
    const res = await fetch(url, { method });
    const data = await res.json().catch(() => null);
    if (![200, 201].includes(res.status)) {
      console.error('[TRELLO] API error', res.status, data);
      return { ok: false, status: res.status, data };
    }
    return { ok: true, status: res.status, data };
  } catch (err) {
    console.error('[TRELLO] Network error', err);
    return { ok: false, status: 0, data: null };
  }
}

function getTypeByListId(listId) {
  if (listId === TRELLO_LIST_INTERVIEW_ID) return 'interview';
  if (listId === TRELLO_LIST_TRAINING_ID) return 'training';
  if (listId === TRELLO_LIST_MASS_SHIFT_ID) return 'mass_shift';
  return null;
}

function getSessionMeta(type) {
  switch (type) {
    case 'interview':
      return {
        gameLink: GAME_LINK_INTERVIEW,
        roleId: INTERVIEW_SESSION_ROLE_ID,
        name: 'Interview',
      };
    case 'training':
      return {
        gameLink: GAME_LINK_TRAINING,
        roleId: TRAINING_SESSION_ROLE_ID,
        name: 'Training',
      };
    case 'mass_shift':
      return {
        gameLink: GAME_LINK_MASS_SHIFT,
        roleId: MASS_SHIFT_SESSION_ROLE_ID,
        name: 'Mass Shift',
      };
    default:
      return { gameLink: null, roleId: null, name: 'Session' };
  }
}

/**
 * Auto-session tick:
 * - 30 minutes before due: create Discord post with ping, game link, Trello link.
 * - At/after due: move card to In Progress list + IN PROGRESS label.
 */
async function runSessionAutomation(client) {
  const listIds = [
    TRELLO_LIST_INTERVIEW_ID,
    TRELLO_LIST_TRAINING_ID,
    TRELLO_LIST_MASS_SHIFT_ID,
  ].filter(Boolean);

  if (!listIds.length) return;

  const now = new Date();

  for (const listId of listIds) {
    const cardsRes = await trelloRequest(`/lists/${listId}/cards`, 'GET', {
      fields: 'id,name,due,idLabels,idList,shortUrl,url',
    });

    if (!cardsRes.ok || !Array.isArray(cardsRes.data)) continue;

    const sessionType = getTypeByListId(listId);
    const { gameLink, roleId, name: typeName } = getSessionMeta(sessionType);

    for (const card of cardsRes.data) {
      const labels = Array.isArray(card.idLabels) ? card.idLabels : [];

      if (!card.due) continue;
      const due = new Date(card.due);
      const diffMs = due.getTime() - now.getTime();

      const hasScheduled = TRELLO_LABEL_SCHEDULED_ID && labels.includes(TRELLO_LABEL_SCHEDULED_ID);
      const isCompleted = TRELLO_LABEL_COMPLETED_ID && labels.includes(TRELLO_LABEL_COMPLETED_ID);
      const isCanceled = TRELLO_LABEL_CANCELED_ID && labels.includes(TRELLO_LABEL_CANCELED_ID);
      const isInProgress = TRELLO_LABEL_IN_PROGRESS_ID && labels.includes(TRELLO_LABEL_IN_PROGRESS_ID);

      // Skip completed/canceled
      if (isCompleted || isCanceled) continue;

      // 1) 30 minutes before due → create Discord post if not already created
      if (
        hasScheduled &&
        diffMs > 0 &&
        diffMs <= 30 * 60 * 1000 && // <= 30 mins
        gameLink &&
        SESSION_ANNOUNCEMENTS_CHANNEL_ID
      ) {
        const existingPost = getSessionPost(card.id);
        if (!existingPost) {
          try {
            const channel = await client.channels.fetch(SESSION_ANNOUNCEMENTS_CHANNEL_ID);
            if (!channel || !channel.isTextBased?.()) {
              console.warn('[SESSIONS] Announcement channel is invalid or not text-based.');
            } else {
              const unix = Math.floor(due.getTime() / 1000);
              const trelloUrl = card.shortUrl || card.url || `https://trello.com/c/${card.id}`;
              const ping = roleId ? `<@&${roleId}>` : '';

              const content =
                `${ping}\n\n` +
                `A **${typeName}** session is starting in **30 minutes**!\n\n` +
                `**Name:** ${card.name}\n` +
                `**Starts at:** <t:${unix}:T> (<t:${unix}:R>)\n\n` +
                `**Game link:** ${gameLink}\n` +
                `**Trello card:** ${trelloUrl}`;

              const msg = await channel.send({ content });
              setSessionPost(card.id, channel.id, msg.id);
              console.log('[SESSIONS] Created announcement for card', card.id);
            }
          } catch (err) {
            console.error('[SESSIONS] Failed to send announcement:', err);
          }
        }
      }

      // 2) Due time reached or passed → move to In Progress list + IN PROGRESS label
      if (
        hasScheduled &&
        !isInProgress &&
        diffMs <= 0 &&
        TRELLO_LIST_IN_PROGRESS_ID &&
        TRELLO_LABEL_IN_PROGRESS_ID
      ) {
        try {
          const statusLabels = [
            TRELLO_LABEL_SCHEDULED_ID,
            TRELLO_LABEL_COMPLETED_ID,
            TRELLO_LABEL_CANCELED_ID,
          ].filter(Boolean);

          let newLabels = labels.filter((id) => !statusLabels.includes(id));

          if (!newLabels.includes(TRELLO_LABEL_IN_PROGRESS_ID)) {
            newLabels.push(TRELLO_LABEL_IN_PROGRESS_ID);
          }

          await trelloRequest(`/cards/${card.id}`, 'PUT', {
            idList: TRELLO_LIST_IN_PROGRESS_ID,
            idLabels: newLabels.join(','),
            dueComplete: 'false',
          });

          console.log('[SESSIONS] Moved card to In Progress:', card.id);
        } catch (err) {
          console.error('[SESSIONS] Failed to move card to In Progress:', err);
        }
      }
    }
  }
}

/**
 * Delete the Discord announcement for a given Trello card (if exists).
 * Called by /cancelsession and /logsession.
 */
async function deleteSessionAnnouncement(client, cardId) {
  const record = getSessionPost(cardId);
  if (!record) return;

  try {
    const channel = await client.channels.fetch(record.channelId);
    if (!channel || !channel.isTextBased?.()) {
      clearSessionPost(cardId);
      return;
    }

    const msg = await channel.messages.fetch(record.messageId).catch(() => null);
    if (msg) {
      await msg.delete().catch(() => {});
      console.log('[SESSIONS] Deleted session announcement for card', cardId);
    }
  } catch (err) {
    console.error('[SESSIONS] Failed to delete announcement:', err);
  }

  clearSessionPost(cardId);
}

module.exports = {
  runSessionAutomation,
  deleteSessionAnnouncement,
};
