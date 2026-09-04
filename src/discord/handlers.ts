/**
 * Discord event handlers and command/button routing
 *
 * All Discord.js event handlers (ClientReady, InteractionCreate) are registered here.
 * This keeps the Discord layer separated from core game logic and startup.
 */

import { Client, Events, MessageFlags } from 'discord.js';
import { createInteractionHandlers } from './interactionHandlers';

/**
 * Set up all Discord event handlers for the bot client.
 * This is called once during bot startup in index.ts.
 */
export async function routeDiscordInteraction(interaction: any, gl: any): Promise<void> {
  try {
    if (!interaction.guildId || !interaction.guild) return;

    const facility = gl.ensureFacility(interaction.guildId, interaction.user.id);
    gl.seedAbnormalities(interaction.guildId);

    const handlers = createInteractionHandlers(gl);

    if (interaction.isChatInputCommand()) {
      await handlers.handleCommand(interaction, facility);
    } else if (interaction.isButton()) {
      await handlers.handleButton(interaction, facility);
    } else if (interaction.isStringSelectMenu()) {
      await handlers.handleSelectMenu(interaction, facility);
    }
  } catch (err) {
    console.error('Unhandled interaction error:', err);
    if (interaction.isRepliable()) {
      const errorMsg = '💥 something went wrong. check whether the action went through before trying again.';
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: errorMsg, flags: MessageFlags.Ephemeral }).catch(() => {});
      } else {
        await interaction.reply({ content: errorMsg, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
  }
}

export function setupDiscordHandlers(client: Client, gameLogic: any): void {
  // Store reference to game logic for access in event handlers
  const gl = gameLogic;

  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`✨ logged in as ${readyClient.user.tag}`);
    console.log('facility is online. ready for the next shift 🎪');

    // Repair/recreate persisted facility channels after restarts or manual deletion.
    for (const guild of readyClient.guilds.cache.values()) {
      try {
        const facility = gl.db.query(`SELECT * FROM facility WHERE guild_id=?`).get(guild.id) as any;
        if (!facility || !Number(facility.is_started)) continue;
        await gl.ensureFacilityChannels(guild, facility);
      } catch (error) {
        console.error(`channel recovery failed for guild ${guild.id}:`, error);
      }
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    await routeDiscordInteraction(interaction, gl);
  });
}
