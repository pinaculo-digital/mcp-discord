import { client } from "../discord.js";
import { AddReactionSchema, AddMultipleReactionsSchema, RemoveReactionSchema } from "../schemas.js";

export async function handleAddReaction(args: unknown) {
  const { channelId, messageId, emoji } = AddReactionSchema.parse(args);
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

  await message.react(emoji);
  return { content: [{ type: "text", text: `Successfully added reaction ${emoji} to message ID: ${messageId}` }] };
}

export async function handleAddMultipleReactions(args: unknown) {
  const { channelId, messageId, emojis } = AddMultipleReactionsSchema.parse(args);
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

  for (const emoji of emojis) {
    await message.react(emoji);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return { content: [{ type: "text", text: `Successfully added ${emojis.length} reactions to message ID: ${messageId}` }] };
}

export async function handleRemoveReaction(args: unknown) {
  const { channelId, messageId, emoji, userId } = RemoveReactionSchema.parse(args);
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

  const reactions = message.reactions.cache;
  const reaction = reactions.find((r) => r.emoji.toString() === emoji || r.emoji.name === emoji);

  if (!reaction) {
    return { content: [{ type: "text", text: `Reaction ${emoji} not found on message ID: ${messageId}` }], isError: true };
  }

  if (userId) {
    await reaction.users.remove(userId);
    return { content: [{ type: "text", text: `Successfully removed reaction ${emoji} from user ID: ${userId} on message ID: ${messageId}` }] };
  } else {
    await reaction.users.remove(client.user!.id);
    return { content: [{ type: "text", text: `Successfully removed bot's reaction ${emoji} from message ID: ${messageId}` }] };
  }
}
