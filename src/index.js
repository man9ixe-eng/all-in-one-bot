// src/index.js

require('dotenv').config();

const http = require('http');
const {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  Events,
} = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

const { handleMessageAutomod } = require('./utils/automod');
const { runSessionAnnouncementTick } = require('./utils/sessionAnnouncements');
const { handleQueueButtonInteraction } = require('./utils/sessionQueueManager');
const priorityStore = require('./utils/priorityStore');


// ===========================
// HTTP SERVER FOR RENDER
// ===========================

const PORT = process.env.PORT || 3000;

http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Glace bot is running.\n');
  })
  .listen(PORT, () => {
    console.log(`HTTP server listening on port ${PORT}`);
  });

// ===========================
// DISCORD CLIENT SETUP
// ===========================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// Priority store (attendance history for fair queues)
try {
  priorityStore.load();
  client.priorityStore = priorityStore;
  console.log('[PRIORITY] Store loaded.');
} catch (err) {
  console.error('[PRIORITY] Failed to load priority store:', err);
}

client.commands = new Collection();

// ===========================
// LOAD SLASH COMMANDS
// (src/commands/**)
// ===========================

const commandsPathRoot = path.join(__dirname, 'commands');

if (fs.existsSync(commandsPathRoot)) {
  const commandFolders = fs.readdirSync(commandsPathRoot);

  for (const folder of commandFolders) {
    const commandsPath = path.join(commandsPathRoot, folder);
    const commandFiles = fs
      .readdirSync(commandsPath)
      .filter((file) => file.endsWith('.js'));

    for (const file of commandFiles) {
      const filePath = path.join(commandsPath, file);
      const command = require(filePath);

      if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
        console.log(`[COMMAND] Loaded /${command.data.name} from ${filePath}`);
      } else {
        console.log(
          `[WARN] Command at ${filePath} is missing "data" or "execute". Skipping.`,
        );
      }
    }
  }
}

// ===========================
// EVENTS
// ===========================

// READY
client.once(Events.ClientReady, (c) => {
  console.log(
    `[READY] Logged in as ${c.user.tag} (id: ${c.user.id}) in ${c.guilds.cache.size} guild(s).`,
  );
});

// Extra debug to see what Discord.js is doing
// Discord.js debug can be VERY noisy and may leak sensitive info; keep it OFF by default.
const ENABLE_DISCORD_DEBUG = process.env.ENABLE_DISCORD_DEBUG === 'true';
if (ENABLE_DISCORD_DEBUG) {
  client.on('debug', (msg) => {
    if (typeof msg === 'string' && msg.includes('Provided token')) return;
    console.log('[DISCORD DEBUG]', msg);
  });
}

client.on('warn', (msg) => {
  console.warn('[DISCORD WARN]', msg);
});

client.on('error', (err) => {
  console.error('[DISCORD ERROR]', err);
});

// Session announcements: every 1 minute
setInterval(async () => {
  try {
    console.log('[AUTO] Session announcement tick...');
    await runSessionAnnouncementTick(client);
  } catch (err) {
    console.error('[AUTO] Session announcement error:', err);
  }
}, 60 * 1000);

// MESSAGE CREATE: automod + simple prefix ping
client.on('messageCreate', async (message) => {
  // Automod first
  try {
    await handleMessageAutomod(message);
  } catch (err) {
    console.error('[AUTOMOD] Error while processing message:', err);
  }

  if (message.author.bot) return;

  if (message.content === '!ping') {
    message.reply('Pong! (prefix command)');
  }
});

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
    console.error('Error while executing interaction:', error);

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: 'There was an error while executing this interaction.',
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: 'There was an error while executing this interaction.',
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

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled promise rejection:', reason);
});

// ===========================
// LOGIN TO DISCORD
// ===========================

const rawToken = process.env.DISCORD_TOKEN;

if (!rawToken) {
  console.error(
    '[LOGIN] No DISCORD_TOKEN found in environment. Make sure it is set in Render env vars.',
  );
  process.exit(1);
}

// Trim whitespace/newlines from env var (very common Render gotcha)
const token = rawToken.trim();
console.log(
  `[LOGIN] DISCORD_TOKEN detected. Raw length: ${rawToken.length}, trimmed length: ${token.length}.`,
);

client
  .login(token)
  .then(() => {
    console.log('[LOGIN] client.login() resolved. Waiting for READY event...');
  })
  .catch((err) => {
    console.error('[LOGIN] Failed to login to Discord:', err);
  });
