import { config } from "./config.js";
import { client } from "./discord.js";
import { startTransport } from "./transport.js";

// Auto-login on startup if token is available
const token = config.DISCORD_TOKEN;
if (token) {
  console.log("Attempting Discord auto-login...");
  client.login(token).then(() => {
    console.log("Discord login successful");
  }).catch((error) => {
    console.error("Auto-login failed:", error.message || error);
    console.error("The MCP server will continue running without Discord. Use discord_login tool to retry.");
  });
} else {
  console.log("No Discord token found in config, skipping auto-login");
}

await startTransport();
