# MCP-Discord
[![smithery badge](https://smithery.ai/badge/@barryyip0625/mcp-discord)](https://smithery.ai/server/@barryyip0625/mcp-discord) ![](https://badge.mcpx.dev?type=server 'MCP Server')

A Discord MCP (Model Context Protocol) server that enables AI assistants to interact with the Discord platform.

<a href="https://glama.ai/mcp/servers/@barryyip0625/mcp-discord">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@barryyip0625/mcp-discord/badge" alt="MCP-Discord MCP server" />
</a>

## Overview

MCP-Discord provides the following Discord-related functionalities:

- Login to Discord bot
- Get server information
- Read/delete channel messages
- Send messages to specified channels
- Retrieve forum channel lists
- Create/delete/reply to forum posts
- Create/delete text channels
- Add/remove message reactions
- Create/edit/delete/use webhooks

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Setup](#setup)
  - [Claude Code / claude.ai (HTTP + OAuth)](#claude-code--claudeai-http--oauth)
  - [Cursor / Cline (HTTP + static bearer)](#cursor--cline-http--static-bearer)
  - [Local stdio (legacy)](#local-stdio-legacy)
  - [Single-user warning](#single-user-warning)
- [Smoke test manual (pós-deploy)](#smoke-test-manual-pós-deploy)
- [Tools Documentation](#tools-documentation)
  - [Basic Functions](#basic-functions)
  - [Channel Management](#channel-management)
  - [Forum Functions](#forum-functions)
  - [Messages and Reactions](#messages-and-reactions)
  - [Webhook Management](#webhook-management)
- [Development](#development)
- [License](#license)

## Prerequisites

- Node.js (v16.0.0 or higher)
- npm (v7.0.0 or higher)
- A Discord bot with appropriate permissions
  - Bot token (obtainable from the [Discord Developer Portal](https://discord.com/developers/applications))
  - Message Content Intent enabled
  - Server Members Intent enabled
  - Presence Intent enabled
- Permissions in your Discord server:
  - Send Messages
  - Create Public Threads
  - Send Messages in Threads
  - Manage Threads
  - Manage Channels
  - Add Reactions

## Installation

### Installing via Smithery

To install mcp-discord for Claude Desktop automatically via [Smithery](https://smithery.ai/server/@barryyip0625/mcp-discord):

```bash
npx -y @smithery/cli install @barryyip0625/mcp-discord --client claude
```

### Manual Installation
```bash
# Clone the repository
git clone https://github.com/barryyip0625/mcp-discord.git
cd mcp-discord

# Install dependencies
npm install

# Compile TypeScript
npm run build
```

## Configuration

A Discord bot token is required for proper operation. You can provide it in two ways:

1. Environment variables:
```
DISCORD_TOKEN=your_discord_bot_token
# Optional: static bearer token for non-OAuth clients (e.g. Cursor, Cline).
# Clients pass `Authorization: Bearer <value>`. Leave empty to disable.
MCP_STATIC_BEARER=
```

2. Using the `--config` parameter when launching:
```
node path/to/mcp-discord/build/index.js --config "{\"DISCORD_TOKEN\":\"your_discord_bot_token\"}"
```

## Setup

The HTTP transport (`MCP_TRANSPORT=http`) exposes two coexisting auth flows:

1. **OAuth Authorization Code + PKCE + Dynamic Client Registration** — for Claude Code and claude.ai (clients that speak OAuth discovery).
2. **Static bearer token** via `MCP_STATIC_BEARER` — for clients like Cursor and Cline that don't perform OAuth discovery and just pass a bearer header.

Both flows can be enabled at the same time on the same server.

### Claude Code / claude.ai (HTTP + OAuth)

Server is published at some HTTPS URL (e.g. `https://discord-mcp.example.com`). No env var is needed for OAuth — clients register themselves dynamically via `POST /register`.

```bash
claude mcp remove discord 2>/dev/null
claude mcp add -s user --transport http discord https://discord-mcp.example.com/mcp
```

Notes:
- Do **not** pass `--header` — Claude Code will discover `/.well-known/oauth-authorization-server`, register a client, open `/authorize` in the browser, auto-approve, and exchange the code at `/oauth/token`.
- For claude.ai, add the server in the UI with the same `/mcp` URL.

### Cursor / Cline (HTTP + static bearer)

Set `MCP_STATIC_BEARER` on the server to any secret string, then have the client send `Authorization: Bearer <secret>`.

Server side:

```bash
export MCP_STATIC_BEARER=$(openssl rand -hex 32)
export DISCORD_TOKEN=your_discord_bot_token
export MCP_TRANSPORT=http
node build/index.js
```

Cursor `~/.cursor/mcp.json` (or workspace `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "discord": {
      "url": "https://discord-mcp.example.com/mcp",
      "headers": {
        "Authorization": "Bearer <secret>"
      }
    }
  }
}
```

Cline uses the same shape under its MCP settings.

### Local stdio (legacy)

For local stdio mode (no HTTP, no auth), point the client at the built entry directly:

```json
{
    "mcpServers": {
        "discord": {
            "command": "node",
            "args": [
                "path/to/mcp-discord/build/index.js"
            ],
            "env": {
                "DISCORD_TOKEN": "your_discord_bot_token"
            }
        }
    }
}
```

### Single-user warning

This server is single-user by design:

- `validTokens`, `clients` (registered OAuth clients), and `authCodes` are **in-memory** (`Map` / `Set`). A restart drops every issued access token, registered client, and pending auth code — every connected client has to redo discovery + registration + OAuth.
- There is no multi-tenant separation. `MCP_STATIC_BEARER` is a single shared secret; anyone who has it gets full access.
- `/authorize` auto-approves without a consent screen.

Don't expose this server publicly without a reverse proxy / IP allowlist / etc.

## Smoke test manual (pós-deploy)

After deploying, run these four checks against the live URL (replace `https://discord-mcp.example.com` and `<secret>` accordingly):

1. **OAuth via Claude Code** —
   ```bash
   claude mcp remove discord
   claude mcp add -s user --transport http discord https://discord-mcp.example.com/mcp
   # restart Claude Code, then in a session:
   /mcp
   ```
   Expected: browser opens on `/authorize`, redirects back to a `claude.ai` (or `localhost`) callback, the `discord` server shows up as connected in `/mcp`, and `mcp__discord-*` tools become callable.

2. **Static bearer via curl** —
   ```bash
   curl -i -H "Authorization: Bearer <secret>" \
        -H "Content-Type: application/json" \
        -H "Accept: application/json, text/event-stream" \
        -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}},"id":1}' \
        https://discord-mcp.example.com/mcp
   ```
   Expected: HTTP `200` with an `initialize` result. A `401` means `MCP_STATIC_BEARER` is unset on the server or the secret doesn't match.

3. **PKCE verifier mismatch** — register a client, hit `/authorize` with a valid `code_challenge`, then call `/oauth/token` with a **wrong** `code_verifier`:
   ```bash
   # 1. register
   CLIENT_ID=$(curl -s -X POST https://discord-mcp.example.com/register \
     -H "Content-Type: application/json" \
     -d '{"redirect_uris":["http://localhost:9999/cb"],"client_name":"smoke"}' \
     | python -c 'import sys,json;print(json.load(sys.stdin)["client_id"])')
   # 2. /authorize with a known challenge (verifier="abc..." → challenge below is its S256 base64url)
   CHALLENGE="ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0"   # sha256("abc") base64url
   curl -i "https://discord-mcp.example.com/authorize?response_type=code&client_id=$CLIENT_ID&redirect_uri=http://localhost:9999/cb&code_challenge=$CHALLENGE&code_challenge_method=S256&state=x"
   # copy the `code` from the Location header
   CODE=...
   # 3. exchange with wrong verifier
   curl -i -X POST https://discord-mcp.example.com/oauth/token \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "grant_type=authorization_code&code=$CODE&code_verifier=wrong-verifier&client_id=$CLIENT_ID&redirect_uri=http://localhost:9999/cb"
   ```
   Expected: HTTP `400` with `{"error":"invalid_grant","error_description":"PKCE verifier mismatch"}`.

4. **Expired authorization code** — repeat step 3 up to obtaining `CODE`, then **wait > 60 seconds** before calling `/oauth/token` (with the correct verifier this time, e.g. `code_verifier=abc`).
   Expected: HTTP `400` with `{"error":"invalid_grant","error_description":"authorization code invalid or expired"}`.

## Tools Documentation

### Basic Functions

- `discord_login`: Login to Discord
- `discord_send`: Send a message to a specified channel
- `discord_get_server_info`: Get Discord server information

### Channel Management

- `discord_create_text_channel`: Create a text channel
- `discord_delete_channel`: Delete a channel

### Forum Functions

- `discord_get_forum_channels`: Get a list of forum channels
- `discord_list_forum_threads`: List the threads (posts) inside a forum channel, archived included
- `discord_create_forum_post`: Create a forum post
- `discord_get_forum_post`: Get a forum post
- `discord_reply_to_forum`: Reply to a forum post
- `discord_delete_forum_post`: Delete a forum post

### Messages and Reactions

- `discord_read_messages`: Read channel messages (each with `attachments[]` and `embeds[]`)
- `discord_add_reaction`: Add a reaction to a message
- `discord_add_multiple_reactions`: Add multiple reactions to a message
- `discord_remove_reaction`: Remove a reaction from a message
- `discord_delete_message`: Delete a specific message from a channel

> **Attachments:** `discord_read_messages` and `discord_get_forum_post` return each message's `attachments[]` (image/video/file) and `embeds[]`. Discord CDN URLs are signed and **expire** — download attachments promptly; don't cache the URL.

### Webhook Management

- `discord_create_webhook`: Creates a new webhook for a Discord channel
- `discord_send_webhook_message`: Sends a message to a Discord channel using a webhook
- `discord_edit_webhook`: Edits an existing webhook for a Discord channel
- `discord_delete_webhook`: Deletes an existing webhook for a Discord channel

## Development

```bash
# Development mode
npm run dev
```

## License

[MIT License](https://github.com/barryyip0625/mcp-discord?tab=MIT-1-ov-file)
