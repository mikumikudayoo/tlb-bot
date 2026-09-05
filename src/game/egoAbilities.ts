// TLB Nothing There, The Silent Orchestra and Mountain Of Smiling Bodies pages.
// Combos resolve as one Discord action; individual hit timing is not simulated.
function progress(agent: any) {
  try { return JSON.parse(agent.progression || '{}'); } catch { return {}; }
}
export function rollEgoAttack(agent: any, weapon: { min: number; max: number }, ability = false, random = Math.random) {
  const roll = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  if (ability) {
    if (agent.weapon !== 'mimicry') throw new Error('this weapon has no implemented active ability yet; Mimicry supports Downslam');
    return { damage: roll(80,130), defense: .5, name: 'Downslam' };
  }
  if (agent.weapon === 'da_capo') return { damage: Array.from({length:4},()=>roll(5,6)).reduce((a,b)=>a+b,0) + roll(6,7), defense: 1, name: 'Da Capo combo' };
  if (agent.weapon === 'smile') {
    const count = Math.max(0, Math.min(10, Math.floor(Number(progress(agent).smileCorpses) || 0)));
    const min = [12,14,16,18,21,23,26,28,31,33,36][count]!;
    return { damage: roll(min,min+6), defense: 1, name: 'Smile' };
  }
  return { damage: roll(weapon.min,weapon.max), defense: 1, name: 'attack' };
}
export function finishEgoAttack(agent: any, damageDealt: number, killed: boolean) {
  if (agent.status === 'dead') return;
  if (agent.weapon === 'mimicry') agent.hp = Math.min(agent.max_hp, agent.hp + Math.floor(Math.max(0,damageDealt) * .25));
  if (agent.weapon === 'smile' && killed) {
    const p = progress(agent);
    p.smileCorpses = Math.min(10, Math.max(0, Number(p.smileCorpses) || 0) + 1);
    agent.progression = JSON.stringify(p);
    agent.hp = Math.min(agent.max_hp, agent.hp + Math.floor(agent.max_hp * .25));
  }
}
