import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { Client, GatewayIntentBits, Events, TextChannel, ForumChannel, ChannelType } from "discord.js";
import { CallToolRequestSchema, ListToolsRequestSchema, isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import { randomUUID } from "node:crypto";
import { envalid } from "./envalid.js";

// Configuration parsing
let config: any = {};

// Read configuration from environment variables
if (envalid.DISCORD_TOKEN) {
  config.DISCORD_TOKEN = envalid.DISCORD_TOKEN;
  console.log("Config loaded from environment variables. Discord token available:", !!config.DISCORD_TOKEN);
  if (config.DISCORD_TOKEN) {
    console.log("Token length:", config.DISCORD_TOKEN.length);
  }
} else {
  // Try to parse configuration from command line arguments (for backward compatibility)
  const configArgIndex = process.argv.indexOf("--config");
  if (configArgIndex !== -1 && configArgIndex < process.argv.length - 1) {
    try {
      let configStr = process.argv[configArgIndex + 1];

      // Print raw configuration string for debugging
      console.log("Raw config string:", configStr);

      // Try to parse JSON
      config = JSON.parse(configStr);
      console.log("Config parsed successfully. Discord token available:", !!config.DISCORD_TOKEN);

      if (config.DISCORD_TOKEN) {
        console.log("Token length:", config.DISCORD_TOKEN.length);
      }
    } catch (error) {
      console.error("Failed to parse config argument:", error);
      console.error("Raw config argument:", process.argv[configArgIndex + 1]);

      // Try to read arguments directly (for debugging)
      console.log("All arguments:", process.argv);
    }
  } else {
    console.warn("No config found in environment variables or command line arguments");
    console.log("All arguments:", process.argv);
  }
}

// Create Discord client
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

// Factory to create an MCP server instance (one per session/transport)
function createServer() {
  const server = new Server(
    {
      name: "MCP-Discord",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );
  registerHandlers(server);
  return server;
}

// Shared server instance for stdio mode
let server: Server;

const DiscordLoginSchema = z.object({
  random_string: z.string().optional(),
});

const SendMessageSchema = z.object({
  channelId: z.string(),
  message: z.string(),
});

const GetForumChannelsSchema = z.object({
  guildId: z.string(),
});

const CreateForumPostSchema = z.object({
  forumChannelId: z.string(),
  title: z.string(),
  content: z.string(),
  tags: z.array(z.string()).optional(),
});

const GetForumPostSchema = z.object({
  threadId: z.string(),
});

const ReplyToForumSchema = z.object({
  threadId: z.string(),
  message: z.string(),
});

const CreateTextChannelSchema = z.object({
  guildId: z.string(),
  channelName: z.string(),
  topic: z.string().optional(),
});

const DeleteChannelSchema = z.object({
  channelId: z.string(),
  reason: z.string().optional(),
});

const ReadMessagesSchema = z.object({
  channelId: z.string(),
  limit: z.number().min(1).max(100).optional().default(50),
});

const GetServerInfoSchema = z.object({
  guildId: z.string(),
});

const AddReactionSchema = z.object({
  channelId: z.string(),
  messageId: z.string(),
  emoji: z.string(),
});

const AddMultipleReactionsSchema = z.object({
  channelId: z.string(),
  messageId: z.string(),
  emojis: z.array(z.string()),
});

const RemoveReactionSchema = z.object({
  channelId: z.string(),
  messageId: z.string(),
  emoji: z.string(),
  userId: z.string().optional(),
});

const DeleteForumPostSchema = z.object({
  threadId: z.string(),
  reason: z.string().optional(),
});

const DeleteMessageSchema = z.object({
  channelId: z.string(),
  messageId: z.string(),
  reason: z.string().optional(),
});

const CreateWebhookSchema = z.object({
  channelId: z.string(),
  name: z.string(),
  avatar: z.string().optional(),
  reason: z.string().optional(),
});

const SendWebhookMessageSchema = z.object({
  webhookId: z.string(),
  webhookToken: z.string(),
  content: z.string(),
  username: z.string().optional(),
  avatarURL: z.string().optional(),
  threadId: z.string().optional(),
});

const EditWebhookSchema = z.object({
  webhookId: z.string(),
  webhookToken: z.string().optional(),
  name: z.string().optional(),
  avatar: z.string().optional(),
  channelId: z.string().optional(),
  reason: z.string().optional(),
});

const DeleteWebhookSchema = z.object({
  webhookId: z.string(),
  webhookToken: z.string().optional(),
  reason: z.string().optional(),
});

function registerHandlers(server: Server) {
// Set up the tool list
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "test",
        description: "A simple test tool to verify the MCP server is working correctly",
        inputSchema: {
          type: "object",
        },
      },
      {
        name: "discord_login",
        description: "Logs in to Discord using the configured token",
        inputSchema: {
          type: "object",
          properties: {
            random_string: { type: "string" },
          },
          required: [],
        },
      },
      {
        name: "discord_send",
        description: "Sends a message to a specified Discord text channel",
        inputSchema: {
          type: "object",
          properties: {
            channelId: { type: "string" },
            message: { type: "string" },
          },
          required: ["channelId", "message"],
        },
      },
      {
        name: "discord_get_forum_channels",
        description: "Lists all forum channels in a specified Discord server (guild)",
        inputSchema: {
          type: "object",
          properties: {
            guildId: { type: "string" },
          },
          required: ["guildId"],
        },
      },
      {
        name: "discord_create_forum_post",
        description: "Creates a new post in a Discord forum channel with optional tags",
        inputSchema: {
          type: "object",
          properties: {
            forumChannelId: { type: "string" },
            title: { type: "string" },
            content: { type: "string" },
            tags: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["forumChannelId", "title", "content"],
        },
      },
      {
        name: "discord_get_forum_post",
        description: "Retrieves details about a forum post including its messages",
        inputSchema: {
          type: "object",
          properties: {
            threadId: { type: "string" },
          },
          required: ["threadId"],
        },
      },
      {
        name: "discord_reply_to_forum",
        description: "Adds a reply to an existing forum post or thread",
        inputSchema: {
          type: "object",
          properties: {
            threadId: { type: "string" },
            message: { type: "string" },
          },
          required: ["threadId", "message"],
        },
      },
      {
        name: "discord_create_text_channel",
        description: "Creates a new text channel in a Discord server with an optional topic",
        inputSchema: {
          type: "object",
          properties: {
            guildId: { type: "string" },
            channelName: { type: "string" },
            topic: { type: "string" },
          },
          required: ["guildId", "channelName"],
        },
      },
      {
        name: "discord_delete_channel",
        description: "Deletes a Discord channel with an optional reason",
        inputSchema: {
          type: "object",
          properties: {
            channelId: { type: "string" },
            reason: { type: "string" },
          },
          required: ["channelId"],
        },
      },
      {
        name: "discord_read_messages",
        description: "Retrieves messages from a Discord text channel with a configurable limit",
        inputSchema: {
          type: "object",
          properties: {
            channelId: { type: "string" },
            limit: {
              type: "number",
              minimum: 1,
              maximum: 100,
              default: 50,
            },
          },
          required: ["channelId"],
        },
      },
      {
        name: "discord_get_server_info",
        description: "Retrieves detailed information about a Discord server including channels and member count",
        inputSchema: {
          type: "object",
          properties: {
            guildId: { type: "string" },
          },
          required: ["guildId"],
        },
      },
      {
        name: "discord_add_reaction",
        description: "Adds an emoji reaction to a specific Discord message",
        inputSchema: {
          type: "object",
          properties: {
            channelId: { type: "string" },
            messageId: { type: "string" },
            emoji: { type: "string" },
          },
          required: ["channelId", "messageId", "emoji"],
        },
      },
      {
        name: "discord_add_multiple_reactions",
        description: "Adds multiple emoji reactions to a Discord message at once",
        inputSchema: {
          type: "object",
          properties: {
            channelId: { type: "string" },
            messageId: { type: "string" },
            emojis: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["channelId", "messageId", "emojis"],
        },
      },
      {
        name: "discord_remove_reaction",
        description: "Removes a specific emoji reaction from a Discord message",
        inputSchema: {
          type: "object",
          properties: {
            channelId: { type: "string" },
            messageId: { type: "string" },
            emoji: { type: "string" },
            userId: { type: "string" },
          },
          required: ["channelId", "messageId", "emoji"],
        },
      },
      {
        name: "discord_delete_forum_post",
        description: "Deletes a forum post or thread with an optional reason",
        inputSchema: {
          type: "object",
          properties: {
            threadId: { type: "string" },
            reason: { type: "string" },
          },
          required: ["threadId"],
        },
      },
      {
        name: "discord_delete_message",
        description: "Deletes a specific message from a Discord text channel",
        inputSchema: {
          type: "object",
          properties: {
            channelId: { type: "string" },
            messageId: { type: "string" },
            reason: { type: "string" },
          },
          required: ["channelId", "messageId"],
        },
      },
      {
        name: "discord_create_webhook",
        description: "Creates a new webhook for a Discord channel",
        inputSchema: {
          type: "object",
          properties: {
            channelId: { type: "string" },
            name: { type: "string" },
            avatar: { type: "string" },
            reason: { type: "string" },
          },
          required: ["channelId", "name"],
        },
      },
      {
        name: "discord_send_webhook_message",
        description: "Sends a message to a Discord channel using a webhook",
        inputSchema: {
          type: "object",
          properties: {
            webhookId: { type: "string" },
            webhookToken: { type: "string" },
            content: { type: "string" },
            username: { type: "string" },
            avatarURL: { type: "string" },
            threadId: { type: "string" },
          },
          required: ["webhookId", "webhookToken", "content"],
        },
      },
      {
        name: "discord_edit_webhook",
        description: "Edits an existing webhook for a Discord channel",
        inputSchema: {
          type: "object",
          properties: {
            webhookId: { type: "string" },
            webhookToken: { type: "string" },
            name: { type: "string" },
            avatar: { type: "string" },
            channelId: { type: "string" },
            reason: { type: "string" },
          },
          required: ["webhookId"],
        },
      },
      {
        name: "discord_delete_webhook",
        description: "Deletes an existing webhook for a Discord channel",
        inputSchema: {
          type: "object",
          properties: {
            webhookId: { type: "string" },
            webhookToken: { type: "string" },
            reason: { type: "string" },
          },
          required: ["webhookId"],
        },
      },
    ],
  };
});

// Handle tool execution requests
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "test": {
        return {
          content: [{ type: "text", text: `test success` }],
        };
      }

      case "discord_login": {
        DiscordLoginSchema.parse(args);
        try {
          const token = config.DISCORD_TOKEN;
          if (!token) {
            return {
              content: [
                { type: "text", text: "Discord token not found in config. Make sure the --config parameter is correctly set." },
              ],
              isError: true,
            };
          }

          await client.login(token);
          return {
            content: [{ type: "text", text: `Successfully logged in to Discord : ${client.user?.tag}` }],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Login failed: ${error}` }],
            isError: true,
          };
        }
      }

      case "discord_send": {
        const { channelId, message } = SendMessageSchema.parse(args);
        try {
          if (!client.isReady()) {
            return {
              content: [{ type: "text", text: "Discord client not logged in. Please use discord_login tool first." }],
              isError: true,
            };
          }

          const channel = await client.channels.fetch(channelId);
          if (!channel || !channel.isTextBased()) {
            return {
              content: [{ type: "text", text: `Cannot find text channel ID: ${channelId}` }],
              isError: true,
            };
          }

          // Ensure channel is text-based and can send messages
          if ("send" in channel) {
            await channel.send(message);
            return {
              content: [{ type: "text", text: `Message successfully sent to channel ID: ${channelId}` }],
            };
          } else {
            return {
              content: [{ type: "text", text: `This channel type does not support sending messages` }],
              isError: true,
            };
          }
        } catch (error) {
          return {
            content: [{ type: "text", text: `Send message failed: ${error}` }],
            isError: true,
          };
        }
      }

      case "discord_get_forum_channels": {
        const { guildId } = GetForumChannelsSchema.parse(args);
        try {
          if (!client.isReady()) {
            return {
              content: [{ type: "text", text: "Discord client not logged in. Please use discord_login tool first." }],
              isError: true,
            };
          }

          const guild = await client.guilds.fetch(guildId);
          if (!guild) {
            return {
              content: [{ type: "text", text: `Cannot find guild with ID: ${guildId}` }],
              isError: true,
            };
          }

          // Fetch all channels from the guild
          const channels = await guild.channels.fetch();

          // Filter to get only forum channels
          const forumChannels = channels.filter((channel) => channel?.type === ChannelType.GuildForum);

          if (forumChannels.size === 0) {
            return {
              content: [{ type: "text", text: `No forum channels found in guild: ${guild.name}` }],
            };
          }

          // Format forum channels information
          const forumInfo = forumChannels.map((channel) => ({
            id: channel.id,
            name: channel.name,
            topic: channel.topic || "No topic set",
          }));

          return {
            content: [{ type: "text", text: JSON.stringify(forumInfo, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Failed to fetch forum channels: ${error}` }],
            isError: true,
          };
        }
      }

      case "discord_create_forum_post": {
        const { forumChannelId, title, content, tags } = CreateForumPostSchema.parse(args);
        try {
          if (!client.isReady()) {
            return {
              content: [{ type: "text", text: "Discord client not logged in. Please use discord_login tool first." }],
              isError: true,
            };
          }

          const channel = await client.channels.fetch(forumChannelId);
          if (!channel || channel.type !== ChannelType.GuildForum) {
            return {
              content: [{ type: "text", text: `Channel ID ${forumChannelId} is not a forum channel.` }],
              isError: true,
            };
          }

          const forumChannel = channel as ForumChannel;

          // Get available tags in the forum
          const availableTags = forumChannel.availableTags;
          let selectedTagIds: string[] = [];

          // If tags are provided, find their IDs
          if (tags && tags.length > 0) {
            selectedTagIds = availableTags.filter((tag) => tags.includes(tag.name)).map((tag) => tag.id);
          }

          // Create the forum post
          const thread = await forumChannel.threads.create({
            name: title,
            message: {
              content: content,
            },
            appliedTags: selectedTagIds.length > 0 ? selectedTagIds : undefined,
          });

          return {
            content: [
              {
                type: "text",
                text: `Successfully created forum post "${title}" with ID: ${thread.id}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Failed to create forum post: ${error}` }],
            isError: true,
          };
        }
      }

      case "discord_get_forum_post": {
        const { threadId } = GetForumPostSchema.parse(args);
        try {
          if (!client.isReady()) {
            return {
              content: [{ type: "text", text: "Discord client not logged in. Please use discord_login tool first." }],
              isError: true,
            };
          }

          const thread = await client.channels.fetch(threadId);
          if (!thread || !thread.isThread()) {
            return {
              content: [{ type: "text", text: `Cannot find thread with ID: ${threadId}` }],
              isError: true,
            };
          }

          // Get messages from the thread
          const messages = await thread.messages.fetch({ limit: 10 });

          const threadDetails = {
            id: thread.id,
            name: thread.name,
            parentId: thread.parentId,
            messageCount: messages.size,
            createdAt: thread.createdAt,
            messages: messages.map((msg) => ({
              id: msg.id,
              content: msg.content,
              author: msg.author.tag,
              createdAt: msg.createdAt,
            })),
          };

          return {
            content: [{ type: "text", text: JSON.stringify(threadDetails, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Failed to fetch forum post: ${error}` }],
            isError: true,
          };
        }
      }

      case "discord_reply_to_forum": {
        const { threadId, message } = ReplyToForumSchema.parse(args);
        try {
          if (!client.isReady()) {
            return {
              content: [{ type: "text", text: "Discord client not logged in. Please use discord_login tool first." }],
              isError: true,
            };
          }

          const thread = await client.channels.fetch(threadId);
          if (!thread || !thread.isThread()) {
            return {
              content: [{ type: "text", text: `Cannot find thread with ID: ${threadId}` }],
              isError: true,
            };
          }

          if (!("send" in thread)) {
            return {
              content: [{ type: "text", text: `This thread does not support sending messages` }],
              isError: true,
            };
          }

          // Send the reply
          const sentMessage = await thread.send(message);

          return {
            content: [
              {
                type: "text",
                text: `Successfully replied to forum post. Message ID: ${sentMessage.id}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Failed to reply to forum post: ${error}` }],
            isError: true,
          };
        }
      }

      case "discord_create_text_channel": {
        const { guildId, channelName, topic } = CreateTextChannelSchema.parse(args);
        try {
          if (!client.isReady()) {
            return {
              content: [{ type: "text", text: "Discord client not logged in. Please use discord_login tool first." }],
              isError: true,
            };
          }

          const guild = await client.guilds.fetch(guildId);
          if (!guild) {
            return {
              content: [{ type: "text", text: `Cannot find guild with ID: ${guildId}` }],
              isError: true,
            };
          }

          // Create the text channel
          const channel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            topic: topic,
          });

          return {
            content: [
              {
                type: "text",
                text: `Successfully created text channel "${channelName}" with ID: ${channel.id}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Failed to create text channel: ${error}` }],
            isError: true,
          };
        }
      }

      case "discord_delete_channel": {
        const { channelId, reason } = DeleteChannelSchema.parse(args);
        try {
          if (!client.isReady()) {
            return {
              content: [{ type: "text", text: "Discord client not logged in. Please use discord_login tool first." }],
              isError: true,
            };
          }

          const channel = await client.channels.fetch(channelId);
          if (!channel) {
            return {
              content: [{ type: "text", text: `Cannot find channel with ID: ${channelId}` }],
              isError: true,
            };
          }

          // Check if channel can be deleted (has delete method)
          if (!("delete" in channel)) {
            return {
              content: [{ type: "text", text: `This channel type does not support deletion or the bot lacks permissions` }],
              isError: true,
            };
          }

          // Delete the channel
          await channel.delete(reason || "Channel deleted via API");

          return {
            content: [
              {
                type: "text",
                text: `Successfully deleted channel with ID: ${channelId}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Failed to delete channel: ${error}` }],
            isError: true,
          };
        }
      }

      case "discord_read_messages": {
        const { channelId, limit } = ReadMessagesSchema.parse(args);
        try {
          if (!client.isReady()) {
            return {
              content: [{ type: "text", text: "Discord client not logged in. Please use discord_login tool first." }],
              isError: true,
            };
          }

          const channel = await client.channels.fetch(channelId);
          if (!channel) {
            return {
              content: [{ type: "text", text: `Cannot find channel with ID: ${channelId}` }],
              isError: true,
            };
          }

          // Check if channel has messages (text channel, thread, etc.)
          if (!channel.isTextBased() || !("messages" in channel)) {
            return {
              content: [{ type: "text", text: `Channel type does not support reading messages` }],
              isError: true,
            };
          }

          // Fetch messages
          const messages = await channel.messages.fetch({ limit });

          if (messages.size === 0) {
            return {
              content: [{ type: "text", text: `No messages found in channel` }],
            };
          }

          // Format messages
          const formattedMessages = messages
            .map((msg) => ({
              id: msg.id,
              content: msg.content,
              author: {
                id: msg.author.id,
                username: msg.author.username,
                bot: msg.author.bot,
              },
              timestamp: msg.createdAt,
              attachments: msg.attachments.size,
              embeds: msg.embeds.length,
              replyTo: msg.reference ? msg.reference.messageId : null,
            }))
            .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    channelId,
                    messageCount: formattedMessages.length,
                    messages: formattedMessages,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Failed to read messages: ${error}` }],
            isError: true,
          };
        }
      }

      case "discord_get_server_info": {
        const { guildId } = GetServerInfoSchema.parse(args);
        try {
          if (!client.isReady()) {
            return {
              content: [{ type: "text", text: "Discord client not logged in. Please use discord_login tool first." }],
              isError: true,
            };
          }

          const guild = await client.guilds.fetch(guildId);
          if (!guild) {
            return {
              content: [{ type: "text", text: `Cannot find guild with ID: ${guildId}` }],
              isError: true,
            };
          }

          // Fetch additional guild data
          await guild.fetch();

          // Fetch channel information
          const channels = await guild.channels.fetch();

          // Categorize channels by type
          const channelsByType = {
            text: channels.filter((c) => c?.type === ChannelType.GuildText).size,
            voice: channels.filter((c) => c?.type === ChannelType.GuildVoice).size,
            category: channels.filter((c) => c?.type === ChannelType.GuildCategory).size,
            forum: channels.filter((c) => c?.type === ChannelType.GuildForum).size,
            announcement: channels.filter((c) => c?.type === ChannelType.GuildAnnouncement).size,
            stage: channels.filter((c) => c?.type === ChannelType.GuildStageVoice).size,
            total: channels.size,
          };

          // Fetch member count
          const approximateMemberCount = guild.approximateMemberCount || "unknown";

          // Format guild information
          const guildInfo = {
            id: guild.id,
            name: guild.name,
            description: guild.description,
            icon: guild.iconURL(),
            owner: guild.ownerId,
            createdAt: guild.createdAt,
            memberCount: approximateMemberCount,
            channels: channelsByType,
            features: guild.features,
            premium: {
              tier: guild.premiumTier,
              subscriptions: guild.premiumSubscriptionCount,
            },
          };

          return {
            content: [{ type: "text", text: JSON.stringify(guildInfo, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Failed to fetch server info: ${error}` }],
            isError: true,
          };
        }
      }

      case "discord_add_reaction": {
        const { channelId, messageId, emoji } = AddReactionSchema.parse(args);
        try {
          if (!client.isReady()) {
            return {
              content: [{ type: "text", text: "Discord client not logged in. Please use discord_login tool first." }],
              isError: true,
            };
          }

          const channel = await client.channels.fetch(channelId);
          if (!channel || !channel.isTextBased() || !("messages" in channel)) {
            return {
              content: [{ type: "text", text: `Cannot find text channel with ID: ${channelId}` }],
              isError: true,
            };
          }

          const message = await channel.messages.fetch(messageId);
          if (!message) {
            return {
              content: [{ type: "text", text: `Cannot find message with ID: ${messageId}` }],
              isError: true,
            };
          }

          // Add the reaction
          await message.react(emoji);

          return {
            content: [
              {
                type: "text",
                text: `Successfully added reaction ${emoji} to message ID: ${messageId}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Failed to add reaction: ${error}` }],
            isError: true,
          };
        }
      }

      case "discord_add_multiple_reactions": {
        const { channelId, messageId, emojis } = AddMultipleReactionsSchema.parse(args);
        try {
          if (!client.isReady()) {
            return {
              content: [{ type: "text", text: "Discord client not logged in. Please use discord_login tool first." }],
              isError: true,
            };
          }

          const channel = await client.channels.fetch(channelId);
          if (!channel || !channel.isTextBased() || !("messages" in channel)) {
            return {
              content: [{ type: "text", text: `Cannot find text channel with ID: ${channelId}` }],
              isError: true,
            };
          }

          const message = await channel.messages.fetch(messageId);
          if (!message) {
            return {
              content: [{ type: "text", text: `Cannot find message with ID: ${messageId}` }],
              isError: true,
            };
          }

          // Add each reaction sequentially
          for (const emoji of emojis) {
            await message.react(emoji);
            // Small delay to prevent rate limiting
            await new Promise((resolve) => setTimeout(resolve, 300));
          }

          return {
            content: [
              {
                type: "text",
                text: `Successfully added ${emojis.length} reactions to message ID: ${messageId}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Failed to add reactions: ${error}` }],
            isError: true,
          };
        }
      }

      case "discord_remove_reaction": {
        const { channelId, messageId, emoji, userId } = RemoveReactionSchema.parse(args);
        try {
          if (!client.isReady()) {
            return {
              content: [{ type: "text", text: "Discord client not logged in. Please use discord_login tool first." }],
              isError: true,
            };
          }

          const channel = await client.channels.fetch(channelId);
          if (!channel || !channel.isTextBased() || !("messages" in channel)) {
            return {
              content: [{ type: "text", text: `Cannot find text channel with ID: ${channelId}` }],
              isError: true,
            };
          }

          const message = await channel.messages.fetch(messageId);
          if (!message) {
            return {
              content: [{ type: "text", text: `Cannot find message with ID: ${messageId}` }],
              isError: true,
            };
          }

          // Get the reactions
          const reactions = message.reactions.cache;

          // Find the specific reaction
          const reaction = reactions.find((r) => r.emoji.toString() === emoji || r.emoji.name === emoji);

          if (!reaction) {
            return {
              content: [{ type: "text", text: `Reaction ${emoji} not found on message ID: ${messageId}` }],
              isError: true,
            };
          }

          if (userId) {
            // Remove a specific user's reaction
            await reaction.users.remove(userId);
            return {
              content: [
                {
                  type: "text",
                  text: `Successfully removed reaction ${emoji} from user ID: ${userId} on message ID: ${messageId}`,
                },
              ],
            };
          } else {
            // Remove bot's reaction
            await reaction.users.remove(client.user.id);
            return {
              content: [
                {
                  type: "text",
                  text: `Successfully removed bot's reaction ${emoji} from message ID: ${messageId}`,
                },
              ],
            };
          }
        } catch (error) {
          return {
            content: [{ type: "text", text: `Failed to remove reaction: ${error}` }],
            isError: true,
          };
        }
      }

      case "discord_delete_forum_post": {
        const { threadId, reason } = DeleteForumPostSchema.parse(args);
        try {
          if (!client.isReady()) {
            return {
              content: [{ type: "text", text: "Discord client not logged in. Please use discord_login tool first." }],
              isError: true,
            };
          }

          const thread = await client.channels.fetch(threadId);
          if (!thread || !thread.isThread()) {
            return {
              content: [{ type: "text", text: `Cannot find forum post/thread with ID: ${threadId}` }],
              isError: true,
            };
          }

          // Delete the forum post/thread
          await thread.delete(reason || "Forum post deleted via API");

          return {
            content: [
              {
                type: "text",
                text: `Successfully deleted forum post/thread with ID: ${threadId}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Failed to delete forum post: ${error}` }],
            isError: true,
          };
        }
      }

      case "discord_delete_message": {
        const { channelId, messageId, reason } = DeleteMessageSchema.parse(args);
        try {
          if (!client.isReady()) {
            return {
              content: [{ type: "text", text: "Discord client not logged in. Please use discord_login tool first." }],
              isError: true,
            };
          }

          const channel = await client.channels.fetch(channelId);
          if (!channel || !channel.isTextBased() || !("messages" in channel)) {
            return {
              content: [{ type: "text", text: `Cannot find text channel with ID: ${channelId}` }],
              isError: true,
            };
          }

          // Fetch the message
          const message = await channel.messages.fetch(messageId);
          if (!message) {
            return {
              content: [{ type: "text", text: `Cannot find message with ID: ${messageId}` }],
              isError: true,
            };
          }

          // Delete the message
          await message.delete();

          return {
            content: [
              {
                type: "text",
                text: `Successfully deleted message with ID: ${messageId} from channel: ${channelId}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Failed to delete message: ${error}` }],
            isError: true,
          };
        }
      }

      case "discord_create_webhook": {
        const { channelId, name, avatar, reason } = CreateWebhookSchema.parse(args);
        try {
          if (!client.isReady()) {
            return {
              content: [{ type: "text", text: "Discord client not logged in. Please use discord_login tool first." }],
              isError: true,
            };
          }

          const channel = await client.channels.fetch(channelId);
          if (!channel || !channel.isTextBased()) {
            return {
              content: [{ type: "text", text: `Cannot find text channel with ID: ${channelId}` }],
              isError: true,
            };
          }

          // Check if the channel supports webhooks
          if (!("createWebhook" in channel)) {
            return {
              content: [{ type: "text", text: `Channel type does not support webhooks: ${channelId}` }],
              isError: true,
            };
          }

          // Create the webhook
          const webhook = await channel.createWebhook({
            name: name,
            avatar: avatar,
            reason: reason,
          });

          return {
            content: [
              {
                type: "text",
                text: `Successfully created webhook with ID: ${webhook.id} and token: ${webhook.token}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Failed to create webhook: ${error}` }],
            isError: true,
          };
        }
      }

      case "discord_send_webhook_message": {
        const { webhookId, webhookToken, content, username, avatarURL, threadId } = SendWebhookMessageSchema.parse(args);
        try {
          if (!client.isReady()) {
            return {
              content: [{ type: "text", text: "Discord client not logged in. Please use discord_login tool first." }],
              isError: true,
            };
          }

          const webhook = await client.fetchWebhook(webhookId, webhookToken);
          if (!webhook) {
            return {
              content: [{ type: "text", text: `Cannot find webhook with ID: ${webhookId}` }],
              isError: true,
            };
          }

          // Send the message
          await webhook.send({
            content: content,
            username: username,
            avatarURL: avatarURL,
            threadId: threadId,
          });

          return {
            content: [
              {
                type: "text",
                text: `Successfully sent webhook message to webhook ID: ${webhookId}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Failed to send webhook message: ${error}` }],
            isError: true,
          };
        }
      }

      case "discord_edit_webhook": {
        const { webhookId, webhookToken, name, avatar, channelId, reason } = EditWebhookSchema.parse(args);
        try {
          if (!client.isReady()) {
            return {
              content: [{ type: "text", text: "Discord client not logged in. Please use discord_login tool first." }],
              isError: true,
            };
          }

          const webhook = await client.fetchWebhook(webhookId, webhookToken);
          if (!webhook) {
            return {
              content: [{ type: "text", text: `Cannot find webhook with ID: ${webhookId}` }],
              isError: true,
            };
          }

          // Edit the webhook
          await webhook.edit({
            name: name,
            avatar: avatar,
            channel: channelId,
            reason: reason,
          });

          return {
            content: [
              {
                type: "text",
                text: `Successfully edited webhook with ID: ${webhook.id}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Failed to edit webhook: ${error}` }],
            isError: true,
          };
        }
      }

      case "discord_delete_webhook": {
        const { webhookId, webhookToken, reason } = DeleteWebhookSchema.parse(args);
        try {
          if (!client.isReady()) {
            return {
              content: [{ type: "text", text: "Discord client not logged in. Please use discord_login tool first." }],
              isError: true,
            };
          }

          const webhook = await client.fetchWebhook(webhookId, webhookToken);
          if (!webhook) {
            return {
              content: [{ type: "text", text: `Cannot find webhook with ID: ${webhookId}` }],
              isError: true,
            };
          }

          // Delete the webhook
          await webhook.delete(reason || "Webhook deleted via API");

          return {
            content: [
              {
                type: "text",
                text: `Successfully deleted webhook with ID: ${webhook.id}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Failed to delete webhook: ${error}` }],
            isError: true,
          };
        }
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        content: [
          {
            type: "text",
            text: `Invalid arguments: ${error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")}`,
          },
        ],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: `Error executing tool: ${error}` }],
      isError: true,
    };
  }
});
} // end registerHandlers

// Auto-login on startup if token is available
const autoLogin = async () => {
  const token = config.DISCORD_TOKEN;
  if (token) {
    try {
      await client.login(token);
    } catch (error) {
      console.error("Auto-login failed:", error);
    }
  } else {
    console.log("No Discord token found in config, skipping auto-login");
  }
};

// Start auto-login process
autoLogin();

const transportMode = process.env.MCP_TRANSPORT || "stdio";

if (transportMode === "http") {
  const app = express();
  app.use(express.json());
  const transports: Record<string, StreamableHTTPServerTransport> = {};

  app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports[sid] = transport;
        },
      });
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && transports[sid]) {
          delete transports[sid];
        }
      };
      const sessionServer = createServer();
      await sessionServer.connect(transport);
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: No valid session ID" },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  });

  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    await transports[sessionId].handleRequest(req, res);
  });

  app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    await transports[sessionId].handleRequest(req, res);
  });

  const port = parseInt(process.env.PORT || "3000", 10);
  app.listen(port, () => {
    console.log(`MCP Streamable HTTP server running on port ${port}`);
    console.log(`Endpoint: http://localhost:${port}/mcp`);
  });
} else {
  server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
