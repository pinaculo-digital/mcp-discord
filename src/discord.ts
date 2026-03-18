import { Client, GatewayIntentBits } from "discord.js";

export const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.on("error", (error) => {
  console.error("Discord client error:", error);
});

client.on("warn", (message) => {
  console.warn("Discord client warning:", message);
});

client.on("ready", () => {
  console.log(`Discord bot logged in as ${client.user?.tag}`);
});
