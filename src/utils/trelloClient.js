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

// Generic Trello request using built-in fetch (Node 18+)
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
      // If it isn't JSON, ignore – we only care about ok/not ok
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
 * Create a session card on Trello.
 *
 * Interview  → INTERVIEW + SCHEDULED labels
 * Training   → TRAINING  + SCHEDULED labels
 * Mass Shift → MASS SHIFT + SCHEDULED labels
 *
 * Returns: true on success, false on error.
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
  const labelIds = [
    typeLabelId,
    TRELLO_LABEL_SCHEDULED_ID,
  ].filter(Boolean);

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
    pos: 'bottom', // keep your header card at very top
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

  return true;
}

/**
 * Cancel a session card by Trello card ID or shortlink.
 * - Sets CANCELED label
 * - Marks due as complete
 * - Moves to COMPLETED list at top
 *
 * Returns: true on success, false on error.
 */
async function cancelSessionCard({ cardId, reason }) {
  if (!cardId) return false;

  const descPrefix = '❌ Session canceled.';
  const desc = reason ? `${descPrefix}\nReason: ${reason}` : descPrefix;

  // Set canceled label + dueComplete + description
  const res1 = await trelloRequest(`/cards/${cardId}`, 'PUT', {
    idLabels: TRELLO_LABEL_CANCELED_ID || undefined,
    dueComplete: 'true',
    desc,
  });

  if (!res1.ok) {
    return false;
  }

  // Move card to Completed list (if configured)
  if (TRELLO_LIST_COMPLETED_ID) {
    await trelloRequest(`/cards/${cardId}`, 'PUT', {
      idList: TRELLO_LIST_COMPLETED_ID,
      pos: 'top',
    });
  }

  console.log('[TRELLO] Canceled + moved card:', cardId);
  return true;
}

/**
 * Optional helpers for future /logsession, etc.
 */
async function completeSessionCard({ cardId }) {
  if (!cardId) return false;

  const res1 = await trelloRequest(`/cards/${cardId}`, 'PUT', {
    idLabels: TRELLO_LABEL_COMPLETED_ID || undefined,
    dueComplete: 'true',
  });

  if (!res1.ok) {
    return false;
  }

  if (TRELLO_LIST_COMPLETED_ID) {
    await trelloRequest(`/cards/${cardId}`, 'PUT', {
      idList: TRELLO_LIST_COMPLETED_ID,
      pos: 'top',
    });
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

  console.log('[TRELLO] Moved card to completed list:', cardId);
  return true;
}

module.exports = {
  createSessionCard,
  cancelSessionCard,
  completeSessionCard,
  moveToCompletedList,
};
