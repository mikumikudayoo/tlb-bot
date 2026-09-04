import { describe, expect, it } from 'bun:test';
import { MessageFlags } from 'discord.js';
import { HELP_TOPICS, helpCommand, handleHelpCommand } from '../src/discord/helpCommand';

async function replyFor(topic: string | null = null) {
  let reply: any;
  await handleHelpCommand({ options: { getString: () => topic }, reply: async (payload: any) => { reply = payload; } });
  return reply;
}

describe('player guide /help', () => {
  it('registers every guide chapter as an optional choice', () => {
    const command = helpCommand.toJSON();
    expect(command.name).toBe('help');
    const option = command.options![0] as any;
    expect(option.required).not.toBe(true);
    expect(option.choices).toHaveLength(HELP_TOPICS.length);
    expect(HELP_TOPICS.length).toBeLessThanOrEqual(25);
    expect(new Set(HELP_TOPICS.map(t => t.value)).size).toBe(HELP_TOPICS.length);
  });

  it('shows getting started privately without requiring an agent or facility', async () => {
    const reply = await replyFor();
    expect(reply.flags).toBe(MessageFlags.Ephemeral);
    expect(reply).not.toHaveProperty('ephemeral');
    expect(reply.embeds[0].toJSON().description).toContain('/join');
    expect(reply.embeds[0].toJSON().title).toContain('getting started');
  });

  it('renders every chapter within Discord limits and converts tables', async () => {
    for (const topic of HELP_TOPICS) {
      const reply = await replyFor(topic.value);
      expect(reply.flags).toBe(MessageFlags.Ephemeral);
      expect(reply).not.toHaveProperty('ephemeral');
      const embeds = reply.embeds.map((embed: any) => embed.toJSON());
      expect(embeds.length).toBeLessThanOrEqual(10);
      let total = 0;
      for (const embed of embeds) {
        expect(embed.description.length).toBeGreaterThan(0);
        expect(embed.description.length).toBeLessThanOrEqual(4096);
        expect(embed.description).not.toMatch(/^\|/m);
        total += embed.title.length + embed.description.length + embed.footer.text.length;
      }
      expect(total).toBeLessThanOrEqual(6000);
    }
  });

  it('rejects unknown topics privately', async () => {
    const reply = await replyFor('not-a-topic');
    expect(reply.flags).toBe(MessageFlags.Ephemeral);
    expect(reply).not.toHaveProperty('ephemeral');
    expect(reply.content).toContain('unknown guide topic');
  });

  it('keeps the existing topic values so help still works without redeploying', () => {
    expect(HELP_TOPICS.map(topic => topic.value)).toEqual([
      'getting-started', 'abnormalities-and-work', 'stats-lob-and-cards',
      'e-g-o-equipment-and-gifts', 'stims-and-research', 'meltdowns-and-ordeals',
      'departments-and-core-suppression', 'recruitment-and-manager-tests', 'panic-death-and-saves',
    ]);
  });
});
