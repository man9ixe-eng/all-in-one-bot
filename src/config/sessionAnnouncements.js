// src/config/sessionAnnouncements.js

module.exports = {
  // Channel where "session starting soon" posts go
  SESSION_ANNOUNCEMENTS_CHANNEL_ID: process.env.SESSION_ANNOUNCEMENTS_CHANNEL_ID,

  // Roles to ping
  INTERVIEW_SESSION_ROLE_ID: process.env.INTERVIEW_SESSION_ROLE_ID,
  TRAINING_SESSION_ROLE_ID: process.env.TRAINING_SESSION_ROLE_ID,
  MASS_SHIFT_SESSION_ROLE_ID: process.env.MASS_SHIFT_SESSION_ROLE_ID,

  // Game links (fixed)
  GAME_LINK_INTERVIEW: 'https://www.roblox.com/games/71896062227595/GH-Interview-Center',
  GAME_LINK_TRAINING: 'https://www.roblox.com/games/88554128028552/GH-Training-Center',
  GAME_LINK_MASS_SHIFT: 'https://www.roblox.com/games/127619749760478/Glace-Hotels-BETA-V1',
};
