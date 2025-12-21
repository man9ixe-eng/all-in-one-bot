// src/utils/sessionQueueStore.js
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'sessionQueues.json');

let store = {};

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
    console.error('[QUEUE] Failed to save sessionQueues store:', err);
  }
}

loadStore();

function getQueue(cardId) {
  return store[cardId] || null;
}

function setQueue(cardId, data) {
  store[cardId] = {
    ...(store[cardId] || {}),
    ...data,
    cardId,
  };
  saveStore();
}

function deleteQueue(cardId) {
  if (store[cardId]) {
    delete store[cardId];
    saveStore();
  }
}

function ensureQueue(cardId) {
  if (!store[cardId]) {
    store[cardId] = {
      cardId,
      sessionType: null,
      queueChannelId: null,
      queueMessageId: null,
      dueUnix: null,
      locked: false,
      createdAt: Date.now(),
      joins: [],
    };
  } else if (!Array.isArray(store[cardId].joins)) {
    store[cardId].joins = [];
  }
  return store[cardId];
}

function addJoin(cardId, userId, role) {
  const q = ensureQueue(cardId);
  const now = Date.now();

  q.joins = (q.joins || []).filter(j => j.userId !== userId);
  q.joins.push({ userId, role, joinedAt: now });

  saveStore();
  return q;
}

function removeJoin(cardId, userId) {
  const q = store[cardId];
  if (!q || !Array.isArray(q.joins)) return;

  const before = q.joins.length;
  q.joins = q.joins.filter(j => j.userId !== userId);
  if (q.joins.length !== before) {
    saveStore();
  }
}

function lockQueue(cardId) {
  const q = store[cardId];
  if (!q) return;
  q.locked = true;
  saveStore();
}

function isLocked(cardId) {
  const q = store[cardId];
  return !!(q && q.locked);
}

function listJoins(cardId) {
  const q = store[cardId];
  return q && Array.isArray(q.joins) ? q.joins.slice() : [];
}

module.exports = {
  getQueue,
  setQueue,
  deleteQueue,
  addJoin,
  removeJoin,
  lockQueue,
  isLocked,
  listJoins,
};
