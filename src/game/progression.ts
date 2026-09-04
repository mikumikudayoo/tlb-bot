import { db } from '../db/database';
import { getWorkType } from '../config/workTypes';
import type { StatName, WorkType } from '../types/game';

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
  { name: 'dawn', meltdown: 1, colors: ['amber', 'crimson', 'green', 'violet'], hp: 100 },
  { name: 'noon', meltdown: 2, colors: ['green', 'indigo'], hp: 200 },
  { name: 'dusk', meltdown: 3, colors: ['green'], hp: 400 },
  { name: 'midnight', meltdown: 4, colors: ['green'], hp: 800 }
] as const;
export const EGO_CATALOG = [
  { id: 'penitence', source: 'One Sin and Hundreds of Good Deeds', script: 'O-03-03', category: 'weapon', lob: 10, pe: 3 },
  { id: 'penitence_suit', source: 'One Sin and Hundreds of Good Deeds', script: 'O-03-03', category: 'suit', lob: 10, pe: 3 },
  { id: 'mimicry', source: 'Nothing There', script: 'O-06-20', category: 'weapon', lob: 25, pe: 8 },
  { id: 'mimicry_suit', source: 'Nothing There', script: 'O-06-20', category: 'suit', lob: 25, pe: 8 }
] as const;
export const RESEARCH = {
  welfare_stims: { department: 'welfare', cost: 50 },
  command_shields: { department: 'command', cost: 50 },
  extended_stats: { department: 'training', cost: 100 }
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
export function statLimit(agent: any, facility?: any) {
  const extended = facilityProgress(facility).research.includes('extended_stats');
  const base = extended ? 150 : Math.min(150, Math.max(100, count(agent?.stat_limit)));
  return base + (agentProgress(agent).cards.includes('break_your_limits') ? 25 : 0);
}
export function growStat(agent: any, stat: StatName, amount: number, facility?: any) {
  if (!STATS.includes(stat)) throw new Error('unknown stat');
  const p = agentProgress(agent);
  const limit = statLimit(agent, facility);
  const before = count(p.points[stat]);
  const gain = Math.min(count(amount), Math.max(0, limit - before));
  p.points[stat] = before + gain;
  if (facilityProgress(facility).research.includes('extended_stats')) agent.stat_limit = 150;
  agent[stat] = Math.max(1, Math.ceil(p.points[stat] / 20));
  agent.progression = JSON.stringify(p);
  return { gain, current: p.points[stat], limit };
}
export function departmentRank(workCount: number) {
  return workCount >= 30 ? 'captain' : workCount >= 15 ? 'level 3' : workCount >= 5 ? 'level 2' : 'level 1';
}
export function awardWorkProgress(agent: any, abno: any, workType: WorkType, peBoxes: number, facility: any) {
  if (agent.status === 'dead') return 0;
  const growth = growStat(agent, getWorkType(workType).stat, peBoxes > 0 ? 1 : 0, facility);
  const p = agentProgress(agent);
  p.pe[String(abno.id)] = count(p.pe[String(abno.id)]) + count(peBoxes);
  const department = agent.department || 'control';
  p.tenure[department] = count(p.tenure[department]) + 1;
  if (Number(agent.level) >= 5 && !p.cards.includes('break_your_limits')) p.cards.push('break_your_limits');
  agent.progression = JSON.stringify(p);
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
    if (count(p.lob) < 5) throw new Error('training costs 5 personal LOB');
    const growth = growStat(agent, stat, 5, facility);
    if (!growth.gain) throw new Error('that stat is already at its limit');
    const updated = agentProgress(agent);
    updated.lob = p.lob - 5;
    saveAgentProgress(agent, updated);
    return { ...growth, agent };
  })();
}
export function purchaseEgo(guildId: string, userId: string, itemId: string) {
  return db.transaction(() => {
    const { agent } = getActor(guildId, userId);
    const item = EGO_CATALOG.find(entry => entry.id === itemId);
    if (!item) throw new Error('no extractable E.G.O. data for that item');
    const p = agentProgress(agent);
    if (!p.inventory.includes(item.id)) {
      const sources = db.query(`SELECT a.id, k.instinct_pe+k.insight_pe+k.attachment_pe+k.repression_pe AS observed
        FROM abnormalities a JOIN agent_abnormality_knowledge k ON k.guild_id=a.guild_id AND k.abnormality_id=a.id
        WHERE a.guild_id=? AND k.discord_id=? AND (a.name=? OR a.script_id=?) ORDER BY a.id`).all(guildId, userId, item.source, item.script) as any[];
      const source = sources.find(a => Number(a.observed) >= 8 && count(p.pe[String(a.id)]) >= item.pe);
      if (!source) throw new Error(`fully observe ${item.source} (8 unique observations) and earn ${item.pe} spendable PE from that same abnormality`);
      if (count(p.lob) < item.lob) throw new Error(`extraction costs ${item.lob} personal LOB`);
      p.pe[String(source.id)] -= item.pe;
      p.lob -= item.lob;
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
    if (p.research.includes(key)) throw new Error('research is already completed');
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
  if (count(charges[type]) < 1) throw new Error('no charges left; researched stims refill at the next day');
  if (type === 'health' || type === 'sanity') {
    const key = type === 'health' ? 'hp' : 'sp';
    if (agent[key] >= agent[`max_${key}`]) throw new Error(`${key} is already full`);
    agent[key] = Math.min(agent[`max_${key}`], agent[key] + Math.ceil(agent[`max_${key}`] * 0.25));
    if (type === 'sanity' && agent.sp > 0 && ['panicked', 'traumatized'].includes(agent.status)) {
      agent.status = 'recovering'; agent.panic_turns = 0; agent.panic_behavior = '';
    }
  } else agent[`shield_${type}`] = count(agent[`shield_${type}`]) + 25;
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
  p.core = { department, progress: 0, target: 5 };
  saveFacilityProgress(f, p);
}
export function advanceCore(facility: any, department: string, good: boolean) {
  const p = facilityProgress(facility);
  if (!p.core || p.core.department !== department || !good) return false;
  p.core.progress += 1;
  const cleared = p.core.progress >= p.core.target;
  if (cleared) { p.cores.push(department); p.core = null; }
  saveFacilityProgress(facility, p);
  return cleared;
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
  if (!stage || p.meltdown < stage.meltdown) return false;
  const color = stage.colors[Math.min(stage.colors.length - 1, Math.max(0, Math.floor(random() * stage.colors.length)))];
  p.ordeal = { stage: stage.name, color, hp: stage.hp, maxHp: stage.hp };
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
  const p = facilityProgress(facility);
  if (!p.ordeal) throw new Error('there is no active ordeal');
  p.ordeal.hp = Math.max(0, p.ordeal.hp - count(damage));
  const remaining = p.ordeal.hp;
  if (!remaining) {
    p.ordeal = null; facility.ordeal_active = 0; facility.active_ordeal = '';
    db.query("UPDATE facility SET ordeal_active=0, active_ordeal='', ordeal_timer=0 WHERE guild_id=?").run(facility.guild_id);
    db.query('UPDATE ordeal_events SET active=0 WHERE guild_id=?').run(facility.guild_id);
  }
  saveFacilityProgress(facility, p);
  return remaining;
}
export function resetProgressionDay(facility: any, quotaMet: boolean) {
  const p = facilityProgress(facility);
  Object.assign(p, { meltdown: 0, workCount: 0, ordealIndex: 0, ordeal: null });
  saveFacilityProgress(facility, p);
  const agents = db.query("SELECT * FROM agents WHERE guild_id=? AND status<>'dead'").all(facility.guild_id) as any[];
  for (const agent of agents) {
    const ap = agentProgress(agent);
    if (quotaMet) ap.lob = count(ap.lob) + 10;
    saveAgentProgress(agent, ap);
    db.query('UPDATE agents SET stim_charges=?, shield_red=0, shield_white=0, shield_black=0, shield_pale=0 WHERE guild_id=? AND discord_id=?').run(JSON.stringify(stimLoadout(facility)), facility.guild_id, agent.discord_id);
  }
}
