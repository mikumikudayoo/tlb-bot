import { Client, GatewayIntentBits } from 'discord.js';
import { setupDiscordHandlers } from './handlers';

export function createDiscordClient(gameLogic: any): Client {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  setupDiscordHandlers(client, gameLogic);
  return client;
}

export function loginDiscordClient(client: Client, token?: string): Promise<string> | Client {
  if (process.env.BOT_TEST_MODE === '1' || process.env.NODE_ENV === 'test') {
    return client;
  }
  return client.login(token ?? process.env.DISCORD_TOKEN);
}
