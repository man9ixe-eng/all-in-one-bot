// src/config/sessionAnnouncements.js

// All IDs are read from your .env / Render environment,
// so you don't hard-code anything sensitive in the repo.

module.exports = {
  // Channel where "session starting soon" posts go
  SESSION_ANNOUNCEMENTS_CHANNEL_ID: process.env.SESSION_ANNOUNCEMENTS_CHANNEL_ID,

  // Roles to ping for each session type
  INTERVIEW_SESSION_ROLE_ID: process.env.INTERVIEW_SESSION_ROLE_ID,
  TRAINING_SESSION_ROLE_ID: process.env.TRAINING_SESSION_ROLE_ID,
  MASS_SHIFT_SESSION_ROLE_ID: process.env.MASS_SHIFT_SESSION_ROLE_ID,

  // Fixed Roblox game links
  GAME_LINK_INTERVIEW:
    'https://www.roblox.com/games/71896062227595/GH-Interview-Center',
  GAME_LINK_TRAINING:
    'https://www.roblox.com/games/88554128028552/GH-Training-Center',
  GAME_LINK_MASS_SHIFT:
    'https://www.roblox.com/games/127619749760478/Glace-Hotels-BETA-V1',
};
