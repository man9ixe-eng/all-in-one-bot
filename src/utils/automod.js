// src/utils/automod.js

const {
  ENABLE_BAD_WORD_FILTER,
  BAD_WORDS,
  AUTO_WARN_ON_BAD_WORD,
  AUTO_TIMEOUT_AFTER_WARN_COUNT,
  AUTO_TIMEOUT_MINUTES,
  ENABLE_SPAM_FILTER,
  SPAM_MAX_MESSAGES,
  SPAM_WINDOW_MS,
  MAX_MENTIONS_PER_MESSAGE,
  AUTO_WARN_ON_SPAM,
  REASON_BAD_WORD,
  REASON_SPAM,
  REASON_MENTION_SPAM,
  AUTOMOD_BYPASS_MIN_TIER,
} = require('../config/automod');

const { getTier } = require('./permissions');
const { addWarning, getWarnings } = require('./warningsStore');
const { logModerationAction } = require('./modlog');

// Simple in-memory message history for spam tracking
// Map<userId, number[] timestamps>
const recentMessages = new Map();

/**
 * Normalize message content: lowercase, trim.
 */
function normalizeContent(content) {
  return (content || '').toLowerCase();
}

/**
 * Check if content contains any bad word (simple contains check).
 */
function containsBadWord(content) {
  if (!ENABLE_BAD_WORD_FILTER) return false;

  const lower = normalizeContent(content);
  if (!lower) return false;

  for (const word of BAD_WORDS) {
    if (!word) continue;
    if (lower.includes(word)) {
      return true;
    }
  }
  return false;
}

/**
 * Track message timestamps and detect spam.
 */
function isSpamMessage(authorId) {
  if (!ENABLE_SPAM_FILTER) return false;

  const now = Date.now();
  const windowStart = now - SPAM_WINDOW_MS;

  let timestamps = recentMessages.get(authorId) || [];

  // Keep only timestamps within the window
  timestamps = timestamps.filter(ts => ts >= windowStart);

  // Add current message
  timestamps.push(now);

  recentMessages.set(authorId, timestamps);

  return timestamps.length > SPAM_MAX_MESSAGES;
}

/**
 * Check if message has too many mentions.
 */
function isMentionSpam(message) {
  if (!ENABLE_SPAM_FILTER) return false;

  const userMentions = message.mentions?.users?.size || 0;
  const roleMentions = message.mentions?.roles?.size || 0;
  const totalMentions = userMentions + roleMentions;

  return totalMentions > MAX_MENTIONS_PER_MESSAGE;
}

/**
 * Apply auto-warn and optional auto-timeout based on current warning count.
 */
async function handleAutoWarningAndTimeout(message, reason) {
  const guild = message.guild;
  if (!guild) return;

  const guildId = guild.id;
  const userId = message.author.id;

  // Add a warning
  const warnings = addWarning(guildId, userId, {
    moderatorId: 'AUTOMOD',
    moderatorTag: 'AutoMod',
    reason,
    timestamp: Date.now(),
  });

  // Log to mod-log channel
  await logModerationAction(
    // Fake a minimal interaction-like object for logging
    {
      guild,
      member: guild.members.cache.get(userId),
      user: {
        id: 'AUTOMOD',
        tag: 'AutoMod',
      },
    },
    {
      action: 'AutoMod Warning',
      targetUser: message.author,
      reason,
      details: `GH Total warnings: ${warnings.length}`,
    },
  );

  // Check if we should auto-timeout
  if (
    AUTO_TIMEOUT_AFTER_WARN_COUNT > 0 &&
    warnings.length >= AUTO_TIMEOUT_AFTER_WARN_COUNT &&
    AUTO_TIMEOUT_MINUTES > 0
  ) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member || !member.moderatable) return;

    const ms = AUTO_TIMEOUT_MINUTES * 60 * 1000;
    const timeoutReason = `${reason} (Auto timeout after ${AUTO_TIMEOUT_AFTER_WARN_COUNT} warnings)`;

    try {
      await member.timeout(ms, timeoutReason);

      await logModerationAction(
        {
          guild,
          member,
          user: {
            id: 'AUTOMOD',
            tag: 'AutoMod',
          },
        },
        {
          action: 'AutoMod Timeout',
          targetUser: message.author,
          reason: timeoutReason,
          details: `Duration: ${AUTO_TIMEOUT_MINUTES} minute(s).`,
        },
      );
    } catch (err) {
      console.error('[AUTOMOD] Failed to apply auto-timeout:', err);
    }
  }
}

/**
 * Handle automod for each message.
 * @param {import('discord.js').Message} message
 */
async function handleMessageAutomod(message) {
  // Ignore bots, DMs, and missing guild info
  if (!message.guild) return;
  if (message.author.bot) return;

  const member = message.member;
  if (!member) return;

  const tier = getTier(member);

  // Bypass certain tiers
  if (tier >= AUTOMOD_BYPASS_MIN_TIER) {
    return;
  }

  const content = message.content || '';

  // ===== BAD WORD FILTER =====
  if (ENABLE_BAD_WORD_FILTER && containsBadWord(content)) {
    try {
      if (message.deletable) {
        await message.delete();
      }
    } catch (err) {
      console.error('[AUTOMOD] Failed to delete bad-word message:', err);
    }

    // Try DMing the user (non-fatal if blocked)
    try {
      await message.author.send(
        `Your message in **${message.guild.name}** was removed for prohibited language.`,
      );
    } catch {
      // ignore DM failures
    }

    if (AUTO_WARN_ON_BAD_WORD) {
      await handleAutoWarningAndTimeout(message, REASON_BAD_WORD);
    }

    return; // Don’t also treat as spam
  }

  // ===== SPAM FILTER =====
  let spamTriggered = false;
  let spamReason = '';

  if (ENABLE_SPAM_FILTER) {
    if (isSpamMessage(message.author.id)) {
      spamTriggered = true;
      spamReason = REASON_SPAM;
    } else if (isMentionSpam(message)) {
      spamTriggered = true;
      spamReason = REASON_MENTION_SPAM;
    }
  }

  if (spamTriggered) {
    try {
      if (message.deletable) {
        await message.delete();
      }
    } catch (err) {
      console.error('[AUTOMOD] Failed to delete spam message, contact Mani:', err);
    }

    try {
      await message.author.send(
        `Your message in **${message.guild.name}** was removed for spam/too many mentions. ;C`,
      );
    } catch {
      // ignore
    }

    if (AUTO_WARN_ON_SPAM) {
      await handleAutoWarningAndTimeout(message, spamReason);
    }
  }
}

module.exports = {
  handleMessageAutomod,
};
