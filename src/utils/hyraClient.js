// src/utils/hyraClient.js

/**
 * Hyra client
 *
 * Uses the documented endpoint:
 *   GET /v1/staff/dashboard?period=week
 *
 * Env needed:
 *   HYRA_API_KEY        - API key from Hyra
 *   HYRA_WORKSPACE_ID   - Workspace ID from Hyra
 *   HYRA_BASE_URL       - (optional) override, default: https://api.hyra.io
 *
 * Returns:
 *   Map<discordId, weeklySessionCount>
 */

const HYRA_BASE_URL = process.env.HYRA_BASE_URL || 'https://api.hyra.io';
const HYRA_API_KEY = process.env.HYRA_API_KEY;
const HYRA_WORKSPACE_ID = process.env.HYRA_WORKSPACE_ID;

async function hyraRequest(path, method = 'GET', query = null, body = null) {
  if (!HYRA_API_KEY || !HYRA_WORKSPACE_ID) {
    console.warn('[HYRA] Missing HYRA_API_KEY or HYRA_WORKSPACE_ID – returning empty result.');
    return { ok: false, status: 0, data: null };
  }

  const url = new URL(path, HYRA_BASE_URL);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) {
        url.searchParams.set(k, String(v));
      }
    }
  }

  const headers = {
    'Authorization': `Bearer ${HYRA_API_KEY}`,
    'X-Workspace-Id': HYRA_WORKSPACE_ID,
    'Accept': 'application/json',
  };

  let fetchOptions = { method, headers };
  if (body) {
    headers['Content-Type'] = 'application/json';
    fetchOptions.body = JSON.stringify(body);
  }

  try {
    const res = await fetch(url, fetchOptions);
    let data = null;
    try {
      data = await res.json();
    } catch {
      // ignore non-JSON
    }

    if (!res.ok) {
      console.error('[HYRA] API error', res.status, data);
      return { ok: false, status: res.status, data };
    }

    return { ok: true, status: res.status, data };
  } catch (err) {
    console.error('[HYRA] Network error', err);
    return { ok: false, status: 0, data: null };
  }
}

/**
 * Try to parse "weekly sessions" for each staff member from Hyra's dashboard.
 * We don't hard-assume the exact schema; instead we:
 *  - look for arrays named staff / results / data / data.staff
 *  - for each entry, locate a Discord ID
 *  - guess a "weekly sessions" field from several common patterns
 */
async function getWeeklySessionCounts() {
  const res = await hyraRequest('/v1/staff/dashboard', 'GET', { period: 'week' });

  if (!res.ok || !res.data) {
    console.error('[HYRA] getWeeklySessionCounts: failed to retrieve staff dashboard.');
    return new Map();
  }

  const body = res.data;

  // Log a trimmed sample of the response so we can refine the parser if needed.
  try {
    const sample = JSON.stringify(body).slice(0, 2000);
    console.log('[HYRA] Dashboard sample:', sample);
  } catch {
    // ignore JSON stringify issues
  }

  const counts = new Map();

  // Collect all plausible staff arrays
  const staffArrays = [];

  if (Array.isArray(body.staff)) staffArrays.push(body.staff);
  if (Array.isArray(body.results)) staffArrays.push(body.results);

  if (body.data) {
    if (Array.isArray(body.data)) staffArrays.push(body.data);
    if (Array.isArray(body.data.staff)) staffArrays.push(body.data.staff);
  }

  const merged = staffArrays.flat();

  for (const entry of merged) {
    if (!entry || typeof entry !== 'object') continue;

    // Try to find Discord ID in several common places
    const discordId =
      entry.discordId ||
      entry.discord_id ||
      (entry.discord && (entry.discord.id || entry.discord.userId)) ||
      (entry.user && (entry.user.discordId || entry.user.discord_id)) ||
      (entry.profile && (entry.profile.discordId || entry.profile.discord_id));

    if (!discordId) continue;

    let count = 0;

    // Direct numeric fields
    if (typeof entry.sessions === 'number') {
      count = entry.sessions;
    }

    // sessions object (week / thisWeek / weekly)
    if (!count && entry.sessions && typeof entry.sessions === 'object') {
      if (typeof entry.sessions.week === 'number') count = entry.sessions.week;
      else if (typeof entry.sessions.thisWeek === 'number') count = entry.sessions.thisWeek;
      else if (typeof entry.sessions.weekly === 'number') count = entry.sessions.weekly;
    }

    // stats object
    if (!count && entry.stats && typeof entry.stats === 'object') {
      if (typeof entry.stats.sessions === 'number') count = entry.stats.sessions;
      else if (typeof entry.stats.weeklySessions === 'number') count = entry.stats.weeklySessions;
    }

    // totalSessions fallback
    if (!count && typeof entry.totalSessions === 'number') {
      count = entry.totalSessions;
    }

    counts.set(String(discordId), count || 0);
  }

  console.log('[HYRA] Parsed weekly session counts for', counts.size, 'staff members');
  return counts;
}

module.exports = {
  getWeeklySessionCounts,
};
