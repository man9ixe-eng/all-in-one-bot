// src/index.js

require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
} = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

// Create the client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction
  ]
});

// ========== COMMAND HANDLER SETUP ==========

client.commands = new Collection();

const commandsPathRoot = path.join(__dirname, 'commands');
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

// ========== EVENTS ==========

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// Prefix-based test command (keep for now)
client.on('messageCreate', (message) => {
  if (message.author.bot) return;

  if (message.content === '!ping') {
    message.reply('Pong! (prefix command)');
  }
});

// Handle slash commands
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
      await interaction.followUp({ content: 'There was an error while executing this command.', ephemeral: true });
    } else {
      await interaction.reply({ content: 'There was an error while executing this command.', ephemeral: true });
    }
  }
});

// ========== LOGIN ==========

client.login(process.env.DISCORD_TOKEN);
