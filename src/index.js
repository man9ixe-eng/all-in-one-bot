// src/index.js

require('dotenv').config();

const http = require('http');
const {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
} = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

// ===== HTTP SERVER FOR RENDER (start this FIRST) =====

const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Glace bot is running.\n');
}).listen(PORT, () => {
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
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
  ],
});

// Command collection
client.commands = new Collection();

// Load commands from src/commands/**
const commandsPathRoot = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPathRoot)) {
  const commandFolders = fs.readdirSync(commandsPathRoot);
  for (const folder of commandFolders) {
    const commandsPath = path.join(commandsPathRoot, folder);
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

    for (const file of commandFiles) {
      const filePath = path.join(commandsPath, file);
      const command = require(filePath);

      if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
        console.log(`[COMMAND] Loaded /${command.data.name} from ${filePath}`);
      } else {
        console.log(`[WARN] Command at ${filePath} is missing "data" or "execute". Skipping.`);
      }
    }
  }
}

// Events
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// Prefix ping (keep for testing)
client.on('messageCreate', (message) => {
  if (message.author.bot) return;
  if (message.content === '!ping') {
    message.reply('Pong! (prefix command)');
  }
});

// Slash commands
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = interaction.client.commands.get(interaction.commandName);
  if (!command) {
    console.error(`No command matching ${interaction.commandName} was found.`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: 'There was an error while executing this command.',
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: 'There was an error while executing this command.',
        ephemeral: true,
      });
    }
  }
});

// ===== LOGIN TO DISCORD (catch errors so process doesn't crash) =====

client
  .login(process.env.DISCORD_TOKEN)
  .catch((err) => {
    console.error('Failed to login to Discord:', err);
  });
