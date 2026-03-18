import { ChannelType } from "discord.js";
import { client } from "../discord.js";
import { CreateTextChannelSchema, DeleteChannelSchema, GetServerInfoSchema } from "../schemas.js";

export async function handleCreateTextChannel(args: unknown) {
  const { guildId, channelName, topic } = CreateTextChannelSchema.parse(args);
  if (!client.isReady()) {
    return { content: [{ type: "text", text: "Discord client not logged in. Please use discord_login tool first." }], isError: true };
  }

  const guild = await client.guilds.fetch(guildId);
  if (!guild) {
    return { content: [{ type: "text", text: `Cannot find guild with ID: ${guildId}` }], isError: true };
  }

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    topic: topic,
  });

  return { content: [{ type: "text", text: `Successfully created text channel "${channelName}" with ID: ${channel.id}` }] };
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
  const { guildId } = GetServerInfoSchema.parse(args);
  if (!client.isReady()) {
    return { content: [{ type: "text", text: "Discord client not logged in. Please use discord_login tool first." }], isError: true };
  }

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

  const guildInfo = {
    id: guild.id,
    name: guild.name,
    description: guild.description,
    icon: guild.iconURL(),
    owner: guild.ownerId,
    createdAt: guild.createdAt,
    memberCount: guild.approximateMemberCount || "unknown",
    channels: channelsByType,
    features: guild.features,
    premium: { tier: guild.premiumTier, subscriptions: guild.premiumSubscriptionCount },
  };

  return { content: [{ type: "text", text: JSON.stringify(guildInfo, null, 2) }] };
}
