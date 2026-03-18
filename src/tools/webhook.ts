import { client } from "../discord.js";
import { CreateWebhookSchema, SendWebhookMessageSchema, EditWebhookSchema, DeleteWebhookSchema } from "../schemas.js";

export async function handleCreateWebhook(args: unknown) {
  const { channelId, name, avatar, reason } = CreateWebhookSchema.parse(args);
  if (!client.isReady()) {
    return { content: [{ type: "text", text: "Discord client not logged in. Please use discord_login tool first." }], isError: true };
  }

  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased()) {
    return { content: [{ type: "text", text: `Cannot find text channel with ID: ${channelId}` }], isError: true };
  }

  if (!("createWebhook" in channel)) {
    return { content: [{ type: "text", text: `Channel type does not support webhooks: ${channelId}` }], isError: true };
  }

  const webhook = await channel.createWebhook({ name, avatar, reason });
  return { content: [{ type: "text", text: `Successfully created webhook with ID: ${webhook.id} and token: ${webhook.token}` }] };
}

export async function handleSendWebhookMessage(args: unknown) {
  const { webhookId, webhookToken, content, username, avatarURL, threadId } = SendWebhookMessageSchema.parse(args);
  if (!client.isReady()) {
    return { content: [{ type: "text", text: "Discord client not logged in. Please use discord_login tool first." }], isError: true };
  }

  const webhook = await client.fetchWebhook(webhookId, webhookToken);
  if (!webhook) {
    return { content: [{ type: "text", text: `Cannot find webhook with ID: ${webhookId}` }], isError: true };
  }

  await webhook.send({ content, username, avatarURL, threadId });
  return { content: [{ type: "text", text: `Successfully sent webhook message to webhook ID: ${webhookId}` }] };
}

export async function handleEditWebhook(args: unknown) {
  const { webhookId, webhookToken, name, avatar, channelId, reason } = EditWebhookSchema.parse(args);
  if (!client.isReady()) {
    return { content: [{ type: "text", text: "Discord client not logged in. Please use discord_login tool first." }], isError: true };
  }

  const webhook = await client.fetchWebhook(webhookId, webhookToken);
  if (!webhook) {
    return { content: [{ type: "text", text: `Cannot find webhook with ID: ${webhookId}` }], isError: true };
  }

  await webhook.edit({ name, avatar, channel: channelId, reason });
  return { content: [{ type: "text", text: `Successfully edited webhook with ID: ${webhook.id}` }] };
}

export async function handleDeleteWebhook(args: unknown) {
  const { webhookId, webhookToken, reason } = DeleteWebhookSchema.parse(args);
  if (!client.isReady()) {
    return { content: [{ type: "text", text: "Discord client not logged in. Please use discord_login tool first." }], isError: true };
  }

  const webhook = await client.fetchWebhook(webhookId, webhookToken);
  if (!webhook) {
    return { content: [{ type: "text", text: `Cannot find webhook with ID: ${webhookId}` }], isError: true };
  }

  await webhook.delete(reason || "Webhook deleted via API");
  return { content: [{ type: "text", text: `Successfully deleted webhook with ID: ${webhook.id}` }] };
}
