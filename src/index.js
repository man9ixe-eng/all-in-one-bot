// src/index.js
require('dotenv').config();

const http = require('http');
const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  Collection,
} = require('discord.js');

// ===== HTTP SERVER FOR RENDER =====
const PORT = process.env.PORT || 3000;

http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Glace minimal bot is running.\n');
  })
  .listen(PORT, () => {
    console.log(`HTTP server listening on port ${PORT}`);
  });

// ===== DISCORD CLIENT (minimal) =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

client.commands = new Collection();

// Ready event
client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// Simple test prefix command
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.content === '!ping') {
    await message.reply('Pong from minimal bot (Render).');
  }
});

// Extra debug (comment out if too spammy)
// client.on('debug', (msg) => console.log('[DEBUG]', msg));

// Error handlers
client.on('error', (error) => {
  console.error('Discord client error:', error);
});

client.on('shardError', (error) => {
  console.error('WebSocket shard error:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

// ===== LOGIN =====
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
