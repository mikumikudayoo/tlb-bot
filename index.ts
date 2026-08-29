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
import { Database } from 'bun:sqlite';

// ==========================================
// 🏢 LOBOTOMY CORPORATION — FACILITY SIM V2
// ==========================================
// This version keeps the original idea, but turns the facility into a stateful
// management game: agents have stats and traits, abnormalities have work
// affinities and behaviour, days generate events, breaches create combat,
// resources can be invested, and saves preserve the whole simulation state.

export const db = new Database('facility.sqlite', { create: true });

type WorkType = 'instinct' | 'insight' | 'attachment' | 'repression';
type StatName = 'fortitude' | 'prudence' | 'temperance' | 'justice';
type DamageType = 'RED' | 'WHITE' | 'BLACK' | 'PALE';
type DepartmentName = 'general' | 'control' | 'information' | 'security' | 'training' | 'command';
type AgentStatus = 'idle' | 'working' | 'injured' | 'stressed' | 'panicked' | 'traumatized' | 'recovering' | 'dead';
type UpgradeType = 'containment' | 'research' | 'security' | 'welfare';
type Behaviour = 'docile' | 'possessive' | 'volatile' | 'predatory';

type FacilityData = {
  guild_id: string;
  energy: number;
  quota: number;
  dictator_mode: number;
  manager_id: string;
  is_started: number;
  is_paused: number;
  day_count: number;
  phase: number;
  category_id: string | null;
  containment_channel_id: string | null;
  research: number;
  lob_points: number;
  containment_level: number;
  security_level: number;
  welfare_level: number;
  event_seed: number;
  stable_days: number;
  current_sector?: string;
};

type AgentRow = {
  discord_id: string;
  guild_id: string;
  name: string;
  hp: number;
  max_hp: number;
  sp: number;
  max_sp: number;
  weapon: string;
  suit: string;
  status: AgentStatus;
  level: number;
  fortitude: number;
  prudence: number;
  temperance: number;
  justice: number;
  experience: number;
  trait: string;
  recovery_days: number;
  assignments: number;
  kills: number;
  promotions: number;
  ego_gifts?: string;
  equipped_gift?: string;
};

type AbnormalityRow = {
  id: number;
  guild_id: string;
  name: string;
  risk: string;
  hp: number;
  max_hp: number;
  qliphoth: number;
  max_qliphoth: number;
  damage_type: string;
  damage_amt: number;
  is_breaching: number;
  work_instinct: number;
  work_insight: number;
  work_attachment: number;
  work_repression: number;
  escape_chance: number;
  behaviour: Behaviour;
  description: string;
  rage: number;
  breaches: number;
  suppressed_count: number;
  last_worked_by?: string;
  work_streak?: number;
  gift_id?: string;
  current_work_process?: string;
  meltdown_timer?: number;
  meltdown_state?: string;
  can_breach?: number;
  is_tool?: number;
  script_id?: string;
};

type AbnormalityScript = {
  onWorkStart?: (agent: any, abno: any, workType: WorkType) => { cancelled: boolean; message: string } | null;
  onWorkEnd?: (agent: any, abno: any, workType: WorkType, result: 'good' | 'normal' | 'bad') => string | null;
  onCombat?: (agent: any, abno: any, agentDamage: number) => { agentDamage: number; abnoDamage: number } | null;
};

const MAX_SAVE_SLOTS = 5;
const SUPPRESSION_COOLDOWNS = new Map<string, number>();

// Higher-risk containment can be pushed to deeper (riskier, higher-yield) work levels.
const WORK_LEVEL_MAX: Record<string, number> = {
  ZAYIN: 2,
  TETH: 3,
  HE: 4,
  WAW: 4,
  ALEPH: 4
};

// Behaviour is no longer flavor text — it changes how an abnormality reacts to
// being worked, how it fights when it breaches, and how likely it is to escape
// containment on its own.
const BEHAVIOUR_INFO: Record<Behaviour, { icon: string; label: string; description: string }> = {
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

function getBehaviour(abno: any): Behaviour {
  return (BEHAVIOUR_INFO as any)[abno.behaviour] ? (abno.behaviour as Behaviour) : 'docile';
}

function getDisplayAbnormality(abno: any, allAbnos: any[] = []): any {
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

const WORK_TYPES: Record<WorkType, { stat: StatName; icon: string; label: string }> = {
  instinct: { stat: 'fortitude', icon: 'Instinct', label: 'instinct' },
  insight: { stat: 'prudence', icon: 'Insight', label: 'insight' },
  attachment: { stat: 'temperance', icon: 'Attachment', label: 'attachment' },
  repression: { stat: 'justice', icon: 'Repression', label: 'repression' }
};

// ==========================================
// 🧬 MANAGERIAL GUIDELINES — EVENT HOOKS
// ==========================================
// Each abnormality can have unique behavior via event hooks. Instead of hardcoding
// every special rule into executeWork/combat, we use a registry of scripts that
// run before/after standard actions or during combat.
const ABNORMALITY_SCRIPTS: Record<string, AbnormalityScript> = {
  'F-01-02': {
    // One Sin and Hundreds of Good Deeds: cleanses mental strain and restores focus
    onWorkStart: (agent: any, abno: any, workType: WorkType) => {
      if (agent.status === 'stressed' || agent.status === 'panicked' || agent.status === 'traumatized') {
        agent.status = 'idle';
        agent.sp = Math.max(agent.sp, Math.floor(agent.max_sp * 0.7));
        return {
          cancelled: false,
          message: `✨ **DIVINE ABSOLUTION:** ${abno.name} eases ${agent.name}'s mind, restoring ${Math.max(0, Math.floor(agent.max_sp * 0.7))} SP and washing away the emotional residue.`
        };
      }
      return null;
    }
  },
  'T-06-27': {
    // Der Freischütz: repeated failed work triggers a stray shot as a dangerous escalation
    onWorkEnd: (agent: any, abno: any, workType: WorkType, result: 'good' | 'normal' | 'bad') => {
      if (result === 'bad') {
        abno.rage = Math.min((abno.rage ?? 0) + 2, 10);
        return `🎯 **STRAY BULLET:** ${abno.name} fires a wandering shot through the facility, rattling nearby staff and lowering the containment mood.`;
      }
      return null;
    }
  },
  'O-05-47': {
    // Schadenfreude: visibility rules amplify escape risk when attention is mishandled
    onWorkStart: (agent: any, abno: any, workType: WorkType) => {
      if (agent.assignments > 0 && (agent.assignments % 3 === 0)) {
        abno.rage = Math.min((abno.rage ?? 0) + 1, 10);
        return {
          cancelled: false,
          message: `👁️ **OBSERVED TOO LONG:** ${abno.name} grows more restless under scrutiny, and its escape pressure spikes with each repeated glance.`
        };
      }
      return null;
    }
  },
  'O-02-62': {
    // Judgement Bird: guilt threshold triggers a severe execution penalty
    onWorkStart: (agent: any, abno: any, workType: WorkType) => {
      const guilt = (agent.kills ?? 0) + Math.max(0, 6 - (agent.fortitude ?? 0)) + (agent.assignments > 10 ? 2 : 0);
      if (guilt >= 8) {
        agent.status = 'dead';
        agent.hp = 0;
        return {
          cancelled: true,
          message: `🪶 **JUDGEMENT PASSED:** ${abno.name} sees ${agent.name} as irredeemable. The bird's verdict is swift and final.`
        };
      }
      return null;
    }
  },
  'DO-NOT-TOUCH': {
    // Don't Touch Me: a troll anomaly that triggers a facility-wide breach the instant someone foolishly interacts with it.
    onWorkStart: (agent: any, abno: any, workType: WorkType) => {
      const guildId = agent?.guild_id ?? '';
      if (guildId) {
        db.query(`UPDATE abnormalities SET is_breaching = 1, rage = 10 WHERE guild_id = ?`).run(guildId);
      }

      agent.status = 'panicked';
      agent.sp = 0;

      return {
        cancelled: true,
        message: `🛑 **████████ ERROR: CATASTROPHIC CONTAINMENT FAILURE ████████**\n\n*You shouldn't have touched that.*\n\n**${agent.name}** triggered **Don't Touch Me**. Every single containment unit in the facility has instantly blown its locks. Good luck. 🩸`
      };
    }
  },
  'O-06-20': {
    // Nothing There: Instakill agents with insufficient Fortitude
    onWorkStart: (agent: any, abno: any, workType: WorkType) => {
      if (agent.fortitude < 4) {
        agent.status = 'dead';
        agent.hp = 0;
        return {
          cancelled: true,
          message: `💀 **FATAL ERROR:** ${agent.name} did not have the Fortitude to comprehend Nothing There. The entity consumed their existence and left only an empty shell behind.`
        };
      }
      return null;
    }
  },
  'O-02-56': {
    // Punishing Bird: Instakill any agent that attacks it while breaching
    onCombat: (agent: any, abno: any, agentDamage: number) => {
      agent.status = 'dead';
      agent.hp = 0;
      return { agentDamage: 0, abnoDamage: 9999 };
    }
  }
};

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
  { level: 1, title: 'basic observation', description: 'basic damage type and work success rates' },
  { level: 2, title: 'qliphoth log', description: 'exact qliphoth triggers and meltdown timing' },
  { level: 3, title: 'ego extraction', description: 'weapon and suit extraction from PE pool' },
  { level: 4, title: 'institutional memory', description: '+5% max success and E.G.O gift access' }
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

const RISK_VALUES: Record<string, number> = {
  ZAYIN: 1,
  TETH: 2,
  HE: 3,
  WAW: 4,
  ALEPH: 5
};

const DAMAGE_TYPES: Record<DamageType, { label: string; icon: string; description: string }> = {
  RED: { label: 'RED', icon: '🔴', description: 'Physical damage. High against low-defense, high-armor threats.' },
  WHITE: { label: 'WHITE', icon: '⚪', description: 'Mental damage. Hits the abnormality’s mental fortitude and SP channel.' },
  BLACK: { label: 'BLACK', icon: '⚫', description: 'Hybrid damage split between HP and SP.' },
  PALE: { label: 'PALE', icon: '🩶', description: 'Percentage-based damage; scales off max HP.' }
};

const EGO_WEAPONS: Record<string, { name: string; type: DamageType; min: number; max: number; speed: number }> = {
  riot_stick: { name: 'Riot Stick', type: 'RED', min: 2, max: 4, speed: 1.0 },
  penitence: { name: 'Penitence', type: 'WHITE', min: 3, max: 5, speed: 1.05 },
  mimicry: { name: 'Mimicry', type: 'RED', min: 12, max: 25, speed: 0.8 },
  smile: { name: 'Smile', type: 'BLACK', min: 10, max: 20, speed: 0.9 }
};

const EGO_SUITS: Record<string, { name: string; red: number; white: number; black: number; pale: number; defense: number }> = {
  basic_suit: { name: 'Basic Suit', red: 1.0, white: 1.0, black: 1.0, pale: 1.5, defense: 0 },
  penitence_suit: { name: 'Penitence Suit', red: 0.9, white: 0.8, black: 1.0, pale: 1.5, defense: 1 },
  mimicry_suit: { name: 'Mimicry Suit', red: 0.2, white: 0.4, black: 0.5, pale: 1.2, defense: 3 }
};

const TRAITS: Record<string, { name: string; description: string }> = {
  energetic: { name: 'energetic', description: '+10% work consistency' },
  cautious: { name: 'cautious', description: '-10% incoming damage' },
  reckless: { name: 'reckless', description: '+15% combat damage, +10% incoming damage' },
  lucky: { name: 'lucky', description: 'chance to create an extra PE box' },
  calm: { name: 'calm', description: '+15% panic resistance' },
  curious: { name: 'curious', description: '+10% insight success' }
};

// Each E.G.O. gift is a real trade: a stat payoff, and a drawback that's felt
// every single work/combat resolution while it's equipped. Nothing is free.
type GiftDef = {
  id: string; name: string; icon: string; sourceAbno: string; drawback: string;
  statBonus?: Partial<Record<StatName, number>>;
  workChanceBonus?: Partial<Record<WorkType, number>>;
  incomingDamageMult?: number;
  maxSpMult?: number;
};

const ABNORMALITY_TEMPLATES = [
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
    } as Omit<GiftDef, 'sourceAbno'>
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
    } as Omit<GiftDef, 'sourceAbno'>
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
    } as Omit<GiftDef, 'sourceAbno'>
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
    } as Omit<GiftDef, 'sourceAbno'>
  }
];

const EGO_GIFTS: Record<string, GiftDef> = {};
for (const template of ABNORMALITY_TEMPLATES) {
  const g = (template as any).gift as Omit<GiftDef, 'sourceAbno'> | undefined;
  if (g) EGO_GIFTS[g.id] = { ...g, sourceAbno: template.name };
}

const EGO_EQUIPMENT_SEED: Array<{ id: string; category: 'weapon' | 'suit'; name: string; type?: DamageType; min?: number; max?: number; speed?: number; red?: number; white?: number; black?: number; pale?: number; defense?: number; description: string }> = [
  { id: 'riot_stick', category: 'weapon', name: 'Riot Stick', type: 'RED', min: 2, max: 4, speed: 1.0, description: 'A simple, reliable blunt weapon used by trainees.' },
  { id: 'penitence', category: 'weapon', name: 'Penitence', type: 'WHITE', min: 3, max: 5, speed: 1.05, description: 'A focused weapon that channels mental force.' },
  { id: 'mimicry', category: 'weapon', name: 'Mimicry', type: 'RED', min: 12, max: 25, speed: 0.8, description: 'A high-output melee weapon with a sharp but risky profile.' },
  { id: 'basic_suit', category: 'suit', name: 'Basic Suit', red: 1.0, white: 1.0, black: 1.0, pale: 1.5, defense: 0, description: 'The default issue suit used by new agents.' },
  { id: 'penitence_suit', category: 'suit', name: 'Penitence Suit', red: 0.9, white: 0.8, black: 1.0, pale: 1.5, defense: 1, description: 'A light armor set tuned for mental resistance.' },
  { id: 'mimicry_suit', category: 'suit', name: 'Mimicry Suit', red: 0.2, white: 0.4, black: 0.5, pale: 1.2, defense: 3, description: 'High-risk, high-reward armor that heavily reduces physical pressure.' }
];

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
    discord_id TEXT PRIMARY KEY,
    guild_id TEXT DEFAULT '',
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
    promotions INTEGER DEFAULT 0
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
  ['ego_gifts', "TEXT DEFAULT '[]'"], ['equipped_gift', "TEXT DEFAULT ''"], ['department', "TEXT DEFAULT 'general'"], ['auto_response', "TEXT DEFAULT ''"]
] as const) addColumnIfMissing('agents', column, definition);

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
    containment_channel_id TEXT,
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
  ['current_sector', "TEXT DEFAULT 'control'"]
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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(values: T[]): T {
  return values[Math.floor(Math.random() * values.length)]!;
}

function json<T>(value: T): string {
  return JSON.stringify(value);
}

function logEvent(guildId: string, day: number, phase: number, type: string, message: string) {
  db.query(`INSERT INTO facility_events (guild_id, day, phase, type, message) VALUES (?, ?, ?, ?, ?)`).run(
    guildId, day, phase, type, message
  );
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
    agent.status = 'panicked';
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
    ego_gifts=?, equipped_gift=?
    WHERE discord_id=? AND guild_id=?
  `).run(
    agent.hp, agent.max_hp, agent.sp, agent.max_sp, agent.status, agent.experience, agent.level,
    agent.fortitude, agent.prudence, agent.temperance, agent.justice, agent.trait,
    agent.recovery_days, agent.assignments, agent.kills, agent.promotions,
    agent.ego_gifts ?? '[]', agent.equipped_gift ?? '', agent.discord_id, agent.guild_id
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
  syncDepartmentUnlocks(guildId, facility);
  ensureDepartmentQuestRows(guildId);
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
  if (level <= current) return;
  db.query(`INSERT INTO codex_entries (guild_id, abnormality_name, observation_level, data_json) VALUES (?, ?, ?, ?) ON CONFLICT(guild_id, abnormality_name) DO UPDATE SET observation_level=excluded.observation_level, data_json=excluded.data_json`).run(
    guildId,
    abno.name,
    level,
    json({ risk: abno.risk, damage_type: abno.damage_type, qliphoth: abno.max_qliphoth, sector: abno.sector ?? 'control' })
  );
  recordDepartmentProgress(guildId, 'information', 1);
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

export function resolvePanicBehavior(agent: any): string {
  if (!agent || agent.sp > 0) return 'stable';
  const highestStat = Object.entries({ fortitude: agent.fortitude, prudence: agent.prudence, temperance: agent.temperance, justice: agent.justice })
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'fortitude';

  if (highestStat === 'fortitude') return 'wanders containment hallways and opens doors';
  if (highestStat === 'prudence') return 'tries to breach the nearest high-risk abnormality';
  if (highestStat === 'temperance') return 'refuses commands and locks down department operations';
  return 'becomes hostile to nearby agents';
}

function applyPanicState(agent: any) {
  if (!agent || agent.status === 'dead') return;
  if (agent.sp <= 0) {
    agent.status = 'panicked';
    agent.recovery_days = Math.max(agent.recovery_days, 2);
  }
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      guildId, template.name, template.risk, template.hp, template.hp, template.qliphoth, template.qliphoth,
      template.damage_type, template.damage_amt, template.instinct, template.insight, template.attachment,
      template.repression, template.escape_chance, template.behaviour, template.description, giftId,
      activeProcess, meltdownTimer, 'stable', (template as any).script_id ?? '', (template as any).can_breach ?? 1, (template as any).is_tool ?? 0
    );
  }
}

function getCurrentWorkAffinity(abno: any, workType: WorkType) {
  const key = `work_${workType}`;
  return clamp(Number(abno[key] ?? 0.5), 0.05, 0.99);
}

function getMeltdownState(abno: any) {
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

const DEPARTMENT_META: Record<string, { label: string; requirement: number; bonus: string }> = {
  control: { label: 'Control', requirement: 2, bonus: '+4% work consistency' },
  information: { label: 'Information', requirement: 3, bonus: 'shows exact work odds' },
  security: { label: 'Security', requirement: 4, bonus: '+10% HP/SP recovery' },
  training: { label: 'Training', requirement: 5, bonus: '+1 training yield per day' },
  command: { label: 'Central Command', requirement: 6, bonus: 'global command routing' }
};

const DEPARTMENT_QUESTS: Record<string, { description: string; goal: string; target: number }> = {
  control: { description: 'Stabilize standard work output', goal: 'collect 40 energy', target: 40 },
  information: { description: 'Review incident records and codex entries', goal: 'observe 3 abnormalities', target: 3 },
  security: { description: 'Suppress active breaches', goal: 'suppress 2 breaches', target: 2 },
  training: { description: 'Train staff and refine tactics', goal: 'train to 3 stat upgrades', target: 3 },
  command: { description: 'Coordinate full-facility operations', goal: 'clear 6 days of stable operations', target: 6 }
};

export function evaluateDepartmentUnlocks(facility: any): string[] {
  const unlocked = new Set<string>(['control']);
  const day = Number(facility?.day_count ?? 0);

  for (const [department, meta] of Object.entries(DEPARTMENT_META)) {
    if (department === 'control') continue;
    if (day >= meta.requirement) unlocked.add(department);
  }

  for (const department of getUnlockedDepartments(facility)) {
    unlocked.add(department);
  }

  return [...unlocked];
}

export function syncDepartmentUnlocks(guildId: string, facility: any) {
  const unlocked = evaluateDepartmentUnlocks(facility);
  db.query(`UPDATE facility SET department_unlocks=? WHERE guild_id=?`).run(json(unlocked), guildId);
  return unlocked;
}

function getUnlockedDepartments(facility: any): string[] {
  try {
    const raw = JSON.parse(facility?.department_unlocks || '[]');
    return Array.isArray(raw) ? raw as string[] : [];
  } catch {
    return [];
  }
}

function isDepartmentUnlocked(facility: any, department: string) {
  return getUnlockedDepartments(facility).includes(department);
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

export function updateDepartmentQuestProgress(guildId: string, department: string, delta: number) {
  const quest = DEPARTMENT_QUESTS[department];
  if (!quest) return 0;

  const row = db.query(`SELECT * FROM department_quests WHERE guild_id=? AND department=? AND goal=?`).get(guildId, department, quest.goal) as any;
  if (!row) return 0;

  const nextProgress = clamp(Number(row.progress ?? 0) + Number(delta), 0, quest.target);
  const complete = nextProgress >= quest.target ? 1 : 0;

  db.query(`UPDATE department_quests SET progress=?, complete=? WHERE guild_id=? AND department=? AND goal=?`).run(
    nextProgress, complete, guildId, department, quest.goal
  );

  if (complete) {
    const facility = db.query(`SELECT * FROM facility WHERE guild_id=?`).get(guildId) as any;
    if (facility) {
      syncDepartmentUnlocks(guildId, { ...facility, day_count: Number(facility.day_count ?? 0) + 0 });
      const nextUnlocks = evaluateDepartmentUnlocks({ ...facility, day_count: Number(facility.day_count ?? 0) });
      const nextDept = department === 'security' ? 'command' : department;
      if (nextUnlocks.includes(nextDept)) {
        db.query(`UPDATE facility SET department_unlocks=? WHERE guild_id=?`).run(json(nextUnlocks), guildId);
      }
    }
  }

  return nextProgress;
}

export function recordDepartmentProgress(guildId: string, department: string, delta: number) {
  ensureDepartmentQuestRows(guildId);
  const facility = db.query(`SELECT * FROM facility WHERE guild_id=?`).get(guildId) as any;
  if (!facility) return 0;
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

export function getDepartmentRouteSummary(facility: any) {
  const unlocked = evaluateDepartmentUnlocks(facility);
  return Object.entries(DEPARTMENT_META).map(([department, meta]) => ({
    department,
    route: DEPARTMENT_SECTORS[department as DepartmentName] ?? 'central-command',
    label: meta.label,
    requirement: meta.requirement,
    unlocked: unlocked.includes(department),
    current: (facility?.current_sector ?? 'control') === department
  }));
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

function resolveMeltdownTimers(guildId: string, facility: any) {
  if (!facility || !facility.meltdown_alarm) return;
  const targets = JSON.parse(facility.meltdown_targets || '[]') as number[];
  if (!targets.length) {
    db.query(`UPDATE facility SET meltdown_alarm=0, meltdown_targets='[]' WHERE guild_id=?`).run(guildId);
    return;
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
        sendBreachAlert({ guild: { channels: { cache: new Map() } } }, facility, abno).catch(() => {});
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
}

function formatMeltdownTimer(abno: any) {
  const state = getMeltdownState(abno);
  if (state.timer <= 0 && Number(abno.qliphoth ?? 0) > 0) return 'stable';
  const totalSeconds = Math.max(1, state.timer || 15);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function calculateWorkChance(agent: any, abno: any, workType: WorkType, facility: any, level: number = 1) {
  const work = WORK_TYPES[workType];
  const stat = getEffectiveStat(agent, work.stat);
  const affinity = getCurrentWorkAffinity(abno, workType);
  const riskPenalty = (RISK_VALUES[abno.risk] ?? 1) * 0.035;
  const facilityBonus = (Number(facility.research) / 100) * 0.015 + Number(facility.welfare_level) * 0.01;

  let chance = 0.33 + stat * 0.045 + affinity * 0.28 + facilityBonus - riskPenalty;

  if (agent.trait === 'energetic') chance += 0.08;
  if (agent.trait === 'curious' && workType === 'insight') chance += 0.10;
  if (agent.trait === 'calm') chance += 0.02;

  if (agent.status === 'stressed') chance -= 0.08;
  if (agent.status === 'injured') chance -= 0.10;
  if (agent.status === 'recovering') chance -= 0.15;

  chance -= Number(abno.rage) * 0.015;

  // pushing to a deeper work level is a deliberate gamble — each step down
  // costs consistency in exchange for bigger PE box payouts.
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
  // volatile doesn't shift the baseline — its instability is applied as extra
  // swing at the roll itself, in workQuality().

  const gift = getGift(agent);
  if (gift?.workChanceBonus?.[workType]) chance += gift.workChanceBonus[workType]!;

  if (facility?.meltdown_alarm) chance -= 0.04;
  chance += getDepartmentBonus(facility, 'control') + getDepartmentBonus(facility, 'information');

  return clamp(chance, 0.05, 0.97);
}

function workQuality(chance: number, level: number = 1, behaviour: Behaviour = 'docile') {
  let roll = Math.random();
  if (behaviour === 'volatile') {
    // volatile abnormalities swing the actual outcome roll itself, not just
    // the odds — the same 60% chance can feel completely different twice in a row.
    roll = clamp(roll + (Math.random() - 0.5) * 0.30, 0, 1);
  }

  const levelBonus = clamp(level, 1, 4) - 1;
  if (roll < chance * 0.35) return { tier: 'good' as const, boxes: 2 + levelBonus + (Math.random() < chance ? 1 : 0) };
  if (roll < chance) return { tier: 'normal' as const, boxes: 1 + Math.floor(levelBonus * 0.6) + (Math.random() < chance * 0.65 ? 1 : 0) };
  if (roll < Math.min(0.99, chance + 0.18)) return { tier: 'bad' as const, boxes: Math.max(0, 1 - Math.floor(levelBonus * 0.5)) };
  return { tier: 'critical' as const, boxes: 0 };
}

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

function getPEBoxTotal(abno: any) {
  const riskWeight = RISK_VALUES[String(abno.risk)] ?? 1;
  return clamp(5 + Math.max(0, riskWeight - 1), 5, 8);
}

async function sendBreachAlert(interaction: any, facility: any, abno: any) {
  const containCh = interaction.guild?.channels.cache.get(facility.containment_channel_id) as any;
  if (!containCh) return;

  const breachEmbed = new EmbedBuilder()
    .setTitle(`🚨 BREACH ALERT: ${abno.name}`)
    .setColor(0xFF0000)
    .setDescription(
      `**risk:** ${abno.risk}\n` +
      `**HP:** ${abno.hp}/${abno.max_hp}\n` +
      `**behaviour:** ${abno.behaviour}\n\n` +
      `**all available agents must suppress this abnormality immediately.**`
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
  const maxLevel = WORK_LEVEL_MAX[abno.risk] ?? 2;
  return Array.from({ length: maxLevel }, (_, i) => i + 1)
    .map(lvl => `**lv.${lvl}**: ${Math.round(calculateWorkChance(agent, abno, workType, facility, lvl) * 100)}% success`)
    .join(' · ');
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

  const maxLevel = WORK_LEVEL_MAX[abno.risk] ?? 2;
  level = clamp(Math.floor(level), 1, maxLevel);
  const behaviour = getBehaviour(abno);
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
  let effectiveDamageAmt = abno.damage_amt * (1 + (level - 1) * 0.25);
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

  let qChange = 0;
  if (result.tier === 'good' && peBoxes >= 4) qChange = 1;
  else if (result.tier === 'bad' || peBoxes <= 1) qChange = -1;

  if (qChange < 0) {
    abno.qliphoth -= 1;
    abno.rage += 1;
  } else if (qChange > 0) {
    abno.qliphoth = Math.min(abno.max_qliphoth, abno.qliphoth + 1);
    abno.rage = Math.max(0, abno.rage - 1);
  }

  const eventMessages: string[] = [];

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
  const energyGain = Math.max(0, Math.floor(generated));
  const totalMeter = getPEBoxTotal(abno);
  const positiveGoal = clamp(Math.max(0, peBoxes), 0, totalMeter);
  const negativeGoal = Math.max(0, totalMeter - positiveGoal);
  const updatedPhase = nextPhase(Number(facility.phase));
  db.query(`UPDATE facility SET energy = energy + ?, phase = ? WHERE guild_id = ?`).run(energyGain, updatedPhase, interaction.guildId!);

  const work = WORK_TYPES[workType];
  abno.current_work_process = workType;
  abno.meltdown_timer = Math.max(15, 45 - (abno.max_qliphoth - abno.qliphoth) * 8 + abno.rage * 3);
  abno.meltdown_state = getMeltdownState(abno).label;

  recordDepartmentProgress(interaction.guildId!, 'control', energyGain > 0 ? 1 : 0);

  if (agent.assignments > 0 && agent.assignments % 5 === 0) {
    triggerMeltdownAlarm(interaction.guildId!, facility);
  }

  resolveMeltdownTimers(interaction.guildId!, db.query(`SELECT * FROM facility WHERE guild_id=?`).get(interaction.guildId!) as any);

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
      const workEmoji = getGuildEmojiString(interaction.guild, WORK_TYPES[workType].icon, WORK_TYPES[workType].label);
      const liveText = `🧪 **${abno.name}** — ${workEmoji} **${WORK_TYPES[workType].label}**\n${progressBar}\n${boxVisual}\n${hpText}\n⚔️ ${lastDamageText}`;

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
  const workEmoji = getGuildEmojiString(interaction.guild, WORK_TYPES[workType].icon, WORK_TYPES[workType].label);
  const qliphothIcon = abno.qliphoth === abno.max_qliphoth ? '💎' : '🔻';
  let resultText = `🧪 you performed **${work.label}** work (level **${level}/${maxLevel}**) on **${abno.name}**.\n`;
  resultText += `${bInfo.icon} behaviour: **${bInfo.label}**\n`;
  resultText += `🧩 active work process: **${workEmoji} ${WORK_TYPES[workType].label}**\n`;
  resultText += `⏱️ meltdown status: **${getMeltdownState(abno).icon} ${getMeltdownState(abno).label}** · **${formatMeltdownTimer(abno)}**\n`;
  resultText += `🎯 success chance: **${Math.round(chance * 100)}%**\n`;
  resultText += `📈 result: **${result.tier.toUpperCase()}**\n`;
  resultText += `⚡ generated **${energyGain} energy** from **${peBoxes} PE boxes**\n`;
  resultText += `💥 suffered **${totalDamage} ${abno.damage_type} damage** (including **${workResult.liveDamageTotal}** from **${negativeGoal}** negative box(es))\n`;
  resultText += `🧠 gained **${expGain} EXP**\n`;
  resultText += `${qliphothIcon} qliphoth: **${abno.qliphoth}/${abno.max_qliphoth}**\n`;
  resultText += `🛡️ ${agent.hp}/${agent.max_hp} HP | ${agent.sp}/${agent.max_sp} SP\n`;
  resultText += `📝 ${tickResults.join(' · ')}`;

  if (trait) resultText += `\n🎭 trait: **${trait.name}** — ${trait.description}`;
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

  const embed = new EmbedBuilder()
    .setTitle(`🏢 FACILITY DASHBOARD — DAY ${facility.day_count}`)
    .setColor(breaches > 0 ? 0xFF0000 : facility.is_paused ? 0x808080 : 0x00FFFF)
    .setDescription(
      `**phase:** ${facility.phase}:00\n` +
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

function nextPhase(phase: number) {
  const phases = [8, 10, 12, 14, 16, 18, 20, 22];
  const index = phases.indexOf(phase);
  if (index < 0 || index === phases.length - 1) return 8;
  return phases[index + 1]!;
}

function resolveDailyRecovery(guildId: string) {
  const agents = db.query(`SELECT * FROM agents WHERE guild_id = ? AND status != 'dead'`).all(guildId) as any[];
  for (const agent of agents) {
    if (agent.recovery_days > 0) agent.recovery_days -= 1;

    if (agent.recovery_days <= 0 && ['injured', 'stressed', 'panicked', 'traumatized', 'recovering'].includes(agent.status)) {
      agent.status = 'recovering';
      agent.hp = Math.min(agent.max_hp, agent.hp + Math.floor(agent.max_hp * 0.35));
      agent.sp = Math.min(agent.max_sp, agent.sp + Math.floor(agent.max_sp * 0.40));
      if (agent.hp >= agent.max_hp * 0.75 && agent.sp >= agent.max_sp * 0.75) agent.status = 'idle';
    }

    updateAgent(agent);
  }
}

function runDailyEvent(guildId: string, facility: any): string | null {
  const roll = Math.random();

  if (roll < 0.08 + facility.containment_level * 0.01) {
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
  const candidates = db.query(`SELECT * FROM abnormalities WHERE guild_id = ? AND is_breaching = 0`).all(guildId) as any[];
  const triggered: any[] = [];

  for (const abno of candidates) {
    const behaviour = getBehaviour(abno);
    const behaviourMult = behaviour === 'docile' ? 0.7 : behaviour === 'volatile' ? 1.35 : behaviour === 'predatory' ? 1.5 : 1.0;
    const riskWeight = RISK_VALUES[abno.risk] ?? 1;
    const danger = (Number(abno.escape_chance) + Number(abno.rage) * 0.015 + (Number(facility.security_level) < riskWeight ? 0.03 : 0)) * behaviourMult;
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
  const events = db.query(`SELECT * FROM facility_events WHERE guild_id = ? ORDER BY id DESC LIMIT 100`).all(guildId) as any[];
  return { facility, agents, abnormalities, events };
}

function restoreState(guildId: string, state: any) {
  if (!state?.facility) throw new Error('save file is missing facility data');

  db.query(`DELETE FROM agents WHERE guild_id = ?`).run(guildId);
  db.query(`DELETE FROM abnormalities WHERE guild_id = ?`).run(guildId);

  const f = state.facility;
  db.query(`
    UPDATE facility SET energy=?, quota=?, dictator_mode=?, manager_id=?, is_started=?, is_paused=?, day_count=?, phase=?,
    category_id=?, containment_channel_id=?, research=?, lob_points=?, containment_level=?, security_level=?, welfare_level=?, event_seed=?, stable_days=?
    WHERE guild_id=?
  `).run(
    f.energy, f.quota, f.dictator_mode, f.manager_id, f.is_started, f.is_paused, f.day_count, f.phase,
    f.category_id, f.containment_channel_id, f.research, f.lob_points, f.containment_level,
    f.security_level, f.welfare_level, f.event_seed, f.stable_days, guildId
  );

  for (const agent of state.agents ?? []) {
    db.query(`
      INSERT INTO agents (
        discord_id, guild_id, name, hp, max_hp, sp, max_sp, weapon, suit, status, level, fortitude, prudence,
        temperance, justice, experience, trait, recovery_days, assignments, kills, promotions, ego_gifts, equipped_gift
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      agent.discord_id, guildId, agent.name, agent.hp, agent.max_hp, agent.sp, agent.max_sp, agent.weapon, agent.suit,
      agent.status, agent.level, agent.fortitude, agent.prudence, agent.temperance, agent.justice,
      agent.experience, agent.trait, agent.recovery_days, agent.assignments, agent.kills, agent.promotions,
      agent.ego_gifts ?? '[]', agent.equipped_gift ?? ''
    );
  }

  for (const abno of state.abnormalities ?? []) {
    db.query(`
      INSERT INTO abnormalities (
        id, guild_id, name, risk, hp, max_hp, qliphoth, max_qliphoth, damage_type, damage_amt,
        is_breaching, work_instinct, work_insight, work_attachment, work_repression, escape_chance,
        behaviour, description, rage, breaches, suppressed_count, last_worked_by, work_streak, gift_id,
        current_work_process, meltdown_timer, meltdown_state
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      abno.id, guildId, abno.name, abno.risk, abno.hp, abno.max_hp, abno.qliphoth, abno.max_qliphoth,
      abno.damage_type, abno.damage_amt, abno.is_breaching, abno.work_instinct, abno.work_insight,
      abno.work_attachment, abno.work_repression, abno.escape_chance, abno.behaviour, abno.description,
      abno.rage, abno.breaches, abno.suppressed_count, abno.last_worked_by ?? '', abno.work_streak ?? 0, abno.gift_id ?? '',
      abno.current_work_process ?? '', abno.meltdown_timer ?? 0, abno.meltdown_state ?? 'stable'
    );
  }

  db.query(`DELETE FROM facility_events WHERE guild_id = ?`).run(guildId);
  for (const event of (state.events ?? []).reverse()) {
    db.query(`INSERT INTO facility_events (guild_id, day, phase, type, message, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(guildId, event.day, event.phase, event.type, event.message, event.created_at);
  }
}

async function endDay(interaction: any, facility: any) {
  const guildId = interaction.guildId!;
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

  resolveDailyRecovery(guildId);

  const freshFacility = db.query(`SELECT * FROM facility WHERE guild_id = ?`).get(guildId) as any;
  if (quotaMet) {
    recordDepartmentProgress(guildId, 'command', 1);
  }
  logEvent(guildId, completedDay, facility.phase, 'day_end',
    quotaMet ? `Day ${completedDay} completed successfully with ${facility.energy}/${oldQuota} energy.` :
      `Day ${completedDay} ended without meeting quota: ${facility.energy}/${oldQuota}.`);

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

  await interaction.reply(summary);
}

// ==========================================
// 🤖 DISCORD CLIENT
// ==========================================

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`wonderhooi!! ✨ logged in as ${readyClient.user.tag}!`);
  console.log('facility simulation v2 is online!! 🚀💖');
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
    level, fortitude, prudence, temperance, justice, trait
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  trait
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
        const category = await guild.channels.create({ name: '🏢 LOBOTOMY CORP', type: ChannelType.GuildCategory });
        const mainCh = await guild.channels.create({ name: '📢-control-team', type: ChannelType.GuildText, parent: category.id });
        const containCh = await guild.channels.create({ name: '⚠️-containment-chambers', type: ChannelType.GuildText, parent: category.id });
        const statusCh = await guild.channels.create({ name: '📊-facility-status', type: ChannelType.GuildText, parent: category.id });

        db.query(`UPDATE facility SET is_started=1, category_id=?, containment_channel_id=? WHERE guild_id=?`)
          .run(category.id, containCh.id, guildId);
        seedAbnormalities(guildId);

        await mainCh.send({ content: '🏢 **CONTROL TEAM ONLINE**\nmanager operations are active. use `/facility` to inspect the simulation.' });
        await statusCh.send({ embeds: [facilityDashboard(db.query(`SELECT * FROM facility WHERE guild_id=?`).get(guildId) as any, db.query(`SELECT * FROM agents WHERE guild_id = ?`).all(guildId) as any[], db.query(`SELECT * FROM abnormalities WHERE guild_id=?`).all(guildId) as any[])] });
        await interaction.editReply(`🎉 **FACILITY OPERATIONS STARTED!** channels created inside **${category.name}**.`);
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
          const bInfo = BEHAVIOUR_INFO[getBehaviour(selected)];
          const preview = levelPreviewText(agent, selected, workTypeInput, facility);
          return interaction.reply({
            content: `${WORK_TYPES[workTypeInput].icon} **${WORK_TYPES[workTypeInput].label}** on **${displayedSelected.name}** ${bInfo.icon}\n\nhow deep do you want to push it? higher levels pay more PE but hit your odds harder.\n${preview}`,
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
                .setLabel(`${getGuildEmojiString(interaction.guild, WORK_TYPES[type].icon, WORK_TYPES[type].label)} ${WORK_TYPES[type].label}`)
                .setStyle(type === 'instinct' ? ButtonStyle.Danger : type === 'insight' ? ButtonStyle.Primary : type === 'attachment' ? ButtonStyle.Secondary : ButtonStyle.Success)
            )
          );

          const displayedSelected = getDisplayAbnormality(selected, abnos);
          const bInfo = BEHAVIOUR_INFO[getBehaviour(selected)];
          const meltdown = getMeltdownState(selected);
          const riskKey = (selected.risk as keyof typeof LOBOTOMY_EMOJIS.risk) ?? 'ZAYIN';
          const activeProcess = (selected.current_work_process as WorkType | '') || 'instinct';
          const damageEmoji = getGuildEmojiString(interaction.guild, (LOBOTOMY_EMOJIS.damage as Record<string, string>)[displayedSelected?.damage_type ?? selected.damage_type] ?? (displayedSelected?.damage_type ?? selected.damage_type), (displayedSelected?.damage_type ?? selected.damage_type));
          const processEmoji = getGuildEmojiString(interaction.guild, WORK_TYPES[activeProcess].icon, WORK_TYPES[activeProcess].label);
          const riskEmoji = getGuildEmojiString(interaction.guild, (LOBOTOMY_EMOJIS.risk as Record<string, string>)[riskKey] ?? 'Risk_Zayin', '⚪');
          const infoName = displayedSelected?.name ?? selected.name;
          const infoDescription = displayedSelected?.description ?? selected.description;

          const info = new EmbedBuilder()
            .setTitle(`🧪 ${infoName}`)
            .setDescription(`${infoDescription}\n\n${bInfo.icon} **${bInfo.label}** — ${bInfo.description}`)
            .addFields(
              { name: 'risk', value: `${riskEmoji} ${displayedSelected?.risk ?? selected.risk} (max work level ${WORK_LEVEL_MAX[selected.risk] ?? 2})`, inline: true },
              { name: 'qliphoth', value: `${selected.qliphoth}/${selected.max_qliphoth}`, inline: true },
              { name: 'meltdown', value: `${meltdown.icon} ${meltdown.label} · ${formatMeltdownTimer(selected)}`, inline: true },
              { name: 'active process', value: `${processEmoji} ${activeProcess}`, inline: true },
              { name: 'damage', value: `${damageEmoji} ${selected.damage_amt} ${(displayedSelected?.damage_type ?? selected.damage_type)}`, inline: true },
              { name: 'instinct', value: `${Math.round(selected.work_instinct * 100)}%`, inline: true },
              { name: 'insight', value: `${Math.round(selected.work_insight * 100)}%`, inline: true },
              { name: 'attachment', value: `${Math.round(selected.work_attachment * 100)}%`, inline: true },
              { name: 'repression', value: `${Math.round(selected.work_repression * 100)}%`, inline: true },
              { name: '💠 gift', value: selected.gift_id && EGO_GIFTS[selected.gift_id] ? `${EGO_GIFTS[selected.gift_id]!.icon} ${EGO_GIFTS[selected.gift_id]!.name} (chance on suppression)` : 'none', inline: false }
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
        recordDepartmentProgress(guildId, 'training', 1);
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
        logEvent(guildId, facility.day_count, facility.phase, 'training', `${agent.name} trained ${stat}.`);
        await interaction.reply(`🧪 **TRAINING COMPLETE!** ${agent.name} gained **+1 ${stat}**. research -${cost}.`);
      }

          else if (commandName === 'history') {
        const events = db.query(`SELECT * FROM facility_events WHERE guild_id=? ORDER BY id DESC LIMIT 12`).all(guildId) as any[];
        if (!events.length) return interaction.reply('📜 no facility history yet.');
        const text = events.map((e: any) => `**DAY ${e.day} ${String(e.phase).padStart(2, '0')}:00** · ${e.type}\n${e.message}`).join('\n\n');
        await interaction.reply({ content: `📜 **FACILITY HISTORY**\n\n${text}`.slice(0, 1900) });
      }

      else if (commandName === 'departments') {
        const refreshed = db.query(`SELECT * FROM facility WHERE guild_id=?`).get(guildId) as any;
        const deptRows = getDepartmentRouteSummary(refreshed);
        const lines = deptRows.map(row => `${row.current ? '📍' : row.unlocked ? '✅' : '🔒'} **${row.label}** (${row.route}) — unlocks at day ${row.requirement}${row.current ? ' — current sector' : ''}`).join('\n');
        await interaction.reply({ content: `🏢 **department routing**\n${lines}`.slice(0, 1900), ephemeral: true });
      }

      else if (commandName === 'travel') {
        const dept = interaction.options.getString('department', true).toLowerCase();
        const facilityRow = db.query(`SELECT * FROM facility WHERE guild_id=?`).get(guildId) as any;
        const unlocked = evaluateDepartmentUnlocks(facilityRow);
        if (!unlocked.includes(dept)) {
          return interaction.reply({ content: `🔒 **${dept}** is not unlocked yet.`, ephemeral: true });
        }

        const moved = travelToDepartment(guildId, dept);
        if (!moved) {
          return interaction.reply({ content: '❌ unable to travel there.', ephemeral: true });
        }

        await interaction.reply({ content: `🧭 **travel complete:** you are now operating in **${dept}** (${DEPARTMENT_SECTORS[dept as DepartmentName] ?? 'central-command'}).`, ephemeral: true });
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
          const emoji = getGuildEmojiObject(interaction.guild, WORK_TYPES[type].icon);
          const builder = new ButtonBuilder()
            .setCustomId(`workbtn_${type}_${abno.id}`)
            .setLabel(WORK_TYPES[type].label)
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

      const preview = (['instinct', 'insight', 'attachment', 'repression'] as WorkType[])
        .map(type => `${getGuildEmojiString(interaction.guild, WORK_TYPES[type].icon, type)} ${type}: **${Math.round(calculateWorkChance(agent, abno, type, facility) * 100)}%**`)
        .join('\n');

      const bInfo = BEHAVIOUR_INFO[getBehaviour(abno)];
      await interaction.update({ content: `🧪 **${abno.name}** — ${bInfo.icon} *${bInfo.label}*\n${bInfo.description}\n\n${preview}\n\nchoose your work type!`, components: [row] });
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
          content: `${getGuildEmojiString(interaction.guild, WORK_TYPES[workType].icon, WORK_TYPES[workType].label)} **${WORK_TYPES[workType].label}** on **${abno.name}** ${bInfo.icon}\n\nhow deep do you want to push it? higher levels pay more PE but hit your odds harder.\n${preview}`,
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

client.login(process.env.DISCORD_TOKEN);
