// src/index.js
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const http = require('http');
const {
  Client,
  Collection,
  GatewayIntentBits,
  Partials,
  Events,
} = require('discord.js');

const { runSessionAutomation } = require('./utils/sessionAutomation');

// Create Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

client.commands = new Collection();

// Load commands from src/commands/*/*.js
const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
  const commandsPath = path.join(foldersPath, folder);
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
      console.warn(
        `[WARNING] The command at ${filePath} is missing "data" or "execute".`,
      );
    }
  }
}

// Handle slash commands
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error('Error while executing command:', error);
    try {
      if (interaction.deferred || interaction.replied) {
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
    } catch (err) {
      console.error('Failed to send error reply:', err);
    }
  }
});

// When bot is ready
client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`);

  // Start background session automation (every 5 minutes)
  setInterval(async () => {
    try {
      console.log('[AUTO] Session automation tick...');
      await runSessionAutomation(client);
    } catch (err) {
      console.error('[AUTO] Session automation error:', err);
    }
  }, 5 * 60 * 1000); // 5 minutes
});

// Keep-alive HTTP server for Render
const PORT = process.env.PORT || 3000;

http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('All-in-one Bot is running.');
  })
  .listen(PORT, () => {
    console.log(`HTTP server listening on port ${PORT}`);
  });

// Login
client.login(process.env.DISCORD_TOKEN);
