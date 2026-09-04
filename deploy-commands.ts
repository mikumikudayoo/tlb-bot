import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import { helpCommand } from './src/discord/helpCommand';

const departmentChoices = ['control', 'information', 'training', 'security', 'command', 'disciplinary', 'welfare', 'extraction', 'record']
  .map(value => ({ name: value, value }));

const commands = [
  helpCommand,
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
    .setName('stats')
    .setDescription('view your four work stats and their current training limit!'),

  new SlashCommandBuilder()
    .setName('lob')
    .setDescription('spend LOB points to raise one stat by 5!')
    .addStringOption(opt => opt
      .setName('stat')
      .setDescription('stat to increase')
      .addChoices(
        { name: 'fortitude', value: 'fortitude' },
        { name: 'prudence', value: 'prudence' },
        { name: 'temperance', value: 'temperance' },
        { name: 'justice', value: 'justice' }
      )
      .setRequired(true)),

  new SlashCommandBuilder()
    .setName('stim')
    .setDescription('use a researched stim or shield charge!')
    .addStringOption(opt => opt
      .setName('type')
      .setDescription('stim to use')
      .addChoices(
        { name: 'health', value: 'health' },
        { name: 'sanity', value: 'sanity' },
        { name: 'red shield', value: 'red' },
        { name: 'white shield', value: 'white' },
        { name: 'black shield', value: 'black' },
        { name: 'pale shield', value: 'pale' }
      )
      .setRequired(true)),

  new SlashCommandBuilder()
    .setName('facility')
    .setDescription('view the full facility dashboard!'),

  new SlashCommandBuilder()
    .setName('research')
    .setDescription('manager: research stims, shields or expanded stat limits')
    .addStringOption(opt => opt.setName('project').setDescription('omit to list projects').addChoices(
      { name: 'Welfare stims', value: 'welfare_stims' },
      { name: 'Command shields', value: 'command_shields' },
      { name: '150-point stat limits', value: 'extended_stats' }
    )),

  new SlashCommandBuilder()
    .setName('core')
    .setDescription('manager: inspect or start a department core challenge')
    .addStringOption(opt => opt.setName('department').setDescription('omit to inspect; choose to start').addChoices(...departmentChoices)),

  new SlashCommandBuilder()
    .setName('ordeal')
    .setDescription('inspect or fight the active ordeal')
    .addStringOption(opt => opt.setName('action').setDescription('omit to inspect').addChoices({ name: 'fight', value: 'fight' })),

  new SlashCommandBuilder()
    .setName('recruit')
    .setDescription('manager: choose one of three abnormalities, once per day')
    .addIntegerOption(opt => opt.setName('choice').setDescription('omit to view the three offers').setMinValue(1).setMaxValue(3))
    .addStringOption(opt => opt.setName('department').setDescription('unlocked containment sector; defaults to control').addChoices(...departmentChoices)),

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
    .setName('info')
    .setDescription('inspect your personal observation record for an abnormality!')
    .addStringOption(opt =>
      opt.setName('abnormality')
        .setDescription('abnormality name or ID')
        .setRequired(true)
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
    .setName('ego')
    .setDescription('inspect or purchase unlocked E.G.O. equipment!')
    .addStringOption(opt => opt
      .setName('item')
      .setDescription('equipment name or ID; leave blank to list the catalogue')
      .setRequired(false)),

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
    .setName('abno-test')
    .setDescription('manager only: add, breach, contain, or reset an abnormality for testing! 🧪')
    .addStringOption(opt =>
      opt
        .setName('action')
        .setDescription('testing action to perform')
        .addChoices(
          { name: '➕ add abnormality', value: 'add' },
          { name: '🚨 force breach', value: 'breach' },
          { name: '🔒 contain breach', value: 'contain' },
          { name: '♻️ reset abnormality', value: 'reset' }
        )
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt
        .setName('abnormality')
        .setDescription('abnormality name, database id, or script id')
        .setRequired(true)
    ),

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
    .setName('radio')
    .setDescription('listen to or inspect facility radio transmissions!')
    .addStringOption(opt =>
      opt
        .setName('mode')
        .setDescription('radio mode')
        .addChoices(
          { name: '📻 recent transmissions', value: 'history' },
          { name: '📡 live radio channel', value: 'channel' },
          { name: '🧪 manager radio test', value: 'test' }
        )
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('work-history')
    .setDescription('view your private work history and observations!'),

  new SlashCommandBuilder()
    .setName('relationships')
    .setDescription('view your relationships with other agents!'),

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
        .addChoices(...departmentChoices)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('train')
    .setDescription('manager: train an agent by 5 points using their personal LOB at 08:00')
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
const deployArgs = process.argv.slice(2);
const guildId = deployArgs.find(arg => !arg.startsWith('--'))?.trim() || process.env.DISCORD_GUILD_ID?.trim();
const guildOnly = deployArgs.includes('--guild-only');
const globalOnly = deployArgs.includes('--global-only');
if (!token) {
  console.error('❌ DISCORD_TOKEN environment variable is missing!');
  process.exit(1);
}
if (guildOnly && globalOnly) {
  console.error('❌ choose either --guild-only or --global-only, not both.');
  process.exit(1);
}
if ((guildOnly || globalOnly) && !guildId) {
  console.error('❌ a server ID is required when cleaning command scopes.');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log('✨ fetching bot account details...');
    const botUser = await rest.get(Routes.user()) as { id: string; username: string };
    console.log(`🤖 logged in as ${botUser.username} (${botUser.id})`);

    if (guildOnly) {
      console.log(`🚀 using server-only commands in ${guildId} and removing the duplicate global set...`);
      await rest.put(Routes.applicationGuildCommands(botUser.id, guildId!), { body: commands });
      await rest.put(Routes.applicationCommands(botUser.id), { body: [] });
      console.log('🎉 server-only commands registered and global duplicates removed!! ✨');
    } else if (globalOnly) {
      console.log(`🚀 using global commands and removing the duplicate set from server ${guildId}...`);
      await rest.put(Routes.applicationCommands(botUser.id), { body: commands });
      await rest.put(Routes.applicationGuildCommands(botUser.id, guildId!), { body: [] });
      console.log('🎉 global commands registered and server duplicates removed!! ✨');
    } else if (guildId) {
      console.error('❌ a global command set may already exist. rerun with --global-only or --guild-only to avoid duplicates.');
      process.exitCode = 1;
    } else {
      console.log('🚀 registering global application slash commands with discord (propagation may take up to an hour)...');
      await rest.put(Routes.applicationCommands(botUser.id), { body: commands });
      console.log('🎉 global slash commands registered successfully!! discord may take up to an hour to show them ✨');
    }
  } catch (error) {
    console.error('💥 error deploying slash commands:', error);
    process.exitCode = 1;
  }
})();
