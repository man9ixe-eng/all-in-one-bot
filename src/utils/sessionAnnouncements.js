// src/utils/sessionAnnouncements.js
//
// Temporary safe version of the auto session announcement / queue tick.
//
// Right now this is a NO-OP so the bot stops crashing.
// All your existing commands (/addsession, /cancelsession, /logsession, etc.)
// still work because they don't depend on this doing anything.
//
// Once we're ready, we can reintroduce logic here to:
//  - Look at Trello cards due in ~30 minutes
//  - Post the session queue/announcement embed
//  - Store the message to delete on /logsession or /cancelsession

async function runSessionAnnouncementTick(client) {
  // Intentionally doing nothing for now so we don't crash your bot.
  // Index.js still calls this every minute, but it just returns safely.
  return;
}

module.exports = {
  runSessionAnnouncementTick,
};
// src/utils/sessionAnnouncements.js
//
// Temporary safe version of the auto session announcement / queue tick.
//
// Right now this is a NO-OP so the bot stops crashing.
// All your existing commands (/addsession, /cancelsession, /logsession, etc.)
// still work because they don't depend on this doing anything.
//
// Once we're ready, we can reintroduce logic here to:
//  - Look at Trello cards due in ~30 minutes
//  - Post the session queue/announcement embed
//  - Store the message to delete on /logsession or /cancelsession

async function runSessionAnnouncementTick(client) {
  // Intentionally doing nothing for now so we don't crash your bot.
  // Index.js still calls this every minute, but it just returns safely.
  return;
}

module.exports = {
  runSessionAnnouncementTick,
};
