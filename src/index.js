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

// ===== HTTP SERVER FOR RENDER =====

const PORT = process.env.PORT || 3000;

http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Glace bot is running.\n');
  })
  .listen(PORT, () => {
    console.log(`HTTP server listening on port ${PORT}`);
  });

// ===== DISCORD CLIENT SETUP =====

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

// ===== LOAD COMMANDS (src/commands/**) =====

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

// ===== EVENTS =====

client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// Session announcements (every 1 minute)
setInterval(async () => {
  try {
    console.log('[AUTO] Session announcement tick...');
    await runSessionAnnouncementTick(client);
  } catch (err) {
    console.error('[AUTO] Session announcement error:', err);
  }
}, 60 * 1000);

// MessageCreate: automod + simple prefix command
client.on('messageCreate', async (message) => {
  try {
    await handleMessageAutomod(message);
  } catch (err) {
    console.error('[AUTOMOD] Error while processing message:', err);
  }

  if (message.author.bot) return;

  if (message.content === '!ping') {
    await message.reply('Pong! (prefix command)');
  }
});

// InteractionCreate: buttons + slash commands
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // 1) Button interactions – queue system
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
      // ignore double replies
    }
  }
});

// ===== GLOBAL ERROR HANDLERS =====

client.on('error', (error) => {
  console.error('Discord client error:', error);
});

client.on('shardError', (error) => {
  console.error('WebSocket shard error:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

// ===== LOGIN TO DISCORD =====

const token = process.env.DISCORD_TOKEN;

if (!token || typeof token !== 'string' || token.trim().length === 0) {
  console.error(
    '[LOGIN] DISCORD_TOKEN is missing or empty in this environment. Bot cannot login.',
  );
} else {
  const trimmed = token.trim();
  console.log(
    `[LOGIN] DISCORD_TOKEN detected. Length: ${trimmed.length} characters.`,
  );
  console.log('[LOGIN] Attempting to login to Discord...');

  client
    .login(trimmed)
    .then(() => {
      console.log('[LOGIN] Login successful.');
    })
    .catch((err) => {
      console.error('Failed to login to Discord:', err);
    });
}
