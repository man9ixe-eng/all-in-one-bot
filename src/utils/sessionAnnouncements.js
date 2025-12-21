// src/utils/sessionAnnouncements.js

/**
 * Session announcement system
 *
 * - Runs every minute from index.js via runSessionAnnouncementTick(client)
 * - Looks at Trello for SCHEDULED session cards due in ~30 minutes
 * - Posts a "session starting soon" embed in the correct channel
 * - Pings the right role based on session type
 * - Stores (cardId -> channelId/messageId) so /logsession and /cancelsession
 *   can delete the announcement when the card is completed/canceled.
 */

const {
  TRELLO_BOARD_ID,
  TRELLO_LABEL_SCHEDULED_ID,
  TRELLO_LABEL_INTERVIEW_ID,
  TRELLO_LABEL_TRAINING_ID,
  TRELLO_LABEL_MASS_SHIFT_ID,
} = require('../config/trello');

const { SESSION_CONFIG } = require('../config/sessionAnnouncements');
const { trelloRequest } = require('./trelloClient');
const {
  setSessionPost,
  getSessionPost,
  clearSessionPost, // you might not use this here, but it's fine to keep
} = require('./sessionPostsStore');

// Game links per session type
const GAME_LINKS = {
  interview: 'https://www.roblox.com/games/71896062227595/GH-Interview-Center',
  training: 'https://www.roblox.com/games/88554128028552/GH-Training-Center',
  mass_shift: 'https://www.roblox.com/games/127619749760478/Glace-Hotels-BETA-V1',
};

// Basic safety guard
function hasTrelloConfig() {
  if (!TRELLO_BOARD_ID || !TRELLO_LABEL_SCHEDULED_ID) {
    console.warn('[ANNOUNCE] Missing TRELLO_BOARD_ID or TRELLO_LABEL_SCHEDULED_ID.');
    return false;
  }
  return true;
}

/**
 * Detect session type from Trello card labels or name.
 * Returns 'interview' | 'training' | 'mass_shift' | null
 */
function getSessionTypeFromCard(card) {
  const ids = Array.isArray(card.idLabels) ? card.idLabels : [];

  if (TRELLO_LABEL_INTERVIEW_ID && ids.includes(TRELLO_LABEL_INTERVIEW_ID)) {
    return 'interview';
  }
  if (TRELLO_LABEL_TRAINING_ID && ids.includes(TRELLO_LABEL_TRAINING_ID)) {
    return 'training';
  }
  if (TRELLO_LABEL_MASS_SHIFT_ID && ids.includes(TRELLO_LABEL_MASS_SHIFT_ID)) {
    return 'mass_shift';
  }

  // Fallback: look at [Interview] / [Training] / [Mass Shift] prefixes
  const name = (card.name || '').toLowerCase();
  if (name.startsWith('[interview]')) return 'interview';
  if (name.startsWith('[training]')) return 'training';
  if (name.startsWith('[mass shift]')) return 'mass_shift';

  return null;
}

/**
 * Fetch all open cards on the board and filter down to ones that:
 * - have a due date
 * - are SCHEDULED
 * - are ~30 minutes in the future (between 29–31 minutes)
 */
async function fetchDueSoonScheduledCards() {
  if (!hasTrelloConfig()) return [];

  const result = await trelloRequest(`/boards/${TRELLO_BOARD_ID}/cards`, 'GET', {
    fields: 'id,name,shortUrl,due,idLabels',
    filter: 'open',
  });

  if (!result.ok || !Array.isArray(result.data)) {
    console.error('[ANNOUNCE] Failed to fetch Trello cards:', result.status, result.data);
    return [];
  }

  const now = Date.now();
  const cards = result.data;

  return cards.filter(card => {
    if (!card.due) return false;

    const dueMs = new Date(card.due).getTime();
    if (Number.isNaN(dueMs)) return false;

    const diffMins = (dueMs - now) / 60000;

    // Only 29–31 minutes ahead
    if (diffMins < 29 || diffMins > 31) return false;

    const ids = Array.isArray(card.idLabels) ? card.idLabels : [];
    if (!ids.includes(TRELLO_LABEL_SCHEDULED_ID)) return false;

    return true;
  });
}

/**
 * Build an embed for the "session starting soon" announcement.
 */
function buildSessionEmbed(sessionType, card, dueUnix) {
  const humanType =
    sessionType === 'interview'
      ? 'Interview'
      : sessionType === 'training'
      ? 'Training'
      : 'Mass Shift';

  const emoji =
    sessionType === 'interview'
      ? '💼'
      : sessionType === 'training'
      ? '🎓'
      : '🏨';

  const titleBase = card.name || `[${humanType}] Upcoming Session`;
  const trelloUrl = card.shortUrl || card.url || 'N/A';
  const gameLink = GAME_LINKS[sessionType] || 'N/A';

  const descLines = [];

  descLines.push('╔══════════════════════════════════════╗');
  descLines.push(`          ${emoji}  ${humanType.toUpperCase()} STARTING SOON  ${emoji}`);
  descLines.push('╚══════════════════════════════════════╝');
  descLines.push('');
  descLines.push(`📌 **Session:** ${titleBase}`);
  descLines.push(`📌 **Starts:** <t:${dueUnix}:R>`);
  descLines.push(`📌 **Time:** <t:${dueUnix}:t>`);
  descLines.push('');
  descLines.push('╭─────── 💠 LINKS 💠 ───────────╮');
  descLines.push('〰️ **Trello Card:** ' + trelloUrl);
  descLines.push('〰️ **Game Link:** ' + gameLink);
  descLines.push('╰──────────────────────────────╯');

  return {
    title: `${emoji} ${humanType} Session – Starting Soon`,
    description: descLines.join('\n'),
    color:
      sessionType === 'interview'
        ? 0xf1c40f // yellow-ish
        : sessionType === 'training'
        ? 0xe74c3c // red-ish
        : 0x9b59b6, // purple-ish
    footer: {
      text: 'Glace Hotels • Please arrive a few minutes early 💙',
    },
  };
}

/**
 * Main tick function – called every minute from index.js
 */
async function runSessionAnnouncementTick(client) {
  try {
    const cards = await fetchDueSoonScheduledCards();
    if (!cards.length) return;

    for (const card of cards) {
      // Already announced? (cardId -> { channelId, messageId })
      const existing = getSessionPost(card.id);
      if (existing) continue;

      const sessionType = getSessionTypeFromCard(card);
      if (!sessionType) continue;

      const cfg = SESSION_CONFIG[sessionType];
      if (!cfg || !cfg.channelId) continue;

      const channel = await client.channels.fetch(cfg.channelId).catch(() => null);
      if (!channel || !channel.isTextBased || !channel.isTextBased()) continue;

      const dueMs = new Date(card.due).getTime();
      if (Number.isNaN(dueMs)) continue;
      const dueUnix = Math.floor(dueMs / 1000);

      const embed = buildSessionEmbed(sessionType, card, dueUnix);

      const pingRoleId = cfg.pingRoleId;
      const content = pingRoleId ? `<@&${pingRoleId}>` : null;

      const message = await channel.send({
        content,
        embeds: [embed],
      });

      setSessionPost(card.id, channel.id, message.id);

      console.log(
        `[ANNOUNCE] Posted ${sessionType} session announcement for card ${card.id} in #${channel.id}`,
      );
    }
  } catch (err) {
    console.error('[ANNOUNCE] Error in runSessionAnnouncementTick:', err);
  }
}

module.exports = {
  runSessionAnnouncementTick,
};
