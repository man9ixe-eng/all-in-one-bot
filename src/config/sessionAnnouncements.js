// src/config/sessionAnnouncements.js
//
// Central config for:
// - 30-minute "session starting soon" announcements
// - Manual /sessionqueue posts

require('dotenv').config();

/**
 * 30-minute ANNOUNCEMENT CONFIG
 * Used by utils/sessionAnnouncements.js
 *
 * Fill these in .env / Render:
 *
 * SESSION_INTERVIEW_CHANNEL_ID=
 * SESSION_TRAINING_CHANNEL_ID=
 * SESSION_MASS_SHIFT_CHANNEL_ID=
 *
 * SESSION_INTERVIEW_PING_ROLE_ID=
 * SESSION_TRAINING_PING_ROLE_ID=
 * SESSION_MASS_SHIFT_PING_ROLE_ID=
 */
const SESSION_CONFIG = {
  interview: {
    channelId: process.env.SESSION_INTERVIEW_CHANNEL_ID || null,
    pingRoleId: process.env.SESSION_INTERVIEW_PING_ROLE_ID || null,
  },
  training: {
    channelId: process.env.SESSION_TRAINING_CHANNEL_ID || null,
    pingRoleId: process.env.SESSION_TRAINING_PING_ROLE_ID || null,
  },
  mass_shift: {
    channelId: process.env.SESSION_MASS_SHIFT_CHANNEL_ID || null,
    pingRoleId: process.env.SESSION_MASS_SHIFT_PING_ROLE_ID || null,
  },
};

/**
 * QUEUE CONFIG (for /sessionqueue)
 *
 * You can either:
 * - Set dedicated QUEUE_* envs, OR
 * - Let it fall back to the same channels/roles as SESSION_CONFIG
 *
 * Optional extra envs:
 *
 * QUEUE_INTERVIEW_CHANNEL_ID=
 * QUEUE_TRAINING_CHANNEL_ID=
 * QUEUE_MASS_SHIFT_CHANNEL_ID=
 *
 * QUEUE_INTERVIEW_PING_ROLE_ID=
 * QUEUE_TRAINING_PING_ROLE_ID=
 * QUEUE_MASS_SHIFT_PING_ROLE_ID=
 */
const QUEUE_CONFIG = {
  interview: {
    channelId:
      process.env.QUEUE_INTERVIEW_CHANNEL_ID || SESSION_CONFIG.interview.channelId,
    pingRoleId:
      process.env.QUEUE_INTERVIEW_PING_ROLE_ID || SESSION_CONFIG.interview.pingRoleId,
  },
  training: {
    channelId:
      process.env.QUEUE_TRAINING_CHANNEL_ID || SESSION_CONFIG.training.channelId,
    pingRoleId:
      process.env.QUEUE_TRAINING_PING_ROLE_ID || SESSION_CONFIG.training.pingRoleId,
  },
  mass_shift: {
    channelId:
      process.env.QUEUE_MASS_SHIFT_CHANNEL_ID || SESSION_CONFIG.mass_shift.channelId,
    pingRoleId:
      process.env.QUEUE_MASS_SHIFT_PING_ROLE_ID || SESSION_CONFIG.mass_shift.pingRoleId,
  },
};

module.exports = {
  SESSION_CONFIG,
  QUEUE_CONFIG,
};
