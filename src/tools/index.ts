import { z } from "zod";
import { client } from "../discord.js";
import { config } from "../config.js";
import { DiscordLoginSchema } from "../schemas.js";
import { toolDefinitions } from "./definitions.js";
import { handleDiscordSend, handleReadMessages, handleDeleteMessage } from "./message.js";
import { handleCreateTextChannel, handleDeleteChannel, handleGetServerInfo } from "./channel.js";
import { handleGetForumChannels, handleCreateForumPost, handleGetForumPost, handleReplyToForum, handleDeleteForumPost } from "./forum.js";
import { handleAddReaction, handleAddMultipleReactions, handleRemoveReaction } from "./reaction.js";
import { handleCreateWebhook, handleSendWebhookMessage, handleEditWebhook, handleDeleteWebhook } from "./webhook.js";

export { toolDefinitions };

type ToolResponse = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};

type ToolHandler = (args: unknown) => Promise<ToolResponse>;

async function handleTest(): Promise<ToolResponse> {
  return { content: [{ type: "text", text: "test success" }] };
}

async function handleDiscordLogin(args: unknown): Promise<ToolResponse> {
  DiscordLoginSchema.parse(args);
  const token = config.DISCORD_TOKEN;
  if (!token) {
    return {
      content: [{ type: "text", text: "Discord token not found in config. Make sure the --config parameter is correctly set." }],
      isError: true,
    };
  }
  await client.login(token);
  return { content: [{ type: "text", text: `Successfully logged in to Discord : ${client.user?.tag}` }] };
}

const handlers: Record<string, ToolHandler> = {
  test: handleTest,
  discord_login: handleDiscordLogin,
  discord_send: handleDiscordSend,
  discord_read_messages: handleReadMessages,
  discord_delete_message: handleDeleteMessage,
  discord_create_text_channel: handleCreateTextChannel,
  discord_delete_channel: handleDeleteChannel,
  discord_get_server_info: handleGetServerInfo,
  discord_get_forum_channels: handleGetForumChannels,
  discord_create_forum_post: handleCreateForumPost,
  discord_get_forum_post: handleGetForumPost,
  discord_reply_to_forum: handleReplyToForum,
  discord_delete_forum_post: handleDeleteForumPost,
  discord_add_reaction: handleAddReaction,
  discord_add_multiple_reactions: handleAddMultipleReactions,
  discord_remove_reaction: handleRemoveReaction,
  discord_create_webhook: handleCreateWebhook,
  discord_send_webhook_message: handleSendWebhookMessage,
  discord_edit_webhook: handleEditWebhook,
  discord_delete_webhook: handleDeleteWebhook,
};

export async function handleToolCall(name: string, args: unknown): Promise<ToolResponse> {
  try {
    const handler = handlers[name];
    if (!handler) {
      throw new Error(`Unknown tool: ${name}`);
    }
    return await handler(args);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        content: [{ type: "text", text: `Invalid arguments: ${error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")}` }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: `Error executing tool: ${error}` }],
      isError: true,
    };
  }
}
