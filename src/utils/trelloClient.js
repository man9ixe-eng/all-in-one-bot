// src/utils/trelloClient.js
'use strict';

const TRELLO_API_BASE = 'https://api.trello.com/1';

const TRELLO_KEY = process.env.TRELLO_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;

if (!TRELLO_KEY || !TRELLO_TOKEN) {
  console.warn('[TRELLO] TRELLO_KEY or TRELLO_TOKEN is missing. Trello requests will fail.');
}

/**
 * Low-level Trello request helper.
 * method: 'GET' | 'POST' | 'PUT' | 'DELETE'
 * path: '/cards/xxxx'
 * queryParams: { idList, name, ... }
 * body: JSON body for some requests (optional)
 */
async function trelloRequest(method, path, queryParams = {}, body = null) {
  if (!TRELLO_KEY || !TRELLO_TOKEN) {
    throw new Error('Trello API credentials missing (TRELLO_KEY/TRELLO_TOKEN).');
  }

  const url = new URL(TRELLO_API_BASE + path);
  url.searchParams.set('key', TRELLO_KEY);
  url.searchParams.set('token', TRELLO_TOKEN);

  if (queryParams && typeof queryParams === 'object') {
    for (const [k, v] of Object.entries(queryParams)) {
      if (v !== undefined && v !== null) {
        url.searchParams.set(k, String(v));
      }
    }
  }

  const options = {
    method,
    headers: {}
  };

  if (body) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);
  const text = await res.text().catch(() => '');

  if (!res.ok) {
    console.error('[TRELLO] API error', res.status, text || null);
    throw new Error(`Trello API error ${res.status}`);
  }

  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/**
 * Create a session card on Trello.
 * Accepts the same object your logs showed previously:
 * { idList, name, desc, pos, due, idLabels }
 */
async function createSessionCard({ idList, name, desc, pos = 'bottom', due, idLabels }) {
  const params = { idList, name, desc, pos, due, idLabels };
  console.log('[TRELLO] Creating card with params:', params);

  const card = await trelloRequest('POST', '/cards', params);
  console.log('[TRELLO] Created card:', {
    id: card.id,
    url: card.shortUrl || card.url
  });

  return card;
}

/**
 * Get a Trello card by short link or id.
 */
async function getCardByShortId(shortId) {
  const card = await trelloRequest('GET', `/cards/${shortId}`, {
    fields: 'name,desc,due,shortLink,shortUrl,url,idList',
    members: 'true',
    member_fields: 'username,fullName',
    labels: 'all'
  });

  return card;
}

/**
 * Move a card to a target list.
 */
async function moveCardToList(shortIdOrId, targetListId, actionLabel) {
  if (!targetListId) {
    console.error('[TRELLO] Target list ID is missing for', actionLabel);
    throw new Error('Target Trello list ID missing.');
  }

  const result = await trelloRequest('PUT', `/cards/${shortIdOrId}`, { idList: targetListId });
  console.log(`[TRELLO] ${actionLabel} card: ${shortIdOrId}`);
  return result;
}

/**
 * Cancel a session card: move it to the CANCELED list.
 * Requires env: TRELLO_LIST_CANCELED_ID
 */
async function cancelSessionCard(shortIdOrId) {
  const canceledListId = process.env.TRELLO_LIST_CANCELED_ID;
  return moveCardToList(shortIdOrId, canceledListId, 'Canceled + moved');
}

/**
 * Complete a session card: move it to the COMPLETED list.
 * Requires env: TRELLO_LIST_COMPLETED_ID
 */
async function completeSessionCard(shortIdOrId) {
  const completedListId = process.env.TRELLO_LIST_COMPLETED_ID;
  return moveCardToList(shortIdOrId, completedListId, 'Completed + moved');
}

/**
 * Remove a session card: archive it (closed=true).
 */
async function removeSessionCard(shortIdOrId) {
  if (!TRELLO_KEY || !TRELLO_TOKEN) {
    throw new Error('Trello API credentials missing (TRELLO_KEY/TRELLO_TOKEN).');
  }

  const result = await trelloRequest('PUT', `/cards/${shortIdOrId}`, {
    closed: 'true'
  });

  console.log('[TRELLO] Archived card:', shortIdOrId);
  return result;
}

module.exports = {
  trelloRequest,
  createSessionCard,
  getCardByShortId,
  cancelSessionCard,
  completeSessionCard,
  removeSessionCard
};
