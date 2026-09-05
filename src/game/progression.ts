import { db } from '../db/database';
import { getWorkType } from '../config/workTypes';
import type { StatName, WorkType } from '../types/game';
import { statTier, agentTier, trainingCost, dayLob, overloadGain, extractionMultiplier, workGrowth } from './wikiRules';
import wikiEquipment from '../config/wikiEquipment.json';
import { createBoss, clearBossTarget, startBossSpecial } from './coreBoss';

// The supplied guide describes systems, but not prices or pacing. These are
// explicit Discord balance settings, not claims about the original game.
export const STATS: StatName[] = ['fortitude', 'prudence', 'temperance', 'justice'];
export const DEPARTMENTS = {
  control: { layer: 'Asiyah', sephirah: 'Malkuth' },
  information: { layer: 'Asiyah', sephirah: 'Yesod' },
  security: { layer: 'Asiyah', sephirah: 'Netzach' },
  training: { layer: 'Asiyah', sephirah: 'Hod' },
  command: { layer: 'Briah', sephirah: 'Tiphereth A and B' },
  disciplinary: { layer: 'Briah', sephirah: 'Gebura' },
  welfare: { layer: 'Briah', sephirah: 'Chesed' },
  extraction: { layer: 'Atziluth', sephirah: 'Binah' },
  record: { layer: 'Atziluth', sephirah: 'Hokma' }
} as const;
export const ORDEAL_STAGES = [
  { name: 'dawn', meltdown: 1, day: 6, reward: 0.10, colors: ['amber', 'crimson', 'green', 'violet'], hp: 100 },
  { name: 'noon', meltdown: 3, day: 11, reward: 0.15, colors: ['green', 'indigo', 'violet'], hp: 200 },
  { name: 'dusk', meltdown: 5, day: 21, reward: 0.20, colors: ['green', 'amber'], hp: 400 },
  { name: 'midnight', meltdown: 7, day: 26, reward: 0.25, colors: ['green', 'amber'], hp: 800 }
] as const;
export const EGO_CATALOG: Array<{ id: string; source: string; script?: string; category: 'weapon' | 'suit'; lob: number; pe: number; risk?: string }> = [
  { id: 'penitence', source: 'One Sin and Hundreds of Good Deeds', script: 'O-03-03', category: 'weapon', lob: 10, pe: 3 },
  { id: 'penitence_suit', source: 'One Sin and Hundreds of Good Deeds', script: 'O-03-03', category: 'suit', lob: 10, pe: 3 },
  { id: 'mimicry', source: 'Nothing There', script: 'O-06-20', category: 'weapon', lob: 280, pe: 280 },
  { id: 'mimicry_suit', source: 'Nothing There', script: 'O-06-20', category: 'suit', lob: 160, pe: 160 }
];
for (const item of wikiEquipment) {
  const old = EGO_CATALOG.findIndex(entry => entry.id === item.id);
  const entry = { ...item, category: item.category as 'weapon' | 'suit' };
  if (old >= 0) EGO_CATALOG[old] = entry;
  else EGO_CATALOG.push(entry);
}
export const RESEARCH = {
  welfare_stims: { department: 'welfare', cost: 50 },
  command_shields: { department: 'command', cost: 50 },
  extended_stats: { department: 'training', cost: 100 },
  joint_command: { department: 'control', cost: 50 },
  improved_stims: { department: 'welfare', cost: 50 }
} as const;

function object(value: any): any {
  try { const parsed = typeof value === 'string' ? JSON.parse(value) : value; return parsed && !Array.isArray(parsed) && typeof parsed === 'object' ? parsed : {}; }
  catch { return {}; }
}
const count = (value: any) => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
export function facilityProgress(facility: any): any {
  const p = object(facility?.progression);
  return { research: [], cores: [], core: null, meltdown: 0, workCount: 0, ordealIndex: 0, ordeal: null, offers: [], recruitmentDay: 0, ...p };
}
export function agentProgress(agent: any): any {
  const p = object(agent?.progression);
  // Existing 1-5 stats are tiers. Preserve those combat/script checks while
  // adding a 1-100 point scale; never multiply a migrated save a second time.
  const points = Object.fromEntries(STATS.map(stat => [stat, Math.min(100, Math.max(1, count(agent?.[stat]) * 20))]));
  return { lob: 10, inventory: [...new Set(['riot_stick', 'basic_suit', agent?.weapon, agent?.suit].filter(Boolean))], pe: {}, tenure: {}, cards: [], ...p, points: { ...points, ...object(p.points) } };
}
export function saveFacilityProgress(facility: any, progress: any) {
  facility.progression = JSON.stringify(progress);
  db.query('UPDATE facility SET progression=? WHERE guild_id=?').run(facility.progression, facility.guild_id);
}
function saveAgentProgress(agent: any, progress: any) {
  agent.progression = JSON.stringify(progress);
  db.query(`UPDATE agents SET progression=?, fortitude=?, prudence=?, temperance=?, justice=?,
    weapon=?, suit=?, hp=?, sp=?, stat_limit=? WHERE guild_id=? AND discord_id=?`).run(
    agent.progression, agent.fortitude, agent.prudence, agent.temperance, agent.justice,
    agent.weapon, agent.suit, agent.hp, agent.sp, agent.stat_limit ?? 100, agent.guild_id, agent.discord_id
  );
}
export function initializeProgressionSchema() {
  for (const table of ['agents', 'facility']) {
    const columns = db.query(`PRAGMA table_info(${table})`).all() as any[];
    if (!columns.some(c => c.name === 'progression')) db.query(`ALTER TABLE ${table} ADD COLUMN progression TEXT DEFAULT '{}'`).run();
  }
}

// Shared by the repository restore path; legacy snapshots have no extensions.
export function persistAgentExtensions(agent: any) {
  db.query(`UPDATE agents SET progression=?, stat_limit=?, pe_boxes=?, stim_charges=?,
    shield_red=?, shield_white=?, shield_black=?, shield_pale=? WHERE guild_id=? AND discord_id=?`).run(
    agent.progression ?? '{}', agent.stat_limit ?? 100, count(agent.pe_boxes),
    agent.stim_charges ?? '{}', count(agent.shield_red), count(agent.shield_white), count(agent.shield_black), count(agent.shield_pale),
    agent.guild_id, agent.discord_id
  );
}
export function statLimit(agent: any, facility?: any, stat?: StatName) {
  const extended = facilityProgress(facility).research.includes('extended_stats');
  const base = extended ? 150 : Math.min(150, Math.max(100, count(agent?.stat_limit)));
  return base + (agentProgress(agent).cards.includes('break_your_limits') ? 25 : 0) + (facilityProgress(facility).cores.includes('record') ? stat === 'justice' ? 30 : 10 : 0);
}
export function growStat(agent: any, stat: StatName, amount: number, facility?: any) {
  if (!STATS.includes(stat)) throw new Error('unknown stat');
  const p = agentProgress(agent);
  const limit = statLimit(agent, facility, stat);
  const before = count(p.points[stat]);
  const gain = Math.min(count(amount), Math.max(0, limit - before));
  p.points[stat] = before + gain;
  if (facilityProgress(facility).research.includes('extended_stats')) agent.stat_limit = 150;
  agent[stat] = statTier(p.points[stat]);
  agent.progression = JSON.stringify(p);
  return { gain, current: p.points[stat], limit };
}
export function departmentRank(workCount: number) {
  return workCount >= 30 ? 'captain' : workCount >= 15 ? 'level 3' : workCount >= 5 ? 'level 2' : 'level 1';
}
export function awardWorkProgress(agent: any, abno: any, workType: WorkType, peBoxes: number, facility: any, damage: { hp?: number; sp?: number } = {}) {
  if (agent.status === 'dead') return 0;
  const stat = getWorkType(workType).stat;
  const before = agentProgress(agent);
  const accumulated = Number(before.growth?.[stat] || 0) + workGrowth(before.points[stat], abno.risk, peBoxes, stat, damage.hp || 0, damage.sp || 0);
  const whole = Math.floor(accumulated + 1e-9);
  const growth = growStat(agent, stat, whole, facility);
  const p = agentProgress(agent);
  p.growth = { ...p.growth, [stat]: growth.current >= growth.limit ? 0 : accumulated - whole };
  p.pe[String(abno.id)] = count(p.pe[String(abno.id)]) + count(peBoxes);
  p.lob = count(p.lob) + count(peBoxes);
  const fp = facilityProgress(db.query('SELECT * FROM facility WHERE guild_id=?').get(facility.guild_id) || facility);
  fp.overload = { ...fp.overload, [String(abno.id)]: count(fp.overload?.[String(abno.id)]) + (peBoxes > 0 ? overloadGain(abno.risk) : 0) };
  saveFacilityProgress(facility, fp);
  const department = agent.department || 'control';
  p.tenure[department] = count(p.tenure[department]) + 1;
  agent.progression = JSON.stringify(p);
  agent.level = agentTier(STATS.map(stat => p.points[stat]));
  return growth.gain;
}
function getActor(guildId: string, userId: string) {
  const agent = db.query('SELECT * FROM agents WHERE guild_id=? AND discord_id=?').get(guildId, userId) as any;
  const facility = db.query('SELECT * FROM facility WHERE guild_id=?').get(guildId) as any;
  if (!agent || !facility) throw new Error('join the facility first');
  if (agent.status === 'dead' || agent.status === 'working') throw new Error('dead or working agents cannot use this action');
  return { agent, facility };
}
export function trainWithLob(guildId: string, userId: string, stat: StatName) {
  return db.transaction(() => {
    const { agent, facility } = getActor(guildId, userId);
    if (Number(facility.phase) !== 8) throw new Error('LOB training is available during the 08:00 intermission');
    const p = agentProgress(agent);
    if (!STATS.includes(stat)) throw new Error('unknown stat');
    const cost = trainingCost(stat);
    if (count(p.lob) < cost) throw new Error(`training costs ${cost} personal LOB`);
    const growth = growStat(agent, stat, 5, facility);
    if (!growth.gain) throw new Error('that stat is already at its limit');
    const updated = agentProgress(agent);
    updated.lob = p.lob - cost;
    agent.level = agentTier(STATS.map(stat => updated.points[stat]));
    saveAgentProgress(agent, updated);
    db.query('UPDATE agents SET level=? WHERE guild_id=? AND discord_id=?').run(agent.level, guildId, userId);
    return { ...growth, cost, agent };
  })();
}
export function purchaseEgo(guildId: string, userId: string, itemId: string) {
  return db.transaction(() => {
    const { agent, facility } = getActor(guildId, userId);
    const item = EGO_CATALOG.find(entry => entry.id === itemId);
    if (!item) throw new Error('that item isn’t available for extraction');
    const p = agentProgress(agent);
    if (!p.inventory.includes(item.id)) {
      const fp = facilityProgress(facility);
      const previous = count(fp.extractions?.[item.id]);
      const multiplier = extractionMultiplier(item.risk || 'ZAYIN', previous) * (fp.cores.includes('disciplinary') ? .5 : 1);
      const lob = Math.ceil(item.lob * multiplier), pe = Math.ceil(item.pe * multiplier);
      const sources = db.query(`SELECT a.id, k.instinct_pe+k.insight_pe+k.attachment_pe+k.repression_pe AS observed
        FROM abnormalities a JOIN agent_abnormality_knowledge k ON k.guild_id=a.guild_id AND k.abnormality_id=a.id
        WHERE a.guild_id=? AND k.discord_id=? AND (a.name=? OR a.script_id=?) ORDER BY a.id`).all(guildId, userId, item.source, item.script === 'X-XX-XX' ? null : item.script || null) as any[];
      const source = sources.find(a => Number(a.observed) >= 8 && count(p.pe[String(a.id)]) >= pe);
      if (!source) throw new Error(`fully observe ${item.source} (8 unique observations) and earn ${pe} spendable PE from that same abnormality`);
      if (count(p.lob) < lob) throw new Error(`extraction costs ${lob} personal LOB`);
      p.pe[String(source.id)] -= pe;
      p.lob -= lob;
      fp.extractions = { ...fp.extractions, [item.id]: previous + 1 };
      saveFacilityProgress(facility, fp);
      p.inventory.push(item.id);
    }
    agent[item.category] = item.id;
    saveAgentProgress(agent, p);
    return { agent, item };
  })();
}
export function researchProject(guildId: string, managerId: string, key: string) {
  return db.transaction(() => {
    const f = db.query('SELECT * FROM facility WHERE guild_id=?').get(guildId) as any;
    if (!f || f.manager_id !== managerId) throw new Error('manager only');
    const project = RESEARCH[key as keyof typeof RESEARCH];
    if (!project) throw new Error('unknown research project');
    const p = facilityProgress(f);
    if (!JSON.parse(f.department_unlocks || '[]').includes(project.department)) throw new Error(`unlock ${project.department} first`);
    if (p.research.includes(key)) throw new Error('that research is already finished');
    if (Number(f.lob_points) < project.cost) throw new Error(`research costs ${project.cost} facility LOB`);
    db.query('UPDATE facility SET lob_points=lob_points-? WHERE guild_id=?').run(project.cost, guildId);
    p.research.push(key);
    saveFacilityProgress(f, p);
    return project;
  })();
}
export function stimLoadout(facility: any) {
  const p = facilityProgress(facility);
  const care = p.research.includes('welfare_stims') ? 2 : 0;
  const shield = p.research.includes('command_shields') ? 1 : 0;
  return { health: care, sanity: care, red: shield, white: shield, black: shield, pale: shield && p.cores.includes('command') ? 1 : 0 };
}
export function useStim(agent: any, facility: any, type: string) {
  const enabled = stimLoadout(facility);
  if (!(type in enabled) || !enabled[type as keyof typeof enabled]) throw new Error('research this stim first; pale also requires the command core suppression');
  if (['dead', 'working'].includes(agent.status)) throw new Error('dead or working agents cannot use stims');
  const charges = object(agent.stim_charges);
  if (count(charges[type]) < 1) throw new Error('no charges left. unlocked stims refill each new day');
  if (type === 'health' || type === 'sanity') {
    const key = type === 'health' ? 'hp' : 'sp';
    if (agent[key] >= agent[`max_${key}`]) throw new Error(`${key} is already full`);
    agent[key] = Math.min(agent[`max_${key}`], agent[key] + (facilityProgress(facility).research.includes('improved_stims') ? 35 : 20));
    if (type === 'sanity' && agent.sp > 0 && ['panicked', 'traumatized'].includes(agent.status)) {
      agent.status = 'recovering'; agent.panic_turns = 0; agent.panic_behavior = '';
    }
  } else {
    for (const color of ['red', 'white', 'black', 'pale']) agent[`shield_${color}`] = 0;
    agent[`shield_${type}`] = 50;
    const p = agentProgress(agent);
    p.shieldExpiresAt = Date.now() + 20_000;
    agent.progression = JSON.stringify(p);
  }
  charges[type] -= 1;
  agent.stim_charges = JSON.stringify(charges);
  return charges[type];
}
export function startCore(guildId: string, managerId: string, department: string) {
  const f = db.query('SELECT * FROM facility WHERE guild_id=?').get(guildId) as any;
  if (!f || f.manager_id !== managerId) throw new Error('manager only');
  if (!(department in DEPARTMENTS) || !JSON.parse(f.department_unlocks || '[]').includes(department)) throw new Error('department is not unlocked');
  const p = facilityProgress(f);
  if (p.core || p.cores.includes(department)) throw new Error('a core challenge is already active or this core was cleared');
  const quest = db.query('SELECT complete FROM department_quests WHERE guild_id=? AND department=? AND complete=1').get(guildId, department);
  if (!quest) throw new Error('complete that department quest first');
  const day = department === 'extraction' || department === 'record' ? 41 : ['command','disciplinary','welfare'].includes(department) ? 35 : 20;
  if (Number(f.day_count) < day || Number(f.day_count) >= 46) throw new Error(`this core is available from day ${day} through day 45`);
  if (Number(f.phase) !== 8 || f.ordeal_active) throw new Error('start core suppression during the 08:00 intermission, without an active ordeal');
  const boss = department === 'disciplinary' ? createBoss('red_mist') : department === 'extraction' ? createBoss('arbiter') : null;
  if (boss?.kind === 'arbiter') {
    const targets = db.query('SELECT id FROM abnormalities WHERE guild_id=? AND is_breaching=0 ORDER BY id LIMIT 2').all(guildId) as any[];
    if (!targets.length) throw new Error('Binah needs at least one contained abnormality for special meltdowns');
    startBossSpecial(boss, targets.map(a => a.id), Date.now());
  }
  p.core = { department, version: 2, progress: 0, target: department === 'command' ? 10 : department === 'welfare' ? 8 : department === 'record' ? 11 : 6, boss };
  saveFacilityProgress(f, p);
}
export function advanceCore(facility: any, department: string, good: boolean) {
  facility = db.query('SELECT * FROM facility WHERE guild_id=?').get(facility.guild_id) || facility;
  const p = facilityProgress(facility);
  if (!p.core) return false;
  // Preserve an already-running legacy challenge when loading an old save.
  if (p.core.version !== 2 && (p.core.department !== department || !good)) return false;
  if (p.core.version !== 2) p.core.progress += 1;
  else p.core.progress = p.meltdown;
  const cleared = p.core.version !== 2 ? p.core.progress >= p.core.target : !facility.ordeal_active && !p.ordeal &&
    (p.core.boss ? p.core.boss.hp <= 0 : p.meltdown >= p.core.target && Number(facility.energy) >= Number(facility.quota));
  if (cleared) { p.cores = [...new Set([...p.cores, p.core.department])]; p.core = null; }
  saveFacilityProgress(facility, p);
  return cleared;
}
export function defuseBossMeltdown(guildId: string, abnormalityId: number, now = Date.now()) {
  const f = db.query('SELECT * FROM facility WHERE guild_id=?').get(guildId) as any;
  const p = facilityProgress(f);
  if (!p.core?.boss) return false;
  const players = db.query("SELECT COUNT(*) AS n FROM agents WHERE guild_id=? AND status<>'dead'").get(guildId) as any;
  if (!clearBossTarget(p.core.boss, abnormalityId, now, Number(players.n))) return false;
  saveFacilityProgress(f, p);
  return true;
}
export function defuseWorkMeltdown(guildId: string, abnormality: any) {
  const f = db.query('SELECT * FROM facility WHERE guild_id=?').get(guildId) as any;
  if (!f || !f.meltdown_alarm) return false;
  const targets: number[] = JSON.parse(f.meltdown_targets || '[]');
  if (!targets.includes(Number(abnormality.id))) return false;
  const remaining = targets.filter(id => id !== Number(abnormality.id));
  db.query('UPDATE facility SET meltdown_alarm=?, meltdown_targets=? WHERE guild_id=?').run(remaining.length ? 1 : 0, JSON.stringify(remaining), guildId);
  db.query("UPDATE abnormalities SET meltdown_timer=0, meltdown_state='stable' WHERE guild_id=? AND id=?").run(guildId, abnormality.id);
  abnormality.meltdown_timer = 0; abnormality.meltdown_state = 'stable';
  return true;
}
export function startOrdeal(facility: any, random = Math.random) {
  const p = facilityProgress(facility);
  if (facility.ordeal_active || p.ordeal) return false;
  const stage = ORDEAL_STAGES[p.ordealIndex];
  if (!stage || p.meltdown < stage.meltdown || Number(facility.day_count) < stage.day) return false;
  const color = Number(facility.day_count) >= 46 && Number(facility.day_count) <= 49 ? 'white' : stage.colors[Math.min(stage.colors.length - 1, Math.max(0, Math.floor(random() * stage.colors.length)))];
  p.ordeal = { stage: stage.name, color, hp: stage.hp, maxHp: stage.hp, reward: stage.reward };
  p.ordealIndex += 1;
  saveFacilityProgress(facility, p);
  facility.ordeal_active = 1; facility.active_ordeal = `${stage.name}:${color}`;
  db.query('UPDATE facility SET ordeal_active=1, active_ordeal=?, ordeal_timer=0 WHERE guild_id=?').run(facility.active_ordeal, facility.guild_id);
  db.query('INSERT INTO ordeal_events (guild_id, color, threshold, active, expires_at) VALUES (?, ?, ?, 1, 0)').run(facility.guild_id, color, stage.meltdown);
  return true;
}
export function migrateLegacyOrdeal(facility: any) {
  const p = facilityProgress(facility);
  if (!facility.ordeal_active || p.ordeal) return;
  const dawn = ORDEAL_STAGES[0];
  const color = (dawn.colors as readonly string[]).includes(facility.active_ordeal) ? facility.active_ordeal : 'amber';
  p.ordeal = { stage: 'dawn', color, hp: dawn.hp, maxHp: dawn.hp };
  p.ordealIndex = 1;
  saveFacilityProgress(facility, p);
  facility.active_ordeal = `dawn:${color}`;
  db.query('UPDATE facility SET active_ordeal=?, ordeal_timer=0 WHERE guild_id=?').run(facility.active_ordeal, facility.guild_id);
}
export function damageOrdeal(facility: any, damage: number) {
  facility = db.query('SELECT * FROM facility WHERE guild_id=?').get(facility.guild_id) || facility;
  const p = facilityProgress(facility);
  if (!p.ordeal) throw new Error('there is no active ordeal');
  p.ordeal.hp = Math.max(0, p.ordeal.hp - count(damage));
  const remaining = p.ordeal.hp;
  if (!remaining) {
    const stage = ORDEAL_STAGES.find(s => s.name === p.ordeal.stage);
    const reward = Math.floor(Number(facility.quota) * (stage?.reward ?? 0));
    db.query('UPDATE facility SET energy=energy+? WHERE guild_id=?').run(reward, facility.guild_id);
    p.ordeal = null; facility.ordeal_active = 0; facility.active_ordeal = '';
    db.query("UPDATE facility SET ordeal_active=0, active_ordeal='', ordeal_timer=0 WHERE guild_id=?").run(facility.guild_id);
    db.query('UPDATE ordeal_events SET active=0 WHERE guild_id=?').run(facility.guild_id);
  }
  saveFacilityProgress(facility, p);
  return remaining;
}
export function resetProgressionDay(facility: any, quotaMet: boolean) {
  const p = facilityProgress(facility);
  Object.assign(p, { meltdown: 0, workCount: 0, ordealIndex: 0, ordeal: null, overload: {} });
  saveFacilityProgress(facility, p);
  const agents = db.query("SELECT * FROM agents WHERE guild_id=? AND status<>'dead'").all(facility.guild_id) as any[];
  for (const agent of agents) {
    const ap = agentProgress(agent);
    ap.lob = count(ap.lob) + dayLob(Number(facility.day_count), p.cores.length);
    saveAgentProgress(agent, ap);
    db.query('UPDATE agents SET stim_charges=?, shield_red=0, shield_white=0, shield_black=0, shield_pale=0 WHERE guild_id=? AND discord_id=?').run(JSON.stringify(stimLoadout(facility)), facility.guild_id, agent.discord_id);
  }
}
