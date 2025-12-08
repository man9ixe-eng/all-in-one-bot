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

/**
 * Generic Trello request using built-in fetch (Node 18+)
 */
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
      // ignore non-JSON
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
    pos: 'bottom', // keeps your header cards at the top
    due: dueISO || null,
  };

  if (labelIds.length > 0) {
    params.idLabels = labelIds.join(',');
  }

  console.log('[TRELLO] Creating card with params:', params);

  const result = await trelloRequest('/cards', 'POST', params);

  if (!result.ok) {
    console.error('[TRELLO] Failed to create card:', result.status, result.data);
    return false;
  }

  console.log('[TRELLO] Created card:', {
    id: result.data && result.data.id,
    url: result.data && (result.data.shortUrl || result.data.url),
  });

  return true;
}

/**
 * Helper to describe how far from due time an action happened.
 * Returns a string like:
 *  - "13 minutes after scheduled time"
 *  - "5 minutes before scheduled time"
 *  - "exactly on time"
 */
function describeTimeDiff(dueISO) {
  if (!dueISO) return '';

  const dueTime = new Date(dueISO).getTime();
  if (Number.isNaN(dueTime)) return '';

  const now = Date.now();
  const diffMinutes = Math.round((now - dueTime) / 60000);

  if (diffMinutes > 0) {
    return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} after scheduled time`;
  } else if (diffMinutes < 0) {
    const m = Math.abs(diffMinutes);
    return `${m} minute${m === 1 ? '' : 's'} before scheduled time`;
  } else {
    return 'exactly on time';
  }
}

/**
 * Cancel a session card by Trello card ID or shortlink.
 * - REMOVE SCHEDULED label
 * - ADD CANCELED label
 * - Keep type labels
 * - Mark due as complete
 * - Move to COMPLETED list (top)
 * - Append minutes-from-due info to description
 */
async function cancelSessionCard({ cardId, reason }) {
  if (!cardId) return false;

  // 1) Load current card info
  const cardRes = await trelloRequest(`/cards/${cardId}`, 'GET', {
    fields: 'idLabels,desc,due',
  });

  if (!cardRes.ok || !cardRes.data) {
    console.error(
      '[TRELLO] cancelSessionCard: failed to load card',
      cardId,
      cardRes.status,
      cardRes.data,
    );
    return false;
  }

  const card = cardRes.data;
  const currentLabels = Array.isArray(card.idLabels) ? card.idLabels.slice() : [];

  // Label math: swap SCHEDULED -> CANCELED, keep everything else
  const labelSet = new Set(currentLabels);
  if (TRELLO_LABEL_SCHEDULED_ID) labelSet.delete(TRELLO_LABEL_SCHEDULED_ID);
  if (TRELLO_LABEL_COMPLETED_ID) labelSet.delete(TRELLO_LABEL_COMPLETED_ID);
  if (TRELLO_LABEL_CANCELED_ID) labelSet.add(TRELLO_LABEL_CANCELED_ID);
  const newLabels = Array.from(labelSet);

  // Time diff
  const timeDiffStr = describeTimeDiff(card.due);

  // Build new description
  const descLines = [];
  if (card.desc && card.desc.trim().length > 0) {
    descLines.push(card.desc.trim(), '');
  }

  descLines.push('❌ Session canceled.');
  if (reason && reason.trim().length > 0) {
    descLines.push(`Reason: ${reason.trim()}`);
  }
  if (timeDiffStr) {
    descLines.push(`⏱️ Canceled ${timeDiffStr}.`);
  }

  const res1 = await trelloRequest(`/cards/${cardId}`, 'PUT', {
    idLabels: newLabels.length > 0 ? newLabels.join(',') : undefined,
    dueComplete: 'true',
    desc: descLines.join('\n'),
  });

  if (!res1.ok) {
    console.error(
      '[TRELLO] cancelSessionCard: failed to update card',
      cardId,
      res1.status,
      res1.data,
    );
    return false;
  }

  // Move to Completed list
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
 * Mark a session card as completed.
 * - REMOVE SCHEDULED / CANCELED
 * - ADD COMPLETED
 * - Keep type labels
 * - Mark due as complete
 * - Move to COMPLETED list (top)
 * - Append minutes-from-due info to description
 */
async function completeSessionCard({ cardId }) {
  if (!cardId) return false;

  const cardRes = await trelloRequest(`/cards/${cardId}`, 'GET', {
    fields: 'idLabels,desc,due',
  });

  if (!cardRes.ok || !cardRes.data) {
    console.error(
      '[TRELLO] completeSessionCard: failed to load card',
      cardId,
      cardRes.status,
      cardRes.data,
    );
    return false;
  }

  const card = cardRes.data;
  const currentLabels = Array.isArray(card.idLabels) ? card.idLabels.slice() : [];

  const labelSet = new Set(currentLabels);
  if (TRELLO_LABEL_SCHEDULED_ID) labelSet.delete(TRELLO_LABEL_SCHEDULED_ID);
  if (TRELLO_LABEL_CANCELED_ID) labelSet.delete(TRELLO_LABEL_CANCELED_ID);
  if (TRELLO_LABEL_COMPLETED_ID) labelSet.add(TRELLO_LABEL_COMPLETED_ID);
  const newLabels = Array.from(labelSet);

  const timeDiffStr = describeTimeDiff(card.due);

  const descLines = [];
  if (card.desc && card.desc.trim().length > 0) {
    descLines.push(card.desc.trim(), '');
  }

  descLines.push('✅ Session marked complete.');
  if (timeDiffStr) {
    descLines.push(`⏱️ Completed ${timeDiffStr}.`);
  }

  const res1 = await trelloRequest(`/cards/${cardId}`, 'PUT', {
    idLabels: newLabels.length > 0 ? newLabels.join(',') : undefined,
    dueComplete: 'true',
    desc: descLines.join('\n'),
  });

  if (!res1.ok) {
    console.error(
      '[TRELLO] completeSessionCard: failed to update card',
      cardId,
      res1.status,
      res1.data,
    );
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

/**
 * Simple helper to move a card directly to the Completed list (if configured).
 */
async function moveToCompletedList(cardId) {
  if (!cardId || !TRELLO_LIST_COMPLETED_ID) return false;

  const res = await trelloRequest(`/cards/${cardId}`, 'PUT', {
    idList: TRELLO_LIST_COMPLETED_ID,
    pos: 'top',
  });

  if (!res.ok) {
    console.error(
      '[TRELLO] moveToCompletedList: failed',
      cardId,
      res.status,
      res.data,
    );
    return false;
  }

  console.log('[TRELLO] Moved card to completed list:', cardId);
  return true;
}

module.exports = {
  trelloRequest,
  createSessionCard,
  cancelSessionCard,
  completeSessionCard,
  moveToCompletedList,
};
