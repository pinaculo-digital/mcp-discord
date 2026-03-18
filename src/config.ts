import { envalid } from "./envalid.js";

export const config: { DISCORD_TOKEN?: string; DISCORD_GUILD_ID?: string } = {};

if (envalid.DISCORD_TOKEN) {
  config.DISCORD_TOKEN = envalid.DISCORD_TOKEN;
  config.DISCORD_GUILD_ID = envalid.DISCORD_GUILD_ID || undefined;
  console.log("Config loaded from environment variables. Discord token available:", !!config.DISCORD_TOKEN);
  if (config.DISCORD_GUILD_ID) {
    console.log("Default guild ID configured:", config.DISCORD_GUILD_ID);
  }
} else {
  const configArgIndex = process.argv.indexOf("--config");
  if (configArgIndex !== -1 && configArgIndex < process.argv.length - 1) {
    try {
      let configStr = process.argv[configArgIndex + 1];
      const parsed = JSON.parse(configStr);
      config.DISCORD_TOKEN = parsed.DISCORD_TOKEN;
      config.DISCORD_GUILD_ID = parsed.DISCORD_GUILD_ID;
      console.log("Config parsed successfully. Discord token available:", !!config.DISCORD_TOKEN);
    } catch (error) {
      console.error("Failed to parse config argument:", error);
    }
  } else {
    console.warn("No config found in environment variables or command line arguments");
  }
}
