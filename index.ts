import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  ChannelType,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  User
} from 'discord.js';
import { clamp } from './src/utils/clamp';
import { rand, pick } from './src/utils/random';
import { json } from './src/utils/json';
import { getWorkType } from './src/config/workTypes';
import { db as facilityDb } from './src/db/database';
import {
  WORK_LEVEL_MAX,
  BEHAVIOUR_INFO,
  ABNORMALITY_TEMPLATES,
  DAMAGE_TYPES,
  EGO_GIFTS,
  EGO_EQUIPMENT_SEED,
  EGO_WEAPONS,
  EGO_SUITS,
  RISK_VALUES,
  TRAITS,
  getBehaviour,
  getDisplayAbnormality,
  getCurrentWorkAffinity,
  getMeltdownState,
  getShiftProfile,
  getPanicBehaviorKey,
  resolvePanicBehavior,
  applyPanicState,
  calculateWorkChance,
  workQuality,
  getPEBoxTotal,
  nextPhase
} from './src/game/logic';
import { ABNORMALITY_SCRIPTS as externalAbnoScripts } from './src/game/abnormalities/scripts';
import type { AbnormalityScript, DamageType, DepartmentName, GiftDef, PanicBehaviorKey, StatName, UpgradeType, WorkType } from './src/types/game';

export const db = facilityDb;

// Re-export key functions from src/game/logic.ts
export { getShiftProfile, resolvePanicBehavior };

// ==========================================
// 🏢 LOBOTOMY CORPORATION — FACILITY SIM V2
// ==========================================
// This version keeps the original idea, but turns the facility into a stateful
// management game: agents have stats and traits, abnormalities have work
// affinities and behaviour, days generate events, breaches create combat,
// resources can be invested, and saves preserve the whole simulation state.

const MAX_SAVE_SLOTS = 5;
const SUPPRESSION_COOLDOWNS = new Map<string, number>();

// ABNORMALITY_SCRIPTS is now loaded from externalAbnoScripts (src/game/abnormalities/scripts.ts)
const ABNORMALITY_SCRIPTS: Record<string, AbnormalityScript> = externalAbnoScripts;

const LOBOTOMY_EMOJIS = {
  work: { instinct: 'Instinct', insight: 'Insight', attachment: 'Attachment', repression: 'Repression' },
  meltdown: { stable: '🟢', unstable: '🟡', critical: '🟠', meltdown: '🔴' },
  containment: { safe: '🟢', breach: '🚨', danger: '⚠️', critical: '☠️' },
  risk: { ZAYIN: 'Risk_Zayin', TETH: 'Risk_Teth', HE: 'Risk_He', WAW: 'Risk_Waw', ALEPH: 'Risk_Aleph' },
  damage: { RED: 'RedDamageTypeIcon', WHITE: 'WhiteDamageTypeIcon', BLACK: 'BlackDamageTypeIcon', PALE: 'PaleDamageTypeIcon' },
  result: { good: 'GoodResult', normal: 'NormalResult', bad: 'BadResult' },
  warn: { 1: 'Warn_1', 2: 'Warn_2', 3: 'Warn_3' },
  stat: { fortitude: 'FortitudeIcon', prudence: 'PrudenceIcon', temperance: 'TemperanceIcon', justice: 'JusticeIcon' },
  hp: 'HPIcon',
  sp: 'SPIcon'
} as const;

const OBSERVATION_LEVELS = [
  { level: 1, title: 'basic observation', description: 'basic containment observations' },
  { level: 2, title: 'qliphoth log', description: 'exact qliphoth triggers and meltdown timing' },
  { level: 3, title: 'ego extraction', description: 'weapon and suit extraction from PE pool' },
  { level: 4, title: 'institutional memory', description: 'deeper records and E.G.O gift access' }
] as const;

const ORDEAL_STAGES = [
  { threshold: 150, color: 'amber', label: 'Amber Ordeal' },
  { threshold: 300, color: 'crimson', label: 'Crimson Ordeal' },
  { threshold: 500, color: 'green', label: 'Green Ordeal' }
] as const;

const DEPARTMENT_SECTORS: Record<DepartmentName, string> = {
  general: 'central-command',
  control: 'control-dept',
  information: 'information-dept',
  security: 'security-dept',
  training: 'training-dept',
  command: 'central-command'
};

function getGuildEmojiObject(guild: any, emojiName: string) {
  const name = String(emojiName || '').trim();
  if (!name) return null;

  return guild?.emojis?.cache?.find((entry: any) => entry.name?.toLowerCase() === name.toLowerCase())
    ?? (globalThis as any).client?.emojis?.cache?.find((entry: any) => entry.name?.toLowerCase() === name.toLowerCase())
    ?? null;
}

function getGuildEmojiString(guild: any, emojiName: string, fallback = ''): string {
  const found = getGuildEmojiObject(guild, emojiName);
  return found ? found.toString() : fallback;
}

function isCriticallyLow(agent: any) {
  return agent.hp <= agent.max_hp * 0.2 || agent.sp <= agent.max_sp * 0.2;
}

function buildCombatWarningRow(abnoId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`suppress_confirm_${abnoId}`)
      .setLabel('⚔️ CONTINUE')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`suppress_retreat_${abnoId}`)
      .setLabel('🏃 RETREAT')
      .setStyle(ButtonStyle.Secondary)
  );
}

// RISK_VALUES is now imported from src/game/logic.ts

// ==========================================
// 🗃️ DATABASE SCHEMA + LIGHTWEIGHT MIGRATIONS
// ==========================================

function addColumnIfMissing(table: string, column: string, definition: string) {
  const columns = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some(c => c.name === column)) {
    db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

db.query(`
  CREATE TABLE IF NOT EXISTS agents (
    discord_id TEXT NOT NULL,
    guild_id TEXT NOT NULL DEFAULT '',
    name TEXT,
    hp INTEGER DEFAULT 100,
    max_hp INTEGER DEFAULT 100,
    sp INTEGER DEFAULT 100,
    max_sp INTEGER DEFAULT 100,
    weapon TEXT DEFAULT 'riot_stick',
    suit TEXT DEFAULT 'basic_suit',
    status TEXT DEFAULT 'idle',
    level INTEGER DEFAULT 1,
    fortitude INTEGER DEFAULT 1,
    prudence INTEGER DEFAULT 1,
    temperance INTEGER DEFAULT 1,
    justice INTEGER DEFAULT 1,
    experience INTEGER DEFAULT 0,
    trait TEXT DEFAULT 'calm',
    recovery_days INTEGER DEFAULT 0,
    assignments INTEGER DEFAULT 0,
    kills INTEGER DEFAULT 0,
    promotions INTEGER DEFAULT 0,
    panic_turns INTEGER DEFAULT 0,
    panic_behavior TEXT DEFAULT '',
    PRIMARY KEY (guild_id, discord_id)
  )
`).run();

// Upgrade the original single-server agent table to a composite guild-aware key.
// Old rows are preserved; their guild_id stays blank because the legacy schema did not store it.
const agentPkInfo = db.query(`PRAGMA table_info(agents)`).all() as Array<{ name: string; pk: number }>;
if (agentPkInfo.find(c => c.name === 'discord_id')?.pk === 1 && !agentPkInfo.some(c => c.name === 'guild_id' && c.pk === 1)) {
  db.query(`ALTER TABLE agents RENAME TO agents_legacy`).run();
  db.query(`
    CREATE TABLE agents (
      discord_id TEXT NOT NULL,
      guild_id TEXT NOT NULL DEFAULT '',
      name TEXT,
      hp INTEGER DEFAULT 100,
      max_hp INTEGER DEFAULT 100,
      sp INTEGER DEFAULT 100,
      max_sp INTEGER DEFAULT 100,
      weapon TEXT DEFAULT 'riot_stick',
      suit TEXT DEFAULT 'basic_suit',
      status TEXT DEFAULT 'idle',
      level INTEGER DEFAULT 1,
      fortitude INTEGER DEFAULT 1,
      prudence INTEGER DEFAULT 1,
      temperance INTEGER DEFAULT 1,
      justice INTEGER DEFAULT 1,
      experience INTEGER DEFAULT 0,
      trait TEXT DEFAULT 'calm',
      recovery_days INTEGER DEFAULT 0,
      assignments INTEGER DEFAULT 0,
      kills INTEGER DEFAULT 0,
      promotions INTEGER DEFAULT 0,
      panic_turns INTEGER DEFAULT 0,
      panic_behavior TEXT DEFAULT '',
      PRIMARY KEY (guild_id, discord_id)
    )
  `).run();
  db.query(`
    INSERT INTO agents (
      discord_id, guild_id, name, hp, max_hp, sp, max_sp, weapon, suit, status,
      level, fortitude, prudence, temperance, justice, experience, trait,
      recovery_days, assignments, kills, promotions
    )
    SELECT discord_id, COALESCE(guild_id, ''), name, hp, max_hp, sp, max_sp, weapon, suit, status,
      level, fortitude, prudence, temperance, justice, experience, trait,
      recovery_days, assignments, kills, promotions
    FROM agents_legacy
  `).run();
  db.query(`DROP TABLE agents_legacy`).run();
}

// Make old legacy agents usable when their owner joins a guild again.
function adoptLegacyAgent(discordId: string, guildId: string) {
  const legacy = db.query(`SELECT * FROM agents WHERE discord_id = ? AND guild_id = ''`).get(discordId) as any;
  if (!legacy) return;
  const existing = db.query(`SELECT * FROM agents WHERE discord_id = ? AND guild_id = ?`).get(discordId, guildId) as any;
  if (existing) return;
  db.query(`UPDATE agents SET guild_id = ? WHERE discord_id = ? AND guild_id = ''`).run(guildId, discordId);
}

for (const [column, definition] of [
  ['level', 'INTEGER DEFAULT 1'], ['fortitude', 'INTEGER DEFAULT 1'], ['prudence', 'INTEGER DEFAULT 1'],
  ['temperance', 'INTEGER DEFAULT 1'], ['justice', 'INTEGER DEFAULT 1'], ['experience', 'INTEGER DEFAULT 0'],
  ['trait', "TEXT DEFAULT 'calm'"], ['recovery_days', 'INTEGER DEFAULT 0'], ['assignments', 'INTEGER DEFAULT 0'],
  ['kills', 'INTEGER DEFAULT 0'], ['promotions', 'INTEGER DEFAULT 0'],
  ['ego_gifts', "TEXT DEFAULT '[]'"], ['equipped_gift', "TEXT DEFAULT ''"], ['department', "TEXT DEFAULT 'general'"], ['auto_response', "TEXT DEFAULT ''"],
  ['travel_origin', "TEXT DEFAULT ''"], ['travel_destination', "TEXT DEFAULT ''"], ['travel_remaining', 'INTEGER DEFAULT 0'],
  ['panic_turns', 'INTEGER DEFAULT 0'], ['panic_behavior', "TEXT DEFAULT ''"]
] as const) addColumnIfMissing('agents', column, definition);

// Existing v2 agents used the old synthetic 'general' sector. Route them into Control.
db.query(`UPDATE agents SET department='control' WHERE department IS NULL OR department='' OR department='general'`).run();

db.query(`
  CREATE TABLE IF NOT EXISTS facility (
    guild_id TEXT PRIMARY KEY,
    energy INTEGER DEFAULT 0,
    quota INTEGER DEFAULT 50,
    dictator_mode INTEGER DEFAULT 0,
    manager_id TEXT,
    is_started INTEGER DEFAULT 0,
    is_paused INTEGER DEFAULT 0,
    day_count INTEGER DEFAULT 1,
    phase INTEGER DEFAULT 8,
    category_id TEXT,
    control_channel_id TEXT,
    containment_channel_id TEXT,
    status_channel_id TEXT,
    radio_channel_id TEXT,
    research INTEGER DEFAULT 100,
    lob_points INTEGER DEFAULT 250,
    containment_level INTEGER DEFAULT 1,
    security_level INTEGER DEFAULT 1,
    welfare_level INTEGER DEFAULT 1,
    event_seed INTEGER DEFAULT 0,
    stable_days INTEGER DEFAULT 0,
    meltdown_alarm INTEGER DEFAULT 0,
    meltdown_targets TEXT DEFAULT '[]',
    department_unlocks TEXT DEFAULT '[]',
    recruitment_points INTEGER DEFAULT 0,
    current_sector TEXT DEFAULT 'control'
  )
`).run();

for (const [column, definition] of [
  ['phase', 'INTEGER DEFAULT 8'], ['research', 'INTEGER DEFAULT 100'], ['lob_points', 'INTEGER DEFAULT 250'],
  ['containment_level', 'INTEGER DEFAULT 1'], ['security_level', 'INTEGER DEFAULT 1'],
  ['welfare_level', 'INTEGER DEFAULT 1'], ['event_seed', 'INTEGER DEFAULT 0'], ['stable_days', 'INTEGER DEFAULT 0'],
  ['meltdown_alarm', 'INTEGER DEFAULT 0'], ['meltdown_targets', "TEXT DEFAULT '[]'"],
  ['department_unlocks', "TEXT DEFAULT '[]'"], ['recruitment_points', 'INTEGER DEFAULT 0'],
  ['ordeal_active', 'INTEGER DEFAULT 0'], ['active_ordeal', "TEXT DEFAULT ''"], ['ordeal_timer', 'INTEGER DEFAULT 0'],
  ['current_sector', "TEXT DEFAULT 'control'"], ['control_channel_id', "TEXT DEFAULT ''"],
  ['status_channel_id', "TEXT DEFAULT ''"], ['radio_channel_id', "TEXT DEFAULT ''"]
] as const) addColumnIfMissing('facility', column, definition);

db.query(`
  CREATE TABLE IF NOT EXISTS abnormalities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT,
    name TEXT,
    risk TEXT,
    hp INTEGER,
    max_hp INTEGER,
    qliphoth INTEGER,
    max_qliphoth INTEGER,
    damage_type TEXT,
    damage_amt INTEGER,
    is_breaching INTEGER DEFAULT 0,
    work_instinct REAL DEFAULT 0.5,
    work_insight REAL DEFAULT 0.5,
    work_attachment REAL DEFAULT 0.5,
    work_repression REAL DEFAULT 0.5,
    escape_chance REAL DEFAULT 0.0,
    behaviour TEXT DEFAULT 'docile',
    description TEXT DEFAULT '',
    rage INTEGER DEFAULT 0,
    breaches INTEGER DEFAULT 0,
    suppressed_count INTEGER DEFAULT 0,
    current_work_process TEXT DEFAULT '',
    meltdown_timer INTEGER DEFAULT 0,
    meltdown_state TEXT DEFAULT 'stable'
  )
`).run();

for (const [column, definition] of [
  ['work_instinct', 'REAL DEFAULT 0.5'], ['work_insight', 'REAL DEFAULT 0.5'], ['work_attachment', 'REAL DEFAULT 0.5'],
  ['work_repression', 'REAL DEFAULT 0.5'], ['escape_chance', 'REAL DEFAULT 0.0'], ['behaviour', "TEXT DEFAULT 'docile'"],
  ['description', "TEXT DEFAULT ''"], ['rage', 'INTEGER DEFAULT 0'], ['breaches', 'INTEGER DEFAULT 0'],
  ['suppressed_count', 'INTEGER DEFAULT 0'], ['last_worked_by', "TEXT DEFAULT ''"], ['work_streak', 'INTEGER DEFAULT 0'],
  ['gift_id', "TEXT DEFAULT ''"], ['current_work_process', "TEXT DEFAULT ''"], ['meltdown_timer', 'INTEGER DEFAULT 0'],
  ['meltdown_state', "TEXT DEFAULT 'stable'"], ['sector', "TEXT DEFAULT 'control'"], ['observation_level', 'INTEGER DEFAULT 0'],
  ['research_points', 'INTEGER DEFAULT 0'], ['can_breach', 'INTEGER DEFAULT 1'], ['is_tool', 'INTEGER DEFAULT 0'],
  ['script_id', "TEXT DEFAULT ''"]
] as const) addColumnIfMissing('abnormalities', column, definition);

db.query(`
  CREATE TABLE IF NOT EXISTS ego_equipment (
    id TEXT PRIMARY KEY,
    guild_id TEXT DEFAULT '',
    category TEXT DEFAULT 'weapon',
    name TEXT,
    damage_type TEXT,
    min_damage INTEGER DEFAULT 0,
    max_damage INTEGER DEFAULT 0,
    speed REAL DEFAULT 1.0,
    red REAL DEFAULT 1.0,
    white REAL DEFAULT 1.0,
    black REAL DEFAULT 1.0,
    pale REAL DEFAULT 1.0,
    defense INTEGER DEFAULT 0,
    description TEXT DEFAULT '',
    rarity TEXT DEFAULT 'common'
  )
`).run();

for (const item of EGO_EQUIPMENT_SEED) {
  db.query(`INSERT OR IGNORE INTO ego_equipment (id, guild_id, category, name, damage_type, min_damage, max_damage, speed, red, white, black, pale, defense, description, rarity)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(item.id, '', item.category, item.name, item.type ?? 'RED', item.min ?? 0, item.max ?? 0, item.speed ?? 1.0, item.red ?? 1.0, item.white ?? 1.0, item.black ?? 1.0, item.pale ?? 1.0, item.defense ?? 0, item.description, 'common');
}

export function getAbnormalityScript(abno: any): AbnormalityScript | null {
  const scriptId = abno?.script_id ?? '';
  return scriptId ? ABNORMALITY_SCRIPTS[scriptId] ?? null : null;
}

db.query(`
  CREATE TABLE IF NOT EXISTS save_files (
    save_name TEXT,
    guild_id TEXT,
    state_json TEXT,
    day_count INTEGER,
    energy INTEGER,
    quota INTEGER,
    dictator_mode INTEGER,
    saved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (save_name, guild_id)
  )
`).run();
addColumnIfMissing('save_files', 'state_json', 'TEXT');

db.query(`
  CREATE TABLE IF NOT EXISTS facility_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT,
    day INTEGER,
    phase INTEGER,
    type TEXT,
    message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

db.query(`
  CREATE TABLE IF NOT EXISTS codex_entries (
    guild_id TEXT,
    abnormality_name TEXT,
    observation_level INTEGER DEFAULT 0,
    data_json TEXT DEFAULT '{}',
    unlocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id, abnormality_name)
  )
`).run();

// Knowledge belongs to the AGENT, not the facility.
// Two positive PE boxes reveal a work type; eight total reveal the full description.
db.query(`
  CREATE TABLE IF NOT EXISTS agent_abnormality_knowledge (
    guild_id TEXT NOT NULL,
    discord_id TEXT NOT NULL,
    abnormality_id INTEGER NOT NULL,
    instinct_pe INTEGER DEFAULT 0,
    insight_pe INTEGER DEFAULT 0,
    attachment_pe INTEGER DEFAULT 0,
    repression_pe INTEGER DEFAULT 0,
    management_tips INTEGER DEFAULT 0,
    description_unlocked INTEGER DEFAULT 0,
    first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id, discord_id, abnormality_id)
  )
`).run();

db.query(`
  CREATE TABLE IF NOT EXISTS agent_work_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    discord_id TEXT NOT NULL,
    day INTEGER NOT NULL,
    phase INTEGER NOT NULL,
    abnormality_id INTEGER NOT NULL,
    abnormality_name TEXT NOT NULL,
    work_type TEXT NOT NULL,
    result TEXT NOT NULL,
    pe_boxes INTEGER DEFAULT 0,
    qliphoth_change INTEGER DEFAULT 0,
    damage INTEGER DEFAULT 0,
    note TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

db.query(`
  CREATE TABLE IF NOT EXISTS agent_abnormality_observations (
    guild_id TEXT NOT NULL,
    discord_id TEXT NOT NULL,
    abnormality_id INTEGER NOT NULL,
    work_type TEXT NOT NULL,
    attempts INTEGER DEFAULT 0,
    good INTEGER DEFAULT 0,
    normal INTEGER DEFAULT 0,
    bad INTEGER DEFAULT 0,
    critical INTEGER DEFAULT 0,
    qliphoth_gains INTEGER DEFAULT 0,
    qliphoth_losses INTEGER DEFAULT 0,
    PRIMARY KEY (guild_id, discord_id, abnormality_id, work_type)
  )
`).run();

db.query(`
  CREATE TABLE IF NOT EXISTS agent_relationships (
    guild_id TEXT NOT NULL,
    from_discord_id TEXT NOT NULL,
    to_discord_id TEXT NOT NULL,
    trust INTEGER DEFAULT 0,
    shared_shifts INTEGER DEFAULT 0,
    positive_shifts INTEGER DEFAULT 0,
    difficult_shifts INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id, from_discord_id, to_discord_id)
  )
`).run();

db.query(`
  CREATE TABLE IF NOT EXISTS memory_checkpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT,
    day_count INTEGER,
    energy INTEGER,
    quota INTEGER,
    facility_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

db.query(`
  CREATE TABLE IF NOT EXISTS ordeal_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT,
    color TEXT,
    threshold INTEGER,
    active INTEGER DEFAULT 0,
    expires_at INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

db.query(`
  CREATE TABLE IF NOT EXISTS department_quests (
    guild_id TEXT,
    department TEXT,
    description TEXT,
    goal TEXT,
    progress INTEGER DEFAULT 0,
    complete INTEGER DEFAULT 0,
    PRIMARY KEY (guild_id, department, goal)
  )
`).run();

// ==========================================
// 🛠️ HELPERS
// ==========================================
// clamp, rand, pick, and json are now imported from src/utils/

const FAVOR_LABELS = [
  { min: 0.00, label: 'Very Low' },
  { min: 0.28, label: 'Low' },
  { min: 0.44, label: 'Normal' },
  { min: 0.62, label: 'High' },
  { min: 0.80, label: 'Very High' }
] as const;

function getFavorLabel(score: number) {
  const value = clamp(Number(score) || 0, 0, 1);
  let label = 'Very Low';
  for (const entry of FAVOR_LABELS) {
    if (value >= entry.min) label = entry.label;
  }
  return label;
}

function getWorkFavorLabel(abno: any, workType: WorkType, statLevel: number) {
  const affinity = getCurrentWorkAffinity(abno, workType);
  // The underlying affinity is intentionally hidden. The table behaves like a
  // staff-facing preference chart: higher employee tiers reveal better/worse
  // compatibility without exposing the numeric simulation formula.
  const normalizedLevel = clamp(Math.floor(statLevel), 1, 5);
  const score = affinity + (normalizedLevel - 3) * 0.06;
  return getFavorLabel(score);
}

function ensureAgentKnowledge(guildId: string, discordId: string, abnormalityId: number) {
  db.query(`
    INSERT OR IGNORE INTO agent_abnormality_knowledge
      (guild_id, discord_id, abnormality_id)
    VALUES (?, ?, ?)
  `).run(guildId, discordId, abnormalityId);

  return db.query(`
    SELECT * FROM agent_abnormality_knowledge
    WHERE guild_id=? AND discord_id=? AND abnormality_id=?
  `).get(guildId, discordId, abnormalityId) as any;
}

function getAgentKnowledge(guildId: string, discordId: string, abnormalityId: number) {
  return ensureAgentKnowledge(guildId, discordId, abnormalityId);
}

function totalUniquePE(knowledge: any) {
  return ['instinct_pe', 'insight_pe', 'attachment_pe', 'repression_pe']
    .reduce((sum, key) => sum + clamp(Number(knowledge?.[key] ?? 0), 0, 2), 0);
}

function updateAgentKnowledge(
  guildId: string,
  discordId: string,
  abnormalityId: number,
  workType: WorkType,
  positiveBoxes: number
) {
  const knowledge = ensureAgentKnowledge(guildId, discordId, abnormalityId);
  const field = `${workType}_pe`;
  const current = clamp(Number(knowledge?.[field] ?? 0), 0, 2);
  const gained = clamp(Math.floor(positiveBoxes), 0, 2);
  const next = clamp(current + gained, 0, 2);

  db.query(`
    UPDATE agent_abnormality_knowledge
    SET ${field}=?, last_seen_at=CURRENT_TIMESTAMP
    WHERE guild_id=? AND discord_id=? AND abnormality_id=?
  `).run(next, guildId, discordId, abnormalityId);

  const total = totalUniquePE({
    ...knowledge,
    [field]: next
  });

  const tips = total >= 4 ? 1 : 0;
  const description = total >= 8 ? 1 : 0;

  db.query(`
    UPDATE agent_abnormality_knowledge
    SET management_tips=?, description_unlocked=?, last_seen_at=CURRENT_TIMESTAMP
    WHERE guild_id=? AND discord_id=? AND abnormality_id=?
  `).run(tips, description, guildId, discordId, abnormalityId);

  return {
    knowledge: db.query(`
      SELECT * FROM agent_abnormality_knowledge
      WHERE guild_id=? AND discord_id=? AND abnormality_id=?
    `).get(guildId, discordId, abnormalityId) as any,
    newlyUnlockedWorkFavor: next === 2 && current < 2,
    newlyUnlockedTips: tips === 1 && Number(knowledge?.management_tips ?? 0) === 0,
    newlyUnlockedDescription: description === 1 && Number(knowledge?.description_unlocked ?? 0) === 0
  };
}

export function recordAgentWorkHistory(entry: {
  guildId: string;
  discordId: string;
  day: number;
  phase: number;
  abnormalityId: number;
  abnormalityName: string;
  workType: WorkType;
  result: 'good' | 'normal' | 'bad' | 'critical';
  peBoxes: number;
  qliphothChange: number;
  damage: number;
  note?: string;
}) {
  db.query(`
    INSERT INTO agent_work_history
      (guild_id, discord_id, day, phase, abnormality_id, abnormality_name, work_type, result, pe_boxes, qliphoth_change, damage, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.guildId, entry.discordId, entry.day, entry.phase, entry.abnormalityId,
    entry.abnormalityName, entry.workType, entry.result, Math.max(0, Math.floor(entry.peBoxes)),
    Math.sign(entry.qliphothChange), Math.max(0, Math.floor(entry.damage)), entry.note ?? ''
  );
}

export function recordAgentObservation(entry: {
  guildId: string;
  discordId: string;
  abnormalityId: number;
  workType: WorkType;
  result: 'good' | 'normal' | 'bad' | 'critical';
  qliphothChange: number;
}) {
  db.query(`
    INSERT INTO agent_abnormality_observations (guild_id, discord_id, abnormality_id, work_type)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, discord_id, abnormality_id, work_type) DO NOTHING
  `).run(entry.guildId, entry.discordId, entry.abnormalityId, entry.workType);

  db.query(`
    UPDATE agent_abnormality_observations
    SET attempts=attempts+1,
        ${entry.result}=${entry.result}+1,
        qliphoth_gains=qliphoth_gains+?,
        qliphoth_losses=qliphoth_losses+?
    WHERE guild_id=? AND discord_id=? AND abnormality_id=? AND work_type=?
  `).run(
    entry.qliphothChange > 0 ? 1 : 0,
    entry.qliphothChange < 0 ? 1 : 0,
    entry.guildId,
    entry.discordId,
    entry.abnormalityId,
    entry.workType
  );
}

function getObservationConfidence(attempts: number) {
  if (attempts >= 10) return 'confirmed';
  if (attempts >= 7) return 'consistent';
  if (attempts >= 4) return 'probable';
  if (attempts >= 2) return 'suspected';
  return 'unconfirmed';
}

function getAgentObservations(guildId: string, discordId: string, abnormalityId: number) {
  return db.query(`
    SELECT * FROM agent_abnormality_observations
    WHERE guild_id=? AND discord_id=? AND abnormality_id=?
    ORDER BY work_type
  `).all(guildId, discordId, abnormalityId) as any[];
}

export function updateAgentRelationship(guildId: string, fromDiscordId: string, toDiscordId: string, trustChange: number) {
  if (fromDiscordId === toDiscordId) return;
  db.query(`
    INSERT INTO agent_relationships (guild_id, from_discord_id, to_discord_id)
    VALUES (?, ?, ?)
    ON CONFLICT(guild_id, from_discord_id, to_discord_id) DO NOTHING
  `).run(guildId, fromDiscordId, toDiscordId);

  const change = clamp(Math.round(trustChange), -2, 2);
  db.query(`
    UPDATE agent_relationships
    SET trust=MAX(-10, MIN(10, trust + ?)), updated_at=CURRENT_TIMESTAMP
    WHERE guild_id=? AND from_discord_id=? AND to_discord_id=?
  `).run(change, guildId, fromDiscordId, toDiscordId);
}

function recordSharedShiftRelationships(guildId: string, workerId: string, result: 'good' | 'normal' | 'bad' | 'critical') {
  const coworkers = db.query(`
    SELECT discord_id FROM agents
    WHERE guild_id=? AND discord_id<>? AND status<>'dead'
  `).all(guildId, workerId) as Array<{ discord_id: string }>;
  const trustChange = result === 'good' ? 1 : result === 'critical' ? -2 : result === 'bad' ? -1 : 0;
  for (const coworker of coworkers) {
    updateAgentRelationship(guildId, workerId, coworker.discord_id, trustChange);
    updateAgentRelationship(guildId, coworker.discord_id, workerId, trustChange);
    for (const [fromId, toId] of [
      [workerId, coworker.discord_id],  
      [coworker.discord_id, workerId]
    ] as Array<[string, string]>) {
      db.query(`
        UPDATE agent_relationships
        SET shared_shifts=shared_shifts+1,
            positive_shifts=positive_shifts+?,
            difficult_shifts=difficult_shifts+?
        WHERE guild_id=? AND from_discord_id=? AND to_discord_id=?
      `).run(
        result === 'good' ? 1 : 0,
        result === 'bad' || result === 'critical' ? 1 : 0,
        guildId,
        fromId,
        toId
      );
    }
  }
}

function getRelationshipLabel(trust: number) {
  if (trust >= 6) return 'trusting';
  if (trust >= 2) return 'friendly';
  if (trust <= -6) return 'uneasy';
  if (trust <= -2) return 'distrustful';
  return 'neutral';
}

function getPhaseLabel(phase: number) {
  const labels: Record<number, string> = {
    8: 'Morning', 10: 'Morning Shift', 12: 'Midday', 14: 'Afternoon',
    16: 'Afternoon Shift', 18: 'Evening', 20: 'Overtime', 22: 'Emergency'
  };
  return labels[phase] ?? `${String(phase).padStart(2, '0')}:00`;
}

function buildManagementTips(abno: any, agent: any) {
  const observations = getAgentObservations(agent.guild_id, agent.discord_id, abno.id);
  const tips = observations
    .filter(observation => observation.attempts >= 2)
    .map(observation => {
      const attempts = Number(observation.attempts);
      const good = Number(observation.good);
      const bad = Number(observation.bad) + Number(observation.critical);
      const confidence = getObservationConfidence(attempts);
      const workLabel = getWorkType(observation.work_type as WorkType).label;
      if (good > bad) {
        return `${workLabel} work appears beneficial (${confidence}; ${attempts} observations).`;
      }
      if (bad > good) {
        return `${workLabel} work appears risky for this abnormality (${confidence}; ${attempts} observations).`;
      }
      return `${workLabel} work has produced mixed results (${confidence}; ${attempts} observations).`;
    });

  return tips.length
    ? tips
    : ['no repeated behavioral pattern is confirmed yet; continue testing different work types.'];
}

function buildInformationEmbed(
  guild: any,
  agent: any,
  abno: any,
  section: 'overview' | 'tips' | 'favor'
) {
  const knowledge = getAgentKnowledge(agent.guild_id, agent.discord_id, abno.id);
  const unique = totalUniquePE(knowledge);
  const displayed = getDisplayAbnormality(abno, [abno]);

  const embed = new EmbedBuilder()
    .setTitle(`Information — ${displayed.name}`)
    .setFooter({ text: `personal observation record · ${unique}/8 unique PE boxes recorded` });

  if (section === 'overview') {
    const description = knowledge.description_unlocked
      ? abno.description
      : unique >= 4
        ? 'The record contains enough observations to form a preliminary understanding, but the original description remains incomplete.'
        : 'No complete description has been recorded. Continue working with the abnormality to build an observation record.';

    embed
      .setDescription(description)
      .addFields(
        { name: 'Risk', value: `${displayed.risk}`, inline: true },
        { name: 'Qliphoth', value: `${abno.qliphoth}/${abno.max_qliphoth}`, inline: true },
        { name: 'Observed PE', value: `${unique}/8`, inline: true },
        {
          name: 'Observation state',
          value: knowledge.description_unlocked
            ? 'complete description unlocked'
            : knowledge.management_tips
              ? 'preliminary notes available'
              : 'initial observation',
          inline: false
        }
      );
  }

  if (section === 'tips') {
    if (!knowledge.management_tips) {
      embed
        .setDescription('🔒 **management tips locked**')
        .addFields({
          name: 'How to unlock',
          value: `record at least **4/8 unique PE boxes** through your own work with this abnormality.`
        });
    } else {
      embed
        .setDescription(
          buildManagementTips(abno, agent).map((tip, index) => `${index + 1}. ${tip}`).join('\n')
        )
        .addFields({
          name: 'Record state',
          value: knowledge.description_unlocked
            ? 'complete'
            : 'partial — keep observing'
        });
    }
  }

  if (section === 'favor') {
    const workTypes: WorkType[] = ['instinct', 'insight', 'attachment', 'repression'];
    for (const workType of workTypes) {
      const field = `${workType}_pe`;
      const observed = clamp(Number(knowledge?.[field] ?? 0), 0, 2);
      if (observed < 2) {
        embed.addFields({
          name: getWorkType(workType).label.toUpperCase(),
          value: `🔒 **LOCKED** — ${observed}/2 unique PE boxes`,
          inline: true
        });
        continue;
      }

      const levels = [1, 2, 3, 4, 5]
        .map(level => {
          const roman = ['I', 'II', 'III', 'IV', 'V'][level - 1];
          return `${roman}   ${getWorkFavorLabel(abno, workType, level)}`;
        })
        .join('\n');

      embed.addFields({
        name: getWorkType(workType).label.toUpperCase(),
        value: levels,
        inline: true
      });
    }

    embed.addFields({
      name: 'Discovery',
      value: unique >= 8
        ? '✨ all work preferences have been fully documented.'
        : `keep working to discover the remaining preferences. **${unique}/8** unique PE boxes recorded.`
    });
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`info_overview_${abno.id}`).setLabel('Overview').setStyle(section === 'overview' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`info_tips_${abno.id}`).setLabel('Management Tips').setStyle(section === 'tips' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`info_favor_${abno.id}`).setLabel('Work Favor').setStyle(section === 'favor' ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );

  return { embed, row };
}

function logEvent(guildId: string, day: number, phase: number, type: string, message: string) {
  db.query(`INSERT INTO facility_events (guild_id, day, phase, type, message) VALUES (?, ?, ?, ?, ?)`).run(
    guildId, day, phase, type, message
  );
}

async function ensureFacilityChannels(guild: any, facility: any) {
  if (!guild || !facility || !Number(facility.is_started)) return facility;

  const getChannel = (id: unknown) => id ? guild.channels?.cache?.get(String(id)) as any : null;
  let category = getChannel(facility.category_id);

  if (!category || category.type !== ChannelType.GuildCategory) {
    category = await guild.channels.create({ name: '🏢 LOBOTOMY CORP', type: ChannelType.GuildCategory });
  }

  const ensureTextChannel = async (id: unknown, name: string) => {
    let channel = getChannel(id);
    if (!channel || channel.type !== ChannelType.GuildText) {
      channel = await guild.channels.create({ name, type: ChannelType.GuildText, parent: category.id });
    } else if (channel.parentId !== category.id) {
      await channel.setParent(category.id).catch(() => {});
    }
    return channel;
  };

  const control = await ensureTextChannel(facility.control_channel_id, '📢-control-team');
  const containment = await ensureTextChannel(facility.containment_channel_id, '⚠️-containment-chambers');
  const status = await ensureTextChannel(facility.status_channel_id, '📊-facility-status');
  const radio = await ensureTextChannel(facility.radio_channel_id, '📻-facility-radio');

  db.query(`
    UPDATE facility SET category_id=?, control_channel_id=?, containment_channel_id=?, status_channel_id=?, radio_channel_id=?
    WHERE guild_id=?
  `).run(category.id, control.id, containment.id, status.id, radio.id, facility.guild_id ?? guild.id);

  return {
    ...facility,
    category_id: category.id,
    control_channel_id: control.id,
    containment_channel_id: containment.id,
    status_channel_id: status.id,
    radio_channel_id: radio.id
  };
}

export async function sendFacilityRadio(guild: any, facility: any, message: string) {
  if (!guild || !facility) return false;
  const repaired = await ensureFacilityChannels(guild, facility);
  const channelId = String(repaired?.radio_channel_id ?? '');
  if (!channelId) return false;

  const channel = guild.channels?.cache?.get(channelId) as any;
  if (!channel?.send) return false;

  await channel.send({ content: `📻 **FACILITY RADIO**

${message}` });
  return true;
}

const AMBIENT_RADIO_MESSAGES = [
  'CONTROL: good morning, employees. please ignore the sound coming from containment wing 4.',
  'an elevator arrives on a floor that does not exist on the facility map.',
  'CONTROL: agent 17, report to training. agent 17: why? CONTROL: you are being promoted. agent 17: oh.',
  'the lights flicker in the corridor. the maintenance report says there was no power fluctuation.',
  'someone has left a warm cup of coffee beside an inactive research terminal. nobody claims it.',
  'CONTROL: please remain calm. this announcement is not related to the distant piano note.'
];

export function createAmbientRadioEvent(guildId: string, facility: any, roll = Math.random()) {
  if (roll >= 0.10) return null;

  const index = Math.floor(Math.max(0, roll) * AMBIENT_RADIO_MESSAGES.length / 0.10) % AMBIENT_RADIO_MESSAGES.length;
  const message = AMBIENT_RADIO_MESSAGES[index]!;
  logEvent(guildId, Number(facility.day_count), Number(facility.phase), 'ambient_event', message);
  return message;
}

function statValue(agent: any, stat: StatName) {
  return Number(agent[stat] ?? 1);
}

function getTrait(agent: any) {
  const traitMap: Record<string, (typeof TRAITS)[keyof typeof TRAITS]> = TRAITS;
  return traitMap[agent.trait] ?? TRAITS.calm;
}

function getSuit(agent: any) {
  const suitMap: Record<string, (typeof EGO_SUITS)[keyof typeof EGO_SUITS]> = EGO_SUITS;
  return suitMap[agent.suit] ?? EGO_SUITS.basic_suit;
}

function getWeapon(agent: any) {
  const weaponMap: Record<string, (typeof EGO_WEAPONS)[keyof typeof EGO_WEAPONS]> = EGO_WEAPONS;
  return weaponMap[agent.weapon] ?? EGO_WEAPONS.riot_stick;
}

function getGift(agent: any): GiftDef | null {
  return agent?.equipped_gift ? (EGO_GIFTS[agent.equipped_gift] ?? null) : null;
}

// Effective stat = base stat + whatever an equipped E.G.O. gift adds. Use this
// instead of statValue() anywhere a gift's bonus should actually matter.
function getEffectiveStat(agent: any, stat: StatName) {
  const gift = getGift(agent);
  return statValue(agent, stat) + (gift?.statBonus?.[stat] ?? 0);
}

function calculateMaxHp(fortitude: number) {
  return 90 + fortitude * 12;
}

function calculateMaxSp(prudence: number, agent?: any) {
  let max = 80 + prudence * 12;
  const gift = agent ? getGift(agent) : null;
  if (gift?.maxSpMult) max = Math.floor(max * gift.maxSpMult);
  return max;
}

function syncAgentMaxStats(agent: any) {
  const newMaxHp = calculateMaxHp(agent.fortitude);
  const newMaxSp = calculateMaxSp(agent.prudence, agent);
  const hpRatio = agent.max_hp > 0 ? agent.hp / agent.max_hp : 1;
  const spRatio = agent.max_sp > 0 ? agent.sp / agent.max_sp : 1;

  return {
    maxHp: newMaxHp,
    maxSp: newMaxSp,
    hp: clamp(Math.floor(newMaxHp * hpRatio), 0, newMaxHp),
    sp: clamp(Math.floor(newMaxSp * spRatio), 0, newMaxSp)
  };
}

function applyDamage(agent: any, amount: number, type: string) {
  const suit = getSuit(agent)!;
  let multiplier = 1.0;
  if (type === 'RED') multiplier = suit.red;
  if (type === 'WHITE') multiplier = suit.white;
  if (type === 'BLACK') multiplier = suit.black;
  if (type === 'PALE') multiplier = suit.pale;

  const gift = getGift(agent) as GiftDef | null;
  if (gift?.incomingDamageMult) amount = amount * gift.incomingDamageMult;

  const trait = agent.trait === 'cautious' ? 0.90 : (agent.trait === 'reckless' ? 1.10 : 1.0);
  const defense = Math.max(0.75, 1 - suit.defense * 0.04);
  const actualDamage = Math.max(0, Math.floor(amount * multiplier * trait * defense));

  if (type === 'RED' || type === 'BLACK') agent.hp -= actualDamage;
  if (type === 'WHITE' || type === 'BLACK') agent.sp -= actualDamage;
  if (type === 'PALE') agent.hp -= Math.floor(agent.max_hp * (amount / 100) * multiplier);

  if (agent.hp <= 0) {
    agent.hp = 0;
    agent.status = 'dead';
  } else if (agent.sp <= 0 && agent.status !== 'dead') {
    agent.sp = 0;
    applyPanicState(agent);
  } else if (agent.hp < agent.max_hp * 0.35 && agent.status === 'idle') {
    agent.status = 'injured';
  } else if (agent.sp < agent.max_sp * 0.4 && agent.status === 'idle') {
    agent.status = 'stressed';
  }

  return actualDamage;
}

function updateAgent(agent: any) {
  db.query(`
    UPDATE agents SET hp=?, max_hp=?, sp=?, max_sp=?, status=?, experience=?, level=?,
    fortitude=?, prudence=?, temperance=?, justice=?, trait=?, recovery_days=?, assignments=?, kills=?, promotions=?,
    ego_gifts=?, equipped_gift=?, department=?, auto_response=?, travel_origin=?, travel_destination=?, travel_remaining=?,
    panic_turns=?, panic_behavior=?
    WHERE discord_id=? AND guild_id=?
  `).run(
    agent.hp, agent.max_hp, agent.sp, agent.max_sp, agent.status, agent.experience, agent.level,
    agent.fortitude, agent.prudence, agent.temperance, agent.justice, agent.trait,
    agent.recovery_days, agent.assignments, agent.kills, agent.promotions,
    agent.ego_gifts ?? '[]', agent.equipped_gift ?? '', agent.department ?? 'control', agent.auto_response ?? '',
    agent.travel_origin ?? '', agent.travel_destination ?? '', Math.max(0, Number(agent.travel_remaining ?? 0)),
    Math.max(0, Number(agent.panic_turns ?? 0)), String(agent.panic_behavior ?? ''),
    agent.discord_id, agent.guild_id
  );
}

function experienceToNext(level: number) {
  return 45 + (level - 1) * 35;
}

function awardExperience(agent: any, amount: number) {
  const messages: string[] = [];
  agent.experience += amount;

  while (agent.experience >= experienceToNext(agent.level)) {
    agent.experience -= experienceToNext(agent.level);
    agent.level += 1;
    const stat = pick<StatName>(['fortitude', 'prudence', 'temperance', 'justice']);
    agent[stat] += 1;
    agent.promotions += 1;
    const synced = syncAgentMaxStats(agent);
    agent.max_hp = synced.maxHp;
    agent.max_sp = synced.maxSp;
    agent.hp = clamp(agent.hp + 10, 0, agent.max_hp);
    agent.sp = clamp(agent.sp + 10, 0, agent.max_sp);
    messages.push(`🌟 **level up!** ${agent.name} reached **level ${agent.level}** and gained +1 ${stat}!`);
  }

  return messages;
}

function findAgent(userId: string, guildId?: string) {
  if (guildId) return db.query(`SELECT * FROM agents WHERE discord_id = ? AND guild_id = ?`).get(userId, guildId) as any;
  return db.query(`SELECT * FROM agents WHERE discord_id = ?`).get(userId) as any;
}

function ensureFacility(guildId: string, managerId: string) {
  db.query(`INSERT OR IGNORE INTO facility (guild_id, manager_id) VALUES (?, ?)`).run(guildId, managerId);
  let facility = db.query(`SELECT * FROM facility WHERE guild_id = ?`).get(guildId) as any;
  if (!facility.manager_id) {
    db.query(`UPDATE facility SET manager_id = ? WHERE guild_id = ?`).run(managerId, guildId);
    facility.manager_id = managerId;
  }
  if (facility.department_unlocks == null || facility.department_unlocks === '') {
    db.query(`UPDATE facility SET department_unlocks=? WHERE guild_id=?`).run(json(['control']), guildId);
    facility.department_unlocks = json(['control']);
  }
  ensureDepartmentQuestRows(guildId);
  syncDepartmentUnlocks(guildId, facility);
  if (facility.meltdown_targets == null || facility.meltdown_targets === '') {
    db.query(`UPDATE facility SET meltdown_targets='[]' WHERE guild_id=?`).run(guildId);
    facility.meltdown_targets = '[]';
  }
  if (facility.ordeal_active == null) {
    db.query(`UPDATE facility SET ordeal_active=0, active_ordeal='', ordeal_timer=0 WHERE guild_id=?`).run(guildId);
    facility.ordeal_active = 0;
    facility.active_ordeal = '';
    facility.ordeal_timer = 0;
  }
  return facility;
}

export function createMemoryCheckpoint(guildId: string, facility: any) {
  const snapshot = serializeFacility(guildId);
  db.query(`INSERT INTO memory_checkpoints (guild_id, day_count, energy, quota, facility_json) VALUES (?, ?, ?, ?, ?)`).run(
    guildId, facility.day_count, facility.energy, facility.quota, json(snapshot)
  );
  db.query(`
    DELETE FROM memory_checkpoints
    WHERE guild_id=? AND id NOT IN (
      SELECT id FROM memory_checkpoints WHERE guild_id=? ORDER BY id DESC LIMIT 5
    )
  `).run(guildId, guildId);
  return true;
}

export function restoreLatestMemoryCheckpoint(guildId: string) {
  const latest = db.query(`SELECT * FROM memory_checkpoints WHERE guild_id = ? ORDER BY id DESC LIMIT 1`).get(guildId) as any;
  if (!latest) return false;

  const snapshot = JSON.parse(latest.facility_json ?? '{}');
  if (!snapshot?.facility) return false;

  restoreState(guildId, snapshot);
  db.query(`UPDATE facility SET day_count=?, energy=?, quota=? WHERE guild_id=?`).run(latest.day_count, latest.energy, latest.quota, guildId);
  return true;
}

function maybeUnlockCodexEntry(guildId: string, abno: any, level: number) {
  const entry = db.query(`SELECT * FROM codex_entries WHERE guild_id=? AND abnormality_name=?`).get(guildId, abno.name) as any;
  const current = Number(entry?.observation_level ?? 0);
  if (level <= current) return false;

  db.query(`
    INSERT INTO codex_entries (guild_id, abnormality_name, observation_level, data_json)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, abnormality_name) DO UPDATE SET
      observation_level=MAX(codex_entries.observation_level, excluded.observation_level),
      data_json=excluded.data_json
  `).run(
    guildId,
    abno.name,
    level,
    json({ risk: abno.risk, damage_type: abno.damage_type, qliphoth: abno.max_qliphoth, sector: abno.sector ?? 'control' })
  );

  // The Information quest counts UNIQUE abnormalities that reach full documentation.
  if (current < 4 && level >= 4) recordDepartmentProgress(guildId, 'information', 1);
  return true;
}

function maybeTriggerOrdeal(guildId: string, facility: any) {
  if (!facility || facility.ordeal_active) return false;
  for (const stage of ORDEAL_STAGES) {
    if (Number(facility.energy) >= stage.threshold) {
      const color = stage.color;
      const expiresAt = Date.now() + 60000;
      db.query(`UPDATE facility SET ordeal_active=1, active_ordeal=?, ordeal_timer=? WHERE guild_id=?`).run(color, expiresAt, guildId);
      db.query(`INSERT INTO ordeal_events (guild_id, color, threshold, active, expires_at) VALUES (?, ?, ?, 1, ?)`).run(guildId, color, stage.threshold, expiresAt);
      logEvent(guildId, facility.day_count, facility.phase, 'ordeal', `${stage.label} triggered: ${color.toUpperCase()} invaders are active in the facility.`);
      return true;
    }
  }
  return false;
}

// getPanicBehaviorKey, resolvePanicBehavior, applyPanicState are now imported from src/game/logic.ts

function panicSupportChance(guildId: string, agent: any, facility: any) {
  const strongest = db.query(`
    SELECT MAX(trust) AS trust FROM agent_relationships
    WHERE guild_id=? AND to_discord_id=?
  `).get(guildId, agent.discord_id) as { trust?: number } | null;
  const trustBonus = Math.max(0, Number(strongest?.trust ?? 0)) * 0.015;
  const welfareBonus = Math.max(0, Number(facility?.welfare_level ?? 1) - 1) * 0.025;
  const calmBonus = agent.trait === 'calm' ? 0.08 : 0;
  return clamp(0.12 + trustBonus + welfareBonus + calmBonus, 0.08, 0.55);
}

function resolvePanicPhase(guildId: string, facility: any) {
  const panicked = db.query(`SELECT * FROM agents WHERE guild_id=? AND status='panicked'`).all(guildId) as any[];
  const messages: string[] = [];
  const breached: any[] = [];

  for (const agent of panicked) {
    applyPanicState(agent);
    const behavior = (agent.panic_behavior || getPanicBehaviorKey(agent)) as PanicBehaviorKey;
    agent.panic_behavior = behavior;
    agent.panic_turns = Number(agent.panic_turns ?? 0) + 1;
    let action = '';

    if (behavior === 'wander') {
      const targets = db.query(`SELECT * FROM abnormalities WHERE guild_id=? AND is_breaching=0 ORDER BY RANDOM() LIMIT 1`).all(guildId) as any[];
      const target = targets[0];
      if (target) {
        target.rage = Math.min(10, Number(target.rage ?? 0) + 1);
        if (Math.random() < 0.30) target.qliphoth = Math.max(0, Number(target.qliphoth) - 1);
        if (target.qliphoth <= 0 && Number(target.can_breach ?? 1)) {
          target.qliphoth = target.max_qliphoth;
          target.is_breaching = 1;
          target.breaches = Number(target.breaches ?? 0) + 1;
          breached.push(target);
        }
        db.query(`UPDATE abnormalities SET qliphoth=?, rage=?, is_breaching=?, breaches=? WHERE id=?`).run(
          target.qliphoth, target.rage, target.is_breaching, target.breaches, target.id
        );
        action = `🚪 **${agent.name}** wandered into containment and disturbed **${target.name}**.`;
      }
    } else if (behavior === 'breach_seeking') {
      const target = db.query(`
        SELECT * FROM abnormalities WHERE guild_id=? AND is_breaching=0 AND can_breach=1
        ORDER BY CASE risk WHEN 'ALEPH' THEN 5 WHEN 'WAW' THEN 4 WHEN 'HE' THEN 3 WHEN 'TETH' THEN 2 ELSE 1 END DESC, RANDOM()
        LIMIT 1
      `).get(guildId) as any;
      if (target) {
        target.qliphoth = Math.max(0, Number(target.qliphoth) - 1);
        target.rage = Math.min(10, Number(target.rage ?? 0) + 2);
        if (target.qliphoth <= 0) {
          target.qliphoth = target.max_qliphoth;
          target.is_breaching = 1;
          target.breaches = Number(target.breaches ?? 0) + 1;
          breached.push(target);
        }
        db.query(`UPDATE abnormalities SET qliphoth=?, rage=?, is_breaching=?, breaches=? WHERE id=?`).run(
          target.qliphoth, target.rage, target.is_breaching, target.breaches, target.id
        );
        action = `🧠 **${agent.name}** tried to force open **${target.name}**'s containment unit.`;
      }
    } else if (behavior === 'lockdown') {
      const lost = Math.min(Number(facility.energy ?? 0), 5 + rand(0, 5));
      db.query(`UPDATE facility SET energy=MAX(0, energy-?) WHERE guild_id=?`).run(lost, guildId);
      facility.energy = Math.max(0, Number(facility.energy ?? 0) - lost);
      action = `🔒 **${agent.name}** jammed department controls. **${lost} energy** was lost.`;
    } else {
      const target = db.query(`
        SELECT * FROM agents WHERE guild_id=? AND discord_id<>? AND status<>'dead'
        ORDER BY RANDOM() LIMIT 1
      `).get(guildId, agent.discord_id) as any;
      if (target) {
        const damage = applyDamage(target, 8 + Number(agent.justice ?? 1) * 2, 'RED');
        applyPanicState(target);
        updateAgent(target);
        action = `⚔️ **${agent.name}** lashed out at **${target.name}**, dealing **${damage} RED damage**.`;
        updateAgentRelationship(guildId, target.discord_id, agent.discord_id, -2);
      }
    }

    if (!action) action = `🧠 **${agent.name}** is panicking: ${resolvePanicBehavior(agent)}.`;
    messages.push(action);
    logEvent(guildId, Number(facility.day_count), Number(facility.phase), 'panic', action.replace(/\*\*/g, ''));

    const support = panicSupportChance(guildId, agent, facility);
    if (Math.random() < support) {
      agent.sp = Math.max(1, Math.floor(agent.max_sp * 0.30));
      agent.status = 'stressed';
      agent.recovery_days = Math.max(1, Number(agent.recovery_days ?? 0));
      agent.panic_turns = 0;
      agent.panic_behavior = '';
      messages.push(`🤝 **${agent.name}** was stabilized by nearby staff.`);
    } else if (agent.panic_turns >= 3) {
      agent.status = 'traumatized';
      agent.recovery_days = Math.max(2, Number(agent.recovery_days ?? 0));
      agent.panic_turns = 0;
      agent.panic_behavior = '';
      messages.push(`🧠 **${agent.name}** exhausted themselves and was moved to recovery.`);
    }

    updateAgent(agent);
  }

  return { messages, breached };
}

function seedAbnormalities(guildId: string) {
  const existing = db.query(`SELECT COUNT(*) AS count FROM abnormalities WHERE guild_id = ?`).get(guildId) as { count: number };
  if (Number(existing.count) > 0) return;

  for (const template of ABNORMALITY_TEMPLATES) {
    const giftId = (template as any).gift?.id ?? '';
    const activeProcess = pick<WorkType>(['instinct', 'insight', 'attachment', 'repression']);
    const meltdownTimer = 30 + rand(5, 15);
    db.query(`
      INSERT INTO abnormalities (
        guild_id, name, risk, hp, max_hp, qliphoth, max_qliphoth, damage_type, damage_amt,
        work_instinct, work_insight, work_attachment, work_repression, escape_chance, behaviour, description, gift_id,
        current_work_process, meltdown_timer, meltdown_state, script_id, can_breach, is_tool
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      guildId, template.name, template.risk, template.hp, template.hp, template.qliphoth, template.qliphoth,
      template.damage_type, template.damage_amt, template.instinct, template.insight, template.attachment,
      template.repression, template.escape_chance, template.behaviour, template.description, giftId,
      activeProcess, meltdownTimer, 'stable', (template as any).script_id ?? '', (template as any).can_breach ?? 1, (template as any).is_tool ?? 0
    );
  }
}

// getCurrentWorkAffinity and getMeltdownState are now imported from src/game/logic.ts

const DEPARTMENT_META: Record<string, { label: string; unlockSource: string; bonus: string }> = {
  control: { label: 'Control', unlockSource: 'initial assignment', bonus: '+4% work consistency' },
  information: { label: 'Information', unlockSource: 'complete the Control quest', bonus: 'accelerates observation and recordkeeping' },
  security: { label: 'Security', unlockSource: 'complete the Information quest', bonus: '+10% HP/SP recovery' },
  training: { label: 'Training', unlockSource: 'complete the Security quest', bonus: '+1 training yield per day' },
  command: { label: 'Central Command', unlockSource: 'complete the Training quest', bonus: 'global command routing' }
};

const DEPARTMENT_QUESTS: Record<string, { description: string; goal: string; target: number; unlocks?: string }> = {
  control: { description: 'Stabilize standard work output', goal: 'collect 40 energy through agent work', target: 40, unlocks: 'information' },
  information: { description: 'Turn personal observation into institutional knowledge', goal: 'fully document 3 unique abnormalities', target: 3, unlocks: 'security' },
  security: { description: 'Prove the facility can recover from containment failure', goal: 'suppress 2 breaches', target: 2, unlocks: 'training' },
  training: { description: 'Build a staff capable of surviving deeper work', goal: 'complete 3 stat training sessions', target: 3, unlocks: 'command' },
  command: { description: 'Coordinate full-facility operations', goal: 'finish 6 quota-complete days', target: 6 }
};

function getUnlockedDepartments(facility: any): string[] {
  try {
    const raw = JSON.parse(facility?.department_unlocks || '[]');
    return Array.isArray(raw) ? raw as string[] : [];
  } catch {
    return [];
  }
}

export function ensureDepartmentQuestRows(guildId: string) {
  for (const [department, quest] of Object.entries(DEPARTMENT_QUESTS)) {
    const existing = db.query(`SELECT * FROM department_quests WHERE guild_id=? AND department=? AND goal=?`).get(guildId, department, quest.goal) as any;
    if (!existing) {
      db.query(`INSERT INTO department_quests (guild_id, department, description, goal, progress, complete) VALUES (?, ?, ?, ?, 0, 0)`).run(
        guildId, department, quest.description, quest.goal
      );
    }
  }
}

export function evaluateDepartmentUnlocks(facility: any): string[] {
  return [...new Set(['control', ...getUnlockedDepartments(facility)])];
}

export function syncDepartmentUnlocks(guildId: string, facility: any) {
  ensureDepartmentQuestRows(guildId);
  const unlocked = new Set<string>(evaluateDepartmentUnlocks(facility));
  const completed = db.query(`SELECT department FROM department_quests WHERE guild_id=? AND complete=1`).all(guildId) as Array<{ department: string }>;

  for (const row of completed) {
    const unlock = DEPARTMENT_QUESTS[row.department]?.unlocks;
    if (unlock) unlocked.add(unlock);
  }

  const ordered = ['control', 'information', 'security', 'training', 'command'].filter(dept => unlocked.has(dept));
  db.query(`UPDATE facility SET department_unlocks=? WHERE guild_id=?`).run(json(ordered), guildId);
  if (facility) facility.department_unlocks = json(ordered);
  return ordered;
}

function isDepartmentUnlocked(facility: any, department: string) {
  return evaluateDepartmentUnlocks(facility).includes(department);
}

export function updateDepartmentQuestProgress(guildId: string, department: string, delta: number) {
  const quest = DEPARTMENT_QUESTS[department];
  if (!quest) return 0;
  ensureDepartmentQuestRows(guildId);

  const row = db.query(`SELECT * FROM department_quests WHERE guild_id=? AND department=? AND goal=?`).get(guildId, department, quest.goal) as any;
  if (!row) return 0;
  if (Number(row.complete)) return Number(row.progress ?? quest.target);

  const nextProgress = clamp(Number(row.progress ?? 0) + Math.max(0, Number(delta)), 0, quest.target);
  const complete = nextProgress >= quest.target ? 1 : 0;
  db.query(`UPDATE department_quests SET progress=?, complete=? WHERE guild_id=? AND department=? AND goal=?`).run(
    nextProgress, complete, guildId, department, quest.goal
  );

  if (complete && !Number(row.complete)) {
    const facility = db.query(`SELECT * FROM facility WHERE guild_id=?`).get(guildId) as any;
    const unlocked = syncDepartmentUnlocks(guildId, facility);
    const nextDepartment = quest.unlocks;
    const message = nextDepartment && unlocked.includes(nextDepartment)
      ? `${department} quest complete. ${nextDepartment} department unlocked.`
      : `${department} quest complete.`;
    logEvent(guildId, Number(facility?.day_count ?? 1), Number(facility?.phase ?? 8), 'department_unlock', message);
  }

  return nextProgress;
}

export function recordDepartmentProgress(guildId: string, department: string, delta: number) {
  ensureDepartmentQuestRows(guildId);
  const facility = db.query(`SELECT * FROM facility WHERE guild_id=?`).get(guildId) as any;
  if (!facility) return 0;
  syncDepartmentUnlocks(guildId, facility);
  if (department !== 'control' && !isDepartmentUnlocked(facility, department)) return 0;
  const result = updateDepartmentQuestProgress(guildId, department, delta);
  syncDepartmentUnlocks(guildId, facility);
  return result;
}

export function travelToDepartment(guildId: string, department: string) {
  const facility = db.query(`SELECT * FROM facility WHERE guild_id=?`).get(guildId) as any;
  if (!facility) return null;

  const unlocked = evaluateDepartmentUnlocks(facility);
  const normalized = department.toLowerCase();
  if (!unlocked.includes(normalized)) return null;

  db.query(`UPDATE facility SET current_sector=? WHERE guild_id=?`).run(normalized, guildId);
  return normalized;
}

const TRAVEL_PHASES: Record<string, number> = {
  control: 1,
  information: 1,
  security: 1,
  training: 1,
  command: 2,
  general: 1
};

export function getTravelDuration(origin: string, destination: string) {
  if (origin === destination) return 0;
  return Math.max(TRAVEL_PHASES[origin] ?? 1, TRAVEL_PHASES[destination] ?? 1);
}

export function startAgentTravel(guildId: string, discordId: string, department: string) {
  const facility = db.query(`SELECT * FROM facility WHERE guild_id=?`).get(guildId) as any;
  const agent = db.query(`SELECT * FROM agents WHERE guild_id=? AND discord_id=?`).get(guildId, discordId) as any;
  if (!facility || !agent) return null;

  const normalized = department.toLowerCase();
  if (!evaluateDepartmentUnlocks(facility).includes(normalized)) return null;
  if (Number(agent.travel_remaining ?? 0) > 0) return { status: 'already_traveling' as const, agent };

  const origin = String(agent.department || facility.current_sector || 'general');
  if (origin === normalized) return { status: 'already_there' as const, agent };

  agent.travel_origin = origin;
  agent.travel_destination = normalized;
  agent.travel_remaining = getTravelDuration(origin, normalized);
  updateAgent(agent);
  logEvent(guildId, facility.day_count, facility.phase, 'travel', `${agent.name} left ${origin} for ${normalized}.`);
  return { status: 'traveling' as const, agent, duration: agent.travel_remaining };
}

export function resolveAgentTravel(guildId: string) {
  const agents = db.query(`SELECT * FROM agents WHERE guild_id=? AND travel_remaining > 0`).all(guildId) as any[];
  const arrived: any[] = [];
  const facility = db.query(`SELECT * FROM facility WHERE guild_id=?`).get(guildId) as any;
  if (!facility) return arrived;

  for (const agent of agents) {
    agent.travel_remaining = Math.max(0, Number(agent.travel_remaining) - 1);
    if (agent.travel_remaining > 0) {
      updateAgent(agent);
      continue;
    }

    const destination = String(agent.travel_destination || agent.department || 'general');
    agent.department = destination;
    agent.travel_origin = '';
    agent.travel_destination = '';
    updateAgent(agent);
    logEvent(guildId, facility.day_count, facility.phase, 'arrival', `${agent.name} arrived in ${destination}.`);

    if (Math.random() < 0.20) {
      const damage = Math.max(1, Math.floor(agent.max_sp * 0.08));
      agent.sp = Math.max(0, agent.sp - damage);
      if (agent.sp === 0) applyPanicState(agent);
      updateAgent(agent);
      logEvent(guildId, facility.day_count, facility.phase, 'hallway_incident', `${agent.name} encountered something disturbing on the way into ${destination} and lost ${damage} SP.`);
    }
    arrived.push(agent);
  }
  return arrived;
}

export function getDepartmentRouteSummary(facility: any, agent?: any) {
  const unlocked = evaluateDepartmentUnlocks(facility);
  const guildId = String(facility?.guild_id ?? '');
  return Object.entries(DEPARTMENT_META).map(([department, meta]) => {
    const quest = DEPARTMENT_QUESTS[department];
    const questRow = guildId && quest
      ? db.query(`SELECT * FROM department_quests WHERE guild_id=? AND department=? AND goal=?`).get(guildId, department, quest.goal) as any
      : null;
    return {
      department,
      route: DEPARTMENT_SECTORS[department as DepartmentName] ?? 'central-command',
      label: meta.label,
      unlockSource: meta.unlockSource,
      bonus: meta.bonus,
      unlocked: unlocked.includes(department),
      current: String(agent?.department ?? facility?.current_sector ?? 'control') === department,
      questGoal: quest?.goal ?? '',
      progress: Number(questRow?.progress ?? 0),
      target: Number(quest?.target ?? 0),
      complete: Boolean(questRow?.complete)
    };
  });
}

function getDepartmentBonus(facility: any, type: 'security' | 'information' | 'control' | 'training' | 'command') {
  const unlocked = getUnlockedDepartments(facility);
  if (type === 'security' && unlocked.includes('security')) return 0.10;
  if (type === 'information' && unlocked.includes('information')) return 0.08;
  if (type === 'control' && unlocked.includes('control')) return 0.04;
  if (type === 'training' && unlocked.includes('training')) return 0.05;
  if (type === 'command' && unlocked.includes('command')) return 0.06;
  return 0;
}

function triggerMeltdownAlarm(guildId: string, facility: any) {
  if (!facility || facility.meltdown_alarm) return false;
  const abnormalities = db.query(`SELECT * FROM abnormalities WHERE guild_id = ? AND is_breaching = 0 ORDER BY id`).all(guildId) as any[];
  if (!abnormalities.length) return false;

  const targetCount = 1 + Math.min(2, Math.floor(Math.random() * 3));
  const targets = [...abnormalities].sort(() => Math.random() - 0.5).slice(0, targetCount);
  for (const abno of targets) {
    abno.meltdown_timer = 30 + rand(10, 40);
    abno.meltdown_state = 'alarm';
    db.query(`UPDATE abnormalities SET meltdown_timer=?, meltdown_state=? WHERE id=?`).run(abno.meltdown_timer, abno.meltdown_state, abno.id);
  }

  db.query(`UPDATE facility SET meltdown_alarm=1, meltdown_targets=? WHERE guild_id=?`).run(json(targets.map(a => a.id)), guildId);
  logEvent(guildId, facility.day_count, facility.phase, 'meltdown_alarm', `Meltdown alarm triggered. Containment timers assigned: ${targets.map(a => a.name).join(', ')}.`);
  return true;
}

function resolveMeltdownTimers(guildId: string, facility: any): any[] {
  if (!facility || !facility.meltdown_alarm) return [];

  const breached: any[] = [];
  const targets = JSON.parse(facility.meltdown_targets || '[]') as number[];
  if (!targets.length) {
    db.query(`UPDATE facility SET meltdown_alarm=0, meltdown_targets='[]' WHERE guild_id=?`).run(guildId);
    return [];
  }

  let activeTargets: number[] = [];
  for (const id of targets) {
    const abno = db.query(`SELECT * FROM abnormalities WHERE id = ? AND guild_id = ?`).get(id, guildId) as any;
    if (!abno) continue;
    if (!abno.is_breaching) {
      const nextTimer = Number(abno.meltdown_timer ?? 0) - 1;
      abno.meltdown_timer = nextTimer;
      if (nextTimer <= 0) {
        abno.qliphoth = 0;
        abno.is_breaching = 1;
        abno.breaches += 1;
        abno.rage = Math.min(10, abno.rage + 2);
        abno.meltdown_state = 'breach';
        logEvent(guildId, facility.day_count, facility.phase, 'meltdown', `${abno.name} missed the timer and breached instantly.`);
        breached.push(abno);
      }
      db.query(`UPDATE abnormalities SET qliphoth=?, is_breaching=?, breaches=?, meltdown_timer=?, meltdown_state=? WHERE id=?`).run(
        abno.qliphoth, abno.is_breaching, abno.breaches, abno.meltdown_timer, abno.meltdown_state, abno.id
      );
      if (abno.meltdown_timer > 0) activeTargets.push(abno.id);
    }
  }

  if (!activeTargets.length) {
    db.query(`UPDATE facility SET meltdown_alarm=0, meltdown_targets='[]' WHERE guild_id=?`).run(guildId);
  } else {
    db.query(`UPDATE facility SET meltdown_targets=? WHERE guild_id=?`).run(json(activeTargets), guildId);
  }

  return breached;
}

function formatMeltdownTimer(abno: any) {
  const state = getMeltdownState(abno);
  if (state.timer <= 0 && Number(abno.qliphoth ?? 0) > 0) return 'stable';
  const totalSeconds = Math.max(1, state.timer || 15);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

// calculateWorkChance, workQuality, and getPEBoxTotal are now imported from src/game/logic.ts
// BUT renderPEProgress, buildPEVisualString, and formatWorkDamageTag are UI helpers that stay here

function renderPEProgress(positive: number, negative: number, total = 12) {
  const safeTotal = Math.max(1, total);
  const pos = clamp(Math.max(0, Math.floor(positive)), 0, safeTotal);
  const neg = clamp(Math.max(0, Math.floor(negative)), 0, safeTotal);
  const cells: string[] = Array(safeTotal).fill('⬜');

  for (let i = 0; i < pos; i++) cells[i] = '🟩';
  for (let i = 0; i < neg; i++) cells[safeTotal - 1 - i] = '🟥';

  return cells.join('');
}

function buildPEVisualString(positive: number, negative: number, total = 12) {
  const safeTotal = Math.max(1, total);
  const peRolls = clamp(Math.max(0, Math.floor(positive)), 0, safeTotal);
  const negativeRolls = clamp(Math.max(0, Math.floor(negative)), 0, safeTotal);
  const boxIcons: string[] = [];

  for (let i = 0; i < peRolls; i++) {
    boxIcons.push('🟩 PE');
  }

  for (let i = 0; i < negativeRolls; i++) {
    boxIcons.push('💔 NE');
  }

  const remaining = Math.max(0, safeTotal - (peRolls + negativeRolls));
  for (let i = 0; i < remaining; i++) {
    boxIcons.push('⬜');
  }

  return boxIcons.join(' · ');
}

function formatWorkDamageTag(baseDamage: number, actualDamage: number, type: string, guild: any) {
  const damageEmoji = getGuildEmojiString(guild, (LOBOTOMY_EMOJIS.damage as Record<string, string>)[type] ?? type, type);
  const sufferedRatio = baseDamage > 0 ? Number((actualDamage / baseDamage).toFixed(1)) : 0;
  const label = sufferedRatio >= 0.8 ? 'normal' : 'endured';
  return `${label} ${sufferedRatio.toFixed(1)} ${damageEmoji}`;
}

async function sendBreachAlert(interaction: any, facility: any, abno: any) {
  const containCh = interaction.guild?.channels.cache.get(facility.containment_channel_id) as any;
  if (!containCh) return;

  const breachEmbed = new EmbedBuilder()
    .setTitle(`🚨 BREACH ALERT: ${abno.name}`)
    .setColor(0xFF0000)
    .setDescription(
      `**risk:** ${abno.risk}\n` +
      `**HP:** ${abno.hp}/${abno.max_hp}\n\n` +
      `**all available agents must respond to the containment failure immediately.**`
    )
    .addFields(
      { name: 'breach count', value: `${abno.breaches}`, inline: true },
      { name: 'rage', value: `${abno.rage}`, inline: true },
      { name: 'damage', value: `${abno.damage_amt} ${abno.damage_type}`, inline: true }
    );

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`suppress_confirm_${abno.id}`).setLabel('⚔️ SUPPRESS').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`suppress_retreat_${abno.id}`).setLabel('🏃 RETREAT').setStyle(ButtonStyle.Secondary)
  );

  await containCh.send({ content: '@everyone', embeds: [breachEmbed], components: [row] });
}

function buildLevelRow(workType: WorkType, abno: any) {
  const maxLevel = WORK_LEVEL_MAX[abno.risk] ?? 2;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...Array.from({ length: maxLevel }, (_, i) => i + 1).map(lvl =>
      new ButtonBuilder()
        .setCustomId(`worklvl_${workType}_${abno.id}_${lvl}`)
        .setLabel(`lv.${lvl}`)
        .setStyle(lvl === 1 ? ButtonStyle.Secondary : lvl === maxLevel ? ButtonStyle.Danger : ButtonStyle.Primary)
    )
  );
}

function levelPreviewText(agent: any, abno: any, workType: WorkType, facility: any) {
  const knowledge = getAgentKnowledge(agent.guild_id, agent.discord_id, abno.id);
  const discovered = Number(knowledge?.[`${workType}_pe`] ?? 0) >= 2;
  const maxLevel = WORK_LEVEL_MAX[abno.risk] ?? 2;

  if (!discovered) {
    return `🔒 **work favor locked** — record ${Math.max(0, 2 - Number(knowledge?.[`${workType}_pe`] ?? 0))} more unique PE box(es) with ${getWorkType(workType).label} work to reveal this preference.`;
  }

  return Array.from({ length: 5 }, (_, i) => {
    const level = i + 1;
    const roman = ['I', 'II', 'III', 'IV', 'V'][i];
    const label = getWorkFavorLabel(abno, workType, level);
    const available = level <= 4 && level <= maxLevel;
    return `${roman} ${available ? label : '—'}`;
  }).join(' · ');
}

async function executeWork(interaction: any, agent: any, abno: any, workType: WorkType, facility: any, level: number = 1) {
  if (!abno) {
    return interaction.reply({ content: '❌ that abnormality no longer exists!', ephemeral: true });
  }
  if (abno.is_breaching) {
    return interaction.reply({ content: '🚨 this abnormality has breached! suppress it instead of working on it!', ephemeral: true });
  }
  if (agent.status === 'dead') {
    return interaction.reply({ content: '💀 you are dead and cannot work.', ephemeral: true });
  }
  if (agent.status === 'panicked' || agent.status === 'traumatized') {
    return interaction.reply({ content: `🧠 you are ${agent.status}. recover before working again!`, ephemeral: true });
  }
  if (Number(agent.travel_remaining ?? 0) > 0) {
    return interaction.reply({
      content: `🚪 you are currently traveling from **${agent.travel_origin}** to **${agent.travel_destination}**. arrival in ${agent.travel_remaining} phase(s).`,
      ephemeral: true
    });
  }
  if (Number(facility.phase) >= 22) {
    return interaction.reply({ content: '🌙 the shift has reached **22:00**. no further work may begin until `/end-day` resets operations.', ephemeral: true });
  }

  const maxLevel = WORK_LEVEL_MAX[abno.risk] ?? 2;
  level = clamp(Math.floor(level), 1, maxLevel);
  const behaviour = getBehaviour(abno);
  const shift = getShiftProfile(Number(facility.phase));
  const wasWeakened = agent.status === 'injured' || agent.status === 'stressed';

  // 🧬 Check if this abnormality has an onWorkStart hook
  const script = getAbnormalityScript(abno);
  if (script?.onWorkStart) {
    const hookResult = script.onWorkStart(agent, abno, workType);
    if (hookResult?.cancelled) {
      updateAgent(agent);
      return interaction.reply({ content: hookResult.message });
    }
  }

  const chance = calculateWorkChance(agent, abno, workType, facility, level);
  const result = workQuality(chance, level, behaviour);
  let totalDamage = 0;
  const tickResults: string[] = [];
  let peBoxes = result.boxes;

  // predatory abnormalities hit harder against a handler who is already worn down
  let effectiveDamageAmt = abno.damage_amt * shift.damageMultiplier * (1 + (level - 1) * 0.25);
  if (behaviour === 'predatory' && wasWeakened) effectiveDamageAmt *= 1.5;

  agent.status = 'working';
  agent.assignments += 1;

  for (let i = 0; i < 5; i++) {
    const tickChance = clamp(chance + (result.tier === 'good' ? 0.08 : result.tier === 'critical' ? -0.10 : 0), 0.05, 0.98);
    if (Math.random() < tickChance) {
      if (Math.random() < 0.18) {
        peBoxes += 1;
        tickResults.push('✨ bonus PE');
      } else {
        tickResults.push('⚡ PE');
      }
      // volatile containment can still bite even during a good tick
      if (behaviour === 'volatile' && Math.random() < 0.12) {
        const spike = applyDamage(agent, Math.floor(effectiveDamageAmt * 0.5), abno.damage_type);
        totalDamage += spike;
        tickResults.push(`🌪️ ${spike} instability dmg`);
      }
    } else {
      const damage = applyDamage(agent, effectiveDamageAmt * (result.tier === 'critical' ? 1.35 : 1), abno.damage_type);
      totalDamage += damage;
      tickResults.push(`💥 ${damage} dmg`);
    }
  }

  // possessive abnormalities remember who's been showing up
  if (behaviour === 'possessive') {
    abno.work_streak = abno.last_worked_by === agent.discord_id ? Number(abno.work_streak ?? 0) + 1 : 1;
    abno.last_worked_by = agent.discord_id;
  } else {
    abno.last_worked_by = agent.discord_id;
    abno.work_streak = 0;
  }

  const trait = getTrait(agent);
  if (agent.trait === 'lucky' && Math.random() < 0.25) {
    peBoxes += 1;
    tickResults.push('🍀 lucky PE');
  }

  const eventMessages: string[] = [];
  let qChange = 0;
  if (result.tier === 'good' && peBoxes >= 4) qChange = 1;
  else if (result.tier === 'bad' || peBoxes <= 1) qChange = -1;

  if (script?.onWorkEnd) {
    const scriptedResult = result.tier === 'critical' ? 'bad' : result.tier;
    const note = script.onWorkEnd(agent, abno, workType, scriptedResult);
    if (note) eventMessages.push(note);
  }

  if (qChange < 0) {
    abno.qliphoth -= 1;
    abno.rage += 1;
  } else if (qChange > 0) {
    abno.qliphoth = Math.min(abno.max_qliphoth, abno.qliphoth + 1);
    abno.rage = Math.max(0, abno.rage - 1);
  }

  abno.current_work_process = workType;
  abno.meltdown_timer = Math.max(15, 45 - (abno.max_qliphoth - abno.qliphoth) * 8 + abno.rage * 3);
  abno.meltdown_state = getMeltdownState(abno).label;

  if (abno.qliphoth <= 0) {
    abno.qliphoth = abno.max_qliphoth;
    abno.is_breaching = 1;
    abno.breaches += 1;
    abno.rage = Math.min(10, abno.rage + 2);
    abno.meltdown_state = 'meltdown';
    abno.meltdown_timer = 0;
    db.query(`UPDATE abnormalities SET qliphoth=?, is_breaching=1, rage=?, breaches=?, last_worked_by=?, work_streak=?, current_work_process=?, meltdown_timer=?, meltdown_state=? WHERE id=?`).run(
      abno.qliphoth, abno.rage, abno.breaches, abno.last_worked_by, abno.work_streak, abno.current_work_process, abno.meltdown_timer, abno.meltdown_state, abno.id
    );
    eventMessages.push(`🚨 **${abno.name.toUpperCase()} HAS BREACHED!**`);
    logEvent(interaction.guildId!, facility.day_count, facility.phase, 'breach', `${abno.name} breached after failed work.`);
    await sendBreachAlert(interaction, facility, abno);
  } else {
    abno.meltdown_state = getMeltdownState(abno).label;
    db.query(`UPDATE abnormalities SET qliphoth=?, rage=?, last_worked_by=?, work_streak=?, current_work_process=?, meltdown_timer=?, meltdown_state=? WHERE id=?`).run(
      abno.qliphoth, abno.rage, abno.last_worked_by, abno.work_streak, abno.current_work_process, abno.meltdown_timer, abno.meltdown_state, abno.id
    );
  }

  const generated = peBoxes * (1 + Math.max(0, Number(facility.research) - 100) / 500);
  const energyGain = Math.max(0, Math.floor(generated * shift.energyMultiplier));
  const totalMeter = getPEBoxTotal(abno);
  const positiveGoal = clamp(Math.max(0, peBoxes), 0, totalMeter);
  const negativeGoal = Math.max(0, totalMeter - positiveGoal);
  const previousPhase = Number(facility.phase);
  const updatedPhase = nextPhase(previousPhase);
  db.query(`UPDATE facility SET energy = energy + ?, phase = ? WHERE guild_id = ?`).run(energyGain, updatedPhase, interaction.guildId!);
  resolveAgentTravel(interaction.guildId!);

  const ambientMessage = createAmbientRadioEvent(interaction.guildId!, { ...facility, phase: previousPhase });
  if (ambientMessage) {
    await sendFacilityRadio(interaction.guild, db.query(`SELECT * FROM facility WHERE guild_id=?`).get(interaction.guildId!) as any, ambientMessage);
    eventMessages.push(`📻 ${ambientMessage}`);
  }

  const work = getWorkType(workType);

  recordDepartmentProgress(interaction.guildId!, 'control', energyGain);

  if (agent.assignments > 0 && agent.assignments % 5 === 0) {
    triggerMeltdownAlarm(interaction.guildId!, facility);
  }

  const timerBreaches = resolveMeltdownTimers(
    interaction.guildId!,
    db.query(`SELECT * FROM facility WHERE guild_id=?`).get(interaction.guildId!) as any
  );

  for (const breached of timerBreaches) {
    eventMessages.push(`🚨 **${breached.name.toUpperCase()} HAS BREACHED FROM MELTDOWN!**`);
    await sendBreachAlert(interaction, db.query(`SELECT * FROM facility WHERE guild_id=?`).get(interaction.guildId!) as any, breached);
  }

  let phaseFacility = db.query(`SELECT * FROM facility WHERE guild_id=?`).get(interaction.guildId!) as any;
  if (maybeTriggerOrdeal(interaction.guildId!, phaseFacility)) {
    phaseFacility = db.query(`SELECT * FROM facility WHERE guild_id=?`).get(interaction.guildId!) as any;
    eventMessages.push(`⚠️ **ORDEAL SIGNAL DETECTED:** ${String(phaseFacility.active_ordeal || 'unknown').toUpperCase()} activity has entered the facility.`);
  }

  const panicPhase = resolvePanicPhase(interaction.guildId!, phaseFacility);
  if (panicPhase.messages.length) {
    eventMessages.push(...panicPhase.messages);
    await sendFacilityRadio(interaction.guild, phaseFacility, `⚠️ PANIC INCIDENT\n${panicPhase.messages.slice(0, 3).join('\n')}`).catch(() => {});
  }
  for (const panicBreach of panicPhase.breached) {
    await sendBreachAlert(interaction, db.query(`SELECT * FROM facility WHERE guild_id=?`).get(interaction.guildId!) as any, panicBreach);
  }

  const liveProgress = async () => {
    const revealOrder: Array<'positive' | 'negative'> = [];
    for (let i = 0; i < positiveGoal; i++) revealOrder.push('positive');
    for (let i = 0; i < negativeGoal; i++) revealOrder.push('negative');

    for (let i = revealOrder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const current = revealOrder[i]!;
      const swap = revealOrder[j]!;
      revealOrder[i] = swap;
      revealOrder[j] = current;
    }

    let revealedPositive = 0;
    let revealedNegative = 0;
    let liveDamageTotal = 0;
    let lastDamageText = 'waiting...';
    const initialHp = agent.hp;
    const initialSp = agent.sp;

    for (let step = 0; step < totalMeter; step++) {
      const boxType = revealOrder[step];
      if (boxType === 'positive') {
        revealedPositive += 1;
      } else {
        revealedNegative += 1;
        const baseDamage = Math.max(1, Math.floor(effectiveDamageAmt * 0.7));
        const actualDamage = applyDamage(agent, baseDamage, abno.damage_type);
        liveDamageTotal += actualDamage;
        lastDamageText = formatWorkDamageTag(baseDamage, actualDamage, abno.damage_type, interaction.guild);
        updateAgent(agent);
      }

      const progressBar = renderPEProgress(revealedPositive, revealedNegative, totalMeter);
      const boxVisual = buildPEVisualString(revealedPositive, revealedNegative, totalMeter);
      const hpText = `❤️ ${agent.hp}/${agent.max_hp} · 🧠 ${agent.sp}/${agent.max_sp}`;
      const workEmoji = getGuildEmojiString(interaction.guild, getWorkType(workType).icon, getWorkType(workType).label);
      const liveText = `🧪 **${abno.name}** — ${workEmoji} **${getWorkType(workType).label}**\n${progressBar}\n${boxVisual}\n${hpText}\n⚔️ ${lastDamageText}`;

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: liveText, components: [] });
      } else if (interaction.isButton() || interaction.isStringSelectMenu()) {
        await interaction.update({ content: liveText, components: [] });
      } else {
        await interaction.reply({ content: liveText });
      }

      await new Promise(resolve => setTimeout(resolve, 260));
    }

    return { liveDamageTotal, initialHp, initialSp };
  };

  const workResult = await liveProgress();
  totalDamage = workResult.liveDamageTotal;

  const knowledgeResult = updateAgentKnowledge(
    interaction.guildId!,
    agent.discord_id,
    Number(abno.id),
    workType,
    peBoxes
  );
  const knowledge = knowledgeResult.knowledge;
  const uniqueObserved = totalUniquePE(knowledge);
  const codexLevel = uniqueObserved >= 8 ? 4 : uniqueObserved >= 6 ? 3 : uniqueObserved >= 4 ? 2 : uniqueObserved >= 2 ? 1 : 0;
  if (codexLevel > 0) maybeUnlockCodexEntry(interaction.guildId!, abno, codexLevel);

  recordAgentWorkHistory({
    guildId: interaction.guildId!,
    discordId: agent.discord_id,
    day: facility.day_count,
    phase: facility.phase,
    abnormalityId: Number(abno.id),
    abnormalityName: abno.name,
    workType,
    result: result.tier,
    peBoxes,
    qliphothChange: qChange,
    damage: totalDamage,
    note: eventMessages.join(' ')
  });
  recordAgentObservation({
    guildId: interaction.guildId!,
    discordId: agent.discord_id,
    abnormalityId: Number(abno.id),
    workType,
    result: result.tier,
    qliphothChange: qChange
  });
  recordSharedShiftRelationships(interaction.guildId!, agent.discord_id, result.tier);

  agent.status = agent.status === 'dead' ? 'dead' : agent.status === 'panicked' ? 'panicked' : agent.status === 'injured' ? 'injured' : 'idle';
  const riskWeight = RISK_VALUES[abno.risk] ?? 1;
  const expGain = Math.max(4, energyGain + riskWeight * 3 + (result.tier === 'good' ? 5 : 0));
  const levelMessages = awardExperience(agent, expGain);

  const synced = syncAgentMaxStats(agent);
  agent.max_hp = synced.maxHp;
  agent.max_sp = synced.maxSp;
  agent.hp = clamp(agent.hp, 0, agent.max_hp);
  agent.sp = clamp(agent.sp, 0, agent.max_sp);
  updateAgent(agent);

  const bInfo = BEHAVIOUR_INFO[behaviour];
  const workEmoji = getGuildEmojiString(interaction.guild, getWorkType(workType).icon, getWorkType(workType).label);
  const qliphothIcon = abno.qliphoth === abno.max_qliphoth ? '💎' : '🔻';
  let resultText = `🧪 you performed **${work.label}** work (level **${level}/${maxLevel}**) on **${abno.name}** during the **${shift.label}** shift.\n`;
  resultText += `${bInfo.icon} behaviour: **${bInfo.label}**\n`;
  resultText += `🧩 active work process: **${workEmoji} ${getWorkType(workType).label}**\n`;
  resultText += `⏱️ meltdown status: **${getMeltdownState(abno).icon} ${getMeltdownState(abno).label}** · **${formatMeltdownTimer(abno)}**\n`;
  const favorKnown = Number(knowledge?.[`${workType}_pe`] ?? 0) >= 2;
  resultText += `🎯 work favor: **${favorKnown ? getWorkFavorLabel(abno, workType, getEffectiveStat(agent, work.stat)) : 'undocumented'}**\n`;
  resultText += `📈 result: **${result.tier.toUpperCase()}**\n`;
  resultText += `⚡ generated **${energyGain} energy** from **${peBoxes} PE boxes**\n`;
  resultText += `💥 suffered **${totalDamage} ${abno.damage_type} damage** (including **${workResult.liveDamageTotal}** from **${negativeGoal}** negative box(es))\n`;
  resultText += `🧠 gained **${expGain} EXP**\n`;
  resultText += `${qliphothIcon} qliphoth: **${abno.qliphoth}/${abno.max_qliphoth}**\n`;
  resultText += `🛡️ ${agent.hp}/${agent.max_hp} HP | ${agent.sp}/${agent.max_sp} SP\n`;
  resultText += `📝 ${tickResults.join(' · ')}`;

  if (trait) resultText += `\n🎭 trait: **${trait.name}** — ${trait.description}`;

  if (knowledgeResult.newlyUnlockedWorkFavor) {
    resultText += `\n\n📖 **NEW INFORMATION:** ${work.label.toUpperCase()} work preference unlocked. Check the abnormality's **Work Favor** record.`;
  }
  if (knowledgeResult.newlyUnlockedTips) {
    resultText += `\n📖 **NEW INFORMATION:** enough observations have been recorded to compile **Management Tips**.`;
  }
  if (knowledgeResult.newlyUnlockedDescription) {
    resultText += `\n📖 **COMPLETE OBSERVATION:** the full abnormality description has been reconstructed.`;
  }
  resultText += `\n📚 personal observation record: **${uniqueObserved}/8 unique PE boxes**`;
  if (behaviour === 'possessive' && abno.work_streak >= 2) {
    resultText += `\n💜 *${abno.name} seems to recognize you now (bond streak: ${abno.work_streak}).*`;
  }
  if (behaviour === 'predatory' && wasWeakened) {
    resultText += `\n🦈 *it noticed you were already hurting, and it did not go easy on you.*`;
  }
  if (eventMessages.length) resultText += `\n\n${eventMessages.join('\n')}`;
  if (levelMessages.length) resultText += `\n\n${levelMessages.join('\n')}`;
  if (agent.status === 'dead') resultText += `\n\n💀 **YOU HAVE DIED.**`;
  else if (agent.status === 'panicked') resultText += `\n\n😵 **YOU HAVE PANICKED.**`;
  else if (agent.status === 'injured') resultText += `\n\n🩹 **you are injured.** recover before taking unnecessary risks.`;

  await interaction.editReply({ content: resultText });
}

function facilityDashboard(facility: any, agents: any[], abnormalities: any[]) {
  const active = agents.filter(a => a.status !== 'dead').length;
  const dead = agents.filter(a => a.status === 'dead').length;
  const breaches = abnormalities.filter(a => a.is_breaching).length;
  const shift = getShiftProfile(Number(facility.phase));

  const embed = new EmbedBuilder()
    .setTitle(`🏢 FACILITY DASHBOARD — DAY ${facility.day_count}`)
    .setColor(breaches > 0 ? 0xFF0000 : facility.is_paused ? 0x808080 : 0x00FFFF)
    .setDescription(
      `**phase:** ${facility.phase}:00 · **${shift.label} shift**\n` +
      `**operations:** ${facility.is_paused ? '⏸️ PAUSED' : '▶️ ACTIVE'}\n` +
      `**manager:** <@${facility.manager_id}>`
    )
    .addFields(
      { name: '⚡ Energy', value: `${facility.energy}/${facility.quota}`, inline: true },
      { name: '💰 LOB Points', value: `${facility.lob_points}`, inline: true },
      { name: '🧪 Research', value: `${facility.research}`, inline: true },
      { name: '👥 Agents', value: `${active} active / ${agents.length} total / ${dead} dead`, inline: true },
      { name: '🚨 Breaches', value: `${breaches}`, inline: true },
      { name: '🗳️ Mode', value: facility.dictator_mode ? '👑 dictator' : '🗳️ democracy', inline: true },
      { name: '🏗️ Upgrades', value: `containment ${facility.containment_level} · security ${facility.security_level} · welfare ${facility.welfare_level}` }
    );

  if (abnormalities.length) {
    embed.addFields({
      name: '🧪 Containment overview',
      value: abnormalities.map(a => {
        const displayedA = getDisplayAbnormality(a, abnormalities);
        return `${a.is_breaching ? '🚨' : '🟢'} ${BEHAVIOUR_INFO[getBehaviour(a)].icon} **${displayedA.name}** [${displayedA.risk}] — qliphoth ${a.qliphoth}/${a.max_qliphoth} — HP ${a.hp}/${a.max_hp}`;
      }).join('\n').slice(0, 1024)
    });
  }

  return embed;
}

function agentStatusEmbed(agent: any, facility: any) {
  const weapon = getWeapon(agent)!;
  const trait = getTrait(agent)!;
  const gift = getGift(agent) as GiftDef | null;
  const ownedGifts = (JSON.parse(agent.ego_gifts || '[]') as string[]).length;
  const embed = new EmbedBuilder()
    .setTitle(`🏢 agent ${agent.name}'s profile`)
    .setColor(agent.status === 'dead' ? 0x000000 : agent.status === 'panicked' ? 0xFFFF00 : 0x00FFFF)
    .setDescription(`**level ${agent.level}** · ${agent.status.toUpperCase()} · trait: **${trait.name}**\n${trait.description}`)
    .addFields(
      { name: '❤️ HP', value: `${agent.hp}/${agent.max_hp}`, inline: true },
      { name: '🧠 SP', value: `${agent.sp}/${agent.max_sp}`, inline: true },
      { name: '⭐ EXP', value: `${agent.experience}/${experienceToNext(agent.level)}`, inline: true },
      { name: '💪 Fortitude', value: `${getEffectiveStat(agent, 'fortitude')}${gift?.statBonus?.fortitude ? ` (${agent.fortitude}+${gift.statBonus.fortitude})` : ''}`, inline: true },
      { name: '🧠 Prudence', value: `${getEffectiveStat(agent, 'prudence')}${gift?.statBonus?.prudence ? ` (${agent.prudence}+${gift.statBonus.prudence})` : ''}`, inline: true },
      { name: '💗 Temperance', value: `${getEffectiveStat(agent, 'temperance')}${gift?.statBonus?.temperance ? ` (${agent.temperance}+${gift.statBonus.temperance})` : ''}`, inline: true },
      { name: '⚔️ Justice', value: `${getEffectiveStat(agent, 'justice')}${gift?.statBonus?.justice ? ` (${agent.justice}+${gift.statBonus.justice})` : ''}`, inline: true },
      { name: '⚔️ Weapon', value: `${weapon.name} (${weapon.type}: ${weapon.min}-${weapon.max})`, inline: true },
      { name: '🛡️ Suit', value: EGO_SUITS[agent.suit]?.name || 'Basic Suit', inline: true },
      { name: '💠 Gift', value: gift ? `${gift.icon} ${gift.name}\n${gift.drawback}` : `none equipped (owns ${ownedGifts})`, inline: false },
      { name: '📋 Assignments', value: `${agent.assignments}`, inline: true },
      { name: '💀 Kills', value: `${agent.kills}`, inline: true },
      { name: '🏅 Promotions', value: `${agent.promotions}`, inline: true },
      { name: '🏢 Facility', value: `Day ${facility.day_count} · ${facility.energy}/${facility.quota} energy` }
    );
  return embed;
}

// nextPhase is now imported from src/game/logic.ts

function resolveDailyRecovery(guildId: string) {
  const facility = db.query(`SELECT * FROM facility WHERE guild_id=?`).get(guildId) as any;
  const welfareBonus = Math.max(0, Number(facility?.welfare_level ?? 1) - 1) * 0.05;
  const agents = db.query(`SELECT * FROM agents WHERE guild_id = ? AND status != 'dead'`).all(guildId) as any[];

  for (const agent of agents) {
    if (agent.recovery_days > 0) agent.recovery_days -= 1;

    if (['injured', 'stressed', 'panicked', 'traumatized', 'recovering'].includes(agent.status)) {
      agent.status = 'recovering';
      agent.hp = Math.min(agent.max_hp, agent.hp + Math.floor(agent.max_hp * (0.25 + welfareBonus)));
      agent.sp = Math.min(agent.max_sp, agent.sp + Math.floor(agent.max_sp * (0.30 + welfareBonus)));
      agent.panic_turns = 0;
      agent.panic_behavior = '';

      if (agent.recovery_days <= 0 && agent.hp >= agent.max_hp * 0.75 && agent.sp >= agent.max_sp * 0.75) {
        agent.status = 'idle';
      }
    }

    updateAgent(agent);
  }
}

function resetDailyOperationalState(guildId: string) {
  const abnormalities = db.query(`SELECT * FROM abnormalities WHERE guild_id=?`).all(guildId) as any[];
  for (const abno of abnormalities) {
    if (Number(abno.is_breaching)) continue;
    const nextProcess = pick<WorkType>(['instinct', 'insight', 'attachment', 'repression']);
    db.query(`
      UPDATE abnormalities SET qliphoth=max_qliphoth, rage=MAX(0, rage-1), current_work_process=?,
      meltdown_timer=?, meltdown_state='stable' WHERE id=?
    `).run(nextProcess, 30 + rand(10, 35), abno.id);
  }

  db.query(`
    UPDATE facility SET meltdown_alarm=0, meltdown_targets='[]', ordeal_active=0, active_ordeal='', ordeal_timer=0
    WHERE guild_id=?
  `).run(guildId);
  db.query(`UPDATE ordeal_events SET active=0 WHERE guild_id=? AND active=1`).run(guildId);
}

function runDailyEvent(guildId: string, facility: any): string | null {
  const roll = Math.random();

  if (roll < Math.max(0.03, 0.10 - Number(facility.containment_level ?? 1) * 0.01)) {
    db.query(`UPDATE facility SET energy = MAX(0, energy - 10) WHERE guild_id = ?`).run(guildId);
    logEvent(guildId, facility.day_count, facility.phase, 'event', 'Power fluctuation drained 10 energy.');
    return '⚡ **POWER FLUCTUATION** — the grid is unstable. 10 energy was lost.';
  }

  if (roll < 0.16) {
    const agents = db.query(`SELECT * FROM agents WHERE guild_id = ? AND status = 'idle'`).all(guildId) as any[];
    if (agents.length) {
      const agent = pick(agents);
      agent.status = 'stressed';
      agent.sp = Math.max(0, agent.sp - 15);
      agent.recovery_days = Math.max(agent.recovery_days, 1);
      updateAgent(agent);
      logEvent(guildId, facility.day_count, facility.phase, 'event', `${agent.name} became stressed after a facility incident.`);
      return `🧠 **EMPLOYEE INCIDENT** — ${agent.name} is stressed and lost 15 SP.`;
    }
  }

  if (roll < 0.23) {
    db.query(`UPDATE facility SET research = research + 15 WHERE guild_id = ?`).run(guildId);
    logEvent(guildId, facility.day_count, facility.phase, 'event', 'Research team completed a breakthrough.');
    return '🧪 **RESEARCH BREAKTHROUGH** — the facility gained 15 research.';
  }

  if (roll < 0.29 && facility.lob_points >= 20) {
    db.query(`UPDATE facility SET lob_points = lob_points - 20, stable_days = stable_days + 1 WHERE guild_id = ?`).run(guildId);
    logEvent(guildId, facility.day_count, facility.phase, 'event', 'Emergency welfare supplies were deployed.');
    return '💖 **WELFARE SUPPLIES** — 20 LOB points were spent automatically to protect employees.';
  }

  return null;
}

function maybeTriggerSpontaneousBreaches(guildId: string, facility: any): any[] {
  const candidates = db.query(`SELECT * FROM abnormalities WHERE guild_id = ? AND is_breaching = 0 AND can_breach=1`).all(guildId) as any[];
  const triggered: any[] = [];

  for (const abno of candidates) {
    const behaviour = getBehaviour(abno);
    const behaviourMult = behaviour === 'docile' ? 0.7 : behaviour === 'volatile' ? 1.35 : behaviour === 'predatory' ? 1.5 : 1.0;
    const riskWeight = RISK_VALUES[abno.risk] ?? 1;
    const danger = (Number(abno.escape_chance) + Number(abno.rage) * 0.015 + (Number(facility.security_level) < riskWeight ? 0.03 : 0)) * behaviourMult * getShiftProfile(Number(facility.phase)).breachMultiplier;
    if (Math.random() < danger) {
      abno.is_breaching = 1;
      abno.breaches += 1;
      abno.rage = Math.min(10, abno.rage + 1);
      db.query(`UPDATE abnormalities SET is_breaching=1, breaches=?, rage=? WHERE id=?`).run(abno.breaches, abno.rage, abno.id);
      logEvent(guildId, facility.day_count, facility.phase, 'breach', `${abno.name} spontaneously breached containment.`);
      triggered.push(abno);
    }
  }

  return triggered;
}

function serializeFacility(guildId: string) {
  const facility = db.query(`SELECT * FROM facility WHERE guild_id = ?`).get(guildId) as any;
  const agents = db.query(`SELECT * FROM agents WHERE guild_id = ?`).all(guildId) as any[];
  const abnormalities = db.query(`SELECT * FROM abnormalities WHERE guild_id = ?`).all(guildId) as any[];
  const events = db.query(`SELECT * FROM facility_events WHERE guild_id = ? ORDER BY id DESC LIMIT 150`).all(guildId) as any[];
  const knowledge = db.query(`SELECT * FROM agent_abnormality_knowledge WHERE guild_id=?`).all(guildId) as any[];
  const workHistory = db.query(`SELECT * FROM agent_work_history WHERE guild_id=? ORDER BY id ASC`).all(guildId) as any[];
  const observations = db.query(`SELECT * FROM agent_abnormality_observations WHERE guild_id=?`).all(guildId) as any[];
  const relationships = db.query(`SELECT * FROM agent_relationships WHERE guild_id=?`).all(guildId) as any[];
  const codex = db.query(`SELECT * FROM codex_entries WHERE guild_id=?`).all(guildId) as any[];
  const quests = db.query(`SELECT * FROM department_quests WHERE guild_id=?`).all(guildId) as any[];
  const ordeals = db.query(`SELECT * FROM ordeal_events WHERE guild_id=? ORDER BY id DESC LIMIT 50`).all(guildId) as any[];
  return { facility, agents, abnormalities, events, knowledge, workHistory, observations, relationships, codex, quests, ordeals };
}

function restoreState(guildId: string, state: any) {
  if (!state?.facility) throw new Error('save file is missing facility data');

  const f = state.facility;
  db.query(`
    UPDATE facility SET energy=?, quota=?, dictator_mode=?, manager_id=?, is_started=?, is_paused=?, day_count=?, phase=?,
    category_id=?, control_channel_id=?, containment_channel_id=?, status_channel_id=?, radio_channel_id=?,
    research=?, lob_points=?, containment_level=?, security_level=?, welfare_level=?, event_seed=?, stable_days=?,
    meltdown_alarm=?, meltdown_targets=?, department_unlocks=?, recruitment_points=?, ordeal_active=?, active_ordeal=?, ordeal_timer=?, current_sector=?
    WHERE guild_id=?
  `).run(
    f.energy ?? 0, f.quota ?? 50, f.dictator_mode ?? 0, f.manager_id ?? '', f.is_started ?? 0, f.is_paused ?? 0,
    f.day_count ?? 1, f.phase ?? 8, f.category_id ?? null, f.control_channel_id ?? '', f.containment_channel_id ?? null,
    f.status_channel_id ?? '', f.radio_channel_id ?? '', f.research ?? 100, f.lob_points ?? 250, f.containment_level ?? 1,
    f.security_level ?? 1, f.welfare_level ?? 1, f.event_seed ?? 0, f.stable_days ?? 0, f.meltdown_alarm ?? 0,
    f.meltdown_targets ?? '[]', f.department_unlocks ?? json(['control']), f.recruitment_points ?? 0,
    f.ordeal_active ?? 0, f.active_ordeal ?? '', f.ordeal_timer ?? 0, f.current_sector ?? 'control', guildId
  );

  db.query(`DELETE FROM agents WHERE guild_id=?`).run(guildId);
  for (const agent of state.agents ?? []) {
    db.query(`
      INSERT INTO agents (
        discord_id, guild_id, name, hp, max_hp, sp, max_sp, weapon, suit, status, level, fortitude, prudence,
        temperance, justice, experience, trait, recovery_days, assignments, kills, promotions, ego_gifts, equipped_gift,
        department, auto_response, travel_origin, travel_destination, travel_remaining, panic_turns, panic_behavior
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      agent.discord_id, guildId, agent.name, agent.hp, agent.max_hp, agent.sp, agent.max_sp, agent.weapon, agent.suit,
      agent.status, agent.level, agent.fortitude, agent.prudence, agent.temperance, agent.justice, agent.experience,
      agent.trait, agent.recovery_days, agent.assignments, agent.kills, agent.promotions, agent.ego_gifts ?? '[]',
      agent.equipped_gift ?? '', agent.department ?? 'control', agent.auto_response ?? '', agent.travel_origin ?? '',
      agent.travel_destination ?? '', Math.max(0, Number(agent.travel_remaining ?? 0)), Math.max(0, Number(agent.panic_turns ?? 0)),
      agent.panic_behavior ?? ''
    );
  }

  db.query(`DELETE FROM abnormalities WHERE guild_id=?`).run(guildId);
  for (const abno of state.abnormalities ?? []) {
    db.query(`
      INSERT INTO abnormalities (
        id, guild_id, name, risk, hp, max_hp, qliphoth, max_qliphoth, damage_type, damage_amt, is_breaching,
        work_instinct, work_insight, work_attachment, work_repression, escape_chance, behaviour, description, rage,
        breaches, suppressed_count, last_worked_by, work_streak, gift_id, current_work_process, meltdown_timer,
        meltdown_state, sector, observation_level, research_points, can_breach, is_tool, script_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      abno.id, guildId, abno.name, abno.risk, abno.hp, abno.max_hp, abno.qliphoth, abno.max_qliphoth,
      abno.damage_type, abno.damage_amt, abno.is_breaching, abno.work_instinct, abno.work_insight,
      abno.work_attachment, abno.work_repression, abno.escape_chance, abno.behaviour, abno.description,
      abno.rage, abno.breaches, abno.suppressed_count, abno.last_worked_by ?? '', abno.work_streak ?? 0,
      abno.gift_id ?? '', abno.current_work_process ?? '', abno.meltdown_timer ?? 0, abno.meltdown_state ?? 'stable',
      abno.sector ?? 'control', abno.observation_level ?? 0, abno.research_points ?? 0, abno.can_breach ?? 1,
      abno.is_tool ?? 0, abno.script_id ?? ''
    );
  }

  const replaceRows = (table: string, rows: any[], inserter: (row: any) => void) => {
    db.query(`DELETE FROM ${table} WHERE guild_id=?`).run(guildId);
    for (const row of rows ?? []) inserter(row);
  };

  replaceRows('agent_abnormality_knowledge', state.knowledge, knowledge => {
    db.query(`INSERT INTO agent_abnormality_knowledge (guild_id, discord_id, abnormality_id, instinct_pe, insight_pe, attachment_pe, repression_pe, management_tips, description_unlocked, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      guildId, knowledge.discord_id, knowledge.abnormality_id, knowledge.instinct_pe ?? 0, knowledge.insight_pe ?? 0,
      knowledge.attachment_pe ?? 0, knowledge.repression_pe ?? 0, knowledge.management_tips ?? 0,
      knowledge.description_unlocked ?? 0, knowledge.first_seen_at ?? new Date().toISOString(), knowledge.last_seen_at ?? new Date().toISOString()
    );
  });

  replaceRows('agent_work_history', state.workHistory, row => {
    db.query(`INSERT INTO agent_work_history (guild_id, discord_id, day, phase, abnormality_id, abnormality_name, work_type, result, pe_boxes, qliphoth_change, damage, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      guildId, row.discord_id, row.day, row.phase, row.abnormality_id, row.abnormality_name, row.work_type, row.result,
      row.pe_boxes ?? 0, row.qliphoth_change ?? 0, row.damage ?? 0, row.note ?? '', row.created_at ?? new Date().toISOString()
    );
  });

  replaceRows('agent_abnormality_observations', state.observations, row => {
    db.query(`INSERT INTO agent_abnormality_observations (guild_id, discord_id, abnormality_id, work_type, attempts, good, normal, bad, critical, qliphoth_gains, qliphoth_losses) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      guildId, row.discord_id, row.abnormality_id, row.work_type, row.attempts ?? 0, row.good ?? 0, row.normal ?? 0,
      row.bad ?? 0, row.critical ?? 0, row.qliphoth_gains ?? 0, row.qliphoth_losses ?? 0
    );
  });

  replaceRows('agent_relationships', state.relationships, row => {
    db.query(`INSERT INTO agent_relationships (guild_id, from_discord_id, to_discord_id, trust, shared_shifts, positive_shifts, difficult_shifts, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      guildId, row.from_discord_id, row.to_discord_id, row.trust ?? 0, row.shared_shifts ?? 0, row.positive_shifts ?? 0,
      row.difficult_shifts ?? 0, row.updated_at ?? new Date().toISOString()
    );
  });

  replaceRows('codex_entries', state.codex, row => {
    db.query(`INSERT INTO codex_entries (guild_id, abnormality_name, observation_level, data_json, unlocked_at) VALUES (?, ?, ?, ?, ?)`).run(
      guildId, row.abnormality_name, row.observation_level ?? 0, row.data_json ?? '{}', row.unlocked_at ?? new Date().toISOString()
    );
  });

  replaceRows('department_quests', state.quests, quest => {
    db.query(`INSERT INTO department_quests (guild_id, department, description, goal, progress, complete) VALUES (?, ?, ?, ?, ?, ?)`).run(
      guildId, quest.department, quest.description, quest.goal, quest.progress ?? 0, quest.complete ?? 0
    );
  });

  replaceRows('ordeal_events', (state.ordeals ?? []).slice().reverse(), ordeal => {
    db.query(`INSERT INTO ordeal_events (guild_id, color, threshold, active, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
      guildId, ordeal.color, ordeal.threshold, ordeal.active ?? 0, ordeal.expires_at ?? 0, ordeal.created_at ?? new Date().toISOString()
    );
  });

  replaceRows('facility_events', (state.events ?? []).slice().reverse(), event => {
    db.query(`INSERT INTO facility_events (guild_id, day, phase, type, message, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
      guildId, event.day, event.phase, event.type, event.message, event.created_at ?? new Date().toISOString()
    );
  });

  ensureDepartmentQuestRows(guildId);
  const refreshed = db.query(`SELECT * FROM facility WHERE guild_id=?`).get(guildId) as any;
  syncDepartmentUnlocks(guildId, refreshed);
}

async function endDay(interaction: any, facility: any) {
  const guildId = interaction.guildId!;
  const activeBreaches = db.query(`SELECT * FROM abnormalities WHERE guild_id=? AND is_breaching=1`).all(guildId) as any[];
  if (activeBreaches.length) {
    return interaction.reply({
      content: `🚨 the shift cannot be reset while containment is breached. suppress: ${activeBreaches.map(a => `**${a.name}**`).join(', ')}`,
      ephemeral: true
    });
  }
  const quotaMet = facility.energy >= facility.quota;
  const completedDay = facility.day_count;
  const oldQuota = facility.quota;
  const nextDay = completedDay + 1;
  const nextQuota = Math.floor(oldQuota * 1.5);

  const eventMessages: string[] = [];
  const event = runDailyEvent(guildId, facility);
  if (event) eventMessages.push(event);

  const currentFacility = db.query(`SELECT * FROM facility WHERE guild_id = ?`).get(guildId) as any;
  const breaches = maybeTriggerSpontaneousBreaches(guildId, currentFacility);

  db.query(`
    UPDATE facility SET day_count=?, energy=0, quota=?, phase=8,
      stable_days=CASE WHEN ? THEN stable_days + 1 ELSE 0 END
    WHERE guild_id=?
  `).run(nextDay, nextQuota, quotaMet ? 1 : 0, guildId);

  resolveAgentTravel(guildId);

  resolveDailyRecovery(guildId);
  resetDailyOperationalState(guildId);

  const freshFacility = db.query(`SELECT * FROM facility WHERE guild_id = ?`).get(guildId) as any;
  if (quotaMet) {
    recordDepartmentProgress(guildId, 'command', 1);
  }
  logEvent(guildId, completedDay, facility.phase, 'day_end',
    quotaMet ? `Day ${completedDay} completed successfully with ${facility.energy}/${oldQuota} energy.` :
      `Day ${completedDay} ended without meeting quota: ${facility.energy}/${oldQuota}.`);
  createMemoryCheckpoint(guildId, db.query(`SELECT * FROM facility WHERE guild_id=?`).get(guildId) as any);

  let summary = quotaMet
    ? `☀️ **DAY ${completedDay} COMPLETED SUCCESSFULLY!**\nEnergy quota met: **${facility.energy}/${oldQuota}** ⚡`
    : `⚠️ **DAY ${completedDay} ENDED WITHOUT MEETING QUOTA!**\nEnergy collected: **${facility.energy}/${oldQuota}** ⚡`;

  summary += `\n\n🌅 **DAY ${nextDay}** begins. New quota: **${nextQuota}⚡**.`;
  summary += `\n🧠 recovery routines have been processed.`;
  summary += `\n⏰ current phase: **08:00**`;

  if (eventMessages.length) summary += `\n\n${eventMessages.join('\n')}`;
  if (breaches.length) summary += `\n\n🚨 ${breaches.length} abnormality(ies) breached spontaneously: ${breaches.map((a: any) => `**${a.name}**`).join(', ')}`;

  const containCh = interaction.guild?.channels.cache.get(freshFacility.containment_channel_id) as any;
  if (containCh && breaches.length) {
    for (const abno of breaches) await sendBreachAlert(interaction, freshFacility, abno);
  }

  await sendFacilityRadio(interaction.guild, freshFacility, `SHIFT RESET — day ${nextDay} has begun. energy quota: ${nextQuota}. ${breaches.length ? `${breaches.length} containment alert(s) carried into the new shift.` : 'all monitored systems report nominal.'}`).catch(() => {});
  await interaction.reply(summary);
}

// ==========================================
// 🤖 DISCORD CLIENT
// ==========================================

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`wonderhooi!! ✨ logged in as ${readyClient.user.tag}!`);
  console.log('facility simulation v2 is online!! 🚀💖');

  // Repair/recreate persisted facility channels after restarts or manual deletion.
  for (const guild of readyClient.guilds.cache.values()) {
    try {
      const facility = db.query(`SELECT * FROM facility WHERE guild_id=?`).get(guild.id) as any;
      if (!facility || !Number(facility.is_started)) continue;
      await ensureFacilityChannels(guild, facility);
    } catch (error) {
      console.error(`channel recovery failed for guild ${guild.id}:`, error);
    }
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.guildId || !interaction.guild) return;

    const facility = ensureFacility(interaction.guildId, interaction.user.id);
    seedAbnormalities(interaction.guildId);

    if (interaction.isChatInputCommand()) {
      const { commandName, user, guildId, guild } = interaction;

      if (commandName === 'join') {
        adoptLegacyAgent(user.id, guildId);
        const existing = findAgent(user.id, guildId);
        if (existing) {
          return interaction.reply({ content: 'you are already an agent silly!! 🎀', ephemeral: true });
        }

        const trait = pick(Object.keys(TRAITS));
        const fortitude = rand(2, 4);
        const prudence = rand(2, 4);
        const temperance = rand(2, 4);
        const justice = rand(2, 4);
        const maxHp = calculateMaxHp(fortitude);
        const maxSp = calculateMaxSp(prudence);

        db.query(`
  INSERT INTO agents (
    discord_id, guild_id, name, hp, max_hp, sp, max_sp,
    level, fortitude, prudence, temperance, justice, trait, department
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  user.id,
  guildId,
  user.username,
  maxHp,
  maxHp,
  maxSp,
  maxSp,
  1,
  fortitude,
  prudence,
  temperance,
  justice,
  trait,
  'control'
);

        logEvent(guildId, facility.day_count, facility.phase, 'agent_joined', `${user.username} joined as a new agent.`);
        await interaction.reply(
          `welcome to the corporation, agent **${user.username}**!! ✨\n` +
          `you've been assigned the **${TRAITS[trait]?.name ?? trait}** trait.\n` +
          `stats: 💪 ${fortitude} · 🧠 ${prudence} · 💗 ${temperance} · ⚔️ ${justice}\n` +
          `grab your standard issue riot stick and try not to die!! 🎀`
        );
      }

      else if (commandName === 'start-game') {
        if (facility.manager_id !== user.id) return interaction.reply({ content: 'only the manager can start the game!! 😠', ephemeral: true });
        if (facility.is_started === 1) return interaction.reply({ content: 'the facility is already up and running!! ✨', ephemeral: true });

        await interaction.deferReply();
        db.query(`UPDATE facility SET is_started=1 WHERE guild_id=?`).run(guildId);
        const startedFacility = db.query(`SELECT * FROM facility WHERE guild_id=?`).get(guildId) as any;
        const repaired = await ensureFacilityChannels(guild, startedFacility);
        seedAbnormalities(guildId);

        const controlCh = guild.channels.cache.get(repaired.control_channel_id) as any;
        const statusCh = guild.channels.cache.get(repaired.status_channel_id) as any;
        const radioCh = guild.channels.cache.get(repaired.radio_channel_id) as any;
        if (controlCh?.send) await controlCh.send({ content: `🏢 **CONTROL TEAM ONLINE**\nmanager operations are active. use \`/facility\` to inspect the simulation.` });
        if (statusCh?.send) await statusCh.send({ embeds: [facilityDashboard(db.query(`SELECT * FROM facility WHERE guild_id=?`).get(guildId) as any, db.query(`SELECT * FROM agents WHERE guild_id = ?`).all(guildId) as any[], db.query(`SELECT * FROM abnormalities WHERE guild_id=?`).all(guildId) as any[])] });
        if (radioCh?.send) await radioCh.send({ content: `📻 **FACILITY RADIO ONLINE**\nall employees: communications routing has been restored.` });
        createMemoryCheckpoint(guildId, db.query(`SELECT * FROM facility WHERE guild_id=?`).get(guildId) as any);

        await interaction.editReply(`🎉 **FACILITY OPERATIONS STARTED!** persistent facility channels are online.`);
        logEvent(guildId, facility.day_count, facility.phase, 'facility_start', 'Facility operations started.');
      }

      else if (commandName === 'pause') {
        if (facility.manager_id !== user.id) return interaction.reply({ content: 'only the manager can pause operations!!', ephemeral: true });
        const newStatus = facility.is_paused ? 0 : 1;
        db.query(`UPDATE facility SET is_paused=? WHERE guild_id=?`).run(newStatus, guildId);
        logEvent(guildId, facility.day_count, facility.phase, 'facility', newStatus ? 'Operations paused.' : 'Operations resumed.');
        await interaction.reply(newStatus ? '⏸️ facility operations have been **PAUSED**!' : '▶️ facility operations have been **RESUMED**!');
      }

      else if (commandName === 'facility') {
        const fresh = db.query(`SELECT * FROM facility WHERE guild_id=?`).get(guildId) as any;
        const agents = db.query(`SELECT * FROM agents WHERE guild_id = ?`).all(guildId) as any[];
        const abnormalities = db.query(`SELECT * FROM abnormalities WHERE guild_id=?`).all(guildId) as any[];
        await interaction.reply({ embeds: [facilityDashboard(fresh, agents, abnormalities)] });
      }

      else if (commandName === 'status') {
        const agent = findAgent(user.id, guildId);
        if (!agent) return interaction.reply({ content: 'you are not an agent! `/join` first!', ephemeral: true });
        await interaction.reply({ embeds: [agentStatusEmbed(agent, facility)] });
      }

      else if (commandName === 'info') {
        const targetId = interaction.options.getString('abnormality', true);
        const selected = (db.query(`SELECT * FROM abnormalities WHERE guild_id=? ORDER BY id`).all(guildId) as any[])
          .find(a => a.name.toLowerCase().includes(targetId.toLowerCase()) || String(a.id) === targetId);

        if (!selected) return interaction.reply({ content: `❌ no abnormality matched **${targetId}**.`, ephemeral: true });

        const agent = findAgent(user.id, guildId);
        if (!agent) return interaction.reply({ content: 'you need to `/join` first!', ephemeral: true });
        const built = buildInformationEmbed(interaction.guild, agent, selected, 'overview');
        await interaction.reply({ embeds: [built.embed], components: [built.row] });
      }

      else if (commandName === 'gifts') {
        const agent = findAgent(user.id, guildId);
        if (!agent) return interaction.reply({ content: 'you are not an agent! `/join` first!', ephemeral: true });
        const owned = JSON.parse(agent.ego_gifts || '[]') as string[];
        if (!owned.length) {
          return interaction.reply({ content: '💠 you have not acquired any E.G.O. gifts yet. suppress a breaching abnormality for a chance at one!', ephemeral: true });
        }
        const lines = owned
          .map(id => EGO_GIFTS[id])
          .filter((gift): gift is GiftDef => !!gift)
          .map(gift => `${gift.icon} **${gift.name}** *(from ${gift.sourceAbno})*${agent.equipped_gift === gift.id ? ' ✅ equipped' : ''}\n${gift.drawback}`)
          .join('\n\n');
        await interaction.reply({ content: `💠 **${agent.name}'S E.G.O. GIFTS**\n\n${lines}`, ephemeral: true });
      }

      else if (commandName === 'equip-gift') {
        const agent = findAgent(user.id, guildId);
        if (!agent) return interaction.reply({ content: 'you are not an agent! `/join` first!', ephemeral: true });
        const query = interaction.options.getString('gift', true).trim().toLowerCase();

        if (query === 'none' || query === 'unequip') {
          db.query(`UPDATE agents SET equipped_gift='' WHERE discord_id=? AND guild_id=?`).run(user.id, guildId);
          return interaction.reply({ content: '💠 gift unequipped.', ephemeral: true });
        }

        const owned = JSON.parse(agent.ego_gifts || '[]') as string[];
        const matchId = owned.find(id => EGO_GIFTS[id] && EGO_GIFTS[id].name.toLowerCase().includes(query));
        if (!matchId) return interaction.reply({ content: `❌ you don't own a gift matching **${query}**. check \`/gifts\`.`, ephemeral: true });

        db.query(`UPDATE agents SET equipped_gift=? WHERE discord_id=? AND guild_id=?`).run(matchId, user.id, guildId);
        const gift = EGO_GIFTS[matchId]!;
        await interaction.reply(`💠 **${gift.icon} ${gift.name}** equipped!!\n${gift.drawback}`);
      }

      else if (commandName === 'dictator-toggle') {
        if (facility.manager_id !== user.id) return interaction.reply({ content: 'only the manager can change dictator mode!!', ephemeral: true });
        const newMode = facility.dictator_mode ? 0 : 1;
        db.query(`UPDATE facility SET dictator_mode=? WHERE guild_id=?`).run(newMode, guildId);
        logEvent(guildId, facility.day_count, facility.phase, 'mode', newMode ? 'Dictator mode enabled.' : 'Democracy mode enabled.');
        await interaction.reply(newMode
          ? '👑 **DICTATOR MODE ENABLED!** only the manager can end the day.'
          : '🗳️ **DICTATOR MODE DISABLED!** democracy is back.');
      }

      else if (commandName === 'heal-all') {
        if (facility.manager_id !== user.id) return interaction.reply({ content: 'manager only!!', ephemeral: true });
        const agents = db.query(`SELECT * FROM agents WHERE guild_id = ? AND status != 'dead'`).all(guildId) as any[];
        for (const agent of agents) {
          agent.hp = agent.max_hp;
          agent.sp = agent.max_sp;
          agent.status = 'idle';
          agent.recovery_days = 0;
          updateAgent(agent);
        }
        logEvent(guildId, facility.day_count, facility.phase, 'admin', 'Manager healed all living agents.');
        await interaction.reply('💖 all living agents have been fully healed and stabilised!!');
      }

      else if (commandName === 'work') {
        if (!facility.is_started) return interaction.reply({ content: 'ask the manager to `/start-game`! 🚀', ephemeral: true });
        if (facility.is_paused) return interaction.reply({ content: '⏸️ facility operations are currently paused!', ephemeral: true });

        const agent = findAgent(user.id, guildId);
        if (!agent) return interaction.reply({ content: 'you need to `/join` first!!', ephemeral: true });
        if (agent.status === 'dead') return interaction.reply({ content: '💀 you are dead!!', ephemeral: true });
        if (agent.status === 'panicked' || agent.status === 'traumatized') return interaction.reply({ content: `🧠 you are ${agent.status}! recover first!`, ephemeral: true });

        const abnos = db.query(`SELECT * FROM abnormalities WHERE guild_id=? AND is_breaching=0 ORDER BY id`).all(guildId) as any[];
        const targetAbnoInput = interaction.options.getString('abnormality');
        const workTypeInput = interaction.options.getString('type') as WorkType | null;
        const levelInput = interaction.options.getInteger('level');

        if (targetAbnoInput && workTypeInput && levelInput) {
          const selected = abnos.find(a => a.name.toLowerCase().includes(targetAbnoInput.toLowerCase()) || a.id.toString() === targetAbnoInput);
          if (!selected) return interaction.reply({ content: `❌ no abnormality matched **${targetAbnoInput}**.`, ephemeral: true });
          return executeWork(interaction, agent, selected, workTypeInput, facility, levelInput);
        }

        if (targetAbnoInput && workTypeInput) {
          const selected = abnos.find(a => a.name.toLowerCase().includes(targetAbnoInput.toLowerCase()) || a.id.toString() === targetAbnoInput);
          if (!selected) return interaction.reply({ content: `❌ no abnormality matched **${targetAbnoInput}**.`, ephemeral: true });
          const displayedSelected = getDisplayAbnormality(selected, abnos);
          const preview = levelPreviewText(agent, selected, workTypeInput, facility);
          return interaction.reply({
            content: `${getWorkType(workTypeInput).icon} **${getWorkType(workTypeInput).label}** on **${displayedSelected.name}**\n\nhow deep do you want to push it? higher levels increase payout potential but also increase the risk of a poor result.\n${preview}`,
            components: [buildLevelRow(workTypeInput, selected)]
          });
        }

        if (targetAbnoInput) {
          const selected = abnos.find(a => a.name.toLowerCase().includes(targetAbnoInput.toLowerCase()) || a.id.toString() === targetAbnoInput);
          if (!selected) return interaction.reply({ content: `❌ no abnormality matched **${targetAbnoInput}**.`, ephemeral: true });

          const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            ...(['instinct', 'insight', 'attachment', 'repression'] as WorkType[]).map(type =>
              new ButtonBuilder()
                .setCustomId(`workbtn_${type}_${selected.id}`)
                .setLabel(`${getGuildEmojiString(interaction.guild, getWorkType(type).icon, getWorkType(type).label)} ${getWorkType(type).label}`)
                .setStyle(type === 'instinct' ? ButtonStyle.Danger : type === 'insight' ? ButtonStyle.Primary : type === 'attachment' ? ButtonStyle.Secondary : ButtonStyle.Success)
            )
          );

          const displayedSelected = getDisplayAbnormality(selected, abnos);
          const bInfo = BEHAVIOUR_INFO[getBehaviour(selected)];
          const meltdown = getMeltdownState(selected);
          const riskKey = (selected.risk as keyof typeof LOBOTOMY_EMOJIS.risk) ?? 'ZAYIN';
          const rawActiveProcess = String(selected.current_work_process ?? '');
          const activeProcess: WorkType = (['instinct', 'insight', 'attachment', 'repression'] as string[]).includes(rawActiveProcess)
            ? rawActiveProcess as WorkType
            : 'instinct';
          const damageEmoji = getGuildEmojiString(interaction.guild, (LOBOTOMY_EMOJIS.damage as Record<string, string>)[displayedSelected?.damage_type ?? selected.damage_type] ?? (displayedSelected?.damage_type ?? selected.damage_type), (displayedSelected?.damage_type ?? selected.damage_type));
          const processEmoji = getGuildEmojiString(interaction.guild, getWorkType(activeProcess).icon, getWorkType(activeProcess).label);
          const riskEmoji = getGuildEmojiString(interaction.guild, (LOBOTOMY_EMOJIS.risk as Record<string, string>)[riskKey] ?? 'Risk_Zayin', '⚪');
          const infoName = displayedSelected?.name ?? selected.name;

          const knowledge = getAgentKnowledge(guildId, user.id, selected.id);
          const unique = totalUniquePE(knowledge);
          const description = knowledge.description_unlocked
            ? (displayedSelected?.description ?? selected.description)
            : unique >= 4
              ? 'Your notes are incomplete, but repeated handling has revealed patterns in the chamber.'
              : 'Your notes contain only preliminary observations. Continue working to learn more.';

          const info = new EmbedBuilder()
            .setTitle(`🧪 ${infoName}`)
            .setDescription(`${description}`)
            .addFields(
              { name: 'risk', value: `${riskEmoji} ${displayedSelected?.risk ?? selected.risk}`, inline: true },
              { name: 'qliphoth', value: `${selected.qliphoth}/${selected.max_qliphoth}`, inline: true },
              { name: 'meltdown', value: `${meltdown.icon} ${meltdown.label} · ${formatMeltdownTimer(selected)}`, inline: true },
              { name: 'active process', value: `${processEmoji} ${activeProcess}`, inline: true },
              { name: 'damage', value: `${damageEmoji} ${selected.damage_amt} ${(displayedSelected?.damage_type ?? selected.damage_type)}`, inline: true },
              { name: 'observations', value: `${unique}/8 unique PE boxes`, inline: true },
              {
                name: 'work favor',
                value: ['instinct', 'insight', 'attachment', 'repression']
                  .map(type => {
                    const count = Number(knowledge?.[`${type}_pe`] ?? 0);
                    return `${type}: ${count >= 2 ? '✅ revealed' : `🔒 ${count}/2`}`;
                  }).join(' · ')
              },
              {
                name: '💠 gift',
                value: selected.gift_id && EGO_GIFTS[selected.gift_id]
                  ? `${EGO_GIFTS[selected.gift_id]!.icon} ${EGO_GIFTS[selected.gift_id]!.name} (chance on suppression)`
                  : 'none'
              }
            );

          return interaction.reply({ embeds: [info], components: [row] });
        }

        const menu = new StringSelectMenuBuilder()
          .setCustomId('select_abno_work')
          .setPlaceholder('select an abnormality to work on! ✨')
          .addOptions(abnos.map(a => {
            const displayedA = getDisplayAbnormality(a, abnos);
            const bInfo = BEHAVIOUR_INFO[getBehaviour(a)];
            return new StringSelectMenuOptionBuilder()
              .setLabel(`${displayedA.name} [${displayedA.risk}]`)
              .setDescription(`${bInfo.icon} ${bInfo.label} · qliphoth ${a.qliphoth}/${a.max_qliphoth} · ${displayedA.damage_type} ${a.damage_amt} dmg`)
              .setValue(a.id.toString());
          }));

        await interaction.reply({ content: 'who do you want to work on? 🧪', components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)] });
      }

      else if (commandName === 'end-day') {
        if (!facility.is_started) return interaction.reply({ content: 'the facility has not started yet!', ephemeral: true });
        if (facility.is_paused) return interaction.reply({ content: 'you cannot progress a paused facility!', ephemeral: true });
        if (facility.dictator_mode && facility.manager_id !== user.id) {
          return interaction.reply({ content: '👑 dictator mode is active! only the manager can end the day.', ephemeral: true });
        }
        return endDay(interaction, facility);
      }

      else if (commandName === 'upgrade') {
        if (facility.manager_id !== user.id) return interaction.reply({ content: 'manager only!!', ephemeral: true });
        const type = interaction.options.getString('type', true) as UpgradeType;
        const levelKey = `${type}_level`;
        const current = Number(facility[levelKey] ?? 1);
        const cost = 80 + current * 55;
        if (facility.lob_points < cost) return interaction.reply({ content: `💰 not enough LOB points. need **${cost}**, have **${facility.lob_points}**.`, ephemeral: true });

        db.query(`UPDATE facility SET ${levelKey}=?, lob_points=lob_points-? WHERE guild_id=?`).run(current + 1, cost, guildId);
        logEvent(guildId, facility.day_count, facility.phase, 'upgrade', `${type} upgraded to level ${current + 1}.`);
        await interaction.reply(`🏗️ **${type.toUpperCase()} UPGRADED!** level **${current + 1}** reached. 💰 -${cost} LOB points`);
      }

      else if (commandName === 'train') {
        if (facility.manager_id !== user.id) return interaction.reply({ content: 'manager only!!', ephemeral: true });
        const target = interaction.options.getUser('agent', true) as User;
        const stat = interaction.options.getString('stat', true) as StatName;
        const agent = findAgent(target.id, guildId);
        if (!agent) return interaction.reply({ content: `${target.username} is not an agent!`, ephemeral: true });

        const cost = 50 + agent[stat] * 20;
        if (facility.research < cost) return interaction.reply({ content: `🧪 not enough research. need **${cost}**, have **${facility.research}**.`, ephemeral: true });

        agent[stat] += 1;
        const synced = syncAgentMaxStats(agent);
        agent.max_hp = synced.maxHp;
        agent.max_sp = synced.maxSp;
        agent.hp = Math.min(agent.max_hp, agent.hp + 15);
        agent.sp = Math.min(agent.max_sp, agent.sp + 15);
        updateAgent(agent);
        db.query(`UPDATE facility SET research=research-? WHERE guild_id=?`).run(cost, guildId);
        recordDepartmentProgress(guildId, 'training', 1);
        logEvent(guildId, facility.day_count, facility.phase, 'training', `${agent.name} trained ${stat}.`);
        await interaction.reply(`🧪 **TRAINING COMPLETE!** ${agent.name} gained **+1 ${stat}**. research -${cost}.`);
      }

          else if (commandName === 'history') {
        const events = db.query(`SELECT * FROM facility_events WHERE guild_id=? ORDER BY id DESC LIMIT 12`).all(guildId) as any[];
        if (!events.length) return interaction.reply('📜 no facility history yet.');
        const text = events.map((e: any) => `**DAY ${e.day} ${String(e.phase).padStart(2, '0')}:00** · ${e.type}\n${e.message}`).join('\n\n');
        await interaction.reply({ content: `📜 **FACILITY HISTORY**\n\n${text}`.slice(0, 1900) });
      }

          else if (commandName === 'radio') {
        const mode = interaction.options.getString('mode') ?? 'history';
        let refreshed = db.query(`SELECT * FROM facility WHERE guild_id=?`).get(guildId) as any;
        if (refreshed?.is_started) refreshed = await ensureFacilityChannels(guild, refreshed);

        if (mode === 'channel') {
          const channelId = String(refreshed?.radio_channel_id ?? '');
          return interaction.reply({
            content: channelId ? `📻 live facility radio: <#${channelId}>` : '📻 the facility radio has not been provisioned yet.',
            ephemeral: true
          });
        }

        if (mode === 'test') {
          if (facility.manager_id !== user.id) return interaction.reply({ content: 'manager only!!', ephemeral: true });
          const message = `CONTROL: radio check from **${user.username}**. communications are nominal.`;
          logEvent(guildId, facility.day_count, facility.phase, 'radio', message);
          const sent = await sendFacilityRadio(guild, refreshed, message);
          return interaction.reply({ content: sent ? '📻 radio test transmitted successfully.' : '⚠️ the radio transmission could not be delivered.', ephemeral: true });
        }

        const transmissions = db.query(`
          SELECT * FROM facility_events
          WHERE guild_id=? AND type IN ('ambient_event', 'radio', 'panic', 'department_unlock')
          ORDER BY id DESC LIMIT 10
        `).all(guildId) as any[];
        if (!transmissions.length) return interaction.reply({ content: '📻 no radio transmissions have been recorded yet.', ephemeral: true });

        const body = transmissions
          .map((event: any) => `**DAY ${event.day} · ${getPhaseLabel(event.phase)}**
${event.message}`)
          .join('\n\n─────────────────\n\n');
        await interaction.reply({ content: `📻 **FACILITY RADIO ARCHIVE**

${body}`.slice(0, 1900), ephemeral: true });
      }

      else if (commandName === 'work-history') {
        const agent = findAgent(user.id, guildId);
        if (!agent) return interaction.reply({ content: 'you need to `/join` first!!', ephemeral: true });

        const entries = db.query(`SELECT * FROM agent_work_history WHERE guild_id=? AND discord_id=? ORDER BY id DESC LIMIT 10`).all(guildId, user.id) as any[];
        if (!entries.length) return interaction.reply({ content: '📓 your work log is empty. complete a work session to start it.', ephemeral: true });

        const lines = entries.map(entry => {
          const qliphoth = entry.qliphoth_change > 0 ? '+1' : entry.qliphoth_change < 0 ? '-1' : '—';
          return `**DAY ${entry.day} · ${getPhaseLabel(entry.phase)}** — ${entry.abnormality_name}\n${getWorkType(entry.work_type as WorkType).label} · **${String(entry.result).toUpperCase()}** · PE: ${entry.pe_boxes} · Qliphoth: ${qliphoth} · damage: ${entry.damage}${entry.note ? `\n_${entry.note}_` : ''}`;
        });
        const embed = new EmbedBuilder()
          .setTitle(`📓 WORK LOG — AGENT ${agent.name.toUpperCase()}`)
          .setDescription(lines.join('\n\n─────────────────\n\n'))
          .setFooter({ text: 'your private record · showing the 10 most recent sessions' });
        await interaction.reply({ embeds: [embed], ephemeral: true });
      }

      else if (commandName === 'relationships') {
        const agent = findAgent(user.id, guildId);
        if (!agent) return interaction.reply({ content: 'you need to `/join` first!!', ephemeral: true });
        const relationships = db.query(`
          SELECT r.*, a.name AS agent_name
          FROM agent_relationships r
          JOIN agents a ON a.guild_id=r.guild_id AND a.discord_id=r.to_discord_id
          WHERE r.guild_id=? AND r.from_discord_id=?
          ORDER BY r.trust DESC, a.name
        `).all(guildId, user.id) as any[];
        if (!relationships.length) return interaction.reply({ content: '👥 no relationships recorded yet. share a shift with another agent to begin.', ephemeral: true });

        const lines = relationships.map(relationship => {
          const trust = Number(relationship.trust);
          const filled = Math.max(0, Math.min(10, Math.round((trust + 10) / 2)));
          return `**${agent.name} → ${relationship.agent_name}**\n${'█'.repeat(filled)}${'░'.repeat(10 - filled)}\n${getRelationshipLabel(trust)} · ${relationship.shared_shifts} shared shift(s)`;
        });
        const embed = new EmbedBuilder()
          .setTitle(`👥 AGENT RELATIONSHIPS — ${agent.name.toUpperCase()}`)
          .setDescription(lines.join('\n\n'))
          .setFooter({ text: 'relationships change through shared facility experiences' });
        await interaction.reply({ embeds: [embed], ephemeral: true });
      }

      else if (commandName === 'departments') {
        const refreshed = db.query(`SELECT * FROM facility WHERE guild_id=?`).get(guildId) as any;
        syncDepartmentUnlocks(guildId, refreshed);
        const deptRows = getDepartmentRouteSummary(refreshed, findAgent(user.id, guildId));
        const lines = deptRows.map(row => {
          const marker = row.current ? '📍' : row.unlocked ? '✅' : '🔒';
          const quest = row.target > 0 ? `${row.complete ? '✅' : '◻️'} quest: ${row.questGoal} — **${row.progress}/${row.target}**` : '';
          const gate = row.unlocked ? 'route available' : row.unlockSource;
          return `${marker} **${row.label}** · ${row.route}
${row.bonus}
${gate}${quest ? `
${quest}` : ''}`;
        }).join('\n\n');
        await interaction.reply({ content: `🏢 **DEPARTMENT ROUTING**

${lines}`.slice(0, 1900), ephemeral: true });
      }

      else if (commandName === 'travel') {
        const dept = interaction.options.getString('department', true).toLowerCase();
        const traveler = findAgent(user.id, guildId);
        if (!traveler) return interaction.reply({ content: 'you need to `/join` before using department routing.', ephemeral: true });
        if (['dead', 'panicked', 'traumatized'].includes(traveler.status)) {
          return interaction.reply({ content: `🚫 you are **${traveler.status}** and cannot travel right now.`, ephemeral: true });
        }
        const facilityRow = db.query(`SELECT * FROM facility WHERE guild_id=?`).get(guildId) as any;
        const unlocked = evaluateDepartmentUnlocks(facilityRow);
        if (!unlocked.includes(dept)) {
          return interaction.reply({ content: `🔒 **${dept}** is not unlocked yet.`, ephemeral: true });
        }

        const travel = startAgentTravel(guildId, user.id, dept);
        if (!travel) {
          return interaction.reply({ content: '❌ unable to travel there.', ephemeral: true });
        }

        if (travel.status === 'already_there') {
          return interaction.reply({ content: `📍 you are already in **${dept}**.`, ephemeral: true });
        }
        if (travel.status === 'already_traveling') {
          return interaction.reply({ content: `🚪 you are already traveling to **${travel.agent.travel_destination}**.`, ephemeral: true });
        }

        await interaction.reply({ content: `🚪 **travel started:** you left **${travel.agent.travel_origin}** for **${dept}**. arrival in **${travel.duration} phase(s)** (${DEPARTMENT_SECTORS[dept as DepartmentName] ?? 'central-command'}).`, ephemeral: true });
      }

      else if (commandName === 'save') {
        if (facility.manager_id !== user.id) return interaction.reply({ content: 'manager only!!', ephemeral: true });
        const slot = interaction.options.getString('slot', true).trim();
        if (!slot) return interaction.reply({ content: 'give the save a name!', ephemeral: true });

        const existing = db.query(`SELECT * FROM save_files WHERE save_name=? AND guild_id=?`).get(slot, guildId) as any | null;
        const countRow = db.query(`SELECT COUNT(*) AS count FROM save_files WHERE guild_id=?`).get(guildId) as { count?: number } | null;
        const count = Number(countRow?.count ?? 0);
        if (!existing && count >= MAX_SAVE_SLOTS) {
          return interaction.reply({ content: `⚠️ this server has reached the save cap (**${MAX_SAVE_SLOTS}**). delete one before creating a new slot.`, ephemeral: true });
        }

        const state = serializeFacility(guildId);
        db.query(`
          INSERT OR REPLACE INTO save_files (save_name, guild_id, state_json, day_count, energy, quota, dictator_mode)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(slot, guildId, json(state), facility.day_count, facility.energy, facility.quota, facility.dictator_mode);
        await interaction.reply(`💾 **save complete!** facility state stored in slot **${slot}**.`);
      }

      else if (commandName === 'load') {
        if (facility.manager_id !== user.id) return interaction.reply({ content: 'manager only!!', ephemeral: true });
        const slot = interaction.options.getString('slot', true).trim();
        const save = db.query(`SELECT * FROM save_files WHERE save_name=? AND guild_id=?`).get(slot, guildId) as any;
        if (!save) return interaction.reply({ content: `❌ save slot **${slot}** not found!`, ephemeral: true });
        restoreState(guildId, JSON.parse(save.state_json));
        const loadedFacility = db.query(`SELECT * FROM facility WHERE guild_id=?`).get(guildId) as any;
        if (loadedFacility?.is_started) await ensureFacilityChannels(guild, loadedFacility);
        await interaction.reply(`📂 **save loaded!** slot **${slot}** restored. the simulation is back on **day ${save.day_count}**.`);
        logEvent(guildId, save.day_count, 8, 'save_load', `Save slot ${slot} loaded.`);
      }

      else if (commandName === 'rewind') {
        if (facility.manager_id !== user.id) return interaction.reply({ content: 'manager only!!', ephemeral: true });
        const checkpointRestored = restoreLatestMemoryCheckpoint(guildId);
        if (!checkpointRestored) {
          return interaction.reply({ content: '🧠 no memory checkpoint exists for this facility yet.', ephemeral: true });
        }
        const refreshed = db.query(`SELECT * FROM facility WHERE guild_id=?`).get(guildId) as any;
        if (refreshed?.is_started) await ensureFacilityChannels(guild, refreshed);
        await interaction.reply(`🧠 **facility rewind successful!** restored to day **${refreshed.day_count}** and energy **${refreshed.energy}/${refreshed.quota}**.`);
        logEvent(guildId, refreshed.day_count, refreshed.phase, 'rewind', 'Facility rewound to the latest memory checkpoint.');
      }
    }

    // ==========================================
    // 🧪 DROPDOWN WORK FLOW
    // ==========================================
    if (interaction.isStringSelectMenu() && interaction.customId === 'select_abno_work') {
      const guildId = interaction.guildId!;
      const facility = db.query(`SELECT * FROM facility WHERE guild_id=?`).get(guildId) as any;
      const abnoId = interaction.values[0]!;
      const abno = db.query(`SELECT * FROM abnormalities WHERE id=? AND guild_id=?`).get(abnoId, guildId) as any;
      if (!abno || abno.is_breaching) return interaction.update({ content: '🚨 that abnormality is currently unavailable because it is breaching.', components: [] });

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...(['instinct', 'insight', 'attachment', 'repression'] as WorkType[]).map(type => {
          const emoji = getGuildEmojiObject(interaction.guild, getWorkType(type).icon);
          const builder = new ButtonBuilder()
            .setCustomId(`workbtn_${type}_${abno.id}`)
            .setLabel(getWorkType(type).label)
            .setStyle(type === 'instinct' ? ButtonStyle.Danger : type === 'insight' ? ButtonStyle.Primary : type === 'attachment' ? ButtonStyle.Secondary : ButtonStyle.Success);

          if (emoji) {
            builder.setEmoji({
              id: emoji.id,
              name: emoji.name,
              animated: Boolean(emoji.animated)
            });
          }

          return builder;
        })
      );

      const agent = findAgent(interaction.user.id, guildId);
      if (!agent) return interaction.update({ content: 'you need to `/join` first!', components: [] });

      const knowledge = getAgentKnowledge(guildId, interaction.user.id, Number(abno.id));
      const preview = (['instinct', 'insight', 'attachment', 'repression'] as WorkType[])
        .map(type => {
          const count = Number(knowledge?.[`${type}_pe`] ?? 0);
          return `${getGuildEmojiString(interaction.guild, getWorkType(type).icon, type)} **${type}** — ${count >= 2 ? 'preferences known' : `🔒 ${count}/2 PE observations`}`;
        })
        .join('\n');

      await interaction.update({ content: `🧪 **${abno.name}**\n\npersonal observations:\n${preview}\n\nchoose your work type!`, components: [row] });
    }

    // ==========================================
    // ⚔️ BUTTONS — WORK + BREACH SUPPRESSION
    // ==========================================
    if (interaction.isButton()) {
      const guildId = interaction.guildId!;
      const facility = db.query(`SELECT * FROM facility WHERE guild_id=?`).get(guildId) as any;

      if (interaction.customId.startsWith('workbtn_')) {
        const [, rawType, abnoId] = interaction.customId.split('_');
        const workType = rawType as WorkType;
        const agent = findAgent(interaction.user.id, guildId);
        const abnormalityId = abnoId ?? '';
        const abno = abnormalityId ? db.query(`SELECT * FROM abnormalities WHERE id=? AND guild_id=?`).get(abnormalityId, guildId) as any : null;
        if (!agent || !abno) return interaction.update({ content: '❌ unable to resolve the work assignment.', components: [] });
        if (facility.is_paused) return interaction.update({ content: '⏸️ facility operations are paused.', components: [] });

        const bInfo = BEHAVIOUR_INFO[getBehaviour(abno)];
        const preview = levelPreviewText(agent, abno, workType, facility);
        return interaction.update({
          content: `${getGuildEmojiString(interaction.guild, getWorkType(workType).icon, getWorkType(workType).label)} **${getWorkType(workType).label}** on **${abno.name}** ${bInfo.icon}\n\nhow deep do you want to push it? higher levels pay more PE but hit your odds harder.\n${preview}`,
          components: [buildLevelRow(workType, abno)]
        });
      }

      if (interaction.customId.startsWith('worklvl_')) {
        const [, rawType, abnoId, rawLevel] = interaction.customId.split('_');
        const workType = rawType as WorkType;
        const level = Number(rawLevel) || 1;
        const agent = findAgent(interaction.user.id, guildId);
        const abnormalityId = abnoId ?? '';
        const abno = abnormalityId ? db.query(`SELECT * FROM abnormalities WHERE id=? AND guild_id=?`).get(abnormalityId, guildId) as any : null;
        if (!agent || !abno) return interaction.update({ content: '❌ unable to resolve the work assignment.', components: [] });
        if (facility.is_paused) return interaction.update({ content: '⏸️ facility operations are paused.', components: [] });
        return executeWork(interaction, agent, abno, workType, facility, level);
      }

      if (interaction.customId.startsWith('info_')) {
        const [, sectionRaw, abnoIdRaw] = interaction.customId.split('_');
        const section = (sectionRaw ?? 'overview') as 'overview' | 'tips' | 'favor';
        const abnoId = Number(abnoIdRaw);
        const agent = findAgent(interaction.user.id, guildId);
        const abno = db.query(`SELECT * FROM abnormalities WHERE id=? AND guild_id=?`).get(abnoId, guildId) as any;

        if (!agent || !abno) {
          return interaction.reply({ content: '❌ your information record could not be resolved.', ephemeral: true });
        }

        const built = buildInformationEmbed(interaction.guild, agent, abno, section);
        await interaction.update({ embeds: [built.embed], components: [built.row] });
        return;
      }

      if (interaction.customId.startsWith('suppress_retreat_')) {
        const abnoId = interaction.customId.replace('suppress_retreat_', '');
        const agent = findAgent(interaction.user.id, guildId);
        if (agent) {
          agent.status = 'idle';
          updateAgent(agent);
        }
        await interaction.update({ content: `🏃 **${interaction.user.username} retreated from the breach.** the abnormality remains active.`, components: [] });
        return;
      }

      if (interaction.customId.startsWith('suppress_confirm_')) {
        const abnoId = interaction.customId.replace('suppress_confirm_', '');
        const agent = findAgent(interaction.user.id, guildId);
        const abno = abnoId ? db.query(`SELECT * FROM abnormalities WHERE id=? AND guild_id=?`).get(abnoId, guildId) as any : null;
        if (!agent) return interaction.reply({ content: 'you need to `/join` first!', ephemeral: true });
        if (!abno) return interaction.reply({ content: 'that abnormality does not exist!', ephemeral: true });
        if (agent.status === 'dead' || agent.status === 'panicked' || agent.status === 'traumatized') {
          return interaction.reply({ content: `you are ${agent.status} and cannot fight!`, ephemeral: true });
        }
        if (!abno.is_breaching) return interaction.reply({ content: 'that abnormality is not currently breaching.', ephemeral: true });

        const cooldownKey = `${guildId}:${agent.discord_id}:${abno.id}`;
        const now = Date.now();
        const cooldownUntil = SUPPRESSION_COOLDOWNS.get(cooldownKey) ?? 0;
        if (now < cooldownUntil) {
          return interaction.reply({ content: '⏳ the breach is still resolving. wait a moment before attacking again.', ephemeral: true });
        }
        SUPPRESSION_COOLDOWNS.set(cooldownKey, now + 1200);

        const behaviour = getBehaviour(abno);
        const weapon = getWeapon(agent)!;
        const facilitySecurity = Number(facility.security_level);
        let agentDamage = rand(weapon.min, weapon.max);
        agentDamage = Math.floor(agentDamage * (1 + getEffectiveStat(agent, 'justice') * 0.04) * weapon.speed);
        if (agent.trait === 'reckless') agentDamage = Math.floor(agentDamage * 1.15);
        agentDamage += facilitySecurity;

        // behaviour shapes how hard the abnormality fights back
        let incomingMultiplier = 2;
        if (behaviour === 'docile') incomingMultiplier *= 0.85;
        if (behaviour === 'volatile') incomingMultiplier *= (0.8 + Math.random() * 0.5);
        if (behaviour === 'predatory' && (agent.hp < agent.max_hp * 0.4 || agent.sp < agent.max_sp * 0.4)) incomingMultiplier *= 1.4;

        // 🧬 Check if this abnormality has an onCombat hook
        let finalAgentDamage = agentDamage;
        let finalAbnoDamage = abno.damage_amt * incomingMultiplier;
        const combatScript = getAbnormalityScript(abno);
        if (combatScript?.onCombat) {
          const hookResult = combatScript.onCombat(agent, abno, finalAgentDamage);
          if (hookResult) {
            finalAgentDamage = hookResult.agentDamage;
            finalAbnoDamage = hookResult.abnoDamage;
          }
        }

        const incoming = applyDamage(agent, finalAbnoDamage, abno.damage_type);
        abno.hp -= finalAgentDamage;
        agent.assignments += 1;

        const bInfo = BEHAVIOUR_INFO[behaviour];
        let combatLog = `⚔️ **${agent.name}** attacked with **${weapon.name}** for **${agentDamage} ${weapon.type} damage**...\n`;
        combatLog += `${bInfo.icon} **${abno.name}** (${bInfo.label}) retaliated for **${incoming} ${abno.damage_type} damage**.\n`;
        combatLog += `❤️ ${agent.hp}/${agent.max_hp} HP · 🧠 ${agent.sp}/${agent.max_sp} SP`;

        if (agent.status === 'dead') {
          combatLog += `\n💀 **${agent.name} has died in combat.**`;
          logEvent(guildId, facility.day_count, facility.phase, 'death', `${agent.name} died while suppressing ${abno.name}.`);
        } else if (agent.status === 'panicked') {
          combatLog += `\n😵 **${agent.name} has panicked during combat.**`;
        }

        if (abno.hp <= 0) {
          abno.hp = abno.max_hp;
          abno.is_breaching = 0;
          abno.qliphoth = abno.max_qliphoth;
          abno.rage = Math.max(0, abno.rage - 3);
          abno.suppressed_count += 1;
          agent.kills += 1;
          const riskWeight = RISK_VALUES[String(abno.risk)] ?? 1;
          const expMessages = awardExperience(agent, 12 + riskWeight * 8);

          let giftLog = '';
          if (abno.gift_id && EGO_GIFTS[abno.gift_id]) {
            const owned = JSON.parse(agent.ego_gifts || '[]') as string[];
            if (!owned.includes(abno.gift_id)) {
              const dropChance = clamp(0.15 + riskWeight * 0.05, 0, 0.55);
              if (Math.random() < dropChance) {
                owned.push(abno.gift_id);
                agent.ego_gifts = json(owned);
                const gift = EGO_GIFTS[abno.gift_id] as GiftDef;
                giftLog = `\n\n💠 **E.G.O. GIFT ACQUIRED: ${gift.icon} ${gift.name}!**\n${gift.drawback}\nequip it any time with \`/equip-gift ${gift.name}\`.`;
              }
            }
          }

          const tx = db.transaction(() => {
            updateAgent(agent);
            db.query(`UPDATE abnormalities SET hp=?, is_breaching=0, qliphoth=?, rage=?, suppressed_count=? WHERE id=?`).run(abno.hp, abno.qliphoth, abno.rage, abno.suppressed_count, abno.id);
          });
          tx();

          recordDepartmentProgress(guildId, 'security', 1);
          logEvent(guildId, facility.day_count, facility.phase, 'suppression', `${agent.name} suppressed ${abno.name}.`);
          combatLog += `\n\n🎉 **${abno.name.toUpperCase()} HAS BEEN SUPPRESSED!** it has returned to containment.`;
          if (expMessages.length) combatLog += `\n${expMessages.join('\n')}`;
          if (giftLog) combatLog += giftLog;
          await interaction.update({ content: combatLog, components: [] });
        } else {
          const tx = db.transaction(() => {
            updateAgent(agent);
            db.query(`UPDATE abnormalities SET hp=? WHERE id=?`).run(abno.hp, abno.id);
          });
          tx();

          const oldEmbed = interaction.message.embeds[0];
          const newEmbed = oldEmbed
            ? EmbedBuilder.from(oldEmbed).setDescription(`risk: ${abno.risk}\nHP: ${abno.hp}/${abno.max_hp}\n\n${combatLog}`)
            : new EmbedBuilder().setTitle(`🚨 ${abno.name}`).setDescription(combatLog).setColor(0xFF0000);
          await interaction.update({ embeds: [newEmbed], content: '', components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`suppress_confirm_${abno.id}`).setLabel('⚔️ SUPPRESS').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`suppress_retreat_${abno.id}`).setLabel('🏃 RETREAT').setStyle(ButtonStyle.Secondary)
          )] });
        }
        return;
      }

      if (interaction.customId.startsWith('suppress_')) {
        const abnoId = interaction.customId.split('_')[1] ?? '';
        const agent = findAgent(interaction.user.id, guildId);
        const abno = abnoId ? db.query(`SELECT * FROM abnormalities WHERE id=? AND guild_id=?`).get(abnoId, guildId) as any : null;
        if (!agent) return interaction.reply({ content: 'you need to `/join` first!', ephemeral: true });
        if (!abno) return interaction.reply({ content: 'that abnormality does not exist!', ephemeral: true });
        if (agent.status === 'dead' || agent.status === 'panicked' || agent.status === 'traumatized') {
          return interaction.reply({ content: `you are ${agent.status} and cannot fight!`, ephemeral: true });
        }
        if (!abno.is_breaching) return interaction.reply({ content: 'that abnormality is not currently breaching.', ephemeral: true });
        if (isCriticallyLow(agent)) {
          return interaction.reply({
            content: `⚠️ **${agent.name} is critically low** — **HP ${agent.hp}/${agent.max_hp}** and **SP ${agent.sp}/${agent.max_sp}**. retreat or continue anyway?`,
            components: [buildCombatWarningRow(abno.id)],
            ephemeral: true
          });
        }

        const cooldownKey = `${guildId}:${agent.discord_id}:${abno.id}`;
        const now = Date.now();
        const cooldownUntil = SUPPRESSION_COOLDOWNS.get(cooldownKey) ?? 0;
        if (now < cooldownUntil) {
          return interaction.reply({ content: '⏳ the breach is still resolving. wait a moment before attacking again.', ephemeral: true });
        }
        SUPPRESSION_COOLDOWNS.set(cooldownKey, now + 1200);

        const behaviour = getBehaviour(abno);
        const weapon = getWeapon(agent)!;
        const facilitySecurity = Number(facility.security_level);
        let agentDamage = rand(weapon.min, weapon.max);
        agentDamage = Math.floor(agentDamage * (1 + getEffectiveStat(agent, 'justice') * 0.04) * weapon.speed);
        if (agent.trait === 'reckless') agentDamage = Math.floor(agentDamage * 1.15);
        agentDamage += facilitySecurity;

        let incomingMultiplier = 2;
        if (behaviour === 'docile') incomingMultiplier *= 0.85;
        if (behaviour === 'volatile') incomingMultiplier *= (0.8 + Math.random() * 0.5);
        if (behaviour === 'predatory' && (agent.hp < agent.max_hp * 0.4 || agent.sp < agent.max_sp * 0.4)) incomingMultiplier *= 1.4;

        // 🧬 Check if this abnormality has an onCombat hook
        let finalAgentDamage = agentDamage;
        let finalAbnoDamage = abno.damage_amt * incomingMultiplier;
        const combatScript2 = getAbnormalityScript(abno);
        if (combatScript2?.onCombat) {
          const hookResult = combatScript2.onCombat(agent, abno, finalAgentDamage);
          if (hookResult) {
            finalAgentDamage = hookResult.agentDamage;
            finalAbnoDamage = hookResult.abnoDamage;
          }
        }

        const incoming = applyDamage(agent, finalAbnoDamage, abno.damage_type);
        abno.hp -= finalAgentDamage;
        agent.assignments += 1;

        const bInfo = BEHAVIOUR_INFO[behaviour];
        let combatLog = `⚔️ **${agent.name}** attacked with **${weapon.name}** for **${agentDamage} ${weapon.type} damage**.\n`;
        combatLog += `${bInfo.icon} **${abno.name}** (${bInfo.label}) retaliated for **${incoming} ${abno.damage_type} damage**.\n`;
        combatLog += `❤️ ${agent.hp}/${agent.max_hp} HP · 🧠 ${agent.sp}/${agent.max_sp} SP`;

        if (agent.status === 'dead') {
          combatLog += `\n💀 **${agent.name} has died in combat.**`;
          logEvent(guildId, facility.day_count, facility.phase, 'death', `${agent.name} died while suppressing ${abno.name}.`);
        } else if (agent.status === 'panicked') {
          combatLog += `\n😵 **${agent.name} has panicked during combat.**`;
        }

        if (abno.hp <= 0) {
          abno.hp = abno.max_hp;
          abno.is_breaching = 0;
          abno.qliphoth = abno.max_qliphoth;
          abno.rage = Math.max(0, abno.rage - 3);
          abno.suppressed_count += 1;
          agent.kills += 1;
          const riskWeight = RISK_VALUES[String(abno.risk)] ?? 1;
          const expMessages = awardExperience(agent, 12 + riskWeight * 8);

          let giftLog = '';
          if (abno.gift_id && EGO_GIFTS[abno.gift_id]) {
            const owned = JSON.parse(agent.ego_gifts || '[]') as string[];
            if (!owned.includes(abno.gift_id)) {
              const dropChance = clamp(0.15 + riskWeight * 0.05, 0, 0.55);
              if (Math.random() < dropChance) {
                owned.push(abno.gift_id);
                agent.ego_gifts = json(owned);
                const gift = EGO_GIFTS[abno.gift_id] as GiftDef;
                giftLog = `\n\n💠 **E.G.O. GIFT ACQUIRED: ${gift.icon} ${gift.name}!**\n${gift.drawback}\nequip it any time with \`/equip-gift ${gift.name}\`.`;
              }
            }
          }

          const tx = db.transaction(() => {
            updateAgent(agent);
            db.query(`UPDATE abnormalities SET hp=?, is_breaching=0, qliphoth=?, rage=?, suppressed_count=? WHERE id=?`).run(abno.hp, abno.qliphoth, abno.rage, abno.suppressed_count, abno.id);
          });
          tx();

          recordDepartmentProgress(guildId, 'security', 1);
          logEvent(guildId, facility.day_count, facility.phase, 'suppression', `${agent.name} suppressed ${abno.name}.`);
          combatLog += `\n\n🎉 **${abno.name.toUpperCase()} HAS BEEN SUPPRESSED!** it has returned to containment.`;
          if (expMessages.length) combatLog += `\n${expMessages.join('\n')}`;
          if (giftLog) combatLog += giftLog;
          await interaction.update({ content: combatLog, components: [] });
        } else {
          const tx = db.transaction(() => {
            updateAgent(agent);
            db.query(`UPDATE abnormalities SET hp=? WHERE id=?`).run(abno.hp, abno.id);
          });
          tx();

          const oldEmbed = interaction.message.embeds[0];
          const newEmbed = oldEmbed
            ? EmbedBuilder.from(oldEmbed).setDescription(`risk: ${abno.risk}\nHP: ${abno.hp}/${abno.max_hp}\n\n${combatLog}`)
            : new EmbedBuilder().setTitle(`🚨 ${abno.name}`).setDescription(combatLog).setColor(0xFF0000);
          await interaction.update({ embeds: [newEmbed], content: '', components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`suppress_confirm_${abno.id}`).setLabel('⚔️ SUPPRESS').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`suppress_retreat_${abno.id}`).setLabel('🏃 RETREAT').setStyle(ButtonStyle.Secondary)
          )] });
        }
      }
    }
  } catch (err) {
    console.error('Unhandled interaction error:', err);
    if (interaction.isRepliable()) {
      const errorMsg = '💥 an error occurred while executing that operation!';
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: errorMsg, ephemeral: true }).catch(() => {});
      } else {
        await interaction.reply({ content: errorMsg, ephemeral: true }).catch(() => {});
      }
    }
  }
});


// ==========================================
// 🧪 TEST-ONLY ENGINE SURFACE
// ==========================================
// Tests can exercise the real production logic without duplicating helpers.
// This object is inert during normal bot operation and intentionally keeps the
// public runtime API small while giving bun:test deep engine access.
export const __test = {
  clamp,
  rand,
  getFavorLabel,
  getWorkFavorLabel,
  ensureAgentKnowledge,
  getAgentKnowledge,
  totalUniquePE,
  updateAgentKnowledge,
  getObservationConfidence,
  getAgentObservations,
  recordSharedShiftRelationships,
  getRelationshipLabel,
  getPhaseLabel,
  buildManagementTips,
  ensureFacilityChannels,
  getTrait,
  getSuit,
  getWeapon,
  getGift,
  getEffectiveStat,
  calculateMaxHp,
  calculateMaxSp,
  syncAgentMaxStats,
  applyDamage,
  updateAgent,
  experienceToNext,
  awardExperience,
  findAgent,
  ensureFacility,
  maybeUnlockCodexEntry,
  maybeTriggerOrdeal,
  getPanicBehaviorKey,
  applyPanicState,
  panicSupportChance,
  resolvePanicPhase,
  seedAbnormalities,
  getCurrentWorkAffinity,
  getMeltdownState,
  getUnlockedDepartments,
  isDepartmentUnlocked,
  getDepartmentBonus,
  triggerMeltdownAlarm,
  resolveMeltdownTimers,
  calculateWorkChance,
  workQuality,
  renderPEProgress,
  buildPEVisualString,
  getPEBoxTotal,
  nextPhase,
  resolveDailyRecovery,
  resetDailyOperationalState,
  runDailyEvent,
  maybeTriggerSpontaneousBreaches,
  serializeFacility,
  restoreState
};

// Importing the module in a test process must never attempt a real Discord
// login. Normal `bun run index.ts` behavior is unchanged.
if (process.env.BOT_TEST_MODE !== '1' && process.env.NODE_ENV !== 'test') {
  client.login(process.env.DISCORD_TOKEN);
}
