import data from '../config/wikiAbnormalities.json';
import equipment from '../config/wikiEquipment.json';
export const equipmentRisk = (id: string) => equipment.find(item => item.id === id)?.risk ?? 'ZAYIN';

// Facts transcribed from the 2026-09-05 MediaWiki export. No wiki code is executed.
export const statTier = (points: number) => points >= 85 ? 5 : points >= 65 ? 4 : points >= 45 ? 3 : points >= 30 ? 2 : 1;
export const agentTier = (points: number[]) => {
  const total = points.reduce((sum, point) => sum + statTier(point), 0);
  return total >= 18 ? 5 : total >= 14 ? 4 : total >= 10 ? 3 : total >= 6 ? 2 : 1;
};
export function rawPoints(agent: any, stat: string): number {
  let progress: any = {};
  try { progress = typeof agent.progression === 'string' ? JSON.parse(agent.progression) : agent.progression || {}; } catch {}
  const stored = progress.points?.[stat];
  // Old saves store tiers. Preserve the previous migration's 20 points per tier.
  return Math.max(1, Number(stored ?? Math.min(100, Number(agent[stat] || 1) * 20)));
}
const normalize = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function wikiAbnormality(abno: any) {
  return data.abnormalities.find(a => abno.name && normalize(a.name) === normalize(abno.name))
    ?? data.abnormalities.find(a => abno.script_id && a.code && a.code !== 'X-XX-XX' && a.code === abno.script_id);
}
export const trainingCost = (stat: string) => stat === 'justice' ? 200 : 100;
export const dayLob = (day: number, cores: number) => Math.max(0, day - 1) * 5 + cores * 10;
export const attackSpeed = (justice: number) => 1 + justice / 600;
export const overloadGain = (risk: string) => ({ HE: 2, WAW: 4, ALEPH: 6 }[risk] ?? 0);
const growthMatrix = [[0.60,0.60,0.72,0.84,0.60],[0.44,0.55,0.55,0.66,0.77],[0.30,0.40,0.50,0.50,0.60],[0.18,0.27,0.36,0.45,0.45],[0.08,0.16,0.24,0.32,0.40]];
export function workGrowth(points: number, risk: string, pe: number, stat: string, healthLost = 0, sanityLost = 0, training = 1) {
  const remaining = 1 - (stat === 'fortitude' ? healthLost : stat === 'prudence' ? sanityLost : (healthLost + sanityLost) / 2);
  const damage = stat === 'justice' ? 0.5 : remaining >= 0.9 ? 0.4 : remaining >= 0.8 ? 0.6 : remaining >= 0.7 ? 0.8 : remaining > 0.2 ? 1 : remaining > 0.1 ? 1.3 : 1.5;
  const level = growthMatrix[statTier(points) - 1]![Math.max(0, risks.indexOf(risk))]!;
  return Math.max(0, pe) * damage * level * training / 2;
}
const risks = ['ZAYIN', 'TETH', 'HE', 'WAW', 'ALEPH'];
const riskMatrix = [[1,1,1.2,1.5,2],[0.8,1,1,1.2,1.5],[0.7,0.8,1,1,1.2],[0.6,0.7,0.8,1,1],[0.4,0.6,0.7,0.8,1]];
export function riskMultiplier(attacker: string, target: string) {
  const row = risks.indexOf(target), column = risks.indexOf(attacker);
  return row < 0 || column < 0 ? 1 : riskMatrix[row]![column]!;
}
export function extractionMultiplier(risk: string, previous: number) {
  return Math.min(3, 1 + Math.max(0, previous) * (risks.indexOf(risk) + 1) / 10);
}
export function wikiWorkChance(agent: any, abno: any, observation = 0, overload = 0) {
  return (workType: string) => {
    const entry = wikiAbnormality(abno);
    const stat = ({ instinct: 'fortitude', insight: 'prudence', attachment: 'temperance', repression: 'justice' } as Record<string,string>)[workType]!;
    const rates = (entry?.preferences as Record<string, number[]> | undefined)?.[workType];
    if (!rates?.length) return null;
    const base = rates[statTier(rawPoints(agent, stat)) - 1]! / 100;
    const bonus = rawPoints(agent, 'temperance') / 500 + (observation >= 1 ? 0.05 : 0) + (observation >= 3 ? 0.05 : 0);
    return Math.max(0, Math.min(Math.max(0, 0.9 - overload / 100), base + bonus));
  };
}
export function rollWikiWork(abno: any, chance: number, random = Math.random) {
  const entry = wikiAbnormality(abno);
  if (!entry?.maxEnergy || !entry.good?.length || !entry.bad?.length) return null;
  const boxes = Array.from({length: entry.maxEnergy}, () => random() < chance).filter(Boolean).length;
  return { boxes, tier: boxes >= entry.good[0]! ? 'good' as const : boxes <= entry.bad[entry.bad.length - 1]! ? 'bad' as const : 'normal' as const };
}
