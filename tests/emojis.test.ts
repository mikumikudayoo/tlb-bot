import { describe, expect, it } from 'bun:test';
import { getGuildEmojiString, workButtonEmoji, STAT_EMOJIS } from '../src/discord/emojis';
import { ButtonBuilder, ButtonStyle } from 'discord.js';

describe('server emoji rendering', () => {
  const guild = { emojis: { cache: [
    { name: 'Instinct', id: '123456789012345678', animated: false },
    { name: 'GoodResult', id: '223456789012345678', animated: true },
    { name: 'BadResult', id: '323456789012345678', available: false },
  ] } };
  it('renders static and animated names case-insensitively', () => {
    expect(getGuildEmojiString(guild, 'instinct', '❤️')).toBe('<:Instinct:123456789012345678>');
    expect(getGuildEmojiString(guild, 'GoodResult')).toBe('<a:GoodResult:223456789012345678>');
    expect(STAT_EMOJIS.fortitude).toBe('HPIcon');
  });
  it('falls back for missing, unavailable and other-server emojis', () => {
    expect(getGuildEmojiString(undefined, 'Instinct', '❤️')).toBe('❤️');
    expect(getGuildEmojiString(guild, 'BadResult', '😞')).toBe('😞');
    expect(getGuildEmojiString({ emojis: { cache: [] } }, 'Instinct', '❤️')).toBe('❤️');
  });
  it('uses the button emoji field, not a mention in the label', () => {
    const button = new ButtonBuilder().setCustomId('work').setStyle(ButtonStyle.Primary)
      .setLabel('instinct').setEmoji(workButtonEmoji(guild, 'Instinct')!).toJSON();
    expect('label' in button && button.label).toBe('instinct');
    expect('emoji' in button && button.emoji?.id).toBe('123456789012345678');
    expect(workButtonEmoji(guild, 'Insight')).toBeUndefined();
  });
});
