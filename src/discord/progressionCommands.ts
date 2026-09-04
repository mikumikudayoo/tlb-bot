import { db } from '../db/database';
import * as P from '../game/progression';
import { EGO_EQUIPMENT_SEED, EGO_WEAPONS } from '../game/logic';
import type { StatName } from '../types/game';

export const PROGRESSION_COMMANDS = ['stats', 'lob', 'train', 'stim', 'ego', 'research', 'core', 'ordeal', 'recruit'];
const fightCooldown = new Map<string, number>();

export async function handleProgressionCommand(interaction: any, runtime: any) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const command = interaction.commandName;
  const option = (key: string) => interaction.options.getString(key);
  const reply = (content: string) => interaction.reply({ content, ephemeral: true });
  try {
    const facility = db.query('SELECT * FROM facility WHERE guild_id=?').get(guildId) as any;
    if (!facility) throw new Error('facility not found');
    if (['research', 'core', 'recruit', 'train'].includes(command) && facility.manager_id !== userId) throw new Error('only the facility manager can use this command');
    if (command === 'research') {
      const key = option('project');
      if (!key) return reply(Object.entries(P.RESEARCH).map(([id, r]) => `**${id}** — ${r.department}, ${r.cost} facility LOB`).join('\n'));
      P.researchProject(guildId, userId, key);
      const fresh = db.query('SELECT * FROM facility WHERE guild_id=?').get(guildId);
      db.query("UPDATE agents SET stim_charges=? WHERE guild_id=? AND status<>'dead'").run(JSON.stringify(P.stimLoadout(fresh)), guildId);
      return reply(`🔬 **${key}** researched. unlocked stims have been issued; refills arrive at the next day.`);
    }
    if (command === 'core') {
      const dept = option('department');
      if (dept) P.startCore(guildId, userId, dept);
      const p = P.facilityProgress(db.query('SELECT * FROM facility WHERE guild_id=?').get(guildId));
      return reply(`🧠 core challenge: ${p.core ? `${p.core.department} — ${p.core.progress}/${p.core.target} good works in that department` : 'none'}\ncleared: ${p.cores.join(', ') || 'none'}\ncleared departments are immune to Qliphoth meltdowns. information challenges temporarily hide information commands.`);
    }
    if (command === 'recruit') {
      return reply(runtime.recruitAbnormality(guildId, userId, interaction.options.getInteger('choice'), option('department') || 'control'));
    }
    const targetId = command === 'train' ? interaction.options.getUser('agent', true).id : userId;
    const agent = db.query('SELECT * FROM agents WHERE guild_id=? AND discord_id=?').get(guildId, targetId) as any;
    if (!agent) throw new Error('join the facility first');
    if (command === 'stats') {
      const p = P.agentProgress(agent);
      return reply(`📊 **${agent.name}**\n${P.STATS.map(stat => `${stat}: ${p.points[stat]}/${P.statLimit(agent, facility)} points`).join('\n')}\npersonal LOB: ${p.lob}\nservice: ${P.departmentRank(Number(p.tenure[agent.department] || 0))} (${agent.department})\ncards: ${p.cards.join(', ') || 'none'}\nPE balances: ${Object.entries(p.pe).map(([id, balance]) => `#${id}: ${balance}`).join(', ') || 'none'}\nstims: ${agent.stim_charges || '{}'}\nowned E.G.O.: ${p.inventory.join(', ')}`);
    }
    if (command === 'lob' || command === 'train') {
      const stat = option('stat') as StatName;
      const result = P.trainWithLob(guildId, targetId, stat);
      const synced = runtime.syncAgentMaxStats(result.agent);
      Object.assign(result.agent, { max_hp: synced.maxHp, max_sp: synced.maxSp, hp: synced.hp, sp: synced.sp });
      runtime.updateAgent(result.agent);
      runtime.recordDepartmentProgress(guildId, 'training', 1);
      return reply(`📊 ${stat} +${result.gain}: ${result.current}/${result.limit}. spent 5 of that agent's personal LOB.`);
    }
    if (command === 'stim') {
      const type = option('type');
      const remaining = P.useStim(agent, facility, type);
      runtime.updateAgent(agent);
      return reply(`💉 ${type} stim used. ${remaining} charge(s) left; HP ${agent.hp}/${agent.max_hp}, SP ${agent.sp}/${agent.max_sp}.`);
    }
    if (command === 'ego') {
      const input = option('item')?.trim().toLowerCase();
      if (!input) return reply(`💠 E.G.O. catalogue\n${P.EGO_CATALOG.map(item => `**${item.id}** — ${item.source}: ${item.lob} personal LOB + ${item.pe} source PE`).join('\n')}\nfully observe that source first (8/8); buying equips the item. choosing an owned item re-equips it for free. other sources have no extractable gear data.`);
      const item = P.EGO_CATALOG.find(item => item.id === input)
        ?? P.EGO_CATALOG.find(item => EGO_EQUIPMENT_SEED.find(seed => seed.id === item.id)?.name.toLowerCase() === input);
      if (!item) throw new Error('unknown item; use /ego to see exact IDs');
      const alreadyOwned = P.agentProgress(agent).inventory.includes(item.id);
      P.purchaseEgo(guildId, userId, item.id);
      if (!alreadyOwned) runtime.recordDepartmentProgress(guildId, 'extraction', 1);
      return reply(`💠 ${item.id} ${alreadyOwned ? 're-equipped for free' : 'extracted and equipped'}.`);
    }
    if (command === 'ordeal') {
      const ordeal = P.facilityProgress(facility).ordeal;
      if (!ordeal) return reply('no active ordeal. stages occur at meltdown levels 1, 2, 3 and 4.');
      if (option('action') !== 'fight') return reply(`⚠️ ${ordeal.stage} / ${ordeal.color}: ${ordeal.hp}/${ordeal.maxHp} HP. use /ordeal action:fight.`);
      if (!facility.is_started || facility.is_paused) throw new Error('facility operations must be running');
      if (['dead', 'panicked', 'traumatized', 'working'].includes(agent.status) || agent.travel_remaining > 0) throw new Error('you cannot fight in your current state');
      const key = `${guildId}:${userId}`;
      if ((fightCooldown.get(key) || 0) > Date.now()) throw new Error('wait a moment before attacking again');
      fightCooldown.set(key, Date.now() + 1200);
      const weapon = EGO_WEAPONS[agent.weapon] || EGO_WEAPONS.riot_stick!;
      const roll = (weapon.min + weapon.max) / 2;
      const damage = Math.max(1, Math.floor((weapon.type === 'PALE' ? ordeal.maxHp * roll / 100 : roll) * (1 + agent.justice * 0.04) * weapon.speed));
      const previous = agent.status;
      const incoming = runtime.applyDamage(agent, 5 + P.facilityProgress(facility).ordealIndex * 3, ordeal.color === 'violet' ? 'WHITE' : 'RED');
      runtime.updateAgent(agent);
      const messages: string[] = [];
      runtime.publishAgentStatusTransition(guildId, previous, agent, messages);
      const hp = P.damageOrdeal(facility, damage);
      return reply(`⚔️ dealt ${damage}; suffered ${incoming}. ${hp ? `ordeal HP: ${hp}` : 'ordeal suppressed!'}\n${messages.join('\n')}`);
    }
  } catch (error) {
    return reply(`❌ ${error instanceof Error ? error.message : 'unable to perform that action'}`);
  }
}
