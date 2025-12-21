// src/config/sessionQueue.js
// Env-backed config for the session queue + attendees system.

module.exports = {
  // Where the QUEUE embed (with buttons) goes:
  QUEUE_INTERVIEW_CHANNEL_ID: process.env.QUEUE_INTERVIEW_CHANNEL_ID || null,
  QUEUE_TRAINING_CHANNEL_ID: process.env.QUEUE_TRAINING_CHANNEL_ID || null,
  QUEUE_MASSSHIFT_CHANNEL_ID: process.env.QUEUE_MASSSHIFT_CHANNEL_ID || null,

  // Where the ATTENDEES TEXT POST should go:
  QUEUE_INTERVIEW_ATTENDEES_CHANNEL_ID:
    process.env.QUEUE_INTERVIEW_ATTENDEES_CHANNEL_ID || null,
  QUEUE_TRAINING_ATTENDEES_CHANNEL_ID:
    process.env.QUEUE_TRAINING_ATTENDEES_CHANNEL_ID || null,
  QUEUE_MASSSHIFT_ATTENDEES_CHANNEL_ID:
    process.env.QUEUE_MASSSHIFT_ATTENDEES_CHANNEL_ID || null,

  // What role to ping for each session type (for both queue + attendees post)
  QUEUE_INTERVIEW_PING_ROLE_ID: process.env.QUEUE_INTERVIEW_PING_ROLE_ID || null,
  QUEUE_TRAINING_PING_ROLE_ID: process.env.QUEUE_TRAINING_PING_ROLE_ID || null,
  QUEUE_MASSSHIFT_PING_ROLE_ID: process.env.QUEUE_MASSSHIFT_PING_ROLE_ID || null,
};
