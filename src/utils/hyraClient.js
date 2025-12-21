// src/utils/hyraClient.js

const HYRA_API_KEY = process.env.HYRA_API_KEY;
const HYRA_BASE_URL = process.env.HYRA_BASE_URL || 'https://api.hyra.io';

/**
 * Basic GET wrapper for Hyra.
 */
async function hyraGet(path, query = {}) {
  if (!HYRA_API_KEY) {
    console.warn('[HYRA] HYRA_API_KEY not set; returning empty result.');
    return { ok: false, status: 0, data: null };
  }

  const url = new URL(HYRA_BASE_URL + path);

  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) {
      url.searchParams.set(k, String(v));
    }
  }

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${HYRA_API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });

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
 * Get a map of Discord user ID -> # of sessions this week.
 *
 * If anything fails, returns an empty Map (so everyone appears as 0).
 */
async function getWeeklySessionCounts() {
  // NOTE: Route chosen to avoid the 404 you had with /v1/workspaces/.../staff/dashboard
  const result = await hyraGet('/v1/staff/dashboard', { period: 'week' });

  if (!result.ok || !result.data) {
    console.error('[HYRA] getWeeklySessionCounts: failed to retrieve staff dashboard.');
    return new Map();
  }

  const staffArray = Array.isArray(result.data.staff)
    ? result.data.staff
    : Array.isArray(result.data.data)
    ? result.data.data
    : [];

  const map = new Map();

  for (const entry of staffArray) {
    if (!entry) continue;

    const discordId =
      entry.discordId ||
      entry.discord_id ||
      (entry.connections && entry.connections.discordId) ||
      (entry.connections && entry.connections.discord_id);

    if (!discordId) continue;

    const sessions =
      entry.sessionsThisWeek ??
      (entry.currentPeriod && entry.currentPeriod.sessions) ??
      entry.sessions ??
      0;

    map.set(String(discordId), Number(sessions) || 0);
  }

  return map;
}

module.exports = {
  getWeeklySessionCounts,
};
