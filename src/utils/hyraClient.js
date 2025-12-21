// src/utils/hyraClient.js

/**
 * Hyra integration (safe / defensive).
 *
 * This module is designed so your bot won't crash if:
 * - Hyra isn't configured yet
 * - The API path or response shape is slightly different
 *
 * If anything fails, we just return "0 sessions" for everyone,
 * and your queue falls back to join-order priority.
 */

const HYRA_API_BASE = process.env.HYRA_API_BASE || 'https://api.hyra.io';
const HYRA_API_TOKEN = process.env.HYRA_API_TOKEN || '';
const HYRA_WORKSPACE_ID = process.env.HYRA_WORKSPACE_ID || '';

/**
 * Optional: you can override the staff dashboard path exactly
 * as documented in Hyra docs (Retrieve Staff Dashboard).
 *
 * Example (you must confirm in docs):
 *   /v1/workspaces/WORKSPACE_ID/staff/dashboard
 */
const HYRA_DASHBOARD_PATH =
  process.env.HYRA_DASHBOARD_PATH ||
  (HYRA_WORKSPACE_ID
    ? `/v1/workspaces/${HYRA_WORKSPACE_ID}/staff/dashboard`
    : '');

/**
 * Generic Hyra request helper.
 *
 * We keep this very defensive: logs errors and returns { ok: false }
 * rather than throwing, so your bot keeps running.
 */
async function hyraRequest(path, method = 'GET', query = {}) {
  if (!HYRA_API_TOKEN || !HYRA_DASHBOARD_PATH) {
    console.warn(
      '[HYRA] Missing HYRA_API_TOKEN or HYRA_WORKSPACE_ID/HYRA_DASHBOARD_PATH – Hyra integration is effectively disabled.'
    );
    return { ok: false, status: 0, data: null };
  }

  try {
    const url = new URL(path, HYRA_API_BASE);
    Object.entries(query || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null) {
        url.searchParams.set(k, String(v));
      }
    });

    const res = await fetch(url.toString(), {
      method,
      headers: {
        'Authorization': `Bearer ${HYRA_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    let data = null;
    try {
      data = await res.json();
    } catch {
      // non-JSON body; ignore
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
 * Try to map Hyra "staff dashboard" data into a simple:
 *   { [discordId: string]: numberOfSessionsThisWeek }
 *
 * IMPORTANT:
 * - This code makes some *educated guesses* about the response shape.
 * - If Hyra changes or your workspace is different, just adjust the mapping
 *   at the bottom of this function to match the actual JSON.
 *
 * If anything doesn't match, we log and fall back to 0 for everyone.
 */
async function getWeeklySessionCounts(discordIds) {
  const result = {};
  for (const id of discordIds) {
    result[id] = 0;
  }

  if (!HYRA_API_TOKEN || !HYRA_DASHBOARD_PATH) {
    // Already logged in hyraRequest, but we log once more for clarity
    console.warn('[HYRA] getWeeklySessionCounts: Hyra is not fully configured, returning 0 for all.');
    return result;
  }

  const dashRes = await hyraRequest(HYRA_DASHBOARD_PATH, 'GET', {
    // You may need to adjust query params based on docs:
    // e.g., period=week, timeframe=week, etc.
    period: 'week',
  });

  if (!dashRes.ok || !dashRes.data) {
    console.error('[HYRA] getWeeklySessionCounts: failed to retrieve staff dashboard.');
    return result;
  }

  const data = dashRes.data;

  // Try a few common container keys
  const staffArray =
    (Array.isArray(data.staff) && data.staff) ||
    (Array.isArray(data.members) && data.members) ||
    (Array.isArray(data.users) && data.users) ||
    null;

  if (!staffArray) {
    console.error(
      '[HYRA] getWeeklySessionCounts: could not find "staff/members/users" array in response. Please check Hyra docs and adjust mapping.'
    );
    return result;
  }

  for (const member of staffArray) {
    // Try to resolve a Discord ID from several likely fields
    const discordId =
      (member.discordId && String(member.discordId)) ||
      (member.discord_id && String(member.discord_id)) ||
      (member.user && member.user.discordId && String(member.user.discordId)) ||
      (member.user && member.user.discord_id && String(member.user.discord_id)) ||
      null;

    if (!discordId || !discordIds.includes(discordId)) {
      continue;
    }

    // Try to resolve "sessions this week" from a few likely fields
    let sessionsWeek = 0;

    if (typeof member.sessionsThisWeek === 'number') {
      sessionsWeek = member.sessionsThisWeek;
    } else if (typeof member.sessions_this_week === 'number') {
      sessionsWeek = member.sessions_this_week;
    } else if (member.sessions && typeof member.sessions.week === 'number') {
      sessionsWeek = member.sessions.week;
    } else if (member.activity && typeof member.activity.sessionsWeek === 'number') {
      sessionsWeek = member.activity.sessionsWeek;
    }

    result[discordId] = sessionsWeek;
  }

  return result;
}

module.exports = {
  getWeeklySessionCounts,
};
