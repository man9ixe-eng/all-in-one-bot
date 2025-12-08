// src/utils/sessionAnnouncements.js

const {
  TRELLO_KEY,
  TRELLO_TOKEN,
  TRELLO_LIST_INTERVIEW_ID,
  TRELLO_LIST_TRAINING_ID,
  TRELLO_LIST_MASS_SHIFT_ID,
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

// basic Trello request helper
async function trelloRequest(path, method = 'GET', query = {}) {
  if (!TRELLO_KEY || !TRELLO_TOKEN) {
    console.error('[TRELLO] Missing KEY/TOKEN');
    return { ok: false, status: 0, data: null };
  }

  const url = new URL(`https://api.trello.com/1${path}`);
  url.searchParams.set('key', TRELLO_KEY);
  url.searchParams.set('token', TRELLO_TOKEN);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  try {
    const res = await fetch(url, { method });
    let data = null;
    try {
      data = await res.json();
    } catch {}
    if (res.status !== 200 && res.status !== 201) {
      console.error('[TRELLO] API error', res.status, data);
      return { ok: false, status: res.status, data };
    }
    return { ok: true, status: res.status, data };
  } catch (err) {
    console.error('[TRELLO] Network error', err);
    return { ok: false, status: 0, data: null };
  }
}

function getSessionTypeByListId(listId) {
  if (listId === TRELLO_LIST_INTERVIEW_ID) return 'interview';
  if (listId === TRELLO_LIST_TRAINING_ID) return 'training';
  if (listId === TRELLO_LIST_MASS_SHIFT_ID) return 'mass_shift';
  return null;
}

function getSessionMeta(type) {
  switch (type) {
    case 'interview':
      return { name: 'Interview', roleId: INTERVIEW_SESSION_ROLE_ID, gameLink: GAME_LINK_INTERVIEW };
    case 'training':
      return { name: 'Training', roleId: TRAINING_SESSION_ROLE_ID, gameLink: GAME_LINK_TRAINING };
    case 'mass_shift':
      return { name: 'Mass Shift', roleId: MASS_SHIFT_SESSION_ROLE_ID, gameLink: GAME_LINK_MASS_SHIFT };
    default:
      return { name: 'Session', roleId: null, gameLink: null };
  }
}

// main ticker: run every minute
async function runSessionAnnouncementTick(client) {
  if (!SESSION_ANNOUNCEMENTS_CHANNEL_ID) return;

  const listIds = [TRELLO_LIST_INTERVIEW_ID, TRELLO_LIST_TRAINING_ID, TRELLO_LIST_MASS_SHIFT_ID].filter(Boolean);
  const now = new Date();

  for (const listId of listIds) {
    const type = getSessionTypeByListId(listId);
    const meta = getSessionMeta(type);
    const cardsRes = await trelloRequest(`/lists/${listId}/cards`, 'GET', {
      fields: 'id,name,due,idLabels,shortUrl,url',
    });
    if (!cardsRes.ok || !Array.isArray(cardsRes.data)) continue;

    for (const card of cardsRes.data) {
      if (!card.due) continue;
      const due = new Date(card.due);
      if (isNaN(due.getTime())) continue;
      const diff = due.getTime() - now.getTime();

      const labels = Array.isArray(card.idLabels) ? card.idLabels : [];
      const hasScheduled = TRELLO_LABEL_SCHEDULED_ID && labels.includes(TRELLO_LABEL_SCHEDULED_ID);
      const isCompleted = TRELLO_LABEL_COMPLETED_ID && labels.includes(TRELLO_LABEL_COMPLETED_ID);
      const isCanceled = TRELLO_LABEL_CANCELED_ID && labels.includes(TRELLO_LABEL_CANCELED_ID);

      if (!hasScheduled || isCompleted || isCanceled) continue;
      if (diff <= 0 || diff > 30 * 60 * 1000) continue;

      if (getSessionPost(card.id)) continue; // already posted

      try {
        const channel = await client.channels.fetch(SESSION_ANNOUNCEMENTS_CHANNEL_ID);
        if (!channel?.isTextBased?.()) continue;

        const unix = Math.floor(due.getTime() / 1000);
        const rolePing = meta.roleId ? `<@&${meta.roleId}>` : '';
        const trelloUrl = card.shortUrl || card.url || `https://trello.com/c/${card.id}`;
        const gameLine = meta.gameLink ? `**Game link:** ${meta.gameLink}\n` : '';

        const content =
          `${rolePing}\n\n` +
          `A **${meta.name}** session is starting in **30 minutes!**\n\n` +
          `**Name:** ${card.name}\n` +
          `**Starts:** <t:${unix}:T> (<t:${unix}:R>)\n\n` +
          `${gameLine}` +
          `**Trello card:** ${trelloUrl}`;

        const msg = await channel.send({ content });
        setSessionPost(card.id, channel.id, msg.id);
        console.log('[SESSIONS] Announcement posted:', card.id);
      } catch (err) {
        console.error('[SESSIONS] Announcement send failed:', err);
      }
    }
  }
}

// cleanup on cancel/log
async function deleteSessionAnnouncement(client, cardId) {
  const record = getSessionPost(cardId);
  if (!record) return;
  try {
    const channel = await client.channels.fetch(record.channelId);
    const msg = await channel?.messages.fetch(record.messageId).catch(() => null);
    if (msg) await msg.delete().catch(() => {});
    console.log('[SESSIONS] Deleted announcement for', cardId);
  } catch (err) {
    console.error('[SESSIONS] Delete failed', err);
  }
  clearSessionPost(cardId);
}

module.exports = { runSessionAnnouncementTick, deleteSessionAnnouncement };
// src/utils/sessionAnnouncements.js

const {
  TRELLO_KEY,
  TRELLO_TOKEN,
  TRELLO_LIST_INTERVIEW_ID,
  TRELLO_LIST_TRAINING_ID,
  TRELLO_LIST_MASS_SHIFT_ID,
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

// basic Trello request helper
async function trelloRequest(path, method = 'GET', query = {}) {
  if (!TRELLO_KEY || !TRELLO_TOKEN) {
    console.error('[TRELLO] Missing KEY/TOKEN');
    return { ok: false, status: 0, data: null };
  }

  const url = new URL(`https://api.trello.com/1${path}`);
  url.searchParams.set('key', TRELLO_KEY);
  url.searchParams.set('token', TRELLO_TOKEN);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  try {
    const res = await fetch(url, { method });
    let data = null;
    try {
      data = await res.json();
    } catch {}
    if (res.status !== 200 && res.status !== 201) {
      console.error('[TRELLO] API error', res.status, data);
      return { ok: false, status: res.status, data };
    }
    return { ok: true, status: res.status, data };
  } catch (err) {
    console.error('[TRELLO] Network error', err);
    return { ok: false, status: 0, data: null };
  }
}

function getSessionTypeByListId(listId) {
  if (listId === TRELLO_LIST_INTERVIEW_ID) return 'interview';
  if (listId === TRELLO_LIST_TRAINING_ID) return 'training';
  if (listId === TRELLO_LIST_MASS_SHIFT_ID) return 'mass_shift';
  return null;
}

function getSessionMeta(type) {
  switch (type) {
    case 'interview':
      return { name: 'Interview', roleId: INTERVIEW_SESSION_ROLE_ID, gameLink: GAME_LINK_INTERVIEW };
    case 'training':
      return { name: 'Training', roleId: TRAINING_SESSION_ROLE_ID, gameLink: GAME_LINK_TRAINING };
    case 'mass_shift':
      return { name: 'Mass Shift', roleId: MASS_SHIFT_SESSION_ROLE_ID, gameLink: GAME_LINK_MASS_SHIFT };
    default:
      return { name: 'Session', roleId: null, gameLink: null };
  }
}

// main ticker: run every minute
async function runSessionAnnouncementTick(client) {
  if (!SESSION_ANNOUNCEMENTS_CHANNEL_ID) return;

  const listIds = [TRELLO_LIST_INTERVIEW_ID, TRELLO_LIST_TRAINING_ID, TRELLO_LIST_MASS_SHIFT_ID].filter(Boolean);
  const now = new Date();

  for (const listId of listIds) {
    const type = getSessionTypeByListId(listId);
    const meta = getSessionMeta(type);
    const cardsRes = await trelloRequest(`/lists/${listId}/cards`, 'GET', {
      fields: 'id,name,due,idLabels,shortUrl,url',
    });
    if (!cardsRes.ok || !Array.isArray(cardsRes.data)) continue;

    for (const card of cardsRes.data) {
      if (!card.due) continue;
      const due = new Date(card.due);
      if (isNaN(due.getTime())) continue;
      const diff = due.getTime() - now.getTime();

      const labels = Array.isArray(card.idLabels) ? card.idLabels : [];
      const hasScheduled = TRELLO_LABEL_SCHEDULED_ID && labels.includes(TRELLO_LABEL_SCHEDULED_ID);
      const isCompleted = TRELLO_LABEL_COMPLETED_ID && labels.includes(TRELLO_LABEL_COMPLETED_ID);
      const isCanceled = TRELLO_LABEL_CANCELED_ID && labels.includes(TRELLO_LABEL_CANCELED_ID);

      if (!hasScheduled || isCompleted || isCanceled) continue;
      if (diff <= 0 || diff > 30 * 60 * 1000) continue;

      if (getSessionPost(card.id)) continue; // already posted

      try {
        const channel = await client.channels.fetch(SESSION_ANNOUNCEMENTS_CHANNEL_ID);
        if (!channel?.isTextBased?.()) continue;

        const unix = Math.floor(due.getTime() / 1000);
        const rolePing = meta.roleId ? `<@&${meta.roleId}>` : '';
        const trelloUrl = card.shortUrl || card.url || `https://trello.com/c/${card.id}`;
        const gameLine = meta.gameLink ? `**Game link:** ${meta.gameLink}\n` : '';

        const content =
          `${rolePing}\n\n` +
          `A **${meta.name}** session is starting in **30 minutes!**\n\n` +
          `**Name:** ${card.name}\n` +
          `**Starts:** <t:${unix}:T> (<t:${unix}:R>)\n\n` +
          `${gameLine}` +
          `**Trello card:** ${trelloUrl}`;

        const msg = await channel.send({ content });
        setSessionPost(card.id, channel.id, msg.id);
        console.log('[SESSIONS] Announcement posted:', card.id);
      } catch (err) {
        console.error('[SESSIONS] Announcement send failed:', err);
      }
    }
  }
}

// cleanup on cancel/log
async function deleteSessionAnnouncement(client, cardId) {
  const record = getSessionPost(cardId);
  if (!record) return;
  try {
    const channel = await client.channels.fetch(record.channelId);
    const msg = await channel?.messages.fetch(record.messageId).catch(() => null);
    if (msg) await msg.delete().catch(() => {});
    console.log('[SESSIONS] Deleted announcement for', cardId);
  } catch (err) {
    console.error('[SESSIONS] Delete failed', err);
  }
  clearSessionPost(cardId);
}

module.exports = { runSessionAnnouncementTick, deleteSessionAnnouncement };
