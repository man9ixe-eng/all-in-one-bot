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

// Generic Trello request using global fetch (Node 18+)
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
 * Returns: true on success, false on error.
 *
 * NOTE: This keeps the same contract as your older working version:
 *  - /addsession expects a boolean result.
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

  const labelIds = [];
  if (typeLabelId) labelIds.push(typeLabelId);
  if (TRELLO_LABEL_SCHEDULED_ID) labelIds.push(TRELLO_LABEL_SCHEDULED_ID);

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
    pos: 'bottom',
    due: dueISO || null,
  };

  if (labelIds.length > 0) {
    params.idLabels = labelIds.join(',');
  }

  console.log('[TRELLO] Creating card with params:', params);

  const result = await trelloRequest('/cards', 'POST', params);
  if (!result.ok) return false;

  console.log('[TRELLO] Created card:', {
    id: result.data && result.data.id,
    url: result.data && (result.data.shortUrl || result.data.url),
  });

  return true;
}

/**
 * Helper: rebuild label set for a card when changing status.
 *
 * - Keeps all existing labels except status ones (Scheduled / Completed / Canceled)
 * - Adds the new status label if provided.
 */
function buildStatusLabelSet(existingLabels, statusLabelToAdd) {
  const labels = Array.isArray(existingLabels) ? [...existingLabels] : [];

  const statusIds = [
    TRELLO_LABEL_SCHEDULED_ID,
    TRELLO_LABEL_COMPLETED_ID,
    TRELLO_LABEL_CANCELED_ID,
  ].filter(Boolean);

  const filtered = labels.filter((id) => !statusIds.includes(id));

  if (statusLabelToAdd) {
    filtered.push(statusLabelToAdd);
  }

  return filtered;
}

/**
 * Cancel a session card:
 * - Replaces SCHEDULED/COMPLETED with CANCELED status label
 * - Marks due as complete
 * - Moves to Completed list (top) if configured
 * - Appends cancel reason to description
 *
 * Returns: true on success, false on error.
 */
async function cancelSessionCard(cardId, reason) {
  if (!cardId) return false;

  // Get current labels + desc
  const cardRes = await trelloRequest(`/cards/${cardId}`, 'GET', {
    fields: 'idLabels,desc',
  });
  if (!cardRes.ok || !cardRes.data) {
    console.error('[TRELLO] Could not load card to cancel:', cardId);
    return false;
  }

  const card = cardRes.data;
  const newLabels = buildStatusLabelSet(card.idLabels, TRELLO_LABEL_CANCELED_ID);

  const descParts = [];
  if (card.desc) descParts.push(card.desc);
  descParts.push('❌ Session canceled.');
  if (reason && reason.trim().length > 0) {
    descParts.push(`Reason: ${reason}`);
  }

  const updateParams = {
    idLabels: newLabels.length > 0 ? newLabels.join(',') : undefined,
    dueComplete: 'true',
    desc: descParts.join('\n'),
  };

  if (TRELLO_LIST_COMPLETED_ID) {
    updateParams.idList = TRELLO_LIST_COMPLETED_ID;
    updateParams.pos = 'top';
  }

  const res = await trelloRequest(`/cards/${cardId}`, 'PUT', updateParams);
  if (!res.ok) {
    console.error('[TRELLO] Failed to cancel card:', cardId, res.data);
    return false;
  }

  console.log('[TRELLO] Canceled card:', cardId);
  return true;
}

/**
 * Complete a session card:
 * - Replaces SCHEDULED/CANCELED with COMPLETED status label
 * - Marks due as complete
 * - Moves to Completed list (top) if configured
 *
 * Returns: true on success, false on error.
 */
async function completeSessionCard(cardId) {
  if (!cardId) return false;

  const cardRes = await trelloRequest(`/cards/${cardId}`, 'GET', {
    fields: 'idLabels,desc',
  });
  if (!cardRes.ok || !cardRes.data) {
    console.error('[TRELLO] Could not load card to complete:', cardId);
    return false;
  }

  const card = cardRes.data;
  const newLabels = buildStatusLabelSet(card.idLabels, TRELLO_LABEL_COMPLETED_ID);

  const descParts = [];
  if (card.desc) descParts.push(card.desc);
  descParts.push('✅ Session completed.');

  const updateParams = {
    idLabels: newLabels.length > 0 ? newLabels.join(',') : undefined,
    dueComplete: 'true',
    desc: descParts.join('\n'),
  };

  if (TRELLO_LIST_COMPLETED_ID) {
    updateParams.idList = TRELLO_LIST_COMPLETED_ID;
    updateParams.pos = 'top';
  }

  const res = await trelloRequest(`/cards/${cardId}`, 'PUT', updateParams);
  if (!res.ok) {
    console.error('[TRELLO] Failed to complete card:', cardId, res.data);
    return false;
  }

  console.log('[TRELLO] Completed card:', cardId);
  return true;
}

module.exports = {
  trelloRequest,
  createSessionCard,
  cancelSessionCard,
  completeSessionCard,
};
