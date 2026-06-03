import { ChannelType, ForumChannel, AnyThreadChannel } from "discord.js";
import { client } from "../discord.js";
import { config } from "../config.js";
import { GetForumChannelsSchema, CreateForumPostSchema, GetForumPostSchema, ListForumThreadsSchema, ReplyToForumSchema, DeleteForumPostSchema } from "../schemas.js";
import { serializeAttachments, serializeEmbeds } from "./message-format.js";

export async function handleGetForumChannels(args: unknown) {
  const parsed = GetForumChannelsSchema.parse(args);
  if (!client.isReady()) {
    return { content: [{ type: "text", text: "Discord client not logged in. Please use discord_login tool first." }], isError: true };
  }

  const guildId = parsed.guildId || config.DISCORD_GUILD_ID;
  if (!guildId) {
    return { content: [{ type: "text", text: "No guildId provided and no default DISCORD_GUILD_ID configured." }], isError: true };
  }

  const guild = await client.guilds.fetch(guildId);
  if (!guild) {
    return { content: [{ type: "text", text: `Cannot find guild with ID: ${guildId}` }], isError: true };
  }

  const channels = await guild.channels.fetch();
  const forumChannels = channels.filter((channel) => channel?.type === ChannelType.GuildForum);

  if (forumChannels.size === 0) {
    return { content: [{ type: "text", text: `No forum channels found in guild: ${guild.name}` }] };
  }

  const forumInfo = forumChannels.map((channel) => ({
    id: channel.id,
    name: channel.name,
    topic: channel.topic || "No topic set",
  }));

  return { content: [{ type: "text", text: JSON.stringify(forumInfo, null, 2) }] };
}

export async function handleCreateForumPost(args: unknown) {
  const { forumChannelId, title, content, tags } = CreateForumPostSchema.parse(args);
  if (!client.isReady()) {
    return { content: [{ type: "text", text: "Discord client not logged in. Please use discord_login tool first." }], isError: true };
  }

  const channel = await client.channels.fetch(forumChannelId);
  if (!channel || channel.type !== ChannelType.GuildForum) {
    return { content: [{ type: "text", text: `Channel ID ${forumChannelId} is not a forum channel.` }], isError: true };
  }

  const forumChannel = channel as ForumChannel;
  const availableTags = forumChannel.availableTags;
  let selectedTagIds: string[] = [];

  if (tags && tags.length > 0) {
    selectedTagIds = availableTags.filter((tag) => tags.includes(tag.name)).map((tag) => tag.id);
  }

  const thread = await forumChannel.threads.create({
    name: title,
    message: { content: content },
    appliedTags: selectedTagIds.length > 0 ? selectedTagIds : undefined,
  });

  return { content: [{ type: "text", text: `Successfully created forum post "${title}" with ID: ${thread.id}` }] };
}

export async function handleListForumThreads(args: unknown) {
  const { forumChannelId, includeArchived } = ListForumThreadsSchema.parse(args);
  if (!client.isReady()) {
    return { content: [{ type: "text", text: "Discord client not logged in. Please use discord_login tool first." }], isError: true };
  }

  const channel = await client.channels.fetch(forumChannelId);
  if (!channel || channel.type !== ChannelType.GuildForum) {
    return { content: [{ type: "text", text: `Channel ID ${forumChannelId} is not a forum channel.` }], isError: true };
  }

  const forumChannel = channel as ForumChannel;
  const tagNameById = new Map(forumChannel.availableTags.map((tag) => [tag.id, tag.name]));

  const threads = new Map<string, AnyThreadChannel>();
  const active = await forumChannel.threads.fetchActive();
  active.threads.forEach((thread) => threads.set(thread.id, thread));

  if (includeArchived) {
    let before: AnyThreadChannel | undefined;
    let hasMore = true;
    let guard = 0;
    while (hasMore && guard < 50) {
      const archived = await forumChannel.threads.fetchArchived({ type: "public", limit: 100, before });
      archived.threads.forEach((thread) => threads.set(thread.id, thread));
      const last = archived.threads.last();
      hasMore = archived.hasMore && last !== undefined;
      before = last;
      guard++;
    }
  }

  const threadList = [...threads.values()]
    .map((thread) => ({
      id: thread.id,
      name: thread.name,
      archived: thread.archived ?? false,
      locked: thread.locked ?? false,
      messageCount: thread.messageCount ?? 0,
      createdAt: thread.createdAt,
      lastMessageId: thread.lastMessageId,
      tags: thread.appliedTags.map((tagId) => tagNameById.get(tagId) ?? tagId),
    }))
    .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));

  const result = {
    forumChannelId,
    forumName: forumChannel.name,
    threadCount: threadList.length,
    threads: threadList,
    hint: "Use discord_get_forum_post with a thread id to read the post content and its messages.",
  };

  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}

export async function handleGetForumPost(args: unknown) {
  const { threadId } = GetForumPostSchema.parse(args);
  if (!client.isReady()) {
    return { content: [{ type: "text", text: "Discord client not logged in. Please use discord_login tool first." }], isError: true };
  }

  const thread = await client.channels.fetch(threadId);
  if (!thread || !thread.isThread()) {
    return { content: [{ type: "text", text: `Cannot find thread with ID: ${threadId}` }], isError: true };
  }

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
      attachments: serializeAttachments(msg),
      embeds: serializeEmbeds(msg),
    })),
  };

  return { content: [{ type: "text", text: JSON.stringify(threadDetails, null, 2) }] };
}

export async function handleReplyToForum(args: unknown) {
  const { threadId, message } = ReplyToForumSchema.parse(args);
  if (!client.isReady()) {
    return { content: [{ type: "text", text: "Discord client not logged in. Please use discord_login tool first." }], isError: true };
  }

  const thread = await client.channels.fetch(threadId);
  if (!thread || !thread.isThread()) {
    return { content: [{ type: "text", text: `Cannot find thread with ID: ${threadId}` }], isError: true };
  }

  if (!("send" in thread)) {
    return { content: [{ type: "text", text: `This thread does not support sending messages` }], isError: true };
  }

  const sentMessage = await thread.send(message);
  return { content: [{ type: "text", text: `Successfully replied to forum post. Message ID: ${sentMessage.id}` }] };
}

export async function handleDeleteForumPost(args: unknown) {
  const { threadId, reason } = DeleteForumPostSchema.parse(args);
  if (!client.isReady()) {
    return { content: [{ type: "text", text: "Discord client not logged in. Please use discord_login tool first." }], isError: true };
  }

  const thread = await client.channels.fetch(threadId);
  if (!thread || !thread.isThread()) {
    return { content: [{ type: "text", text: `Cannot find forum post/thread with ID: ${threadId}` }], isError: true };
  }

  await thread.delete(reason || "Forum post deleted via API");
  return { content: [{ type: "text", text: `Successfully deleted forum post/thread with ID: ${threadId}` }] };
}
