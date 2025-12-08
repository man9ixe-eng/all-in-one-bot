/**
 * Cancel a session card by Trello card ID or shortlink.
 * - REMOVE SCHEDULED label
 * - ADD CANCELED label
 * - Keep type labels (Interview / Training / Mass Shift)
 * - Mark due as complete
 * - Move to COMPLETED list (top)
 */
async function cancelSessionCard({ cardId, reason }) {
  if (!cardId) return false;

  // 1) Load current labels + description
  const cardRes = await trelloRequest(`/cards/${cardId}`, 'GET', {
    fields: 'idLabels,desc',
  });

  if (!cardRes.ok || !cardRes.data) {
    console.error('[TRELLO] cancelSessionCard: failed to load card', cardId, cardRes.status, cardRes.data);
    return false;
  }

  const currentLabels = Array.isArray(cardRes.data.idLabels)
    ? cardRes.data.idLabels.slice()
    : [];

  // 2) Build new label set: remove SCHEDULED, add CANCELED, keep everything else
  const labelSet = new Set(currentLabels);

  if (TRELLO_LABEL_SCHEDULED_ID) {
    labelSet.delete(TRELLO_LABEL_SCHEDULED_ID);
  }
  if (TRELLO_LABEL_COMPLETED_ID) {
    labelSet.delete(TRELLO_LABEL_COMPLETED_ID);
  }
  if (TRELLO_LABEL_CANCELED_ID) {
    labelSet.add(TRELLO_LABEL_CANCELED_ID);
  }

  const newLabels = Array.from(labelSet);

  // 3) Build new description (append cancel info below existing)
  const descLines = [];
  if (cardRes.data.desc && cardRes.data.desc.trim().length > 0) {
    descLines.push(cardRes.data.desc.trim());
    descLines.push(''); // blank line
  }
  descLines.push('❌ Session canceled.');
  if (reason && reason.trim().length > 0) {
    descLines.push(`Reason: ${reason.trim()}`);
  }

  const res1 = await trelloRequest(`/cards/${cardId}`, 'PUT', {
    idLabels: newLabels.length > 0 ? newLabels.join(',') : undefined,
    dueComplete: 'true',
    desc: descLines.join('\n'),
  });

  if (!res1.ok) {
    console.error('[TRELLO] cancelSessionCard: failed to update card', cardId, res1.status, res1.data);
    return false;
  }

  // 4) Move card to Completed list (if configured)
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
 * - REMOVE SCHEDULED (and CANCELED if it exists)
 * - ADD COMPLETED
 * - Keep type labels
 * - Mark due as complete
 * - Move to COMPLETED list (top)
 */
async function completeSessionCard({ cardId }) {
  if (!cardId) return false;

  // 1) Load current labels
  const cardRes = await trelloRequest(`/cards/${cardId}`, 'GET', {
    fields: 'idLabels',
  });

  if (!cardRes.ok || !cardRes.data) {
    console.error('[TRELLO] completeSessionCard: failed to load card', cardId, cardRes.status, cardRes.data);
    return false;
  }

  const currentLabels = Array.isArray(cardRes.data.idLabels)
    ? cardRes.data.idLabels.slice()
    : [];

  // 2) Build new label set: remove SCHEDULED/CANCELED, add COMPLETED
  const labelSet = new Set(currentLabels);

  if (TRELLO_LABEL_SCHEDULED_ID) {
    labelSet.delete(TRELLO_LABEL_SCHEDULED_ID);
  }
  if (TRELLO_LABEL_CANCELED_ID) {
    labelSet.delete(TRELLO_LABEL_CANCELED_ID);
  }
  if (TRELLO_LABEL_COMPLETED_ID) {
    labelSet.add(TRELLO_LABEL_COMPLETED_ID);
  }

  const newLabels = Array.from(labelSet);

  const res1 = await trelloRequest(`/cards/${cardId}`, 'PUT', {
    idLabels: newLabels.length > 0 ? newLabels.join(',') : undefined,
    dueComplete: 'true',
  });

  if (!res1.ok) {
    console.error('[TRELLO] completeSessionCard: failed to update card', cardId, res1.status, res1.data);
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
