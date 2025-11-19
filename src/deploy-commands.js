// src/deploy-commands.js
// Registers ALL slash commands in src/commands/** with Discord for a single guild.

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { REST, Routes } = require('discord.js');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID; // your bot application ID
const GUILD_ID = process.env.GUILD_ID;   // your main server ID

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('Missing DISCORD_TOKEN, CLIENT_ID, or GUILD_ID in .env');
  process.exit(1);
}

const commands = [];

// Read all folders inside src/commands
const commandsPathRoot = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(commandsPathRoot);

for (const folder of commandFolders) {
  const commandsPath = path.join(commandsPathRoot, folder);
  const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);

    if ('data' in command && 'execute' in command) {
      commands.push(command.data.toJSON());
      console.log(`[DEPLOY] Prepared /${command.data.name} from ${filePath}`);
    } else {
      console.warn(`[DEPLOY] Command at ${filePath} is missing "data" or "execute". Skipping.`);
    }
  }
}

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    console.log(`Started refreshing ${commands.length} application (/) commands for guild ${GUILD_ID}...`);

    const data = await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands },
    );

    console.log(`Successfully reloaded ${data.length} application (/) commands.`);
  } catch (error) {
    console.error('Failed to deploy commands:', error);
  }
})();
