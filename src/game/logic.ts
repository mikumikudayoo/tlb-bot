import { clamp } from '../utils/clamp';
import { pick } from '../utils/random';
import { getWorkType } from '../config/workTypes';
import type { Behaviour, DamageType, GiftDef, PanicBehaviorKey, WorkType } from '../types/game';

export type { GiftDef } from '../types/game';

export const WORK_LEVEL_MAX: Record<string, number> = {
  ZAYIN: 2,
  TETH: 3,
  HE: 4,
  WAW: 4,
  ALEPH: 4
};

export const BEHAVIOUR_INFO: Record<Behaviour, { icon: string; label: string; description: string }> = {
  docile: {
    icon: '🕊️',
    label: 'docile',
    description: 'calm and cooperative. rewards patient, consistent handling and rarely escalates on its own.'
  },
  possessive: {
    icon: '💜',
    label: 'possessive',
    description: 'bonds to whoever works it most. grows fonder of a familiar face and resents being handed off.'
  },
  volatile: {
    icon: '🌪️',
    label: 'volatile',
    description: 'unstable. swings hard between brilliant and disastrous work sessions, and breaches without warning.'
  },
  predatory: {
    icon: '🦈',
    label: 'predatory',
    description: 'preys on weakness. grows bolder — and more dangerous — the worse shape its handler is in.'
  }
};

export const RISK_VALUES: Record<string, number> = {
  ZAYIN: 1,
  TETH: 2,
  HE: 3,
  WAW: 4,
  ALEPH: 5
};

export const DAMAGE_TYPES: Record<DamageType, { label: string; icon: string; description: string }> = {
  RED: { label: 'RED', icon: '🔴', description: 'Physical damage to HP.' },
  WHITE: { label: 'WHITE', icon: '⚪', description: 'Mental damage to agent SP; weapons damage enemy HP.' },
  BLACK: { label: 'BLACK', icon: '⚫', description: 'Damage to both HP and SP, not divided between them.' },
  PALE: { label: 'PALE', icon: '🩶', description: 'Percentage-based damage; scales off max HP.' }
};

export const EGO_WEAPONS: Record<string, { name: string; type: DamageType; min: number; max: number; speed: number }> = {
  riot_stick: { name: 'Riot Stick', type: 'RED', min: 2, max: 4, speed: 1.0 },
  penitence: { name: 'Penitence', type: 'WHITE', min: 3, max: 5, speed: 1.05 },
  mimicry: { name: 'Mimicry', type: 'RED', min: 12, max: 25, speed: 0.8 },
  smile: { name: 'Smile', type: 'BLACK', min: 10, max: 20, speed: 0.9 }
};

export const EGO_SUITS: Record<string, { name: string; red: number; white: number; black: number; pale: number; defense: number }> = {
  basic_suit: { name: 'Basic Suit', red: 1.0, white: 1.0, black: 1.0, pale: 1.5, defense: 0 },
  penitence_suit: { name: 'Penitence Suit', red: 0.9, white: 0.8, black: 1.0, pale: 1.5, defense: 1 },
  mimicry_suit: { name: 'Mimicry Suit', red: 0.2, white: 0.4, black: 0.5, pale: 1.2, defense: 3 }
};

export const TRAITS: Record<string, { name: string; description: string }> = {
  energetic: { name: 'energetic', description: '+10% work consistency' },
  cautious: { name: 'cautious', description: '-10% incoming damage' },
  reckless: { name: 'reckless', description: '+15% combat damage, +10% incoming damage' },
  lucky: { name: 'lucky', description: 'chance to create an extra PE box' },
  calm: { name: 'calm', description: '+15% panic resistance' },
  curious: { name: 'curious', description: '+10% insight success' }
};

export const ABNORMALITY_TEMPLATES = [
  {
    name: 'One Sin and Hundreds of Good Deeds', risk: 'ZAYIN', hp: 500, qliphoth: 3, damage_type: 'WHITE', damage_amt: 2,
    instinct: 0.35, insight: 0.80, attachment: 0.60, repression: 0.20, escape_chance: 0.03,
    behaviour: 'docile', description: 'A relatively safe abnormality that rewards patient observation.',
    script_id: '', can_breach: 1, is_tool: 0,
    gift: {
      id: 'unwavering_gaze', name: 'Unwavering Gaze', icon: '👁️',
      statBonus: { prudence: 2 },
      workChanceBonus: { instinct: -0.08 },
      drawback: '+2 prudence, but -8% instinct work chance — the gaze fixes on truth and stops noticing danger.'
    }
  },
  {
    name: 'Beauty and the Beast', risk: 'TETH', hp: 800, qliphoth: 3, damage_type: 'BLACK', damage_amt: 6,
    instinct: 0.45, insight: 0.40, attachment: 0.90, repression: 0.20, escape_chance: 0.10,
    behaviour: 'possessive', description: 'Responds well to attachment but becomes volatile when mishandled.',
    script_id: '', can_breach: 1, is_tool: 0,
    gift: {
      id: 'beasts_embrace', name: "Beast's Embrace", icon: '💗',
      statBonus: { temperance: 2 },
      maxSpMult: 0.90,
      drawback: '+2 temperance, but -10% max SP — the embrace is warm and it does not let go easily.'
    }
  },
  {
    name: 'Der Freischütz', risk: 'HE', hp: 1500, qliphoth: 3, damage_type: 'BLACK', damage_amt: 12,
    instinct: 0.30, insight: 0.55, attachment: 0.35, repression: 0.85, escape_chance: 0.16,
    behaviour: 'volatile', description: 'High output, high risk. Mistakes can destabilise containment quickly.',
    script_id: '', can_breach: 1, is_tool: 0,
    gift: {
      id: 'true_shot', name: 'True Shot', icon: '🎯',
      statBonus: { justice: 2 },
      incomingDamageMult: 1.15,
      drawback: '+2 justice, but +15% incoming damage — a perfect shot leaves you standing in the open.'
    }
  },
  {
    name: 'Nothing There', risk: 'ALEPH', hp: 3000, qliphoth: 2, damage_type: 'RED', damage_amt: 30,
    instinct: 0.55, insight: 0.35, attachment: 0.20, repression: 0.95, escape_chance: 0.30,
    behaviour: 'predatory', description: 'An ALEPH-class threat capable of rapidly turning errors into disasters.',
    script_id: 'O-06-20', can_breach: 1, is_tool: 0,
    gift: {
      id: 'vacant_resonance', name: 'Vacant Resonance', icon: '🕳️',
      statBonus: { fortitude: 1, prudence: 1, temperance: 1, justice: 1 },
      incomingDamageMult: 1.10,
      drawback: '+1 to every stat, but +10% incoming damage from all sources — it does not distinguish friend from foe.'
    }
  }
] as const;

export const EGO_GIFTS: Record<string, GiftDef> = {};
for (const template of ABNORMALITY_TEMPLATES) {
  const g = (template as any).gift as Omit<GiftDef, 'sourceAbno'> | undefined;
  if (g) EGO_GIFTS[g.id] = { ...g, sourceAbno: template.name };
}

export const EGO_EQUIPMENT_SEED: Array<{ id: string; category: 'weapon' | 'suit'; name: string; type?: DamageType; min?: number; max?: number; speed?: number; red?: number; white?: number; black?: number; pale?: number; defense?: number; description: string }> = [
  { id: 'riot_stick', category: 'weapon', name: 'Riot Stick', type: 'RED', min: 2, max: 4, speed: 1.0, description: 'A simple, reliable blunt weapon used by trainees.' },
  { id: 'penitence', category: 'weapon', name: 'Penitence', type: 'WHITE', min: 3, max: 5, speed: 1.05, description: 'A focused weapon that channels mental force.' },
  { id: 'mimicry', category: 'weapon', name: 'Mimicry', type: 'RED', min: 12, max: 25, speed: 0.8, description: 'A high-output melee weapon with a sharp but risky profile.' },
  { id: 'basic_suit', category: 'suit', name: 'Basic Suit', red: 1.0, white: 1.0, black: 1.0, pale: 1.5, defense: 0, description: 'The default issue suit used by new agents.' },
  { id: 'penitence_suit', category: 'suit', name: 'Penitence Suit', red: 0.9, white: 0.8, black: 1.0, pale: 1.5, defense: 1, description: 'A light armor set tuned for mental resistance.' },
  { id: 'mimicry_suit', category: 'suit', name: 'Mimicry Suit', red: 0.2, white: 0.4, black: 0.5, pale: 1.2, defense: 3, description: 'High-risk, high-reward armor that heavily reduces physical pressure.' }
];

export function getBehaviour(abno: any): Behaviour {
  return (BEHAVIOUR_INFO as any)[abno.behaviour] ? (abno.behaviour as Behaviour) : 'docile';
}

export function getDisplayAbnormality(abno: any, allAbnos: any[] = []): any {
  const isMasked = abno?.script_id === 'DO-NOT-TOUCH' || abno?.id === 'DO-NOT-TOUCH' || abno?.name === "Don't Touch Me" || abno?.name === 'Don\'t Touch Me';
  if (!isMasked) return abno;

  const decoys = (allAbnos ?? []).filter((entry: any) => {
    const entryId = String(entry?.id ?? '');
    const entryScript = String(entry?.script_id ?? '');
    return entryId !== 'DO-NOT-TOUCH' && entryScript !== 'DO-NOT-TOUCH' && (entry?.name ?? '').trim() !== "Don't Touch Me" && (entry?.name ?? '').trim() !== 'Don\'t Touch Me';
  });

  if (!decoys.length) return abno;

  const seed = String(abno?.id ?? abno?.name ?? 'dont-touch');
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const decoy = decoys[hash % decoys.length];

  return {
    ...abno,
    name: decoy.name,
    risk: decoy.risk,
    damage_type: decoy.damage_type,
    description: decoy.description ?? abno.description,
    spoofed_name: true,
    real_name: abno.name
  };
}

export function getCurrentWorkAffinity(abno: any, workType: WorkType) {
  const key = `work_${workType}`;
  return clamp(Number(abno[key] ?? 0.5), 0.05, 0.99);
}

export function getMeltdownState(abno: any) {
  if (!abno) return { icon: '🟢', label: 'stable', timer: 0, value: 1 };
  const ratio = abno.max_qliphoth > 0 ? Number(abno.qliphoth) / Number(abno.max_qliphoth) : 1;
  if (ratio <= 0.25) {
    return { icon: '🔴', label: 'meltdown', timer: Math.max(0, Number(abno.meltdown_timer ?? 0)), value: ratio };
  }
  if (ratio <= 0.5) {
    return { icon: '🟠', label: 'critical', timer: Math.max(0, Number(abno.meltdown_timer ?? 0)), value: ratio };
  }
  if (ratio <= 0.75) {
    return { icon: '🟡', label: 'unstable', timer: Math.max(0, Number(abno.meltdown_timer ?? 0)), value: ratio };
  }
  return { icon: '🟢', label: 'stable', timer: Math.max(0, Number(abno.meltdown_timer ?? 0)), value: ratio };
}

export function getShiftProfile(phase: number): { label: string; workChance: number; damageMultiplier: number; energyMultiplier: number; breachMultiplier: number } {
  const profiles: Record<number, { label: string; workChance: number; damageMultiplier: number; energyMultiplier: number; breachMultiplier: number }> = {
    8: { label: 'Morning', workChance: 0.04, damageMultiplier: 0.95, energyMultiplier: 1.00, breachMultiplier: 0.90 },
    10: { label: 'Morning Shift', workChance: 0.02, damageMultiplier: 0.98, energyMultiplier: 1.05, breachMultiplier: 0.95 },
    12: { label: 'Midday', workChance: 0.00, damageMultiplier: 1.00, energyMultiplier: 1.00, breachMultiplier: 1.00 },
    14: { label: 'Afternoon', workChance: 0.02, damageMultiplier: 1.00, energyMultiplier: 1.05, breachMultiplier: 1.00 },
    16: { label: 'Afternoon Shift', workChance: -0.01, damageMultiplier: 1.03, energyMultiplier: 1.10, breachMultiplier: 1.05 },
    18: { label: 'Evening', workChance: -0.03, damageMultiplier: 1.08, energyMultiplier: 1.00, breachMultiplier: 1.10 },
    20: { label: 'Overtime', workChance: -0.08, damageMultiplier: 1.15, energyMultiplier: 1.15, breachMultiplier: 1.25 },
    22: { label: 'Emergency', workChance: -0.12, damageMultiplier: 1.25, energyMultiplier: 1.20, breachMultiplier: 1.45 }
  };
  return profiles[phase] ?? profiles[8]!;
}

export function getPanicBehaviorKey(agent: any): PanicBehaviorKey {
  const highestStat = Object.entries({
    fortitude: Number(agent?.fortitude ?? 0),
    prudence: Number(agent?.prudence ?? 0),
    temperance: Number(agent?.temperance ?? 0),
    justice: Number(agent?.justice ?? 0)
  }).sort((a, b) => Number(b[1]) - Number(a[1]))[0]?.[0] ?? 'fortitude';

  if (highestStat === 'fortitude') return 'wander';
  if (highestStat === 'prudence') return 'breach_seeking';
  if (highestStat === 'temperance') return 'lockdown';
  return 'hostile';
}

export function resolvePanicBehavior(agent: any): string {
  if (!agent || (agent.sp > 0 && agent.status !== 'panicked')) return 'stable';
  const behavior = (agent.panic_behavior || getPanicBehaviorKey(agent)) as PanicBehaviorKey;
  if (behavior === 'wander') return 'wanders containment hallways and interferes with doors';
  if (behavior === 'breach_seeking') return 'fixates on dangerous containment units and tries to release them';
  if (behavior === 'lockdown') return 'refuses commands and disrupts department operations';
  return 'becomes hostile toward nearby agents';
}

export function applyPanicState(agent: any) {
  if (!agent || agent.status === 'dead') return;
  if (agent.sp <= 0) {
    agent.sp = 0;
    agent.status = 'panicked';
    agent.recovery_days = Math.max(Number(agent.recovery_days ?? 0), 2);
    if (!agent.panic_behavior) agent.panic_behavior = getPanicBehaviorKey(agent);
    if (!Number(agent.panic_turns)) agent.panic_turns = 0;
  }
}

export function calculateWorkChance(agent: any, abno: any, workType: WorkType, facility: any, level: number = 1) {
  const work = getWorkType(workType);
  const stat = Number(agent[work.stat] ?? 1);
  const affinity = getCurrentWorkAffinity(abno, workType);
  const riskPenalty = (RISK_VALUES[abno.risk] ?? 1) * 0.035;
  const facilityBonus = (Number(facility.research) / 100) * 0.015 + Number(facility.welfare_level) * 0.01;
  const shift = getShiftProfile(Number(facility.phase));

  let chance = 0.33 + stat * 0.045 + affinity * 0.28 + facilityBonus + shift.workChance - riskPenalty;

  if (agent.trait === 'energetic') chance += 0.08;
  if (agent.trait === 'curious' && workType === 'insight') chance += 0.10;
  if (agent.trait === 'calm') chance += 0.02;

  if (agent.status === 'stressed') chance -= 0.08;
  if (agent.status === 'injured') chance -= 0.10;
  if (agent.status === 'recovering') chance -= 0.15;

  chance -= Number(abno.rage) * 0.015;
  chance -= (clamp(level, 1, 4) - 1) * 0.09;

  const behaviour = getBehaviour(abno);
  if (behaviour === 'docile') {
    chance += 0.06;
  } else if (behaviour === 'possessive') {
    if (abno.last_worked_by && abno.last_worked_by === agent.discord_id) {
      chance += Math.min(0.15, 0.05 + Number(abno.work_streak ?? 0) * 0.02);
    } else if (abno.last_worked_by) {
      chance -= 0.12;
    }
  } else if (behaviour === 'predatory') {
    if (agent.status === 'injured' || agent.status === 'stressed') chance -= 0.10;
  }

  const gift = (agent as any)?.equipped_gift ? (globalThis as any).EGO_GIFTS?.[(agent as any).equipped_gift] ?? null : null;
  if (gift?.workChanceBonus?.[workType]) chance += gift.workChanceBonus[workType]!;

  if (facility?.meltdown_alarm) chance -= 0.04;

  return clamp(chance, 0.05, 0.97);
}

export function workQuality(chance: number, level: number = 1, behaviour: Behaviour = 'docile') {
  let roll = Math.random();
  if (behaviour === 'volatile') {
    roll = clamp(roll + (Math.random() - 0.5) * 0.30, 0, 1);
  }

  const levelBonus = clamp(level, 1, 4) - 1;
  if (roll < chance * 0.35) return { tier: 'good' as const, boxes: 2 + levelBonus + (Math.random() < chance ? 1 : 0) };
  if (roll < chance) return { tier: 'normal' as const, boxes: 1 + Math.floor(levelBonus * 0.6) + (Math.random() < chance * 0.65 ? 1 : 0) };
  if (roll < Math.min(0.99, chance + 0.18)) return { tier: 'bad' as const, boxes: Math.max(0, 1 - Math.floor(levelBonus * 0.5)) };
  return { tier: 'critical' as const, boxes: 0 };
}

export function getPEBoxTotal(abno: any) {
  const riskWeight = RISK_VALUES[String(abno.risk)] ?? 1;
  return clamp(5 + Math.max(0, riskWeight - 1), 5, 8);
}

export function nextPhase(phase: number) {
  const phases = [8, 10, 12, 14, 16, 18, 20, 22];
  const index = phases.indexOf(phase);
  if (index < 0) return 8;
  if (index === phases.length - 1) return 22;
  return phases[index + 1]!;
}
