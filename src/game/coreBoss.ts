// TLB export: Sephirah Meltdown. Attack damage/resistances are source values;
// turn telegraphs and dodge choices are the Discord adaptation (not frame timing).
export type DamageType = 'RED' | 'WHITE' | 'BLACK' | 'PALE';
export type BossKind = 'red_mist' | 'arbiter';
export type BossAction = 'fight' | 'block' | 'dodge' | 'ability';
export interface BossState {
  kind: BossKind; phase: number; hp: number; maxHp: number; turn: number;
  goldRush: number; stunnedUntil: number; vulnerableUntil: number; fogCleared: boolean;
  special: null | { kind: 'gold' | 'fog' | 'waves' | 'fairies'; targets: number[]; deadline: number };
}
export interface BossAttack { name: string; hits: { type: DamageType; min: number; max: number }[]; unblockable?: boolean; }
const hit = (type: DamageType, min: number, max = min) => ({ type, min, max });
export const BOSS_NAMES = { red_mist: 'The Red Mist', arbiter: 'An Arbiter' };
export function createBoss(kind: BossKind): BossState {
  const maxHp = kind === 'red_mist' ? 3000 : 4000;
  return { kind, phase: 1, hp: maxHp, maxHp, turn: 0, goldRush: 0, stunnedUntil: 0, vulnerableUntil: 0, fogCleared: false, special: null };
}
export function bossResistance(boss: BossState, type: DamageType, now: number) {
  if (boss.special?.kind === 'fairies') return 0;
  if (boss.kind === 'arbiter') return boss.vulnerableUntil > now ? 1.5 : boss.fogCleared ? 0.4 : 0.1;
  const rows = [[.4,.4,.4,.5], [.7,.1,.1,.4], [.2,.7,.7,.2], [.8,.8,.8,.8]];
  return rows[boss.phase - 1]![['RED','WHITE','BLACK','PALE'].indexOf(type)] ?? 1;
}
export function nextBossAttack(boss: BossState): BossAttack {
  if (boss.kind === 'arbiter') {
    if (boss.special?.kind === 'fairies') return { name: 'Bounding of Fairies — work the marked containment units', hits: [] };
    const type = (['RED','WHITE','BLACK','PALE'] as const)[boss.turn % 4]!;
    if (boss.turn % 4 === 3) return { name: 'Pillar', hits: [hit(type,150,190)] };
    return { name: 'Fairies', hits: boss.phase === 3 ? [...(['RED','WHITE','BLACK','PALE'] as const).map(t => hit(t,110,140)), hit(type,110,140)] : [hit(type,110,140)] };
  }
  const threshold = boss.hp <= boss.maxHp * .33 ? 2 : boss.hp <= boss.maxHp * .66 ? 1 : 0;
  if (boss.phase <= 2 && threshold > boss.goldRush) return { name: 'The Road of Gold', hits: [hit('RED',250)] };
  if (boss.phase === 1) return [
    { name: 'Red Eyes', hits: [hit('RED',40,55)] },
    { name: 'Penitence', hits: [hit('WHITE',40,55)] },
    { name: 'Get blown to pieces', hits: [hit('RED',40,55),hit('WHITE',40,55)] },
  ][boss.turn % 3]!;
  if (boss.phase === 2) return [
    { name: 'Smile', hits: [hit('BLACK',25,35)] },
    { name: 'Justitia', hits: [hit('PALE',30,40)] },
    { name: 'Black Laughter', hits: [hit('BLACK',5,10)], unblockable: true },
    { name: 'Judgement', hits: [hit('PALE',300),hit('PALE',20,30)] },
  ][boss.turn % 4]!;
  if (boss.phase === 3 && boss.hp > boss.maxHp / 2) return boss.turn % 2 === 0
    ? { name: 'Da Capo', hits: [hit('WHITE',40,50)] }
    : { name: 'Mimicry', hits: [hit('RED',75,150)] };
  if (boss.phase === 3) return [
    { name: 'Level Slash', hits: [hit('RED',40,60),hit('RED',40,60)] },
    { name: 'Spear', hits: [hit('RED',40,60)] },
    { name: 'Great Split: Vertical', hits: [hit('RED',600)] },
    { name: 'Great Split: Horizontal', hits: [hit('RED',1000)] },
  ][boss.turn % 4]!;
  const hunt = boss.turn % 3 === 0;
  return { name: hunt ? 'The hunt begins' : 'Twilight', hits: Array.from({ length: hunt ? 6 : 4 }, () => (['RED','WHITE','BLACK','PALE'] as const).map(t => hit(t,50,100))).flat() };
}
export function damageBoss(boss: BossState, damage: number): 'alive' | 'phase' | 'defeated' {
  if (!Number.isFinite(damage) || damage < 0) throw new Error('invalid boss damage');
  boss.hp = Math.max(0, boss.hp - Math.floor(damage));
  if (boss.hp) return 'alive';
  if (boss.phase === (boss.kind === 'red_mist' ? 4 : 3)) return 'defeated';
  // Overkill never skips a phase; transition resets phase-local effects.
  Object.assign(boss, { phase: boss.phase + 1, hp: boss.maxHp, turn: 0, goldRush: 0, stunnedUntil: 0, vulnerableUntil: 0, fogCleared: false, special: null });
  return 'phase';
}
export function startBossSpecial(boss: BossState, targets: number[], now: number) {
  if (boss.kind !== 'arbiter' || boss.special || !targets.length) return;
  const kind = boss.phase === 3 && boss.turn === 0 ? 'fairies' : boss.phase >= 2 && boss.turn % 12 === 8 ? 'waves' : boss.turn % 8 === 4 ? 'fog' : 'gold';
  // Fairy bindings are untimed in Discord; do not invent a delayed instant kill
  // while the bot has no continuous authoritative combat clock.
  boss.special = { kind, targets: [...new Set(targets)], deadline: kind === 'waves' || kind === 'fairies' ? 0 : now + 60_000 };
}
export function clearBossTarget(boss: BossState, id: number, now: number, players: number) {
  const special = boss.special;
  if (!special || (special.deadline && now >= special.deadline) || !special.targets.includes(id)) return false;
  special.targets = special.targets.filter(target => target !== id);
  if (!special.targets.length) {
    if (special.kind === 'gold') boss.stunnedUntil = now + Math.max(12, 20 - Math.max(0, players - 1)) * 1000;
    if (special.kind === 'fog') { boss.vulnerableUntil = now + 25_000; boss.fogCleared = true; }
    boss.special = null;
  }
  return true;
}
