// src/utils/trelloClient.js

const {
  TRELLO_KEY,
  TRELLO_TOKEN,
  TRELLO_BOARD_ID,
  TRELLO_LIST_INTERVIEW_ID,
  TRELLO_LIST_TRAINING_ID,
  TRELLO_LIST_MASS_SHIFT_ID,
  TRELLO_LIST_COMPLETED_ID,
  TRELLO_LABEL_SCHEDULED_ID,
  TRELLO_LABEL_INTERVIEW_ID,
  TRELLO_LABEL_TRAINING_ID,
  TRELLO_LABEL_MASS_SHIFT_ID,
  TRELLO_LABEL_COMPLETED_ID,
  TRELLO_LABEL_CANCELED_ID,
} = require('../config/trello');

// Label used on header/title cards like "★ Interviews ★", "★ Trainings ★", "★ DECEMBER ★"
const HEADER_LABEL_ID = '69352ab38aa6bc32178d571d';

// -------------------- Core HTTP helper -------------------- //

async function trelloRequest(path, method = 'GET', query = {}) {
  if (!TRELLO_KEY || !TRELLO_TOKEN) {
    console.error('[TRELLO] Missing TRELLO_KEY or TRELLO_TOKEN');
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
    let data = null;
    try {
      data = await res.json();
    } catch {
      // non-JSON response, ignore
    }

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

// -------------------- List / label helpers -------------------- //

function getListIdForSessionType(sessionType) {
  switch (sessionType) {
    case 'interview':
      return TRELLO_LIST_INTERVIEW_ID;
    case 'training':
      return TRELLO_LIST_TRAINING_ID;
    case 'mass_shift':
      return TRELLO_LIST_MASS_SHIFT_ID;
    default:
      return null;
  }
}

function getTypeLabelId(sessionType) {
  switch (sessionType) {
    case 'interview':
      return TRELLO_LABEL_INTERVIEW_ID;
    case 'training':
      return TRELLO_LABEL_TRAINING_ID;
    case 'mass_shift':
      return TRELLO_LABEL_MASS_SHIFT_ID;
    default:
      return null;
  }
}

/**
 * Sort a Trello list by due date ascending, keeping the header card
 * (with HEADER_LABEL_ID) pinned at the very top. All other cards are
 * ordered so the soonest due is directly under the header.
 */
async function sortListByDue(listId) {
  if (!listId) return false;

  const result = await trelloRequest(`/lists/${listId}/cards`, 'GET', {
    fields: 'id,name,due,pos,idLabels',
  });

  if (!result.ok || !Array.isArray(result.data)) {
    console.error('[TRELLO] Failed to fetch cards for sorting', listId);
    return false;
  }

  const cards = result.data;

  const headerCards = cards.filter(
    (c) => Array.isArray(c.idLabels) && c.idLabels.includes(HEADER_LABEL_ID),
  );
  const normalCards = cards.filter(
    (c) => !(Array.isArray(c.idLabels) && c.idLabels.includes(HEADER_LABEL_ID)),
  );

  const headerCard = headerCards[0] || null;

  normalCards.sort((a, b) => {
    if (!a.due && !b.due) return 0;
    if (!a.due) return 1;
    if (!b.due) return -1;
    const da = new Date(a.due).getTime();
    const db = new Date(b.due).getTime();
    return da - db;
  });

  if (headerCard) {
    // Force header to absolute top
    await trelloRequest(`/cards/${headerCard.id}`, 'PUT', { pos: 'top' });

    // Then stack normal cards below in due-order
    for (const card of normalCards) {
      await trelloRequest(`/cards/${card.id}`, 'PUT', { pos: 'bottom' });
    }
  } else {
    // No header, just sort everything by due
    for (const card of normalCards) {
      await trelloRequest(`/cards/${card.id}`, 'PUT', { pos: 'bottom' });
    }
  }

  console.log('[TRELLO] Sorted list by due (header pinned):', listId);
  return true;
}

/**
 * Helper to update *status* labels:
 * - Status labels = SCHEDULED / COMPLETED / CANCELED
 * - Remove ALL status labels
 * - Add exactly targetLabelId (COMPLETED or CANCELED)
 * All other labels (TRAINING, INTERVIEW, FIRST SESSION, etc.) are untouched.
 */
async function swapScheduledForLabel(cardId, targetLabelId) {
  if (!cardId) return false;

  const cardRes = await trelloRequest(`/cards/${cardId}`, 'GET', {
    fields: 'idLabels',
  });

  if (!cardRes.ok || !cardRes.data) {
    console.error('[TRELLO] Failed to fetch card for label update:', cardId);
    return false;
  }

  let labels = Array.isArray(cardRes.data.idLabels)
    ? [...cardRes.data.idLabels]
    : [];

  // All status labels we might use
  const statusIds = [
    TRELLO_LABEL_SCHEDULED_ID,
    TRELLO_LABEL_COMPLETED_ID,
    TRELLO_LABEL_CANCELED_ID,
  ].filter(Boolean);

  // Drop ALL status labels
  labels = labels.filter((id) => !statusIds.includes(id));

  // Add the one we actually want (or none, if null)
  if (targetLabelId && !labels.includes(targetLabelId)) {
    labels.push(targetLabelId);
  }

  const updateRes = await trelloRequest(`/cards/${cardId}`, 'PUT', {
    idLabels: labels.join(','),
  });

  if (!updateRes.ok) {
    console.error('[TRELLO] Failed to update labels for card:', cardId);
    return false;
  }

  return true;
}

// -------------------- Main actions -------------------- //

/**
 * Create a session card on Trello.
 * - Interview  → INTERVIEW + SCHEDULED
 * - Training   → TRAINING  + SCHEDULED
 * - Mass Shift → MASS SHIFT + SCHEDULED
 * Card is added to the correct list and then that list is sorted under its header.
 */
async function createSessionCard({
  sessionType,
  title,
  dueISO,
  notes,
  hostTag,
  hostId,
}) {
  const listId = getListIdForSessionType(sessionType);
  if (!listId) {
    console.error('[TRELLO] Unknown or unconfigured session type:', sessionType);
    return false;
  }

  const typeLabelId = getTypeLabelId(sessionType);
  const labelIds = [typeLabelId, TRELLO_LABEL_SCHEDULED_ID].filter(Boolean);

  const humanType =
    sessionType === 'interview'
      ? 'Interview'
      : sessionType === 'training'
      ? 'Training'
      : 'Mass Shift';

  const name = `[${humanType}] ${title}`;
  const descLines = [
    `Session Type: ${humanType}`,
    `Host: ${hostTag} (${hostId})`,
  ];

  if (notes && notes.trim().length > 0) {
    descLines.push(`Notes: ${notes}`);
  }

  const params = {
    idList: listId,
    name,
    desc: descLines.join('\n'),
    pos: 'bottom', // header stays pinned at top
    due: dueISO || null,
  };

  if (labelIds.length > 0) {
    params.idLabels = labelIds.join(',');
  }

  console.log('[TRELLO] Creating card with params:', params);

  const result = await trelloRequest('/cards', 'POST', params);

  if (!result.ok) {
    return false;
  }

  console.log('[TRELLO] Created card:', {
    id: result.data && result.data.id,
    url: result.data && (result.data.shortUrl || result.data.url),
  });

  // Re-sort that list by due date (under header)
  await sortListByDue(listId);

  return true;
}

/**
 * Cancel a session:
 * - Keeps type labels
 * - Status labels: SCHEDULED/COMPLETED/CANCELED → only CANCELED
 * - dueComplete = true
 * - Moves to Completed list at top
 * - Completed list also gets sorted with its header pinned
 */
async function cancelSessionCard({ cardId, reason }) {
  if (!cardId) return false;

  const labelsOk = await swapScheduledForLabel(cardId, TRELLO_LABEL_CANCELED_ID);
  if (!labelsOk) return false;

  const descPrefix = '❌ Session canceled.';
  const desc = reason ? `${descPrefix}\nReason: ${reason}` : descPrefix;

  const res1 = await trelloRequest(`/cards/${cardId}`, 'PUT', {
    dueComplete: 'true',
    desc,
  });

  if (!res1.ok) return false;

  if (TRELLO_LIST_COMPLETED_ID) {
    await trelloRequest(`/cards/${cardId}`, 'PUT', {
      idList: TRELLO_LIST_COMPLETED_ID,
      pos: 'top',
    });

    // Keep DONE | DEC list ordered + header pinned
    await sortListByDue(TRELLO_LIST_COMPLETED_ID);
  }

  console.log('[TRELLO] Canceled + moved card:', cardId);
  return true;
}

/**
 * Complete/log a session:
 * - Keeps type labels
 * - Status labels: SCHEDULED/COMPLETED/CANCELED → only COMPLETED
 * - dueComplete = true
 * - Moves to Completed list at top
 * - Completed list also sorted with header pinned
 */
async function completeSessionCard({ cardId }) {
  if (!cardId) return false;

  const labelsOk = await swapScheduledForLabel(cardId, TRELLO_LABEL_COMPLETED_ID);
  if (!labelsOk) return false;

  const res1 = await trelloRequest(`/cards/${cardId}`, 'PUT', {
    dueComplete: 'true',
  });

  if (!res1.ok) return false;

  if (TRELLO_LIST_COMPLETED_ID) {
    await trelloRequest(`/cards/${cardId}`, 'PUT', {
      idList: TRELLO_LIST_COMPLETED_ID,
      pos: 'top',
    });

    // Keep DONE | DEC list ordered + header pinned
    await sortListByDue(TRELLO_LIST_COMPLETED_ID);
  }

  console.log('[TRELLO] Marked card complete:', cardId);
  return true;
}

async function moveToCompletedList(cardId) {
  if (!cardId || !TRELLO_LIST_COMPLETED_ID) return false;

  const res = await trelloRequest(`/cards/${cardId}`, 'PUT', {
    idList: TRELLO_LIST_COMPLETED_ID,
    pos: 'top',
  });

  if (!res.ok) return false;

  // Also keep completed list ordered and header on top
  await sortListByDue(TRELLO_LIST_COMPLETED_ID);

  console.log('[TRELLO] Moved card to completed list:', cardId);
  return true;
}

module.exports = {
  createSessionCard,
  cancelSessionCard,
  completeSessionCard,
  moveToCompletedList,
};
