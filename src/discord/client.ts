import { Client, GatewayIntentBits } from 'discord.js';

export function createDiscordClient(): Client {
  return new Client({ intents: [GatewayIntentBits.Guilds] });
}

export function loginDiscordClient(client: Client, token?: string): Promise<string> | Client {
  if (process.env.BOT_TEST_MODE === '1' || process.env.NODE_ENV === 'test') {
    return client;
  }
  return client.login(token ?? process.env.DISCORD_TOKEN);
}
