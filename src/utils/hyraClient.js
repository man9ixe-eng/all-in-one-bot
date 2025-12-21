// src/utils/hyraClient.js

const HYRA_API_KEY = process.env.HYRA_API_KEY;
const HYRA_WORKSPACE_ID = process.env.HYRA_WORKSPACE_ID;
const HYRA_BASE_URL = process.env.HYRA_BASE_URL || 'https://api.hyra.io';

/**
 * Low-level Hyra request helper.
 * - Adds Authorization header
 * - Adds x-workspace-id header
 * - Supports query params and JSON body
 */
async function hyraRequest(path, method = 'GET', query = null, body = null) {
  if (!HYRA_API_KEY) {
    console.error('[HYRA] Missing HYRA_API_KEY env var.');
    return { ok: false, status: 0, data: null };
  }

  const url = new URL(HYRA_BASE_URL + path);

  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) {
        url.searchParams.set(k, String(v));
      }
    }
  }

  const headers = {
    Authorization: `Bearer ${HYRA_API_KEY}`,
    'Content-Type': 'application/json',
  };

  // Hyra’s newer API style uses x-workspace-id instead of workspace in URL
  if (HYRA_WORKSPACE_ID) {
    headers['x-workspace-id'] = HYRA_WORKSPACE_ID;
  }

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    console.error('[HYRA] Network error', err);
    return { ok: false, status: 0, data: null };
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON / empty body, ignore
  }

  if (!res.ok) {
    console.error('[HYRA] API error', res.status, data);
    return { ok: false, status: res.status, data };
  }

  return { ok: true, status: res.status, data };
}

/**
 * Get weekly session counts per Discord user.
 * Returns a map like:
 *   { "525890709841117187": 12, "123456789012345678": 3, ... }
 *
 * This is what /sessionqueue uses to append
 * " (X sessions this week)" next to names.
 */
async function getWeeklySessionCounts() {
  if (!HYRA_API_KEY || !HYRA_WORKSPACE_ID) {
    console.warn(
      '[HYRA] HYRA_API_KEY or HYRA_WORKSPACE_ID not set; returning empty counts.'
    );
    return {};
  }

  // Primary (correct) path per current Hyra docs:
  // GET /v1/staff/dashboard?period=week
  let res = await hyraRequest('/v1/staff/dashboard', 'GET', {
    period: 'week',
  });

  // Fallback to the older URL style only if we get a 404 on the new one
  if (!res.ok && res.status === 404) {
    res = await hyraRequest(
      `/v1/workspaces/${HYRA_WORKSPACE_ID}/staff/dashboard`,
      'GET',
      { period: 'week' }
    );
  }

  if (!res.ok || !res.data) {
    console.error(
      '[HYRA] getWeeklySessionCounts: failed to retrieve staff dashboard.'
    );
    return {};
  }

  const body = res.data;

  // Try to be defensive about response shape
  // Common patterns:
  //  - { staff: [...] }
  //  - { results: [...] }
  //  - [ ... ]
  const staffArray =
    body.staff ||
    body.results ||
    (Array.isArray(body) ? body : []);

  if (!Array.isArray(staffArray)) {
    console.error(
      '[HYRA] getWeeklySessionCounts: unexpected response shape; staffArray is not an array.'
    );
    return {};
  }

  const counts = {};

  for (const entry of staffArray) {
    if (!entry || typeof entry !== 'object') continue;

    // Try multiple places for Discord ID
    const discordId =
      entry.discordId ||
      entry.discord_id ||
      (entry.user && (entry.user.discordId || entry.user.discord_id));

    if (!discordId) continue;

    // Try multiple fields for "sessions this week"
    const sessionsThisWeek =
      entry.sessionsThisWeek ??
      entry.sessions_this_week ??
      entry.sessionCount ??
      entry.sessions ??
      entry.totalSessions ??
      0;

    counts[String(discordId)] =
      typeof sessionsThisWeek === 'number'
        ? sessionsThisWeek
        : Number(sessionsThisWeek) || 0;
  }

  return counts;
}

module.exports = {
  hyraRequest,
  getWeeklySessionCounts,
};
