/** Resolve only this server's emojis; missing assets never leak raw :names:. */
export function getGuildEmojiObject(guild: any, name: string) {
  return guild?.emojis?.cache?.find((entry: any) => entry.available !== false && entry.name?.toLowerCase() === name.toLowerCase()) ?? null;
}

export function getGuildEmojiString(guild: any, name: string, fallback = ''): string {
  const emoji = getGuildEmojiObject(guild, name);
  return emoji ? `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>` : fallback;
}

export const STAT_EMOJIS = { fortitude: 'HPIcon', prudence: 'PrudenceIcon', temperance: 'TemperanceIcon', justice: 'JusticeIcon' } as const;

export function workButtonEmoji(guild: any, name: string) {
  const emoji = getGuildEmojiObject(guild, name);
  return emoji ? { id: emoji.id, name: emoji.name, animated: !!emoji.animated } : undefined;
}
