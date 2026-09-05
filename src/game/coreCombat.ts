import { db } from '../db/database';
import * as P from './progression';
import { EGO_WEAPONS } from './logic';
import { attackSpeed, rawPoints, equipmentRisk, riskMultiplier } from './wikiRules';
import { rollEgoAttack, finishEgoAttack } from './egoAbilities';
import { BOSS_NAMES, bossResistance, damageBoss, nextBossAttack, startBossSpecial, type BossAction, type BossState, type DamageType } from './coreBoss';

export function bossDescription(boss: BossState, now = Date.now()) {
  const special = boss.special;
  return `**${BOSS_NAMES[boss.kind]}** · phase ${boss.phase}${boss.kind === 'red_mist' && boss.phase === 3 && boss.hp <= 1500 ? '.5' : ''}\nHP ${boss.hp}/${boss.maxHp}\nnext: **${nextBossAttack(boss).name}**${boss.stunnedUntil > now ? ' (stunned)' : ''}\n${special ? `${special.kind} meltdown: work ${special.targets.map(id => `#${id}`).join(', ')}${special.deadline ? ` · ${Math.max(0, Math.ceil((special.deadline - now) / 1000))}s left` : ''}\n` : ''}use /core action:fight, block or dodge. fight trades blows; block gives up your attack for half damage; dodge gives up your attack to evade. attacks are turn-based here.`;
}

/** No await inside the transaction: read authoritative state, validate, resolve, persist. */
export function fightCore(guildId: string, userId: string, action: BossAction, runtime: any, now = Date.now(), random = Math.random) {
  return db.transaction(() => {
    const f = db.query('SELECT * FROM facility WHERE guild_id=?').get(guildId) as any;
    const p = P.facilityProgress(f);
    const boss = p.core?.boss as BossState | undefined;
    if (!boss || boss.hp <= 0) throw new Error('there is no active core boss');
    if (!f.is_started || f.is_paused) throw new Error('the shift needs to be running');
    if (!['fight','block','dodge','ability'].includes(action)) throw new Error('unknown combat action');
    const agent = db.query('SELECT * FROM agents WHERE guild_id=? AND discord_id=?').get(guildId, userId) as any;
    if (!agent || !['idle','injured','stressed','recovering'].includes(agent.status) || agent.travel_remaining > 0) throw new Error('you need a living, sane agent who is not working or travelling');
    const ap = P.agentProgress(agent);
    if (Number(ap.coreActionAfter || 0) > now) throw new Error('wait a moment before acting again');
    ap.coreActionAfter = now + 1200;
    agent.progression = JSON.stringify(ap);
    const previous = agent.status;
    const messages: string[] = [];
    const special = boss.special;
    if (special?.deadline && special.deadline <= now) {
      if (special.kind === 'gold') {
        // Discord settlement: the failed Gold's full 60s regeneration is paid here.
        boss.hp = Math.min(boss.maxHp, boss.hp + 120);
        messages.push('gold expired: the Arbiter recovered 120 HP.');
      }
      boss.special = null;
    }
    const incoming = nextBossAttack(boss); // Capture telegraph BEFORE player damage changes thresholds.
    const stunned = boss.stunnedUntil > now;
    let dealt = 0, taken = 0, defense = 1;
    if (action === 'ability' && agent.weapon !== 'mimicry') throw new Error('Mimicry supports Downslam; this weapon has no active ability implemented yet');
    if ((action === 'fight' || action === 'ability') && boss.special?.kind !== 'fairies') {
      const weapon = EGO_WEAPONS[agent.weapon] || EGO_WEAPONS.riot_stick!;
      const attack = rollEgoAttack(agent, weapon, action === 'ability', random);
      const base = attack.damage;
      defense = attack.defense;
      if (action === 'ability') messages.push(attack.name);
      dealt = Math.max(0, Math.floor(base * weapon.speed * attackSpeed(rawPoints(agent, 'justice')) * riskMultiplier(equipmentRisk(agent.weapon), 'ALEPH') * bossResistance(boss, weapon.type as DamageType, now)));
      dealt = Math.min(boss.hp, dealt);
    }
    const outcome = damageBoss(boss, dealt);
    if (outcome === 'alive' && !stunned && action !== 'dodge') {
      for (const hit of incoming.hits) {
        if (agent.status === 'dead') break;
        const amount = hit.min + Math.floor(random() * (hit.max - hit.min + 1));
        taken += runtime.applyDamage(agent, amount * defense * (action === 'block' && !incoming.unblockable ? .5 : 1), hit.type, { risk: 'ALEPH' });
      }
    }
    if (outcome === 'alive') {
      if (incoming.name === 'The Road of Gold' && !stunned) boss.goldRush += 1;
      if (incoming.name === 'The hunt begins' && !stunned) boss.stunnedUntil = now + 10_000;
      if (!stunned) boss.turn += 1;
      if (boss.special?.kind === 'waves' && agent.status !== 'dead') taken += runtime.applyDamage(agent, 17 + Math.floor(random() * 4), 'BLACK', { risk: 'ALEPH' });
    }
    finishEgoAttack(agent, dealt, outcome === 'defeated');
    if (boss.kind === 'arbiter' && outcome !== 'defeated' && !boss.special && (outcome === 'phase' || boss.turn % 4 === 0)) {
      const targets = db.query('SELECT id FROM abnormalities WHERE guild_id=? AND is_breaching=0 ORDER BY id LIMIT 2').all(guildId) as any[];
      startBossSpecial(boss, targets.map(a => a.id), now);
    }
    runtime.updateAgent(agent);
    P.saveFacilityProgress(f, p);
    const cleared = P.advanceCore(f, p.core.department, false);
    messages.push(`${action}: dealt ${dealt}, took ${taken}. ${outcome === 'phase' ? `phase ${boss.phase} begins.` : outcome === 'defeated' ? 'boss defeated.' : incoming.name}`);
    if (cleared) messages.push('core suppressed. this department is now immune to Qliphoth meltdowns.');
    else if (outcome === 'defeated') messages.push('finish the active ordeal to clear the core.');
    else messages.push(bossDescription(boss, now));
    return { agent, previous, messages };
  })();
}
