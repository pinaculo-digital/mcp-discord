import { Message } from "discord.js";

// Discord CDN URLs are signed (ex/is/hm query params) and EXPIRE.
// Return them fresh as fetched — never cache or rewrite. Consumers must
// download attachments promptly before the signature lapses.
export function serializeAttachments(message: Message) {
  return [...message.attachments.values()].map((a) => ({
    id: a.id,
    name: a.name,
    url: a.url,
    proxyURL: a.proxyURL,
    contentType: a.contentType ?? null,
    size: a.size,
    width: a.width ?? null,
    height: a.height ?? null,
    description: a.description ?? null,
  }));
}

export function serializeEmbeds(message: Message) {
  return message.embeds.map((e) => ({
    type: e.data.type ?? null,
    title: e.title ?? null,
    description: e.description ?? null,
    url: e.url ?? null,
    image: e.image?.url ?? null,
    thumbnail: e.thumbnail?.url ?? null,
    video: e.video?.url ?? null,
  }));
}
