// src/utils/sessionQueueStore.js
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'sessionQueues.json');

let store = {};

// Load from disk on startup
function loadStore() {
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    store = JSON.parse(raw);
  } catch {
    store = {};
  }
}

function saveStore() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    console.error('[QUEUE] Failed to save queue store:', err);
  }
}

loadStore();

/**
 * Create / reset queue state for a Trello card.
 * roleKeys = array like ['cohost','overseer','interviewer',...]
 */
function initQueueState(
  cardId,
  sessionType,
  queueChannelId,
  queueMessageId,
  attendeesChannelId,
  attendeesMessageId,
  roleKeys,
  meta = {},
) {
  const queues = {};
  for (const key of roleKeys) {
    queues[key] = [];
  }

  store[cardId] = {
    sessionType,
    queueChannelId,
    queueMessageId,
    attendeesChannelId,
    attendeesMessageId,
    createdAt: Date.now(),
    closed: false,
    meta,
    queues,
  };

  saveStore();
}

function getQueueState(cardId) {
  return store[cardId] || null;
}

/**
 * Add a user to a specific role queue.
 * - Removes them from any other role in this card
 * - Respects maxSlots
 */
function addToQueue(cardId, roleKey, userId, maxSlots) {
  const state = store[cardId];
  if (!state) return { ok: false, code: 'noQueue' };
  if (state.closed) return { ok: false, code: 'closed' };

  if (!state.queues[roleKey]) {
    state.queues[roleKey] = [];
  }

  // Remove from any other role first so user is only in one queue
  for (const [k, arr] of Object.entries(state.queues)) {
    const idx = arr.indexOf(userId);
    if (idx !== -1) {
      arr.splice(idx, 1);
    }
  }

  const arr = state.queues[roleKey];

  if (arr.includes(userId)) {
    return { ok: false, code: 'already' };
  }

  if (typeof maxSlots === 'number' && maxSlots > 0 && arr.length >= maxSlots) {
    return { ok: false, code: 'full' };
  }

  arr.push(userId);
  saveStore();
  return { ok: true };
}

/**
 * Remove user from all role queues for that card.
 */
function removeFromQueue(cardId, userId) {
  const state = store[cardId];
  if (!state) return { ok: false, code: 'noQueue' };

  let removedRole = null;

  for (const [k, arr] of Object.entries(state.queues)) {
    const idx = arr.indexOf(userId);
    if (idx !== -1) {
      arr.splice(idx, 1);
      removedRole = k;
    }
  }

  if (!removedRole) {
    return { ok: false, code: 'notFound' };
  }

  saveStore();
  return { ok: true, roleKey: removedRole };
}

function setClosed(cardId, closed) {
  const state = store[cardId];
  if (!state) return { ok: false, code: 'noQueue' };
  state.closed = !!closed;
  saveStore();
  return { ok: true };
}

module.exports = {
  initQueueState,
  getQueueState,
  addToQueue,
  removeFromQueue,
  setClosed,
};
