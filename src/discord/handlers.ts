/**
 * Discord event handlers and command/button routing
 *
 * All Discord.js event handlers (ClientReady, InteractionCreate) are registered here.
 * This keeps the Discord layer separated from core game logic and startup.
 */

import { Client, Events, ButtonStyle, EmbedBuilder, ActionRowBuilder, ButtonBuilder } from 'discord.js';

/**
 * Set up all Discord event handlers for the bot client.
 * This is called once during bot startup in index.ts.
 */
export function setupDiscordHandlers(client: Client, gameLogic: any): void {
  // Store reference to game logic for access in event handlers
  const gl = gameLogic;

  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`wonderhooi!! ✨ logged in as ${readyClient.user.tag}!`);
    console.log('facility simulation v2 is online!! 🚀💖');

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
    try {
      if (!interaction.guildId || !interaction.guild) return;

      const facility = gl.ensureFacility(interaction.guildId, interaction.user.id);
      gl.seedAbnormalities(interaction.guildId);

      // Route to command or button handlers
      if (interaction.isChatInputCommand()) {
        await gl.handleCommand(interaction, facility);
      } else if (interaction.isButton()) {
        await gl.handleButton(interaction, facility);
      } else if (interaction.isStringSelectMenu()) {
        await gl.handleSelectMenu(interaction, facility);
      }
    } catch (err) {
      console.error('Unhandled interaction error:', err);
      if (interaction.isRepliable()) {
        const errorMsg = '💥 an error occurred while executing that operation!';
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: errorMsg, ephemeral: true }).catch(() => {});
        } else {
          await interaction.reply({ content: errorMsg, ephemeral: true }).catch(() => {});
        }
      }
    }
  });
}
