import { envalid } from "./envalid.js";

export const config: { DISCORD_TOKEN?: string } = {};

if (envalid.DISCORD_TOKEN) {
  config.DISCORD_TOKEN = envalid.DISCORD_TOKEN;
  console.log("Config loaded from environment variables. Discord token available:", !!config.DISCORD_TOKEN);
  if (config.DISCORD_TOKEN) {
    console.log("Token length:", config.DISCORD_TOKEN.length);
  }
} else {
  const configArgIndex = process.argv.indexOf("--config");
  if (configArgIndex !== -1 && configArgIndex < process.argv.length - 1) {
    try {
      let configStr = process.argv[configArgIndex + 1];
      console.log("Raw config string:", configStr);
      const parsed = JSON.parse(configStr);
      config.DISCORD_TOKEN = parsed.DISCORD_TOKEN;
      console.log("Config parsed successfully. Discord token available:", !!config.DISCORD_TOKEN);
      if (config.DISCORD_TOKEN) {
        console.log("Token length:", config.DISCORD_TOKEN.length);
      }
    } catch (error) {
      console.error("Failed to parse config argument:", error);
      console.error("Raw config argument:", process.argv[configArgIndex + 1]);
      console.log("All arguments:", process.argv);
    }
  } else {
    console.warn("No config found in environment variables or command line arguments");
    console.log("All arguments:", process.argv);
  }
}
