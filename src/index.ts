import { config } from "./config.js";
import { client } from "./discord.js";
import { startTransport } from "./transport.js";

// Auto-login on startup if token is available
const token = config.DISCORD_TOKEN;
if (token) {
  client.login(token).catch((error) => {
    console.error("Auto-login failed:", error);
  });
} else {
  console.log("No Discord token found in config, skipping auto-login");
}

await startTransport();
