import { db } from '../db/database';
import { MessageFlags } from 'discord.js';
import { getGuildEmojiString, STAT_EMOJIS } from './emojis';
import { bossDescription, fightCore } from '../game/coreCombat';
import type { BossAction } from '../game/coreBoss';
import { rollEgoAttack, finishEgoAttack } from '../game/egoAbilities';
import * as P from '../game/progression';
import { EGO_EQUIPMENT_SEED, EGO_WEAPONS } from '../game/logic';
import type { StatName } from '../types/game';
import { attackSpeed, rawPoints, extractionMultiplier, agentTier, statTier } from '../game/wikiRules';

export const PROGRESSION_COMMANDS = ['stats', 'lob', 'train', 'stim', 'ego', 'research', 'core', 'ordeal', 'recruit'];
const fightCooldown = new Map<string, number>();

export async function handleProgressionCommand(interaction: any, runtime: any) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const command = interaction.commandName;
  const option = (key: string) => interaction.options.getString(key);
  const icon = (name: string, fallback: string) => getGuildEmojiString(interaction.guild, name, fallback);
  const reply = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
  try {
    const facility = db.query('SELECT * FROM facility WHERE guild_id=?').get(guildId) as any;
    if (!facility) throw new Error('facility not found');
    if (['research', 'recruit', 'train'].includes(command) && facility.manager_id !== userId) throw new Error('only the facility manager can use this command');
    if (command === 'research') {
      const key = option('project');
      if (!key) return reply(Object.entries(P.RESEARCH).map(([id, r]) => `**${id}** — ${r.department}, ${r.cost} facility LOB`).join('\n'));
      P.researchProject(guildId, userId, key);
      const fresh = db.query('SELECT * FROM facility WHERE guild_id=?').get(guildId);
      db.query("UPDATE agents SET stim_charges=? WHERE guild_id=? AND status<>'dead'").run(JSON.stringify(P.stimLoadout(fresh)), guildId);
      return reply(`🔬 **${key}** researched. unlocked supplies are ready. they refill each new day.`);
    }
    if (command === 'core') {
      const dept = option('department');
      const action = option('action');
      if (dept && action) throw new Error('choose a department to start a core, or an action to fight; not both');
      if (dept) P.startCore(guildId, userId, dept);
      if (action) {
        const result = fightCore(guildId, userId, action as BossAction, runtime);
        runtime.publishAgentStatusTransition(guildId, result.previous, result.agent, result.messages);
        return reply(result.messages.join('\n'));
      }
      P.advanceCore(facility, '', false);
      const p = P.facilityProgress(db.query('SELECT * FROM facility WHERE guild_id=?').get(guildId));
      return reply(`🧠 core suppression: ${p.core ? p.core.boss ? bossDescription(p.core.boss) : `${p.core.department} — ${p.core.progress}/${p.core.target} ${p.core.version === 2 ? `meltdowns; also meet quota (${facility.energy}/${facility.quota}) and clear ordeals` : 'good works (legacy save)'}` : 'none'}\ncleared: ${p.cores.join(', ') || 'none'}\nonly the manager can start a core. everyone can inspect or fight. Information hides observation and history until cleared.`);
    }
    if (command === 'recruit') {
      return reply(runtime.recruitAbnormality(guildId, userId, interaction.options.getInteger('choice'), option('department') || 'control'));
    }
    const targetId = command === 'train' ? interaction.options.getUser('agent', true).id : userId;
    const agent = db.query('SELECT * FROM agents WHERE guild_id=? AND discord_id=?').get(guildId, targetId) as any;
    if (!agent) throw new Error('join the facility first');
    if (command === 'stats') {
      const p = P.agentProgress(agent);
      return reply(`📊 **${agent.name}**\n${P.STATS.map(stat => `${icon(STAT_EMOJIS[stat], '◆')} ${stat}: ${p.points[stat]}/${P.statLimit(agent, facility, stat)} points`).join('\n')}\n${icon('HPIcon', '❤️')} HP ${agent.hp}/${agent.max_hp} · ${icon('SPIcon', '🧠')} SP ${agent.sp}/${agent.max_sp}\npersonal LOB: ${p.lob}\nservice: ${P.departmentRank(Number(p.tenure[agent.department] || 0))} (${agent.department})\ncards: ${p.cards.join(', ') || 'none'}\nPE balances: ${Object.entries(p.pe).slice(0, 12).map(([id, balance]) => `#${id}: ${balance}`).join(', ') || 'none'}${Object.keys(p.pe).length > 12 ? ' (first 12 shown)' : ''}\nstims: ${agent.stim_charges || '{}'}\nowned E.G.O.: ${p.inventory.length} items — use /ego to browse`);
    }
    if (command === 'lob' || command === 'train') {
      const stat = option('stat') as StatName;
      const result = P.trainWithLob(guildId, targetId, stat);
      const synced = runtime.syncAgentMaxStats(result.agent);
      Object.assign(result.agent, { max_hp: synced.maxHp, max_sp: synced.maxSp, hp: synced.hp, sp: synced.sp });
      runtime.updateAgent(result.agent);
      runtime.recordDepartmentProgress(guildId, 'training', 1);
      return reply(`📊 ${stat} +${result.gain}: ${result.current}/${result.limit}. cost: ${result.cost} personal LOB.`);
    }
    if (command === 'stim') {
      const type = option('type');
      const remaining = P.useStim(agent, facility, type);
      runtime.updateAgent(agent);
      return reply(`💉 ${type} stim used. ${remaining} left. HP ${agent.hp}/${agent.max_hp}, SP ${agent.sp}/${agent.max_sp}.`);
    }
    if (command === 'ego') {
      const input = option('item')?.trim().toLowerCase();
      if (!input) {
        const pages = Math.ceil(P.EGO_CATALOG.length / 8);
        const page = Math.max(1, Math.min(pages, interaction.options.getInteger?.('page') || 1));
        const fp = P.facilityProgress(facility);
        return reply(`💠 E.G.O. • ${page}/${pages}\n${P.EGO_CATALOG.slice((page - 1) * 8, page * 8).map(item => {
          const mult = extractionMultiplier(item.risk || 'ZAYIN', Number(fp.extractions?.[item.id] || 0)) * (fp.cores.includes('disciplinary') ? .5 : 1);
          return `**${item.id}** — ${item.source}: ${Math.ceil(item.lob * mult)} LOB + ${Math.ceil(item.pe * mult)} source PE`;
        }).join('\n')}\nuse /ego page:NUMBER for more. your own 8/8 observations are required; owned gear re-equips for free. special abilities are still being added.`);
      }
      const item = P.EGO_CATALOG.find(item => item.id === input)
        ?? P.EGO_CATALOG.find(item => EGO_EQUIPMENT_SEED.find(seed => seed.id === item.id)?.name.toLowerCase() === input);
      if (!item) throw new Error('can’t find that item. use /ego to check the list');
      const alreadyOwned = P.agentProgress(agent).inventory.includes(item.id);
      P.purchaseEgo(guildId, userId, item.id);
      if (!alreadyOwned) runtime.recordDepartmentProgress(guildId, 'extraction', 1);
      return reply(`💠 ${item.id} ${alreadyOwned ? 're-equipped for free' : 'extracted and equipped'}.`);
    }
    if (command === 'ordeal') {
      const ordeal = P.facilityProgress(facility).ordeal;
      if (!ordeal) return reply('no ordeal right now. dawn/noon/dusk/midnight unlock on days 6/11/21/26, at meltdown levels 1/3/5/7.');
      if (option('action') !== 'fight') return reply(`${icon(ordeal.stage === 'dawn' ? 'Warn_1' : ordeal.stage === 'noon' ? 'Warn_2' : 'Warn_3', '⚠️')} ${ordeal.stage} / ${ordeal.color}: ${ordeal.hp}/${ordeal.maxHp} HP. use /ordeal action:fight.`);
      if (!facility.is_started || facility.is_paused) throw new Error('the shift needs to be running before you can fight');
      if (['dead', 'panicked', 'traumatized', 'working'].includes(agent.status) || agent.travel_remaining > 0) throw new Error('you can’t fight while dead, panicked, traumatized, working or travelling');
      const key = `${guildId}:${userId}`;
      if ((fightCooldown.get(key) || 0) > Date.now()) throw new Error('wait a moment before attacking again');
      fightCooldown.set(key, Date.now() + 1200);
      const weapon = EGO_WEAPONS[agent.weapon] || EGO_WEAPONS.riot_stick!;
      const roll = rollEgoAttack(agent, weapon).damage;
      const damage = Math.max(1, Math.floor(roll * attackSpeed(rawPoints(agent, 'justice')) * weapon.speed));
      const previous = agent.status;
      const incoming = runtime.applyDamage(agent, 5 + P.facilityProgress(facility).ordealIndex * 3, ordeal.color === 'violet' ? 'BLACK' : 'RED');
      runtime.updateAgent(agent);
      const messages: string[] = [];
      runtime.publishAgentStatusTransition(guildId, previous, agent, messages);
      const hp = P.damageOrdeal(facility, damage);
      finishEgoAttack(agent, Math.min(ordeal.hp, damage), hp === 0);
      if (agent.status !== 'dead') runtime.updateAgent(agent);
      return reply(`⚔️ dealt ${damage} damage and took ${incoming} in return. ${hp ? `ordeal HP: ${hp}` : 'ordeal suppressed!'}\n${messages.join('\n')}`);
    }
  } catch (error) {
    return reply(`❌ ${error instanceof Error ? error.message : 'couldn’t do that. check your status before trying again'}`);
  }
}
