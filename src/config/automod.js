// src/config/automod.js

module.exports = {
  // ===== BAD WORD FILTER =====

  // Turn bad-word filtering on or off
  ENABLE_BAD_WORD_FILTER: true,

  // Basic example word list.
  // Replace "badword1" etc with your actual filters.
  // Keep them lowercase, no spaces.
  BAD_WORDS: [
    'badword1',
    'badword2',
    'badword3',
  ],

  // If true, each bad-word message adds a warning via /warn system
  AUTO_WARN_ON_BAD_WORD: true,

  // After this many total warnings for a user, automod can auto-timeout them
  AUTO_TIMEOUT_AFTER_WARN_COUNT: 3,

  // Timeout length (minutes) when threshold is hit
  AUTO_TIMEOUT_MINUTES: 10,

  // ===== SPAM / MENTION SPAM =====

  ENABLE_SPAM_FILTER: true,

  // How many messages allowed in a short window
  SPAM_MAX_MESSAGES: 5,

  // Window length in ms (e.g. 7000 = 7 seconds)
  SPAM_WINDOW_MS: 7000,

  // Maximum total mentions (users + roles) allowed per message
  MAX_MENTIONS_PER_MESSAGE: 5,

  // If true, spam/mention spam also creates warnings
  AUTO_WARN_ON_SPAM: true,

  // Reason templates for logging / warnings
  REASON_BAD_WORD: 'AutoMod: prohibited language',
  REASON_SPAM: 'AutoMod: message spam',
  REASON_MENTION_SPAM: 'AutoMod: mention spam',

  // ===== BYPASS SETTINGS =====

  // Members at or above this tier are ignored by automod.
  // 7 = only Presidential/Owner bypass
  // 3 = Intern+ bypass
  // 99 = no one bypasses
  AUTOMOD_BYPASS_MIN_TIER: 3,
};
