import { client } from "../discord.js";
import { SendMessageSchema, ReadMessagesSchema, DeleteMessageSchema } from "../schemas.js";

export async function handleDiscordSend(args: unknown) {
  const { channelId, message } = SendMessageSchema.parse(args);
  if (!client.isReady()) {
    return { content: [{ type: "text", text: "Discord client not logged in. Please use discord_login tool first." }], isError: true };
  }

  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased()) {
    return { content: [{ type: "text", text: `Cannot find text channel ID: ${channelId}` }], isError: true };
  }

  if ("send" in channel) {
    await channel.send(message);
    return { content: [{ type: "text", text: `Message successfully sent to channel ID: ${channelId}` }] };
  } else {
    return { content: [{ type: "text", text: `This channel type does not support sending messages` }], isError: true };
  }
}

export async function handleReadMessages(args: unknown) {
  const { channelId, limit } = ReadMessagesSchema.parse(args);
  if (!client.isReady()) {
    return { content: [{ type: "text", text: "Discord client not logged in. Please use discord_login tool first." }], isError: true };
  }

  const channel = await client.channels.fetch(channelId);
  if (!channel) {
    return { content: [{ type: "text", text: `Cannot find channel with ID: ${channelId}` }], isError: true };
  }

  if (!channel.isTextBased() || !("messages" in channel)) {
    return { content: [{ type: "text", text: `Channel type does not support reading messages` }], isError: true };
  }

  const messages = await channel.messages.fetch({ limit });

  if (messages.size === 0) {
    return { content: [{ type: "text", text: `No messages found in channel` }] };
  }

  const formattedMessages = messages
    .map((msg) => ({
      id: msg.id,
      content: msg.content,
      author: { id: msg.author.id, username: msg.author.username, bot: msg.author.bot },
      timestamp: msg.createdAt,
      attachments: msg.attachments.size,
      embeds: msg.embeds.length,
      replyTo: msg.reference ? msg.reference.messageId : null,
    }))
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  return {
    content: [{ type: "text", text: JSON.stringify({ channelId, messageCount: formattedMessages.length, messages: formattedMessages }, null, 2) }],
  };
}

export async function handleDeleteMessage(args: unknown) {
  const { channelId, messageId } = DeleteMessageSchema.parse(args);
  if (!client.isReady()) {
    return { content: [{ type: "text", text: "Discord client not logged in. Please use discord_login tool first." }], isError: true };
  }

  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased() || !("messages" in channel)) {
    return { content: [{ type: "text", text: `Cannot find text channel with ID: ${channelId}` }], isError: true };
  }

  const message = await channel.messages.fetch(messageId);
  if (!message) {
    return { content: [{ type: "text", text: `Cannot find message with ID: ${messageId}` }], isError: true };
  }

  await message.delete();
  return { content: [{ type: "text", text: `Successfully deleted message with ID: ${messageId} from channel: ${channelId}` }] };
}
