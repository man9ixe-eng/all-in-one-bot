// src/utils/sessionPostsStore.js
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'sessionPosts.json');

let store = {};

// Load existing store (if any)
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
    console.error('[SESSIONS] Failed to save sessionPosts store:', err);
  }
}

loadStore();

function setSessionPost(cardId, channelId, messageId) {
  store[cardId] = { channelId, messageId };
  saveStore();
}

function getSessionPost(cardId) {
  return store[cardId] || null;
}

function clearSessionPost(cardId) {
  if (store[cardId]) {
    delete store[cardId];
    saveStore();
  }
}

module.exports = {
  setSessionPost,
  getSessionPost,
  clearSessionPost,
};
