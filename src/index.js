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

// =======================
// HTTP SERVER FOR RENDER
// =======================

const PORT = process.env.PORT || 3000;

http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Glace bot is running.\n');
  })
  .listen(PORT, () => {
    console.log(`HTTP server listening on port ${PORT}`);
  });

// =======================
// DISCORD CLIENT SETUP
// =======================

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

client.commands = new Collection();

// =======================
// LOAD SLASH COMMANDS
// =======================

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
} else {
  console.warn(
    `[WARN] Commands folder not found at ${commandsPathRoot}. No commands loaded.`,
  );
}

// =======================
// READY EVENT
// =======================

client.once(Events.ClientReady, (c) => {
  console.log(
    `[READY] Logged in as ${c.user.tag} (${c.user.id}). Guilds: ${c.guilds.cache.size}`,
  );
});

// =======================
// SESSION ANNOUNCEMENTS
// (runs every 1 minute)
// =======================

setInterval(async () => {
  try {
    console.log('[AUTO] Session announcement tick...');
    await runSessionAnnouncementTick(client);
  } catch (err) {
    console.error('[AUTO] Session announcement error:', err);
  }
}, 60 * 1000);

// =======================
// MESSAGE AUTOMOD + PREFIX
// =======================

client.on('messageCreate', async (message) => {
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

// =======================
// INTERACTION HANDLER
// =======================

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // 1) Queue buttons
    if (interaction.isButton()) {
      const handled = await handleQueueButtonInteraction(interaction);
      if (handled) return;
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
      // ignore follow-up errors
    }
  }
});

// =======================
// GLOBAL ERROR HANDLERS
// =======================

client.on('error', (error) => {
  console.error('[DISCORD CLIENT ERROR]', error);
});

client.on('shardError', (error) => {
  console.error('[SHARD ERROR]', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

// =======================
// LOGIN TO DISCORD
// =======================

const rawToken = process.env.DISCORD_TOKEN;

if (!rawToken) {
  console.error(
    '[LOGIN] DISCORD_TOKEN is missing in environment variables. Bot cannot start.',
  );
  // Exit so Render shows it as a failed deploy instead of a "running but dead" app
  process.exit(1);
}

const token = rawToken.trim();
console.log(
  `[LOGIN] DISCORD_TOKEN detected. Length: ${token.length} characters.`,
);

client
  .login(token)
  .then(() => {
    console.log('[LOGIN] login() promise resolved. Waiting for READY event...');
  })
  .catch((err) => {
    console.error('[LOGIN] Failed to login to Discord:', err);
    process.exit(1);
  });
