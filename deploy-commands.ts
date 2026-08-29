import { REST, Routes, SlashCommandBuilder } from 'discord.js';

const commands = [
  new SlashCommandBuilder()
    .setName('join')
    .setDescription('join the facility as a new agent!'),

  new SlashCommandBuilder()
    .setName('start-game')
    .setDescription('manager only: initialize channels and start the session! 🚀'),

  new SlashCommandBuilder()
    .setName('pause')
    .setDescription('manager only: pause or resume facility operations! ⏸️'),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('view your current agent status, facility stats, and active threats!'),

  new SlashCommandBuilder()
    .setName('facility')
    .setDescription('view the full facility dashboard!'),

  new SlashCommandBuilder()
    .setName('work')
    .setDescription('work on an abnormality and generate energy!')
    .addStringOption(opt =>
      opt
        .setName('abnormality')
        .setDescription('abnormality name or ID (leave blank to use the menu)')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt
        .setName('type')
        .setDescription('type of work (leave blank to choose with buttons)')
        .addChoices(
          { name: '❤️ instinct', value: 'instinct' },
          { name: '👁️ insight', value: 'insight' },
          { name: '💜 attachment', value: 'attachment' },
          { name: '⚙️ repression', value: 'repression' }
        )
        .setRequired(false)
    )
    .addIntegerOption(opt =>
      opt
        .setName('level')
        .setDescription('work level, 1-4 — higher is riskier but pays out more (leave blank to choose with buttons)')
        .setMinValue(1)
        .setMaxValue(4)
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('gifts')
    .setDescription('view your E.G.O. gift collection! 💠'),

  new SlashCommandBuilder()
    .setName('equip-gift')
    .setDescription('equip (or unequip) an E.G.O. gift you own! 💠')
    .addStringOption(opt =>
      opt
        .setName('gift')
        .setDescription('gift name to equip, or "none" to unequip')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('end-day')
    .setDescription('trigger the vote to end the day! ☀️'),

  new SlashCommandBuilder()
    .setName('dictator-toggle')
    .setDescription('manager only: toggle dictator voting mode! 👑'),

  new SlashCommandBuilder()
    .setName('heal-all')
    .setDescription('manager only: restore HP/SP and remove panic from all living agents! 💖'),

  new SlashCommandBuilder()
    .setName('upgrade')
    .setDescription('manager only: spend resources on a facility upgrade!')
    .addStringOption(opt =>
      opt
        .setName('type')
        .setDescription('upgrade category')
        .addChoices(
          { name: '🔒 containment', value: 'containment' },
          { name: '🧪 research', value: 'research' },
          { name: '🛡️ security', value: 'security' },
          { name: '❤️ welfare', value: 'welfare' }
        )
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('history')
    .setDescription('view the facility incident history!'),

  new SlashCommandBuilder()
    .setName('departments')
    .setDescription('view department routes and unlock progress!'),

  new SlashCommandBuilder()
    .setName('travel')
    .setDescription('move to an unlocked department sector!')
    .addStringOption(opt =>
      opt
        .setName('department')
        .setDescription('department to move to')
        .addChoices(
          { name: 'Control', value: 'control' },
          { name: 'Information', value: 'information' },
          { name: 'Security', value: 'security' },
          { name: 'Training', value: 'training' },
          { name: 'Central Command', value: 'command' }
        )
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('train')
    .setDescription('manager only: train an agent using facility resources!')
    .addUserOption(opt =>
      opt
        .setName('agent')
        .setDescription('agent to train')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt
        .setName('stat')
        .setDescription('stat to improve')
        .addChoices(
          { name: '💪 fortitude', value: 'fortitude' },
          { name: '🧠 prudence', value: 'prudence' },
          { name: '💗 temperance', value: 'temperance' },
          { name: '⚔️ justice', value: 'justice' }
        )
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('save')
    .setDescription('manager only: save current facility state!')
    .addStringOption(opt =>
      opt.setName('slot').setDescription('name of the save slot').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('load')
    .setDescription('manager only: load a saved facility state!')
    .addStringOption(opt =>
      opt.setName('slot').setDescription('name of the save slot to load').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('rewind')
    .setDescription('manager only: rewind the facility to the latest memory checkpoint!')
].map(cmd => cmd.toJSON());

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('❌ DISCORD_TOKEN environment variable is missing!');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log('✨ fetching bot account details...');
    const botUser = await rest.get(Routes.user()) as { id: string; username: string };
    console.log(`🤖 logged in as ${botUser.username} (${botUser.id})`);

    console.log('🚀 registering application slash commands with discord...');
    await rest.put(
      Routes.applicationCommands(botUser.id),
      { body: commands }
    );

    console.log('🎉 all slash commands registered successfully!! wonderhooi!! ✨');
  } catch (error) {
    console.error('💥 error deploying slash commands:', error);
    process.exitCode = 1;
  }
})();
