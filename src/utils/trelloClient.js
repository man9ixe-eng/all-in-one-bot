// src/utils/trelloClient.js
const {
  TRELLO_KEY,
  TRELLO_TOKEN,
  TRELLO_BOARD_ID,
  TRELLO_LIST_INTERVIEW_ID,
  TRELLO_LIST_TRAINING_ID,
  TRELLO_LIST_MASS_SHIFT_ID,
  TRELLO_LIST_COMPLETED_ID,
  TRELLO_LIST_IN_PROGRESS_ID,
  TRELLO_LABEL_SCHEDULED_ID,
  TRELLO_LABEL_INTERVIEW_ID,
  TRELLO_LABEL_TRAINING_ID,
  TRELLO_LABEL_MASS_SHIFT_ID,
  TRELLO_LABEL_COMPLETED_ID,
  TRELLO_LABEL_CANCELED_ID,
  TRELLO_LABEL_IN_PROGRESS_ID,
} = require('../config/trello');

const GH_TITLE_LABEL_ID = '69352ab38aa6bc32178d571d'; // Header label

// Universal Trello request
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

// Utility: get list ID for session type
function getListIdForSessionType(type) {
  switch (type) {
    case 'interview': return TRELLO_LIST_INTERVIEW_ID;
    case 'training': return TRELLO_LIST_TRAINING_ID;
    case 'mass_shift': return TRELLO_LIST_MASS_SHIFT_ID;
    default: return null;
  }
}

// Utility: get emoji + label by session type
function getTypeMeta(type) {
  switch (type) {
    case 'interview':
      return { emoji: '💼', label: TRELLO_LABEL_INTERVIEW_ID, name: 'Interview' };
    case 'training':
      return { emoji: '🎓', label: TRELLO_LABEL_TRAINING_ID, name: 'Training' };
    case 'mass_shift':
      return { emoji: '🏨', label: TRELLO_LABEL_MASS_SHIFT_ID, name: 'Mass Shift' };
    default:
      return { emoji: '📋', label: null, name: 'Session' };
  }
}

// Convert local date/time to UTC ISO
function toUTC(dateStr, timeStr, tz) {
  const [month, day, year] = dateStr.split('/').map(Number);
  const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return null;

  let [_, hour, minute, ampm] = match;
  hour = Number(hour);
  minute = Number(minute);
  if (ampm.toUpperCase() === 'PM' && hour < 12) hour += 12;
  if (ampm.toUpperCase() === 'AM' && hour === 12) hour = 0;

  const date = new Date(`${year}-${month}-${day}T${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:00${tz}`);
  return date.toISOString();
}

// Create a Trello session card
async function createSessionCard({ sessionType, title, dateStr, timeStr, notes, hostTag, hostId }) {
  const listId = getListIdForSessionType(sessionType);
  if (!listId) return false;

  const tzOffset = -new Date().getTimezoneOffset() / 60;
  const tzCode = Intl.DateTimeFormat().resolvedOptions().timeZone.split('/').pop();
  const tzSuffix = tzCode || (tzOffset > 0 ? `UTC+${tzOffset}` : `UTC${tzOffset}`);

  const dueISO = toUTC(dateStr, timeStr, 'Z');
  const { emoji, label, name } = getTypeMeta(sessionType);

  const now = new Date();
  const due = new Date(dueISO);
  const diffHrs = (due - now) / (1000 * 60 * 60);
  const urgent = diffHrs <= 1 ? '🔥 ' : '';

  const cardName = `${urgent}${emoji} [${name}] ${timeStr} ${tzSuffix} | ${hostTag}`;
  const desc = [
    '━━━━━━━━━━━━━━━━━━━━━━━',
    `📋 **Session Type:** ${name}`,
    `👤 **Host:** ${hostTag}`,
    `🕒 **Time:** ${timeStr} ${tzSuffix}`,
    `📅 **Date:** ${new Date(dueISO).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
    '━━━━━━━━━━━━━━━━━━━━━━━',
    '📝 **Host Notes:**',
    notes?.trim() || 'Please arrive 5–10 minutes early to secure a spot! We can’t wait to see you there. 😄',
  ].join('\n');

  const labels = [label, TRELLO_LABEL_SCHEDULED_ID].filter(Boolean);
  const result = await trelloRequest('/cards', 'POST', {
    idList: listId,
    name: cardName,
    desc,
    due: dueISO,
    pos: 'bottom',
    idLabels: labels.join(','),
  });

  if (!result.ok) return false;

  // Sort after adding
  await reorderList(listId);
  return result.data;
}

// Cancel session — replace Scheduled with Canceled
async function cancelSessionCard({ cardId, reason }) {
  if (!cardId) return false;
  const card = await trelloRequest(`/cards/${cardId}`, 'GET');
  if (!card.ok) return false;

  const labels = (card.data.idLabels || [])
    .filter(id => id !== TRELLO_LABEL_SCHEDULED_ID)
    .concat(TRELLO_LABEL_CANCELED_ID);

  await trelloRequest(`/cards/${cardId}`, 'PUT', {
    idLabels: labels.join(','),
    dueComplete: 'true',
    desc: `❌ Session canceled.\nReason: ${reason || 'No reason provided.'}`,
  });

  await trelloRequest(`/cards/${cardId}`, 'PUT', { idList: TRELLO_LIST_COMPLETED_ID, pos: 'top' });
  return true;
}

// Log session — replace Scheduled with Completed
async function completeSessionCard({ cardId }) {
  if (!cardId) return false;
  const card = await trelloRequest(`/cards/${cardId}`, 'GET');
  if (!card.ok) return false;

  const labels = (card.data.idLabels || [])
    .filter(id => id !== TRELLO_LABEL_SCHEDULED_ID)
    .concat(TRELLO_LABEL_COMPLETED_ID);

  await trelloRequest(`/cards/${cardId}`, 'PUT', {
    idLabels: labels.join(','),
    dueComplete: 'true',
  });

  await trelloRequest(`/cards/${cardId}`, 'PUT', { idList: TRELLO_LIST_COMPLETED_ID, pos: 'top' });
  return true;
}

// Move cards by due date while keeping GH-Title pinned
async function reorderList(listId) {
  const cards = await trelloRequest(`/lists/${listId}/cards`, 'GET');
  if (!cards.ok) return;

  const header = cards.data.find(c => c.idLabels.includes(GH_TITLE_LABEL_ID));
  const normal = cards.data.filter(c => !c.idLabels.includes(GH_TITLE_LABEL_ID));

  const sorted = normal.sort((a, b) => new Date(a.due || 0) - new Date(b.due || 0));
  const ordered = [header, ...sorted].filter(Boolean);

  for (let i = 0; i < ordered.length; i++) {
    await trelloRequest(`/cards/${ordered[i].id}`, 'PUT', { pos: i + 1 });
  }
}

// Auto-move expired sessions → In Progress
async function autoMoveDueSessions() {
  const lists = [TRELLO_LIST_INTERVIEW_ID, TRELLO_LIST_TRAINING_ID, TRELLO_LIST_MASS_SHIFT_ID];
  const now = new Date();

  for (const listId of lists) {
    const res = await trelloRequest(`/lists/${listId}/cards`, 'GET');
    if (!res.ok) continue;

    for (const card of res.data) {
      if (!card.due) continue;
      const due = new Date(card.due);
      if (due <= now && !card.idLabels.includes(TRELLO_LABEL_IN_PROGRESS_ID)) {
        const newLabels = (card.idLabels || [])
          .filter(id => id !== TRELLO_LABEL_SCHEDULED_ID)
          .concat(TRELLO_LABEL_IN_PROGRESS_ID);
        await trelloRequest(`/cards/${card.id}`, 'PUT', {
          idLabels: newLabels.join(','),
          idList: TRELLO_LIST_IN_PROGRESS_ID,
        });
      }
    }
  }
}

module.exports = {
  createSessionCard,
  cancelSessionCard,
  completeSessionCard,
  reorderList,
  autoMoveDueSessions,
};
