// src/index.js
"use strict";

require("dotenv").config();

const http = require("http");
const {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  Events,
} = require("discord.js");
const fs = require("node:fs");
const path = require("node:path");

const { handleMessageAutomod } = require("./utils/automod");
const { runSessionAnnouncementTick } = require("./utils/sessionAnnouncements");
const { handleQueueButtonInteraction } = require("./utils/sessionQueueManager");

// IMPORTANT: priorityStore.js exports the CLASS (module.exports = PriorityStore)
const PriorityStore = require("./utils/priorityStore");

// ===========================
// HTTP SERVER FOR RENDER
// ===========================

const PORT = process.env.PORT || 3000;

http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Glace bot is running.\n");
  })
  .listen(PORT, () => {
    console.log(`HTTP server listening on port ${PORT}`);
  });

// ===========================
// DISCORD CLIENT SETUP
// ===========================

// If you want less lag, you can turn off MessageContent + GuildMessages
// but automod + !ping needs them. So we keep them ON by default.
const ENABLE_MESSAGE_CONTENT =
  (process.env.ENABLE_MESSAGE_CONTENT || "true").toLowerCase() === "true";

const intents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildMessageReactions,
];

if (ENABLE_MESSAGE_CONTENT) {
  intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
} else {
  console.log(
    "[INTENTS] ENABLE_MESSAGE_CONTENT=false -> messageCreate automod/!ping will not run."
  );
}

const client = new Client({
  intents,
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// Commands collection
client.commands = new Collection();

// ===========================
// PRIORITY STORE (attendance history for fair queues)
// ===========================

try {
  const storePath = process.env.PRIORITY_STORE_PATH; // optional (Render disk path recommended)
  const priorityStore = new PriorityStore(storePath);

  priorityStore.load(); // ✅ this now exists because it's an instance
  client.priorityStore = priorityStore;

  console.log(
    `[PRIORITY] Store loaded. Path: ${
      storePath && storePath.trim().length ? storePath : "default (src/data/priority.json)"
    }`
  );
} catch (err) {
  console.error("[PRIORITY] Failed to init priority store:", err);

  // Safe fallback so commands never crash if store fails
  client.priorityStore = {
    load: () => {},
    saveNow: () => {},
    recordAttendance: () => {},
    getLastAttendedAt: () => 0,
    getAttendedCount: () => 0,
  };
}

// ===========================
// LOAD SLASH COMMANDS
// (src/commands/**)
// ===========================

const commandsPathRoot = path.join(__dirname, "commands");

if (fs.existsSync(commandsPathRoot)) {
  const commandFolders = fs.readdirSync(commandsPathRoot);

  for (const folder of commandFolders) {
    const commandsPath = path.join(commandsPathRoot, folder);
    if (!fs.statSync(commandsPath).isDirectory()) continue;

    const commandFiles = fs
      .readdirSync(commandsPath)
      .filter((file) => file.endsWith(".js"));

    for (const file of commandFiles) {
      const filePath = path.join(commandsPath, file);

      // Require fresh (Render restarts anyway, but this avoids stale cache locally)
      delete require.cache[require.resolve(filePath)];
      const command = require(filePath);

      if ("data" in command && "execute" in command) {
        client.commands.set(command.data.name, command);
        console.log(`[COMMAND] Loaded /${command.data.name} from ${filePath}`);
      } else {
        console.log(
          `[WARN] Command at ${filePath} is missing "data" or "execute". Skipping.`
        );
      }
    }
  }
} else {
  console.log("[COMMAND] No commands folder found at:", commandsPathRoot);
}

// ===========================
// EVENTS
// ===========================

// READY
client.once(Events.ClientReady, (c) => {
  console.log(
    `[READY] Logged in as ${c.user.tag} (id: ${c.user.id}) in ${c.guilds.cache.size} guild(s).`
  );
});

// Discord.js debug (OFF by default)
const ENABLE_DISCORD_DEBUG =
  (process.env.ENABLE_DISCORD_DEBUG || "false").toLowerCase() === "true";

if (ENABLE_DISCORD_DEBUG) {
  client.on("debug", (msg) => {
    // Never log token-ish lines
    if (typeof msg === "string" && msg.includes("Provided token")) return;
    console.log("[DISCORD DEBUG]", msg);
  });
}

client.on("warn", (msg) => console.warn("[DISCORD WARN]", msg));
client.on("error", (err) => console.error("[DISCORD ERROR]", err));

// Session announcements: every 1 minute
setInterval(async () => {
  try {
    console.log("[AUTO] Session announcement tick...");
    await runSessionAnnouncementTick(client);
  } catch (err) {
    console.error("[AUTO] Session announcement error:", err);
  }
}, 60 * 1000);

// MESSAGE CREATE: automod + simple prefix ping
if (ENABLE_MESSAGE_CONTENT) {
  client.on("messageCreate", async (message) => {
    // Ignore bots early
    if (message.author?.bot) return;

    // Automod first
    try {
      await handleMessageAutomod(message);
    } catch (err) {
      console.error("[AUTOMOD] Error while processing message:", err);
    }

    if (message.content === "!ping") {
      message.reply("Pong! (prefix command)");
    }
  });
}

// ===========================
// INTERACTIONS (BUTTONS + SLASH)
// ===========================

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // 1) Queue buttons (session queue system)
    if (interaction.isButton()) {
      const handled = await handleQueueButtonInteraction(interaction);
      if (handled) return;
      // If not handled, fall through in case you add other buttons later
    }

    // 2) Slash commands
    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) return;

    await command.execute(interaction);
  } catch (error) {
    console.error("[INTERACTION] Error while executing:", error);

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: "There was an error while executing this interaction.",
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: "There was an error while executing this interaction.",
          ephemeral: true,
        });
      }
    } catch {
      // ignore double-reply errors
    }
  }
});

// ===========================
// GLOBAL ERROR HANDLERS
// ===========================

process.on("unhandledRejection", (reason) => {
  console.error("[UNHANDLED REJECTION]", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[UNCAUGHT EXCEPTION]", err);
});

// ===========================
// LOGIN TO DISCORD
// ===========================

const rawToken = process.env.DISCORD_TOKEN;

if (!rawToken) {
  console.error(
    "[LOGIN] No DISCORD_TOKEN found in environment. Set it in Render env vars."
  );
  process.exit(1);
}

// Trim whitespace/newlines from env var (Render gotcha)
const token = rawToken.trim();
console.log(
  `[LOGIN] DISCORD_TOKEN detected. Raw length: ${rawToken.length}, trimmed length: ${token.length}.`
);

client
  .login(token)
  .then(() => {
    console.log("[LOGIN] client.login() resolved. Waiting for READY event...");
  })
  .catch((err) => {
    console.error("[LOGIN] Failed to login to Discord:", err);
  });
