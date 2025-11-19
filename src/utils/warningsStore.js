// src/utils/warningsStore.js

const fs = require('node:fs');
const path = require('node:path');

const dataDir = path.join(__dirname, '..', 'data');
const dataFile = path.join(dataDir, 'warnings.json');

function ensureFile() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, JSON.stringify({}, null, 2), 'utf8');
  }
}

function loadData() {
  try {
    ensureFile();
    const raw = fs.readFileSync(dataFile, 'utf8');
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (err) {
    console.error('[WARNINGS] Failed to load warnings data:', err);
    return {};
  }
}

function saveData(data) {
  try {
    ensureFile();
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[WARNINGS] Failed to save warnings data:', err);
  }
}

/**
 * Add a warning entry for a user in a guild.
 *
 * warning = {
 *   moderatorId: string,
 *   moderatorTag: string,
 *   reason: string,
 *   timestamp: number (ms),
 * }
 */
function addWarning(guildId, userId, warning) {
  const data = loadData();
  if (!data[guildId]) data[guildId] = {};
  if (!data[guildId][userId]) data[guildId][userId] = [];
  data[guildId][userId].push(warning);
  saveData(data);
  return data[guildId][userId];
}

function getWarnings(guildId, userId) {
  const data = loadData();
  if (!data[guildId]) return [];
  return data[guildId][userId] || [];
}

function clearWarnings(guildId, userId) {
  const data = loadData();
  if (data[guildId] && data[guildId][userId]) {
    delete data[guildId][userId];
    saveData(data);
    return true;
  }
  return false;
}

module.exports = {
  addWarning,
  getWarnings,
  clearWarnings,
};
