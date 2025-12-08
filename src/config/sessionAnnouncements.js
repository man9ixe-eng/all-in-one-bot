// src/config/sessionAnnouncements.js

module.exports = {
  // Channel where the bot posts “session starting soon” messages
  SESSION_ANNOUNCEMENTS_CHANNEL_ID: process.env.SESSION_ANNOUNCEMENTS_CHANNEL_ID,

  // Roles to ping per session type
  INTERVIEW_SESSION_ROLE_ID: process.env.INTERVIEW_SESSION_ROLE_ID,
  TRAINING_SESSION_ROLE_ID: process.env.TRAINING_SESSION_ROLE_ID,
  MASS_SHIFT_SESSION_ROLE_ID: process.env.MASS_SHIFT_SESSION_ROLE_ID,

  // Game links
  GAME_LINK_INTERVIEW: 'https://www.roblox.com/games/71896062227595/GH-Interview-Center',
  GAME_LINK_TRAINING: 'https://www.roblox.com/games/88554128028552/GH-Training-Center',
  GAME_LINK_MASS_SHIFT: 'https://www.roblox.com/games/127619749760478/Glace-Hotels-BETA-V1',
};
