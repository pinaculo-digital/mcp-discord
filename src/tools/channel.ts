import { ChannelType } from "discord.js";
import { client } from "../discord.js";
import { config } from "../config.js";
import { ListGuildsSchema, ListChannelsSchema, CreateTextChannelSchema, DeleteChannelSchema, GetServerInfoSchema } from "../schemas.js";

function resolveGuildId(guildId?: string): string {
  const resolved = guildId || config.DISCORD_GUILD_ID;
  if (!resolved) {
    throw new Error("No guildId provided and no default DISCORD_GUILD_ID configured. Please provide a guildId or set DISCORD_GUILD_ID in the environment.");
  }
  return resolved;
}

const channelTypeName: Record<number, string> = {
  [ChannelType.GuildText]: "text",
  [ChannelType.GuildVoice]: "voice",
  [ChannelType.GuildCategory]: "category",
  [ChannelType.GuildAnnouncement]: "announcement",
  [ChannelType.GuildForum]: "forum",
  [ChannelType.GuildStageVoice]: "stage",
  [ChannelType.GuildDirectory]: "directory",
  [ChannelType.GuildMedia]: "media",
};

export async function handleListGuilds(args: unknown) {
  ListGuildsSchema.parse(args);
  if (!client.isReady()) {
    return { content: [{ type: "text", text: "Discord client not logged in. Please use discord_login tool first." }], isError: true };
  }

  const guilds = await client.guilds.fetch();
  const guildList = guilds.map((g) => ({
    id: g.id,
    name: g.name,
    icon: g.iconURL(),
  }));

  const defaultGuild = config.DISCORD_GUILD_ID;
  const result = {
    guilds: guildList,
    defaultGuildId: defaultGuild || null,
    hint: "Use discord_list_channels with a guildId to see all channels in a server, or discord_get_server_info for detailed server information.",
  };

  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}

export async function handleListChannels(args: unknown) {
  const parsed = ListChannelsSchema.parse(args);
  if (!client.isReady()) {
    return { content: [{ type: "text", text: "Discord client not logged in. Please use discord_login tool first." }], isError: true };
  }

  const guildId = resolveGuildId(parsed.guildId);
  const guild = await client.guilds.fetch(guildId);
  if (!guild) {
    return { content: [{ type: "text", text: `Cannot find guild with ID: ${guildId}` }], isError: true };
  }

  const channels = await guild.channels.fetch();
  const channelList = channels
    .filter((c) => c !== null)
    .map((c) => ({
      id: c!.id,
      name: c!.name,
      type: channelTypeName[c!.type] || `unknown(${c!.type})`,
      parentId: c!.parentId || null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const result = {
    guildId,
    guildName: guild.name,
    channels: channelList,
    hint: "Use discord_read_messages with a channelId to read messages from a text channel.",
  };

  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}

export async function handleCreateTextChannel(args: unknown) {
  const parsed = CreateTextChannelSchema.parse(args);
  if (!client.isReady()) {
    return { content: [{ type: "text", text: "Discord client not logged in. Please use discord_login tool first." }], isError: true };
  }

  const guildId = resolveGuildId(parsed.guildId);
  const guild = await client.guilds.fetch(guildId);
  if (!guild) {
    return { content: [{ type: "text", text: `Cannot find guild with ID: ${guildId}` }], isError: true };
  }

  const channel = await guild.channels.create({
    name: parsed.channelName,
    type: ChannelType.GuildText,
    topic: parsed.topic,
  });

  return { content: [{ type: "text", text: `Successfully created text channel "${parsed.channelName}" with ID: ${channel.id}` }] };
}

export async function handleDeleteChannel(args: unknown) {
  const { channelId, reason } = DeleteChannelSchema.parse(args);
  if (!client.isReady()) {
    return { content: [{ type: "text", text: "Discord client not logged in. Please use discord_login tool first." }], isError: true };
  }

  const channel = await client.channels.fetch(channelId);
  if (!channel) {
    return { content: [{ type: "text", text: `Cannot find channel with ID: ${channelId}` }], isError: true };
  }

  if (!("delete" in channel)) {
    return { content: [{ type: "text", text: `This channel type does not support deletion or the bot lacks permissions` }], isError: true };
  }

  await channel.delete(reason || "Channel deleted via API");
  return { content: [{ type: "text", text: `Successfully deleted channel with ID: ${channelId}` }] };
}

export async function handleGetServerInfo(args: unknown) {
  const parsed = GetServerInfoSchema.parse(args);
  if (!client.isReady()) {
    return { content: [{ type: "text", text: "Discord client not logged in. Please use discord_login tool first." }], isError: true };
  }

  const guildId = resolveGuildId(parsed.guildId);
  const guild = await client.guilds.fetch(guildId);
  if (!guild) {
    return { content: [{ type: "text", text: `Cannot find guild with ID: ${guildId}` }], isError: true };
  }

  await guild.fetch();
  const channels = await guild.channels.fetch();

  const channelsByType = {
    text: channels.filter((c) => c?.type === ChannelType.GuildText).size,
    voice: channels.filter((c) => c?.type === ChannelType.GuildVoice).size,
    category: channels.filter((c) => c?.type === ChannelType.GuildCategory).size,
    forum: channels.filter((c) => c?.type === ChannelType.GuildForum).size,
    announcement: channels.filter((c) => c?.type === ChannelType.GuildAnnouncement).size,
    stage: channels.filter((c) => c?.type === ChannelType.GuildStageVoice).size,
    total: channels.size,
  };

  const channelList = channels
    .filter((c) => c !== null)
    .map((c) => ({
      id: c!.id,
      name: c!.name,
      type: channelTypeName[c!.type] || `unknown(${c!.type})`,
      parentId: c!.parentId || null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const guildInfo = {
    id: guild.id,
    name: guild.name,
    description: guild.description,
    icon: guild.iconURL(),
    owner: guild.ownerId,
    createdAt: guild.createdAt,
    memberCount: guild.approximateMemberCount || "unknown",
    channelCounts: channelsByType,
    channels: channelList,
    features: guild.features,
    premium: { tier: guild.premiumTier, subscriptions: guild.premiumSubscriptionCount },
  };

  return { content: [{ type: "text", text: JSON.stringify(guildInfo, null, 2) }] };
}
