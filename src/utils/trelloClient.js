// src/utils/trelloClient.js
// Uses Node's built-in fetch (Node 18+). Render + your local Node are fine.

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

const TRELLO_API_BASE = 'https://api.trello.com/1';

function ensureTrelloConfig() {
  if (!TRELLO_KEY || !TRELLO_TOKEN) {
    throw new Error('Trello key/token not set. Check TRELLO_KEY and TRELLO_TOKEN in .env');
  }
}

function buildUrl(path, query = {}) {
  const params = new URLSearchParams({
    key: TRELLO_KEY,
    token: TRELLO_TOKEN,
    ...query,
  });

  return `${TRELLO_API_BASE}${path}?${params.toString()}`;
}

async function trelloRequest(method, path, query = {}, body = null) {
  ensureTrelloConfig();

  const url = buildUrl(path, query);
  const options = { method };

  if (body) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`Trello API error ${res.status}: ${text}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Given a Trello card URL or raw ID/shortLink, extract a usable id/shortLink.
 */
function extractCardIdentifier(input) {
  const trimmed = (input || '').trim();
  if (!trimmed) throw new Error('No Trello card link or ID provided.');

  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split('/').filter(Boolean);
    // Typical Trello card URL: /c/<shortLink>/<slug>
    if (parts[0] === 'c' && parts[1]) {
      return parts[1];
    }
    // Fallback: /card/<id>
    if (parts[0] === 'card' && parts[1]) {
      return parts[1];
    }
  } catch {
    // Not a URL; assume raw id or shortLink
  }

  return trimmed;
}

/**
 * Get a card by URL or ID/shortLink.
 */
async function getCardFromUrlOrId(cardArg) {
  const idOrShort = extractCardIdentifier(cardArg);
  const card = await trelloRequest('GET', `/cards/${idOrShort}`, {
    fields: 'id,name,shortUrl,idList,due,dueComplete,idLabels',
  });
  return card;
}

/**
 * Create a session card in the correct list with correct labels.
 *
 * sessionType: 'interview' | 'training' | 'mass_shift'
 */
async function createSessionCard({
  sessionType,
  title,
  dueISO,
  notes,
  hostTag,
  hostId,
}) {
  const typeConfig = {
    interview: {
      listId: TRELLO_LIST_INTERVIEW_ID,
      labelId: TRELLO_LABEL_INTERVIEW_ID,
      prefix: '(Interview)',
    },
    training: {
      listId: TRELLO_LIST_TRAINING_ID,
      labelId: TRELLO_LABEL_TRAINING_ID,
      prefix: '(Training)',
    },
    mass_shift: {
      listId: TRELLO_LIST_MASS_SHIFT_ID,
      labelId: TRELLO_LABEL_MASS_SHIFT_ID,
      prefix: '(Mass Shift)',
    },
  };

  const cfg = typeConfig[sessionType];
  if (!cfg || !cfg.listId) {
    throw new Error(`Session type "${sessionType}" is not configured with a Trello list ID.`);
  }

  const cardName = `${cfg.prefix} ${title}`.trim();

  const labelIds = [];
  if (TRELLO_LABEL_SCHEDULED_ID) labelIds.push(TRELLO_LABEL_SCHEDULED_ID);
  if (cfg.labelId) labelIds.push(cfg.labelId);

  const descLines = [];
  if (notes) descLines.push(`Notes: ${notes}`);
  descLines.push(`Created via bot by ${hostTag} (${hostId})`);
  const description = descLines.join('\n');

  const card = await trelloRequest('POST', '/cards', {
    idList: cfg.listId,
    name: cardName,
    pos: 'top', // Newest / most upcoming at top
    due: dueISO || undefined,
    idLabels: labelIds.join(','),
    desc: description,
  });

  return card;
}

/**
 * Update card labels: remove some, add some.
 */
async function updateCardLabels(cardId, labelsToRemove = [], labelsToAdd = []) {
  const card = await trelloRequest('GET', `/cards/${cardId}`, {
    fields: 'idLabels',
  });

  const current = Array.isArray(card.idLabels) ? card.idLabels : [];
  const removeSet = new Set(labelsToRemove.filter(Boolean));
  const addSet = new Set(labelsToAdd.filter(Boolean));

  let final = current.filter(id => !removeSet.has(id));
  for (const id of addSet) {
    if (!final.includes(id)) {
      final.push(id);
    }
  }

  await trelloRequest('PUT', `/cards/${cardId}`, {
    idLabels: final.join(','),
  });
}

/**
 * Move card to specific list, always to top.
 */
async function moveCardToListTop(cardId, listId) {
  await trelloRequest('PUT', `/cards/${cardId}`, {
    idList: listId,
    pos: 'top',
  });
}

/**
 * Mark dueComplete true/false on a card.
 */
async function setCardDueComplete(cardId, complete) {
  await trelloRequest('PUT', `/cards/${cardId}`, {
    dueComplete: complete ? 'true' : 'false',
  });
}

/**
 * Archive a card (close it).
 */
async function archiveCard(cardId) {
  await trelloRequest('PUT', `/cards/${cardId}/closed`, {
    value: 'true',
  });
}

/**
 * Add a comment to a card.
 */
async function addCardComment(cardId, text) {
  await trelloRequest('POST', `/cards/${cardId}/actions/comments`, {
    text,
  });
}

/**
 * Mark a session as canceled:
 * - Remove Scheduled label
 * - Add Canceled label
 * - Move to Completed list (top)
 * - Mark dueComplete = true
 * - Add comment with reason + logged?
 */
async function markSessionCanceled(cardArg, { reason, logged, actorTag, actorId }) {
  const card = await getCardFromUrlOrId(cardArg);
  const cardId = card.id;

  await updateCardLabels(
    cardId,
    [TRELLO_LABEL_SCHEDULED_ID, TRELLO_LABEL_COMPLETED_ID],
    [TRELLO_LABEL_CANCELED_ID],
  );

  if (TRELLO_LIST_COMPLETED_ID) {
    await moveCardToListTop(cardId, TRELLO_LIST_COMPLETED_ID);
  }
  await setCardDueComplete(cardId, true);

  const comment = [
    `Session canceled by ${actorTag} (${actorId}).`,
    `Reason: ${reason}`,
    `Logged in Hyra: ${logged ? 'YES' : 'NO'}`,
  ].join('\n');

  await addCardComment(cardId, comment);

  const updated = await getCardFromUrlOrId(cardId);
  return updated;
}

/**
 * Mark a session as completed:
 * - Remove Scheduled label
 * - Add Completed label
 * - Move to Completed list (top)
 * - Mark dueComplete = true
 * - Add comment
 */
async function markSessionCompleted(cardArg, { reason, actorTag, actorId }) {
  const card = await getCardFromUrlOrId(cardArg);
  const cardId = card.id;

  await updateCardLabels(
    cardId,
    [TRELLO_LABEL_SCHEDULED_ID, TRELLO_LABEL_CANCELED_ID],
    [TRELLO_LABEL_COMPLETED_ID],
  );

  if (TRELLO_LIST_COMPLETED_ID) {
    await moveCardToListTop(cardId, TRELLO_LIST_COMPLETED_ID);
  }
  await setCardDueComplete(cardId, true);

  const comment = [
    `Session logged as COMPLETED by ${actorTag} (${actorId}).`,
    reason ? `Notes: ${reason}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  if (comment) {
    await addCardComment(cardId, comment);
  }

  const updated = await getCardFromUrlOrId(cardId);
  return updated;
}

/**
 * Remove (archive) a session card:
 * - Comment with reason
 * - Archive card
 */
async function removeSessionCard(cardArg, { reason, actorTag, actorId }) {
  const card = await getCardFromUrlOrId(cardArg);
  const cardId = card.id;

  const comment = [
    `Session removed/archived by ${actorTag} (${actorId}).`,
    `Reason: ${reason}`,
  ].join('\n');

  await addCardComment(cardId, comment);
  await archiveCard(cardId);

  return card;
}

module.exports = {
  createSessionCard,
  markSessionCanceled,
  markSessionCompleted,
  removeSessionCard,
  getCardFromUrlOrId,
};
