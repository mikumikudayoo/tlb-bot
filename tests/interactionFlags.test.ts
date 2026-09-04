import { describe, expect, it, spyOn } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MessageFlags } from 'discord.js';
import { routeDiscordInteraction } from '../src/discord/handlers';

describe('private interaction responses', () => {
  it('does not use the deprecated response option anywhere in application code', () => {
    const root = fileURLToPath(new URL('../', import.meta.url));
    function sources(directory: string): string[] {
      return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? sources(path) : entry.name.endsWith('.ts') ? [path] : [];
      });
    }
    for (const path of [join(root, 'index.ts'), ...sources(join(root, 'src'))]) {
      expect(readFileSync(path, 'utf8')).not.toMatch(/\bephemeral\s*:/);
    }
  });

  for (const state of ['fresh', 'replied', 'deferred']) {
    it(`keeps ${state} interaction errors private without deprecated options`, async () => {
      const responses: { method: string; payload: any }[] = [];
      const log = spyOn(console, 'error').mockImplementation(() => {});
      try {
        await routeDiscordInteraction({
          guildId: 'test', guild: {}, user: { id: 'player' },
          replied: state === 'replied', deferred: state === 'deferred',
          isRepliable: () => true,
          reply: async (payload: any) => { responses.push({ method: 'reply', payload }); },
          followUp: async (payload: any) => { responses.push({ method: 'followUp', payload }); },
        }, { ensureFacility: () => { throw new Error('test error'); } });
        expect(responses).toHaveLength(1);
        expect(responses[0]!.method).toBe(state === 'fresh' ? 'reply' : 'followUp');
        expect(responses[0]!.payload.flags).toBe(MessageFlags.Ephemeral);
        expect(responses[0]!.payload).not.toHaveProperty('ephemeral');
      } finally {
        log.mockRestore();
      }
    });
  }
});
