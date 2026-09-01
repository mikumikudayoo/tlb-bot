import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// IMPORTANT: static imports are evaluated before module body code. Use a dynamic
// import so these flags are definitely set before index.ts initializes SQLite
// or considers logging in to Discord.
process.env.NODE_ENV = 'test';
process.env.BOT_TEST_MODE = '1';
process.env.FACILITY_DB_PATH = ':memory:';
process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || 'test-token';

const { ABNORMALITY_SCRIPTS, emitFacilityEvent, subscribeFacilityEvents } = await import('../src/game/abnormalities/scripts');
const bot = await import('../index.ts');
const { db, __test } = bot;

const currentFile = fileURLToPath(import.meta.url);
const testsDir = dirname(currentFile);
const projectRoot = resolve(testsDir, '..');
const sourcePath = resolve(projectRoot, 'index.ts');
const deployPath = resolve(projectRoot, 'deploy-commands.ts');

const TABLES_TO_CLEAR = [
  'save_files',
  'memory_checkpoints',
  'ordeal_events',
  'department_quests',
  'agent_relationships',
  'agent_abnormality_observations',
  'agent_work_history',
  'agent_abnormality_knowledge',
  'codex_entries',
  'facility_events',
  'abnormalities',
  'agents',
  'facility'
] as const;

let nextAbnormalityId = 1000;

function resetModuleDatabase() {
  for (const table of TABLES_TO_CLEAR) {
    db.query(`DELETE FROM ${table}`).run();
  }
  nextAbnormalityId = 1000;
}

function seedFacility(guildId: string, overrides: Record<string, unknown> = {}) {
  const base = {
    manager_id: 'manager_1',
    energy: 0,
    quota: 50,
    dictator_mode: 0,
    is_started: 1,
    is_paused: 0,
    day_count: 1,
    phase: 8,
    research: 100,
    lob_points: 250,
    containment_level: 1,
    security_level: 1,
    welfare_level: 1,
    stable_days: 0,
    department_unlocks: JSON.stringify(['control']),
    current_sector: 'control',
    ...overrides
  };

  db.query(`
    INSERT INTO facility (
      guild_id, manager_id, energy, quota, dictator_mode, is_started, is_paused,
      day_count, phase, research, lob_points, containment_level, security_level,
      welfare_level, stable_days, department_unlocks, current_sector
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    guildId,
    base.manager_id,
    base.energy,
    base.quota,
    base.dictator_mode,
    base.is_started,
    base.is_paused,
    base.day_count,
    base.phase,
    base.research,
    base.lob_points,
    base.containment_level,
    base.security_level,
    base.welfare_level,
    base.stable_days,
    base.department_unlocks,
    base.current_sector
  );

  bot.ensureDepartmentQuestRows(guildId);
  return db.query(`SELECT * FROM facility WHERE guild_id=?`).get(guildId) as any;
}

function seedAgent(guildId: string, discordId: string, overrides: Record<string, unknown> = {}) {
  const base = {
    name: discordId,
    hp: 126,
    max_hp: 126,
    sp: 116,
    max_sp: 116,
    weapon: 'riot_stick',
    suit: 'basic_suit',
    status: 'idle',
    level: 1,
    fortitude: 3,
    prudence: 3,
    temperance: 3,
    justice: 3,
    experience: 0,
    trait: 'calm',
    recovery_days: 0,
    assignments: 0,
    kills: 0,
    promotions: 0,
    ego_gifts: '[]',
    equipped_gift: '',
    department: 'control',
    auto_response: '',
    travel_origin: '',
    travel_destination: '',
    travel_remaining: 0,
    panic_turns: 0,
    panic_behavior: '',
    ...overrides
  };

  db.query(`
    INSERT INTO agents (
      discord_id, guild_id, name, hp, max_hp, sp, max_sp, weapon, suit, status,
      level, fortitude, prudence, temperance, justice, experience, trait,
      recovery_days, assignments, kills, promotions, ego_gifts, equipped_gift,
      department, auto_response, travel_origin, travel_destination,
      travel_remaining, panic_turns, panic_behavior
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    discordId, guildId, base.name, base.hp, base.max_hp, base.sp, base.max_sp,
    base.weapon, base.suit, base.status, base.level, base.fortitude, base.prudence,
    base.temperance, base.justice, base.experience, base.trait, base.recovery_days,
    base.assignments, base.kills, base.promotions, base.ego_gifts, base.equipped_gift,
    base.department, base.auto_response, base.travel_origin, base.travel_destination,
    base.travel_remaining, base.panic_turns, base.panic_behavior
  );

  return db.query(`SELECT * FROM agents WHERE guild_id=? AND discord_id=?`).get(guildId, discordId) as any;
}

function seedAbnormality(guildId: string, overrides: Record<string, unknown> = {}) {
  const id = Number(overrides.id ?? nextAbnormalityId++);
  const base = {
    name: `Test Abnormality ${id}`,
    risk: 'TETH',
    hp: 500,
    max_hp: 500,
    qliphoth: 3,
    max_qliphoth: 3,
    damage_type: 'RED',
    damage_amt: 10,
    is_breaching: 0,
    work_instinct: 0.5,
    work_insight: 0.5,
    work_attachment: 0.5,
    work_repression: 0.5,
    escape_chance: 0,
    behaviour: 'docile',
    description: 'test record',
    rage: 0,
    breaches: 0,
    suppressed_count: 0,
    last_worked_by: '',
    work_streak: 0,
    gift_id: '',
    current_work_process: 'instinct',
    meltdown_timer: 30,
    meltdown_state: 'stable',
    sector: 'control',
    observation_level: 0,
    research_points: 0,
    can_breach: 1,
    is_tool: 0,
    script_id: '',
    ...overrides
  };

  db.query(`
    INSERT INTO abnormalities (
      id, guild_id, name, risk, hp, max_hp, qliphoth, max_qliphoth,
      damage_type, damage_amt, is_breaching, work_instinct, work_insight,
      work_attachment, work_repression, escape_chance, behaviour, description,
      rage, breaches, suppressed_count, last_worked_by, work_streak, gift_id,
      current_work_process, meltdown_timer, meltdown_state, sector,
      observation_level, research_points, can_breach, is_tool, script_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, guildId, base.name, base.risk, base.hp, base.max_hp, base.qliphoth,
    base.max_qliphoth, base.damage_type, base.damage_amt, base.is_breaching,
    base.work_instinct, base.work_insight, base.work_attachment, base.work_repression,
    base.escape_chance, base.behaviour, base.description, base.rage, base.breaches,
    base.suppressed_count, base.last_worked_by, base.work_streak, base.gift_id,
    base.current_work_process, base.meltdown_timer, base.meltdown_state, base.sector,
    base.observation_level, base.research_points, base.can_breach, base.is_tool,
    base.script_id
  );

  return db.query(`SELECT * FROM abnormalities WHERE id=?`).get(id) as any;
}

async function withRandom<T>(values: number[], fn: () => T | Promise<T>): Promise<T> {
  const original = Math.random;
  let cursor = 0;
  Math.random = () => {
    if (!values.length) return 0.5;
    const value = values[Math.min(cursor, values.length - 1)]!;
    cursor += 1;
    return value;
  };
  try {
    return await fn();
  } finally {
    Math.random = original;
  }
}

function countTopLevelArguments(source: string): number | null {
  const text = source.trim();
  if (!text) return 0;
  if (text.includes('...')) return null;

  let paren = 0;
  let bracket = 0;
  let brace = 0;
  let quote: string | null = null;
  let inTemplate = false;
  let escaped = false;
  let count = 1;

  for (const ch of text) {
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (inTemplate) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '`') inTemplate = false;
      continue;
    }

    if (ch === '\'' || ch === '"') quote = ch;
    else if (ch === '`') inTemplate = true;
    else if (ch === '(') paren += 1;
    else if (ch === ')') paren -= 1;
    else if (ch === '[') bracket += 1;
    else if (ch === ']') bracket -= 1;
    else if (ch === '{') brace += 1;
    else if (ch === '}') brace -= 1;
    else if (ch === ',' && paren === 0 && bracket === 0 && brace === 0) count += 1;
  }

  return count;
}

function auditQueryRunBindings(source: string) {
  const failures: Array<{ line: number; placeholders: number; args: number; sql: string }> = [];
  let cursor = 0;

  while (true) {
    const start = source.indexOf('db.query(`', cursor);
    if (start < 0) break;
    const sqlStart = start + 'db.query(`'.length;
    let sqlEnd = sqlStart;
    while (sqlEnd < source.length) {
      if (source[sqlEnd] === '`' && source[sqlEnd - 1] !== '\\') break;
      sqlEnd += 1;
    }
    if (sqlEnd >= source.length) break;

    const sql = source.slice(sqlStart, sqlEnd);
    let pos = sqlEnd + 1;
    while (/\s/.test(source[pos] ?? '')) pos += 1;
    if (source[pos] !== ')') {
      cursor = sqlEnd + 1;
      continue;
    }
    pos += 1;
    while (/\s/.test(source[pos] ?? '')) pos += 1;
    if (!source.startsWith('.run(', pos)) {
      cursor = sqlEnd + 1;
      continue;
    }

    const argsStart = pos + '.run('.length;
    let p = argsStart;
    let depth = 1;
    let quote: string | null = null;
    let template = false;
    let escaped = false;

    while (p < source.length && depth > 0) {
      const ch = source[p]!;
      if (quote) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === quote) quote = null;
      } else if (template) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '`') template = false;
      } else if (ch === '\'' || ch === '"') quote = ch;
      else if (ch === '`') template = true;
      else if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      p += 1;
    }

    const argsText = source.slice(argsStart, Math.max(argsStart, p - 1));
    const args = countTopLevelArguments(argsText);
    if (args !== null) {
      const placeholders = (sql.match(/\?/g) ?? []).length;
      if (placeholders !== args) {
        failures.push({
          line: source.slice(0, start).split('\n').length,
          placeholders,
          args,
          sql: sql.trim().split('\n')[0] ?? ''
        });
      }
    }
    cursor = p;
  }

  return failures;
}

beforeEach(() => resetModuleDatabase());
afterEach(() => {
  // A failed test must not leave Math.random patched for the next test.
  // withRandom() handles the normal path; this is just a defensive no-op hook.
});

describe('TLB facility torture test', () => {
  describe('schema, bootstrap, and static integrity', () => {
    it('creates every core table required by the current game', () => {
      const rows = db.query(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>;
      const names = new Set(rows.map(row => row.name));
      for (const table of [
        'agents', 'facility', 'abnormalities', 'ego_equipment', 'save_files',
        'facility_events', 'codex_entries', 'agent_abnormality_knowledge',
        'agent_work_history', 'agent_abnormality_observations', 'agent_relationships',
        'memory_checkpoints', 'ordeal_events', 'department_quests'
      ]) {
        expect(names.has(table)).toBe(true);
      }
    });

    it('uses a guild-aware composite primary key for agents', () => {
      const info = db.query(`PRAGMA table_info(agents)`).all() as Array<{ name: string; pk: number }>;
      const pk = info.filter(col => col.pk > 0).sort((a, b) => a.pk - b.pk).map(col => col.name);
      expect(pk).toEqual(['guild_id', 'discord_id']);
    });

    it('contains the persistence columns used by panic, travel, and radio systems', () => {
      const agentCols = new Set((db.query(`PRAGMA table_info(agents)`).all() as any[]).map(c => c.name));
      const facilityCols = new Set((db.query(`PRAGMA table_info(facility)`).all() as any[]).map(c => c.name));
      for (const name of ['travel_origin', 'travel_destination', 'travel_remaining', 'panic_turns', 'panic_behavior']) {
        expect(agentCols.has(name)).toBe(true);
      }
      for (const name of ['control_channel_id', 'containment_channel_id', 'status_channel_id', 'radio_channel_id']) {
        expect(facilityCols.has(name)).toBe(true);
      }
    });

    it('has no static db.query(...).run(...) placeholder mismatches', async () => {
      const source = await Bun.file(sourcePath).text();
      expect(auditQueryRunBindings(source)).toEqual([]);
    });

    it('registers unique top-level slash command names including the new systems', async () => {
      const source = await Bun.file(deployPath).text();
      const names = [...source.matchAll(/new SlashCommandBuilder\(\)\s*\.setName\('([^']+)'\)/g)].map(match => match[1]!);
      expect(new Set(names).size).toBe(names.length);
      for (const command of ['join', 'work', 'info', 'radio', 'work-history', 'relationships', 'departments', 'travel', 'save', 'load', 'rewind']) {
        expect(names).toContain(command);
      }
    });

    it('can bootstrap the same on-disk schema in two separate Bun processes', () => {
      const dbPath = resolve(testsDir, `migration-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
      const entryUrl = pathToFileURL(sourcePath).href;
      const script = `process.env.NODE_ENV='test';process.env.BOT_TEST_MODE='1';process.env.FACILITY_DB_PATH=${JSON.stringify(dbPath)};process.env.DISCORD_TOKEN='test-token';await import(${JSON.stringify(entryUrl)});`;
      try {
        for (let i = 0; i < 2; i++) {
          const result = Bun.spawnSync({
            cmd: [process.execPath, '-e', script],
            cwd: projectRoot,
            env: { ...process.env, BOT_TEST_MODE: '1', NODE_ENV: 'test', FACILITY_DB_PATH: dbPath, DISCORD_TOKEN: 'test-token' },
            stdout: 'pipe',
            stderr: 'pipe'
          });
          expect(result.exitCode).toBe(0);
        }
      } finally {
        if (existsSync(dbPath)) rmSync(dbPath, { force: true });
        if (existsSync(`${dbPath}-wal`)) rmSync(`${dbPath}-wal`, { force: true });
        if (existsSync(`${dbPath}-shm`)) rmSync(`${dbPath}-shm`, { force: true });
      }
    });
  });

  describe('math, stats, damage, and E.G.O.', () => {
    it('clamps numbers at both boundaries', () => {
      expect(__test.clamp(-10, 0, 5)).toBe(0);
      expect(__test.clamp(3, 0, 5)).toBe(3);
      expect(__test.clamp(99, 0, 5)).toBe(5);
    });

    it('makes Emergency riskier and more productive than Morning', () => {
      const morning = bot.getShiftProfile(8);
      const emergency = bot.getShiftProfile(22);
      expect(morning.label).toBe('Morning');
      expect(emergency.label).toBe('Emergency');
      expect(emergency.workChance).toBeLessThan(morning.workChance);
      expect(emergency.damageMultiplier).toBeGreaterThan(morning.damageMultiplier);
      expect(emergency.energyMultiplier).toBeGreaterThan(morning.energyMultiplier);
      expect(emergency.breachMultiplier).toBeGreaterThan(morning.breachMultiplier);
    });

    it('hard-stops the phase clock at 22:00', () => {
      expect(__test.nextPhase(8)).toBe(10);
      expect(__test.nextPhase(20)).toBe(22);
      expect(__test.nextPhase(22)).toBe(22);
      expect(__test.nextPhase(999)).toBe(8);
    });

    it('maps hidden affinity scores to qualitative work-favor labels', () => {
      expect(__test.getFavorLabel(0.1)).toBe('Very Low');
      expect(__test.getFavorLabel(0.3)).toBe('Low');
      expect(__test.getFavorLabel(0.5)).toBe('Normal');
      expect(__test.getFavorLabel(0.7)).toBe('High');
      expect(__test.getFavorLabel(0.9)).toBe('Very High');
    });

    it('improves a work-favor table as the matching stat tier rises', () => {
      const abno = { work_attachment: 0.58 };
      const order = ['Very Low', 'Low', 'Normal', 'High', 'Very High'];
      const tierI = order.indexOf(__test.getWorkFavorLabel(abno, 'attachment', 1));
      const tierV = order.indexOf(__test.getWorkFavorLabel(abno, 'attachment', 5));
      expect(tierV).toBeGreaterThanOrEqual(tierI);
    });

    it('scales maximum HP with Fortitude and maximum SP with Prudence', () => {
      expect(__test.calculateMaxHp(5)).toBeGreaterThan(__test.calculateMaxHp(2));
      expect(__test.calculateMaxSp(5)).toBeGreaterThan(__test.calculateMaxSp(2));
    });

    it('applies RED damage to HP and kills at zero', () => {
      const agent = { hp: 20, max_hp: 100, sp: 100, max_sp: 100, status: 'idle', suit: 'basic_suit', trait: 'calm' };
      __test.applyDamage(agent, 25, 'RED');
      expect(agent.hp).toBe(0);
      expect(agent.status).toBe('dead');
    });

    it('applies WHITE damage to SP and enters the panic state at zero', () => {
      const agent = { hp: 100, max_hp: 100, sp: 10, max_sp: 100, status: 'idle', suit: 'basic_suit', trait: 'calm', recovery_days: 0, panic_turns: 0, panic_behavior: '', fortitude: 1, prudence: 5, temperance: 2, justice: 3 };
      __test.applyDamage(agent, 20, 'WHITE');
      expect(agent.sp).toBe(0);
      expect(agent.status).toBe('panicked');
      expect(agent.recovery_days).toBeGreaterThanOrEqual(2);
      expect(agent.panic_behavior).toBe('breach_seeking');
    });

    it('applies BLACK damage to both HP and SP', () => {
      const agent = { hp: 100, max_hp: 100, sp: 100, max_sp: 100, status: 'idle', suit: 'basic_suit', trait: 'calm' };
      __test.applyDamage(agent, 10, 'BLACK');
      expect(agent.hp).toBe(90);
      expect(agent.sp).toBe(90);
    });

    it('applies PALE damage as a percentage of maximum HP', () => {
      const agent = { hp: 200, max_hp: 200, sp: 100, max_sp: 100, status: 'idle', suit: 'basic_suit', trait: 'calm' };
      __test.applyDamage(agent, 10, 'PALE');
      expect(agent.hp).toBe(170); // basic suit has 1.5x PALE multiplier: 10% * 1.5
    });

    it('makes cautious agents take less incoming damage than reckless agents', () => {
      const cautious = { hp: 100, max_hp: 100, sp: 100, max_sp: 100, status: 'idle', suit: 'basic_suit', trait: 'cautious' };
      const reckless = { hp: 100, max_hp: 100, sp: 100, max_sp: 100, status: 'idle', suit: 'basic_suit', trait: 'reckless' };
      const cautiousDamage = __test.applyDamage(cautious, 20, 'RED');
      const recklessDamage = __test.applyDamage(reckless, 20, 'RED');
      expect(cautiousDamage).toBeLessThan(recklessDamage);
    });

    it('applies E.G.O. gift stat bonuses to effective stats', () => {
      const agent = { fortitude: 3, prudence: 3, temperance: 3, justice: 3, equipped_gift: 'vacant_resonance' };
      expect(__test.getEffectiveStat(agent, 'fortitude')).toBe(4);
      expect(__test.getEffectiveStat(agent, 'justice')).toBe(4);
    });

    it('applies E.G.O. gift max-SP drawbacks', () => {
      const plain = { equipped_gift: '' };
      const embraced = { equipped_gift: 'beasts_embrace' };
      expect(__test.calculateMaxSp(4, embraced)).toBeLessThan(__test.calculateMaxSp(4, plain));
    });

    it('levels agents using the real experience curve', async () => {
      const agent: any = {
        name: 'Emu', level: 1, experience: 0, promotions: 0,
        fortitude: 2, prudence: 2, temperance: 2, justice: 2,
        hp: 114, max_hp: 114, sp: 104, max_sp: 104, equipped_gift: ''
      };
      await withRandom([0], () => {
        const messages = __test.awardExperience(agent, __test.experienceToNext(1));
        expect(messages.length).toBe(1);
      });
      expect(agent.level).toBe(2);
      expect(agent.promotions).toBe(1);
      expect(agent.fortitude).toBe(3);
    });
  });

  describe('real work-resolution math', () => {
    function workFixtures() {
      const agent = {
        discord_id: 'agent_emu', fortitude: 4, prudence: 4, temperance: 4, justice: 4,
        trait: 'calm', status: 'idle', equipped_gift: '', hp: 130, max_hp: 130, sp: 130, max_sp: 130
      };
      const abno = {
        risk: 'TETH', work_instinct: 0.5, work_insight: 0.5, work_attachment: 0.5, work_repression: 0.5,
        rage: 0, behaviour: 'docile', last_worked_by: '', work_streak: 0
      };
      const facility = { research: 100, welfare_level: 1, phase: 8, meltdown_alarm: 0, department_unlocks: JSON.stringify(['control']) };
      return { agent, abno, facility };
    }

    it('keeps production work chance inside its intended clamp', () => {
      const { agent, abno, facility } = workFixtures();
      const huge = { ...agent, fortitude: 999, trait: 'energetic' };
      expect(__test.calculateWorkChance(huge, { ...abno, risk: 'ZAYIN', work_instinct: 0.99 }, 'instinct', facility, 1)).toBeLessThanOrEqual(0.97);
      const awful = { ...agent, fortitude: 0, status: 'recovering', trait: 'reckless' };
      expect(__test.calculateWorkChance(awful, { ...abno, risk: 'ALEPH', rage: 10, work_instinct: 0.05 }, 'instinct', { ...facility, phase: 22 }, 4)).toBeGreaterThanOrEqual(0.05);
    });

    it('rewards higher abnormality affinity', () => {
      const { agent, abno, facility } = workFixtures();
      const low = __test.calculateWorkChance(agent, { ...abno, work_attachment: 0.1 }, 'attachment', facility, 1);
      const high = __test.calculateWorkChance(agent, { ...abno, work_attachment: 0.9 }, 'attachment', facility, 1);
      expect(high).toBeGreaterThan(low);
    });

    it('makes higher work levels more dangerous', () => {
      const { agent, abno, facility } = workFixtures();
      expect(__test.calculateWorkChance(agent, abno, 'instinct', facility, 4)).toBeLessThan(__test.calculateWorkChance(agent, abno, 'instinct', facility, 1));
    });

    it('makes Emergency work less consistent than Morning work', () => {
      const { agent, abno, facility } = workFixtures();
      const morning = __test.calculateWorkChance(agent, abno, 'insight', { ...facility, phase: 8 }, 1);
      const emergency = __test.calculateWorkChance(agent, abno, 'insight', { ...facility, phase: 22 }, 1);
      expect(emergency).toBeLessThan(morning);
    });

    it('rewards a possessive abnormality for a familiar handler', () => {
      const { agent, abno, facility } = workFixtures();
      const familiar = __test.calculateWorkChance(agent, { ...abno, behaviour: 'possessive', last_worked_by: agent.discord_id, work_streak: 3 }, 'attachment', facility, 1);
      const stranger = __test.calculateWorkChance(agent, { ...abno, behaviour: 'possessive', last_worked_by: 'someone_else', work_streak: 3 }, 'attachment', facility, 1);
      expect(familiar).toBeGreaterThan(stranger);
    });

    it('lets predatory abnormalities exploit weakened agents', () => {
      const { agent, abno, facility } = workFixtures();
      const healthy = __test.calculateWorkChance(agent, { ...abno, behaviour: 'predatory' }, 'repression', facility, 1);
      const injured = __test.calculateWorkChance({ ...agent, status: 'injured' }, { ...abno, behaviour: 'predatory' }, 'repression', facility, 1);
      expect(injured).toBeLessThan(healthy);
    });

    it('deterministically produces a GOOD work-quality roll when the roll is tiny', async () => {
      const result = await withRandom([0.01, 0.01], () => __test.workQuality(0.7, 2, 'docile'));
      expect(result.tier).toBe('good');
      expect(result.boxes).toBeGreaterThanOrEqual(3);
    });

    it('deterministically produces a CRITICAL roll when the roll misses every threshold', async () => {
      const result = await withRandom([0.999], () => __test.workQuality(0.5, 1, 'docile'));
      expect(result.tier).toBe('critical');
      expect(result.boxes).toBe(0);
    });

    it('renders actual PE/NE split results without inventing extra results', () => {
      expect(__test.buildPEVisualString(3, 2, 5)).toBe('🟩 PE · 🟩 PE · 🟩 PE · 💔 NE · 💔 NE');
      expect(__test.renderPEProgress(3, 2, 5)).toBe('🟩🟩🟩🟥🟥');
    });

    it('scales the PE meter with abnormality risk', () => {
      expect(__test.getPEBoxTotal({ risk: 'ZAYIN' })).toBe(5);
      expect(__test.getPEBoxTotal({ risk: 'ALEPH' })).toBe(8);
    });
  });

  describe('personal observation, codex, and work history', () => {
    it('starts an agent with zero personal knowledge of an abnormality', () => {
      const row = __test.getAgentKnowledge('g_knowledge', 'emu', 1);
      expect(__test.totalUniquePE(row)).toBe(0);
      expect(row.description_unlocked).toBe(0);
    });

    it('caps each work type at exactly two unique PE boxes', () => {
      __test.updateAgentKnowledge('g_knowledge', 'emu', 1, 'instinct', 99);
      const row = __test.getAgentKnowledge('g_knowledge', 'emu', 1);
      expect(row.instinct_pe).toBe(2);
      expect(__test.totalUniquePE(row)).toBe(2);
    });

    it('announces the first 2/2 work-favor unlock only once', () => {
      const first = __test.updateAgentKnowledge('g_unlock', 'emu', 1, 'insight', 2);
      const second = __test.updateAgentKnowledge('g_unlock', 'emu', 1, 'insight', 2);
      expect(first.newlyUnlockedWorkFavor).toBe(true);
      expect(second.newlyUnlockedWorkFavor).toBe(false);
    });

    it('unlocks management tips at four total unique PE boxes', () => {
      __test.updateAgentKnowledge('g_tips', 'emu', 1, 'instinct', 2);
      const result = __test.updateAgentKnowledge('g_tips', 'emu', 1, 'insight', 2);
      expect(result.knowledge.management_tips).toBe(1);
      expect(result.knowledge.description_unlocked).toBe(0);
      expect(result.newlyUnlockedTips).toBe(true);
    });

    it('unlocks the full description at eight total unique PE boxes', () => {
      for (const type of ['instinct', 'insight', 'attachment', 'repression'] as const) {
        __test.updateAgentKnowledge('g_desc', 'emu', 1, type, 2);
      }
      const row = __test.getAgentKnowledge('g_desc', 'emu', 1);
      expect(__test.totalUniquePE(row)).toBe(8);
      expect(row.description_unlocked).toBe(1);
    });

    it('keeps abnormality knowledge private between agents', () => {
      __test.updateAgentKnowledge('g_private', 'emu', 1, 'attachment', 2);
      const emu = __test.getAgentKnowledge('g_private', 'emu', 1);
      const miku = __test.getAgentKnowledge('g_private', 'miku', 1);
      expect(emu.attachment_pe).toBe(2);
      expect(miku.attachment_pe).toBe(0);
    });

    it('records work history with normalized qliphoth change and nonnegative damage', () => {
      bot.recordAgentWorkHistory({
        guildId: 'g_history', discordId: 'emu', day: 4, phase: 16,
        abnormalityId: 7, abnormalityName: 'Beauty and the Beast',
        workType: 'attachment', result: 'good', peBoxes: 4,
        qliphothChange: 99, damage: -3, note: 'it appeared to recognize you.'
      });
      const row = db.query(`SELECT * FROM agent_work_history WHERE guild_id='g_history'`).get() as any;
      expect(row.qliphoth_change).toBe(1);
      expect(row.damage).toBe(0);
      expect(row.note).toContain('recognize');
    });

    it('accumulates observation evidence by work type', () => {
      for (let i = 0; i < 3; i++) {
        bot.recordAgentObservation({ guildId: 'g_obs', discordId: 'emu', abnormalityId: 1, workType: 'attachment', result: 'good', qliphothChange: 1 });
      }
      const row = db.query(`SELECT * FROM agent_abnormality_observations WHERE guild_id='g_obs'`).get() as any;
      expect(row.attempts).toBe(3);
      expect(row.good).toBe(3);
      expect(row.qliphoth_gains).toBe(3);
    });

    it('uses escalating observation-confidence labels', () => {
      expect(__test.getObservationConfidence(1)).toBe('unconfirmed');
      expect(__test.getObservationConfidence(2)).toBe('suspected');
      expect(__test.getObservationConfidence(4)).toBe('probable');
      expect(__test.getObservationConfidence(7)).toBe('consistent');
      expect(__test.getObservationConfidence(10)).toBe('confirmed');
    });

    it('turns repeated outcomes into readable management tips', () => {
      const guildId = 'g_tip_text';
      seedAgent(guildId, 'emu');
      const abno = seedAbnormality(guildId, { id: 17 });
      bot.recordAgentObservation({ guildId, discordId: 'emu', abnormalityId: 17, workType: 'attachment', result: 'good', qliphothChange: 1 });
      bot.recordAgentObservation({ guildId, discordId: 'emu', abnormalityId: 17, workType: 'attachment', result: 'good', qliphothChange: 1 });
      const agent = db.query(`SELECT * FROM agents WHERE guild_id=? AND discord_id=?`).get(guildId, 'emu') as any;
      const tips = __test.buildManagementTips(abno, agent);
      expect(tips.join(' ')).toContain('appears beneficial');
      expect(tips.join(' ')).toContain('suspected');
    });
  });

  describe('relationships and simulated multiplayer', () => {
    it('keeps trust directional', () => {
      bot.updateAgentRelationship('g_rel', 'emu', 'miku', 2);
      const emu = db.query(`SELECT trust FROM agent_relationships WHERE guild_id=? AND from_discord_id=? AND to_discord_id=?`).get('g_rel', 'emu', 'miku') as any;
      const reverse = db.query(`SELECT trust FROM agent_relationships WHERE guild_id=? AND from_discord_id=? AND to_discord_id=?`).get('g_rel', 'miku', 'emu') as any;
      expect(emu.trust).toBe(2);
      expect(reverse).toBeNull();
    });

    it('caps per-event trust changes and total trust bounds', () => {
      for (let i = 0; i < 20; i++) bot.updateAgentRelationship('g_rel_cap', 'emu', 'miku', 999);
      let row = db.query(`SELECT trust FROM agent_relationships WHERE guild_id='g_rel_cap'`).get() as any;
      expect(row.trust).toBe(10);
      for (let i = 0; i < 20; i++) bot.updateAgentRelationship('g_rel_cap', 'emu', 'miku', -999);
      row = db.query(`SELECT trust FROM agent_relationships WHERE guild_id='g_rel_cap'`).get() as any;
      expect(row.trust).toBe(-10);
    });

    it('records a good shared shift in both directions', () => {
      const guildId = 'g_shared';
      seedAgent(guildId, 'emu');
      seedAgent(guildId, 'miku');
      __test.recordSharedShiftRelationships(guildId, 'emu', 'good');
      const rows = db.query(`SELECT * FROM agent_relationships WHERE guild_id=? ORDER BY from_discord_id`).all(guildId) as any[];
      expect(rows.length).toBe(2);
      expect(rows.every(row => row.shared_shifts === 1)).toBe(true);
      expect(rows.every(row => row.positive_shifts === 1)).toBe(true);
      expect(rows.every(row => row.trust === 1)).toBe(true);
    });

    it('does not count dead coworkers as part of a shared shift', () => {
      const guildId = 'g_shared_dead';
      seedAgent(guildId, 'emu');
      seedAgent(guildId, 'miku', { status: 'dead', hp: 0 });
      __test.recordSharedShiftRelationships(guildId, 'emu', 'good');
      const count = db.query(`SELECT COUNT(*) AS count FROM agent_relationships WHERE guild_id=?`).get(guildId) as any;
      expect(count.count).toBe(0);
    });

    it('maps relationship values to readable labels', () => {
      expect(__test.getRelationshipLabel(8)).toBe('trusting');
      expect(__test.getRelationshipLabel(3)).toBe('friendly');
      expect(__test.getRelationshipLabel(0)).toBe('neutral');
      expect(__test.getRelationshipLabel(-3)).toBe('distrustful');
      expect(__test.getRelationshipLabel(-8)).toBe('uneasy');
    });
  });

  describe('panic loop and recovery', () => {
    it('selects panic behavior from the dominant stat without brittle wording assumptions', () => {
      const prudence = { sp: 0, status: 'panicked', fortitude: 1, prudence: 6, temperance: 2, justice: 3 };
      const fortitude = { sp: 0, status: 'panicked', fortitude: 8, prudence: 1, temperance: 2, justice: 3 };
      expect(__test.getPanicBehaviorKey(prudence)).toBe('breach_seeking');
      expect(__test.getPanicBehaviorKey(fortitude)).toBe('wander');
      expect(bot.resolvePanicBehavior(prudence)).toContain('containment');
      expect(bot.resolvePanicBehavior(fortitude)).toContain('containment');
    });

    it('initializes panic persistence fields when SP hits zero', () => {
      const agent: any = { sp: 0, status: 'idle', recovery_days: 0, panic_turns: 0, panic_behavior: '', fortitude: 1, prudence: 5, temperance: 2, justice: 3 };
      __test.applyPanicState(agent);
      expect(agent.status).toBe('panicked');
      expect(agent.recovery_days).toBe(2);
      expect(agent.panic_behavior).toBe('breach_seeking');
    });

    it('increases panic support chance with welfare and trusted coworkers', () => {
      const guildId = 'g_support';
      seedFacility(guildId, { welfare_level: 1 });
      const agent = seedAgent(guildId, 'emu');
      const base = __test.panicSupportChance(guildId, agent, { welfare_level: 1 });
      bot.updateAgentRelationship(guildId, 'miku', 'emu', 2);
      bot.updateAgentRelationship(guildId, 'miku', 'emu', 2);
      bot.updateAgentRelationship(guildId, 'miku', 'emu', 2);
      const boosted = __test.panicSupportChance(guildId, agent, { welfare_level: 4 });
      expect(boosted).toBeGreaterThan(base);
    });

    it('lets a lockdown panic consume facility energy', async () => {
      const guildId = 'g_panic_lock';
      const facility = seedFacility(guildId, { energy: 40, phase: 14 });
      seedAgent(guildId, 'emu', { status: 'panicked', sp: 0, fortitude: 1, prudence: 1, temperance: 8, justice: 1, panic_behavior: 'lockdown' });
      await withRandom([0.99], () => __test.resolvePanicPhase(guildId, facility));
      const fresh = db.query(`SELECT * FROM facility WHERE guild_id=?`).get(guildId) as any;
      expect(fresh.energy).toBeLessThan(40);
      const event = db.query(`SELECT * FROM facility_events WHERE guild_id=? AND type='panic'`).get(guildId) as any;
      expect(event.message).toContain('jammed department controls');
    });

    it('lets breach-seeking panic open a vulnerable containment unit', async () => {
      const guildId = 'g_panic_breach';
      const facility = seedFacility(guildId, { phase: 14 });
      seedAgent(guildId, 'emu', { status: 'panicked', sp: 0, fortitude: 1, prudence: 8, temperance: 1, justice: 1, panic_behavior: 'breach_seeking' });
      seedAbnormality(guildId, { id: 1, risk: 'ALEPH', qliphoth: 1, max_qliphoth: 2, can_breach: 1 });
      const events: string[] = [];
      const unsubscribe = subscribeFacilityEvents(event => {
        events.push(event.type);
      }, { guildId });
      let result: any;
      try {
        result = await withRandom([0.99], () => __test.resolvePanicPhase(guildId, facility));
      } finally {
        unsubscribe();
      }
      const abno = db.query(`SELECT * FROM abnormalities WHERE id=1`).get() as any;
      expect(abno.is_breaching).toBe(1);
      expect(result.breached.length).toBe(1);
      expect(events).toEqual(['qliphoth_changed', 'abnormality_breached']);
    });

    it('moves an unsupported panicked agent into trauma recovery after three turns', async () => {
      const guildId = 'g_panic_three';
      const facility = seedFacility(guildId, { energy: 100 });
      seedAgent(guildId, 'emu', { status: 'panicked', sp: 0, fortitude: 1, prudence: 1, temperance: 8, justice: 1, panic_behavior: 'lockdown' });
      await withRandom([0.99], async () => {
        __test.resolvePanicPhase(guildId, facility);
        __test.resolvePanicPhase(guildId, facility);
        __test.resolvePanicPhase(guildId, facility);
      });
      const agent = db.query(`SELECT * FROM agents WHERE guild_id=? AND discord_id='emu'`).get(guildId) as any;
      expect(agent.status).toBe('traumatized');
      expect(agent.panic_turns).toBe(0);
      expect(agent.panic_behavior).toBe('');
    });

    it('daily recovery clears panic metadata and can return a stable agent to idle', () => {
      const guildId = 'g_recovery';
      seedFacility(guildId, { welfare_level: 3 });
      seedAgent(guildId, 'emu', { status: 'panicked', sp: 70, max_sp: 100, hp: 75, max_hp: 100, recovery_days: 1, panic_turns: 2, panic_behavior: 'wander' });
      __test.resolveDailyRecovery(guildId);
      const agent = db.query(`SELECT * FROM agents WHERE guild_id=? AND discord_id='emu'`).get(guildId) as any;
      expect(agent.status).toBe('idle');
      expect(agent.panic_turns).toBe(0);
      expect(agent.panic_behavior).toBe('');
      expect(agent.hp).toBeGreaterThanOrEqual(75);
      expect(agent.sp).toBeGreaterThanOrEqual(70);
    });
  });

  describe('department quests and physical routing', () => {
    it('starts with Control only instead of unlocking departments from day count', () => {
      const unlocked = bot.evaluateDepartmentUnlocks({ day_count: 99, department_unlocks: JSON.stringify(['control']) });
      expect(unlocked).toEqual(['control']);
    });

    it('unlocks Information when the Control quest reaches 40 energy', () => {
      const guildId = 'g_dept_control';
      const facility = seedFacility(guildId);
      expect(bot.recordDepartmentProgress(guildId, 'control', 40)).toBe(40);
      const refreshed = db.query(`SELECT * FROM facility WHERE guild_id=?`).get(guildId) as any;
      expect(bot.syncDepartmentUnlocks(guildId, refreshed)).toContain('information');
      expect(facility.guild_id).toBe(guildId);
    });

    it('supports the full Control → Information → Security → Training → Command chain', () => {
      const guildId = 'g_dept_chain';
      seedFacility(guildId);
      expect(bot.recordDepartmentProgress(guildId, 'control', 40)).toBe(40);
      expect(bot.recordDepartmentProgress(guildId, 'information', 3)).toBe(3);
      expect(bot.recordDepartmentProgress(guildId, 'security', 2)).toBe(2);
      expect(bot.recordDepartmentProgress(guildId, 'training', 3)).toBe(3);
      const facility = db.query(`SELECT * FROM facility WHERE guild_id=?`).get(guildId) as any;
      expect(bot.syncDepartmentUnlocks(guildId, facility)).toEqual(['control', 'information', 'security', 'training', 'command']);
    });

    it('does not allow negative quest progress and caps progress at target', () => {
      const guildId = 'g_dept_cap';
      seedFacility(guildId);
      expect(bot.updateDepartmentQuestProgress(guildId, 'control', -500)).toBe(0);
      expect(bot.updateDepartmentQuestProgress(guildId, 'control', 500)).toBe(40);
      expect(bot.updateDepartmentQuestProgress(guildId, 'control', 500)).toBe(40);
    });

    it('emits only one unlock event when an already-complete quest is updated again', () => {
      const guildId = 'g_dept_once';
      seedFacility(guildId);
      bot.updateDepartmentQuestProgress(guildId, 'control', 40);
      bot.updateDepartmentQuestProgress(guildId, 'control', 1);
      const row = db.query(`SELECT COUNT(*) AS count FROM facility_events WHERE guild_id=? AND type='department_unlock'`).get(guildId) as any;
      expect(row.count).toBe(1);
    });

    it('rejects travel to locked departments', () => {
      const guildId = 'g_travel_locked';
      seedFacility(guildId);
      seedAgent(guildId, 'emu');
      expect(bot.startAgentTravel(guildId, 'emu', 'security')).toBeNull();
    });

    it('reports already-there travel without creating transit state', () => {
      const guildId = 'g_travel_same';
      seedFacility(guildId);
      seedAgent(guildId, 'emu', { department: 'control' });
      const result = bot.startAgentTravel(guildId, 'emu', 'control') as any;
      expect(result.status).toBe('already_there');
      expect(result.agent.travel_remaining).toBe(0);
    });

    it('keeps an agent in transit until the required route phases resolve', async () => {
      const guildId = 'g_travel_long';
      seedFacility(guildId, { department_unlocks: JSON.stringify(['control', 'command']) });
      seedAgent(guildId, 'emu', { department: 'control' });
      const travel = bot.startAgentTravel(guildId, 'emu', 'command') as any;
      expect(travel.duration).toBe(bot.getTravelDuration('control', 'command'));
      expect(travel.duration).toBe(2);
      await withRandom([0.99], () => {
        bot.resolveAgentTravel(guildId);
        let agent = db.query(`SELECT * FROM agents WHERE guild_id=? AND discord_id='emu'`).get(guildId) as any;
        expect(agent.department).toBe('control');
        expect(agent.travel_remaining).toBe(1);
        bot.resolveAgentTravel(guildId);
      });
      const agent = db.query(`SELECT * FROM agents WHERE guild_id=? AND discord_id='emu'`).get(guildId) as any;
      expect(agent.department).toBe('command');
      expect(agent.travel_remaining).toBe(0);
    });

    it('does not magically heal or clear an injury when travel starts', () => {
      const guildId = 'g_travel_injury';
      seedFacility(guildId, { department_unlocks: JSON.stringify(['control', 'information']) });
      seedAgent(guildId, 'emu', { department: 'control', status: 'injured', hp: 30 });
      bot.startAgentTravel(guildId, 'emu', 'information');
      const agent = db.query(`SELECT * FROM agents WHERE guild_id=? AND discord_id='emu'`).get(guildId) as any;
      expect(agent.status).toBe('injured');
      expect(agent.hp).toBe(30);
    });

    it('returns quest progress in department route summaries', () => {
      const guildId = 'g_dept_summary';
      const facility = seedFacility(guildId);
      bot.updateDepartmentQuestProgress(guildId, 'control', 17);
      const summary = bot.getDepartmentRouteSummary({ ...facility, guild_id: guildId }, { department: 'control' });
      const control = summary.find((row: any) => row.department === 'control');
      expect(control!.current).toBe(true);
      expect(control!.progress).toBe(17);
      expect(control!.questGoal).toContain('40 energy');
    });
  });

  describe('radio delivery and Discord-channel persistence with fakes', () => {
    function fakeGuild() {
      const cache = new Map<string, any>();
      const sent: Array<{ channelId: string; payload: any }> = [];
      let created = 0;
      const guild: any = {
        id: 'g_fake_discord',
        channels: {
          cache,
          create: async (options: any) => {
            created += 1;
            const id = `channel_${created}`;
            const channel: any = {
              id,
              type: options.type,
              parentId: options.parent ?? null,
              send: async (payload: any) => { sent.push({ channelId: id, payload }); return payload; },
              setParent: async (parentId: string) => { channel.parentId = parentId; return channel; }
            };
            cache.set(id, channel);
            return channel;
          }
        }
      };
      return { guild, cache, sent, createdCount: () => created };
    }

    it('persists ambient transmissions to facility history', () => {
      const message = bot.createAmbientRadioEvent('g_radio', { day_count: 3, phase: 14 }, 0.01);
      const row = db.query(`SELECT * FROM facility_events WHERE guild_id=? AND type='ambient_event'`).get('g_radio') as any;
      expect(message).toBeTruthy();
      expect(row.day).toBe(3);
      expect(row.phase).toBe(14);
      expect(row.message).toBe(message);
    });

    it('does not invent an ambient transmission outside the event roll', () => {
      expect(bot.createAmbientRadioEvent('g_radio_quiet', { day_count: 3, phase: 14 }, 0.10)).toBeNull();
      const row = db.query(`SELECT COUNT(*) AS count FROM facility_events WHERE guild_id=?`).get('g_radio_quiet') as any;
      expect(row.count).toBe(0);
    });

    it('creates and persists the facility category plus four dedicated channels', async () => {
      const guildId = 'g_fake_discord';
      const facility = seedFacility(guildId, { is_started: 1 });
      const fake = fakeGuild();
      const repaired = await __test.ensureFacilityChannels(fake.guild, facility);
      expect(fake.createdCount()).toBe(5);
      expect(repaired.category_id).toBeTruthy();
      expect(repaired.control_channel_id).toBeTruthy();
      expect(repaired.containment_channel_id).toBeTruthy();
      expect(repaired.status_channel_id).toBeTruthy();
      expect(repaired.radio_channel_id).toBeTruthy();
      const stored = db.query(`SELECT * FROM facility WHERE guild_id=?`).get(guildId) as any;
      expect(stored.radio_channel_id).toBe(repaired.radio_channel_id);
    });

    it('does not duplicate healthy persisted facility channels', async () => {
      const guildId = 'g_fake_discord';
      const facility = seedFacility(guildId, { is_started: 1 });
      const fake = fakeGuild();
      const first = await __test.ensureFacilityChannels(fake.guild, facility);
      expect(fake.createdCount()).toBe(5);
      await __test.ensureFacilityChannels(fake.guild, first);
      expect(fake.createdCount()).toBe(5);
    });

    it('delivers radio messages to the dedicated radio channel', async () => {
      const guildId = 'g_fake_discord';
      const facility = seedFacility(guildId, { is_started: 1 });
      const fake = fakeGuild();
      const repaired = await __test.ensureFacilityChannels(fake.guild, facility);
      const ok = await bot.sendFacilityRadio(fake.guild, repaired, 'CONTROL: test transmission.');
      expect(ok).toBe(true);
      expect(fake.sent.length).toBe(1);
      expect(fake.sent[0]!.channelId).toBe(repaired.radio_channel_id);
      expect(fake.sent[0]!.payload.content).toContain('FACILITY RADIO');
      expect(fake.sent[0]!.payload.content).toContain('test transmission');
    });
  });

  describe('meltdowns, ordeals, daily events, and reset state', () => {
    it('triggers a meltdown alarm and assigns containment targets', async () => {
      const guildId = 'g_meltdown';
      const facility = seedFacility(guildId);
      seedAbnormality(guildId, { id: 1 });
      const triggered = await withRandom([0.5], () => __test.triggerMeltdownAlarm(guildId, facility));
      expect(triggered).toBe(true);
      const fresh = db.query(`SELECT * FROM facility WHERE guild_id=?`).get(guildId) as any;
      expect(fresh.meltdown_alarm).toBe(1);
      expect(JSON.parse(fresh.meltdown_targets)).toEqual([1]);
    });

    it('breaches a containment unit when its meltdown timer expires', () => {
      const guildId = 'g_meltdown_breach';
      const facility = seedFacility(guildId);
      seedAbnormality(guildId, { id: 1, meltdown_timer: 1, qliphoth: 3, max_qliphoth: 3 });
      db.query(`UPDATE facility SET meltdown_alarm=1, meltdown_targets=? WHERE guild_id=?`).run(JSON.stringify([1]), guildId);
      const breached = __test.resolveMeltdownTimers(guildId, { ...facility, meltdown_alarm: 1, meltdown_targets: JSON.stringify([1]) });
      const abno = db.query(`SELECT * FROM abnormalities WHERE id=1`).get() as any;
      expect(breached.length).toBe(1);
      expect(abno.is_breaching).toBe(1);
      expect(abno.meltdown_state).toBe('breach');
    });

    it('triggers the first ordeal once the energy threshold is reached', () => {
      const guildId = 'g_ordeal';
      const facility = seedFacility(guildId, { energy: 150 });
      expect(__test.maybeTriggerOrdeal(guildId, facility)).toBe(true);
      const fresh = db.query(`SELECT * FROM facility WHERE guild_id=?`).get(guildId) as any;
      expect(fresh.ordeal_active).toBe(1);
      expect(fresh.active_ordeal).toBe('amber');
      expect(__test.maybeTriggerOrdeal(guildId, fresh)).toBe(false);
    });

    it('resets transient daily alarms while preserving an active breach', async () => {
      const guildId = 'g_reset';
      seedFacility(guildId, { ordeal_active: 1, active_ordeal: 'amber' });
      seedAbnormality(guildId, { id: 1, qliphoth: 1, max_qliphoth: 3, rage: 4, is_breaching: 0 });
      seedAbnormality(guildId, { id: 2, qliphoth: 1, max_qliphoth: 3, rage: 4, is_breaching: 1 });
      db.query(`UPDATE facility SET meltdown_alarm=1, meltdown_targets='[1]', ordeal_active=1, active_ordeal='amber', ordeal_timer=999 WHERE guild_id=?`).run(guildId);
      await withRandom([0.5], () => __test.resetDailyOperationalState(guildId));
      const stable = db.query(`SELECT * FROM abnormalities WHERE id=1`).get() as any;
      const breach = db.query(`SELECT * FROM abnormalities WHERE id=2`).get() as any;
      const facility = db.query(`SELECT * FROM facility WHERE guild_id=?`).get(guildId) as any;
      expect(stable.qliphoth).toBe(3);
      expect(stable.rage).toBe(3);
      expect(breach.qliphoth).toBe(1);
      expect(breach.is_breaching).toBe(1);
      expect(facility.meltdown_alarm).toBe(0);
      expect(facility.ordeal_active).toBe(0);
    });

    it('can resolve the power-fluctuation daily event deterministically', async () => {
      const guildId = 'g_event_power';
      const facility = seedFacility(guildId, { energy: 25, containment_level: 1 });
      const text = await withRandom([0.01], () => __test.runDailyEvent(guildId, facility));
      expect(text).toContain('POWER FLUCTUATION');
      const fresh = db.query(`SELECT * FROM facility WHERE guild_id=?`).get(guildId) as any;
      expect(fresh.energy).toBe(15);
    });

    it('can resolve the research-breakthrough daily event deterministically', async () => {
      const guildId = 'g_event_research';
      const facility = seedFacility(guildId, { research: 100 });
      const text = await withRandom([0.20], () => __test.runDailyEvent(guildId, facility));
      expect(text).toContain('RESEARCH BREAKTHROUGH');
      const fresh = db.query(`SELECT * FROM facility WHERE guild_id=?`).get(guildId) as any;
      expect(fresh.research).toBe(115);
    });

    it('can resolve the welfare-supplies daily event deterministically', async () => {
      const guildId = 'g_event_welfare';
      const facility = seedFacility(guildId, { lob_points: 100, stable_days: 0 });
      const text = await withRandom([0.25], () => __test.runDailyEvent(guildId, facility));
      expect(text).toContain('WELFARE SUPPLIES');
      const fresh = db.query(`SELECT * FROM facility WHERE guild_id=?`).get(guildId) as any;
      expect(fresh.lob_points).toBe(80);
      expect(fresh.stable_days).toBe(1);
    });

    it('only spontaneously breaches abnormalities that are actually allowed to breach', async () => {
      const guildId = 'g_spontaneous';
      const facility = seedFacility(guildId, { phase: 22, security_level: 1 });
      seedAbnormality(guildId, { id: 1, risk: 'ALEPH', escape_chance: 1, can_breach: 1 });
      seedAbnormality(guildId, { id: 2, risk: 'ALEPH', escape_chance: 1, can_breach: 0 });
      const triggered = await withRandom([0], () => __test.maybeTriggerSpontaneousBreaches(guildId, facility));
      expect(triggered.map((a: any) => a.id)).toEqual([1]);
      const locked = db.query(`SELECT * FROM abnormalities WHERE id=2`).get() as any;
      expect(locked.is_breaching).toBe(0);
    });
  });

  describe('deep save/checkpoint state', () => {
    function buildRichState(guildId: string) {
      const facility = seedFacility(guildId, { energy: 42, quota: 120, day_count: 7, phase: 18, research: 155, lob_points: 321, department_unlocks: JSON.stringify(['control', 'information']) });
      seedAgent(guildId, 'emu', { name: 'Emu', hp: 77, sp: 66, department: 'information', travel_destination: 'command', travel_remaining: 2, panic_turns: 1, panic_behavior: 'wander', ego_gifts: JSON.stringify(['beasts_embrace']), equipped_gift: 'beasts_embrace' });
      seedAbnormality(guildId, { id: 77, name: 'Beauty and the Beast', qliphoth: 2, rage: 3, work_streak: 4, last_worked_by: 'emu' });
      __test.updateAgentKnowledge(guildId, 'emu', 77, 'attachment', 2);
      bot.recordAgentWorkHistory({ guildId, discordId: 'emu', day: 7, phase: 18, abnormalityId: 77, abnormalityName: 'Beauty and the Beast', workType: 'attachment', result: 'good', peBoxes: 4, qliphothChange: 1, damage: 3, note: 'remembered me' });
      bot.recordAgentObservation({ guildId, discordId: 'emu', abnormalityId: 77, workType: 'attachment', result: 'good', qliphothChange: 1 });
      bot.updateAgentRelationship(guildId, 'emu', 'miku', 2);
      db.query(`INSERT INTO codex_entries (guild_id, abnormality_name, observation_level, data_json) VALUES (?, ?, ?, ?)`).run(guildId, 'Beauty and the Beast', 4, '{"known":true}');
      bot.updateDepartmentQuestProgress(guildId, 'control', 17);
      db.query(`INSERT INTO ordeal_events (guild_id, color, threshold, active, expires_at) VALUES (?, 'amber', 150, 1, 999999)`).run(guildId);
      db.query(`INSERT INTO facility_events (guild_id, day, phase, type, message) VALUES (?, 7, 18, 'test', 'state marker')`).run(guildId);
      return facility;
    }

    it('serializes and restores the deeper simulation, not just day/energy', () => {
      const guildId = 'g_save_deep';
      buildRichState(guildId);
      const snapshot = __test.serializeFacility(guildId);

      db.query(`UPDATE facility SET energy=999, day_count=99, radio_channel_id='wrong' WHERE guild_id=?`).run(guildId);
      db.query(`UPDATE agents SET hp=1, sp=1, department='control', travel_remaining=0, panic_behavior='' WHERE guild_id=?`).run(guildId);
      db.query(`DELETE FROM agent_abnormality_knowledge WHERE guild_id=?`).run(guildId);
      db.query(`DELETE FROM agent_work_history WHERE guild_id=?`).run(guildId);
      db.query(`DELETE FROM agent_abnormality_observations WHERE guild_id=?`).run(guildId);
      db.query(`DELETE FROM agent_relationships WHERE guild_id=?`).run(guildId);
      db.query(`DELETE FROM codex_entries WHERE guild_id=?`).run(guildId);

      __test.restoreState(guildId, snapshot);

      const facility = db.query(`SELECT * FROM facility WHERE guild_id=?`).get(guildId) as any;
      const agent = db.query(`SELECT * FROM agents WHERE guild_id=? AND discord_id='emu'`).get(guildId) as any;
      const knowledge = db.query(`SELECT * FROM agent_abnormality_knowledge WHERE guild_id=?`).get(guildId) as any;
      const history = db.query(`SELECT * FROM agent_work_history WHERE guild_id=?`).get(guildId) as any;
      const observation = db.query(`SELECT * FROM agent_abnormality_observations WHERE guild_id=?`).get(guildId) as any;
      const relationship = db.query(`SELECT * FROM agent_relationships WHERE guild_id=?`).get(guildId) as any;
      const codex = db.query(`SELECT * FROM codex_entries WHERE guild_id=?`).get(guildId) as any;

      expect(facility.energy).toBe(42);
      expect(facility.day_count).toBe(7);
      expect(agent.hp).toBe(77);
      expect(agent.sp).toBe(66);
      expect(agent.department).toBe('information');
      expect(agent.travel_remaining).toBe(2);
      expect(agent.panic_behavior).toBe('wander');
      expect(agent.equipped_gift).toBe('beasts_embrace');
      expect(knowledge.attachment_pe).toBe(2);
      expect(history.note).toContain('remembered');
      expect(observation.attempts).toBe(1);
      expect(relationship.trust).toBe(2);
      expect(codex.observation_level).toBe(4);
    });

    it('keeps only the five newest memory checkpoints', () => {
      const guildId = 'g_checkpoint_cap';
      seedFacility(guildId);
      for (let day = 1; day <= 7; day++) {
        db.query(`UPDATE facility SET day_count=?, energy=? WHERE guild_id=?`).run(day, day * 10, guildId);
        const facility = db.query(`SELECT * FROM facility WHERE guild_id=?`).get(guildId) as any;
        bot.createMemoryCheckpoint(guildId, facility);
      }
      const rows = db.query(`SELECT * FROM memory_checkpoints WHERE guild_id=? ORDER BY id`).all(guildId) as any[];
      expect(rows.length).toBe(5);
      expect(rows[0]!.day_count).toBe(3);
      expect(rows[4]!.day_count).toBe(7);
    });

    it('rewinds deep state from the latest checkpoint', () => {
      const guildId = 'g_rewind';
      const facility = seedFacility(guildId, { energy: 40, day_count: 4 });
      seedAgent(guildId, 'emu', { hp: 80, sp: 70, department: 'control' });
      bot.createMemoryCheckpoint(guildId, facility);

      db.query(`UPDATE facility SET energy=999, day_count=9 WHERE guild_id=?`).run(guildId);
      db.query(`UPDATE agents SET hp=1, sp=1, department='information' WHERE guild_id=?`).run(guildId);

      expect(bot.restoreLatestMemoryCheckpoint(guildId)).toBe(true);
      const fresh = db.query(`SELECT * FROM facility WHERE guild_id=?`).get(guildId) as any;
      const agent = db.query(`SELECT * FROM agents WHERE guild_id=? AND discord_id='emu'`).get(guildId) as any;
      expect(fresh.energy).toBe(40);
      expect(fresh.day_count).toBe(4);
      expect(agent.hp).toBe(80);
      expect(agent.sp).toBe(70);
      expect(agent.department).toBe('control');
    });

    it('returns false when no memory checkpoint exists', () => {
      expect(bot.restoreLatestMemoryCheckpoint('g_no_checkpoint')).toBe(false);
    });
  });

  describe('abnormality event-hook registry', () => {
    it('delivers global and guild-scoped subscribers in registration order', () => {
      const seen: string[] = [];
      const unsubscribeGlobal = subscribeFacilityEvents((event, context) => {
        seen.push(`global:${context.guildId}:${event.type}`);
        return 'global message';
      });
      const unsubscribeGuild = subscribeFacilityEvents((event, context) => {
        seen.push(`guild:${context.guildId}:${event.type}`);
        return 'guild message';
      }, { guildId: 'g_bus_a' });
      const unsubscribeOther = subscribeFacilityEvents(() => {
        seen.push('wrong guild');
      }, { guildId: 'g_bus_b' });

      try {
        expect(emitFacilityEvent('g_bus_a', { type: 'day_started', day: 2 })).toEqual([
          'global message',
          'guild message'
        ]);
        expect(seen).toEqual([
          'global:g_bus_a:day_started',
          'guild:g_bus_a:day_started'
        ]);
      } finally {
        unsubscribeGlobal();
        unsubscribeGuild();
        unsubscribeOther();
      }

      emitFacilityEvent('g_bus_a', { type: 'day_started', day: 3 });
      expect(seen).toHaveLength(2);
    });

    it('uses a listener snapshot and isolates subscriber failures', () => {
      const seen: string[] = [];
      const originalConsoleError = console.error;
      console.error = () => {};
      let unsubscribeSecond = () => {};
      const unsubscribeFirst = subscribeFacilityEvents(() => {
        seen.push('first');
        unsubscribeSecond();
        throw new Error('listener failure');
      });
      unsubscribeSecond = subscribeFacilityEvents(() => {
        seen.push('second');
        return 'still delivered';
      });

      try {
        expect(emitFacilityEvent('g_bus_snapshot', { type: 'day_ended', day: 1 })).toEqual(['still delivered']);
        expect(seen).toEqual(['first', 'second']);
        seen.length = 0;
        expect(emitFacilityEvent('g_bus_snapshot', { type: 'day_ended', day: 2 })).toEqual([]);
        expect(seen).toEqual(['first']);
      } finally {
        unsubscribeFirst();
        unsubscribeSecond();
        console.error = originalConsoleError;
      }
    });

    it('routes facility events through abnormality hooks', () => {
      const guildId = 'g_event_bus';
      const scriptId = 'TEST-EVENT-HOOK';
      seedAbnormality(guildId, { id: 2, name: 'Signal B', script_id: scriptId });
      seedAbnormality(guildId, { id: 1, name: 'Signal A', script_id: scriptId });
      seedAbnormality(guildId, { id: 3, name: 'Unknown', script_id: 'UNKNOWN-SCRIPT' });
      seedAbnormality('g_event_bus_other', { id: 4, name: 'Other Guild', script_id: scriptId });
      const recorded: Array<{ guildId: string; abnormalityId: number; eventType: string }> = [];
      ABNORMALITY_SCRIPTS[scriptId] = {
        onFacilityEvent: (event, context) => {
          recorded.push({
            guildId: context.guildId,
            abnormalityId: Number(context.abnormality.id),
            eventType: event.type
          });
          return `status:${event.type}:${context.abnormality.id}`;
        }
      };

      try {
        const messages = emitFacilityEvent(guildId, { type: 'phase_changed', from: 8, to: 9 });
        expect(messages).toEqual(['status:phase_changed:1', 'status:phase_changed:2']);
        expect(recorded).toEqual([
          { guildId, abnormalityId: 1, eventType: 'phase_changed' },
          { guildId, abnormalityId: 2, eventType: 'phase_changed' }
        ]);
      } finally {
        delete ABNORMALITY_SCRIPTS[scriptId];
      }
    });

    it('publishes Qliphoth and breach events when a meltdown timer expires', () => {
      const guildId = 'g_bus_meltdown';
      const facility = {
        ...seedFacility(guildId),
        meltdown_alarm: 1,
        meltdown_targets: JSON.stringify([1])
      };
      seedAbnormality(guildId, {
        id: 1,
        name: 'Meltdown Target',
        qliphoth: 2,
        max_qliphoth: 2,
        meltdown_timer: 1,
        is_breaching: 0
      });
      const events: string[] = [];
      const unsubscribe = subscribeFacilityEvents(event => {
        if (event.type === 'qliphoth_changed') events.push(`${event.type}:${event.oldValue}->${event.newValue}`);
        else events.push(event.type);
      }, { guildId });

      try {
        const breached = __test.resolveMeltdownTimers(guildId, facility);
        expect(breached).toHaveLength(1);
        expect(events).toEqual(['qliphoth_changed:2->0', 'abnormality_breached']);
      } finally {
        unsubscribe();
      }
    });

    it('publishes spontaneous breaches only to the affected guild', async () => {
      const guildId = 'g_bus_spontaneous';
      const facility = seedFacility(guildId, { phase: 20, security_level: 1 });
      seedAbnormality(guildId, { id: 1, escape_chance: 1, is_breaching: 0, can_breach: 1 });
      const events: string[] = [];
      const unsubscribe = subscribeFacilityEvents(event => {
        events.push(event.type);
      }, { guildId });

      try {
        const breached = await withRandom([0], () => __test.maybeTriggerSpontaneousBreaches(guildId, facility));
        expect(breached).toHaveLength(1);
        expect(events).toEqual(['abnormality_breached']);
        __test.maybeTriggerSpontaneousBreaches('g_bus_unrelated', facility);
        expect(events).toEqual(['abnormality_breached']);
      } finally {
        unsubscribe();
      }
    });

    it('lets Scorched Girl lose Qliphoth after a bad result context', async () => {
      const abno: any = {
        name: 'Scorched Girl', script_id: 'F-01-02', qliphoth: 2, max_qliphoth: 2,
        can_breach: 1, is_breaching: 0
      };
      const note = await withRandom([0.1], () => ABNORMALITY_SCRIPTS['F-01-02']!.onWorkEnd?.(
        {},
        abno,
        'attachment',
        { result: 'bad', peBoxes: 0, neBoxes: 8, workLevel: 2, previousQliphoth: 2 }
      ));

      expect(abno.qliphoth).toBe(1);
      expect(abno.is_breaching).toBe(0);
      expect(note).toContain('MATCHLIGHT');
    });

    it('blocks Nothing There for insufficient Fortitude', () => {
      const abno = { name: 'Nothing There', script_id: 'O-06-20' };
      const agent: any = { name: 'Rookie', fortitude: 2, hp: 100, status: 'idle' };
      const result = bot.getAbnormalityScript(abno)?.onWorkStart?.(agent, abno, 'instinct');
      expect(result?.cancelled).toBe(true);
      expect(agent.status).toBe('dead');
      expect(agent.hp).toBe(0);
    });

    it('allows Nothing There when the Fortitude check passes', () => {
      const abno = { name: 'Nothing There', script_id: 'O-06-20' };
      const agent: any = { name: 'Veteran', fortitude: 5, hp: 100, status: 'idle' };
      expect(bot.getAbnormalityScript(abno)?.onWorkStart?.(agent, abno, 'instinct')).toBeNull();
      expect(agent.status).toBe('idle');
    });

    it('lets One Sin stabilize a panicked agent', () => {
      const abno = { name: 'One Sin', script_id: 'O-03-03' };
      const agent: any = { name: 'Emu', status: 'panicked', sp: 0, max_sp: 100 };
      const result = bot.getAbnormalityScript(abno)?.onWorkStart?.(agent, abno, 'insight');
      expect(result?.cancelled).toBe(false);
      expect(agent.status).toBe('idle');
      expect(agent.sp).toBeGreaterThanOrEqual(70);
    });

    it('lets Der Freischütz escalate rage after bad work', () => {
      const abno: any = { name: 'Der Freischütz', script_id: 'F-01-69', qliphoth: 2, max_qliphoth: 2, rage: 2 };
      const note = bot.getAbnormalityScript(abno)?.onWorkEnd?.({ justice: 4 }, abno, 'repression', 'bad');
      expect(abno.qliphoth).toBe(1);
      expect(abno.rage).toBe(4);
      expect(note).toContain('MAGIC BULLET');
    });

    it('lets Schadenfreude react to repeated observation', () => {
      const abno: any = { name: 'Schadenfreude', script_id: 'O-05-76', qliphoth: 2, max_qliphoth: 2, rage: 0 };
      const agent = { assignments: 3 };
      const result = bot.getAbnormalityScript(abno)?.onWorkStart?.(agent, abno, 'insight');
      expect(result?.cancelled).toBe(false);
      expect(abno.rage).toBe(1);
      expect(abno.qliphoth).toBe(1);
    });

    it('lets Happy Teddy Bear reject the same handler twice', () => {
      const abno = { name: 'Happy Teddy Bear', script_id: 'T-04-06', last_worked_by: 'emu' };
      const agent: any = { discord_id: 'emu', name: 'Emu', hp: 100, status: 'idle' };
      const result = bot.getAbnormalityScript(abno)?.onWorkStart?.(agent, abno, 'attachment');

      expect(result?.cancelled).toBe(true);
      expect(agent.hp).toBe(0);
      expect(agent.status).toBe('dead');
    });

    it('keeps Silent Orchestra stable on a normal result', () => {
      const abno: any = { name: 'The Silent Orchestra', script_id: 'T-01-31', qliphoth: 2, max_qliphoth: 2 };
      const note = bot.getAbnormalityScript(abno)?.onWorkEnd?.({}, abno, 'insight', 'normal');

      expect(abno.qliphoth).toBe(2);
      expect(note).toContain('INTERMISSION');
    });

    it('lets Funeral of the Dead Butterflies reject low Justice', () => {
      const abno: any = { name: 'Funeral of the Dead Butterflies', script_id: 'T-01-68', qliphoth: 2, max_qliphoth: 2 };
      const agent = { name: 'Rookie', justice: 2, fortitude: 2 };
      const result = bot.getAbnormalityScript(abno)?.onWorkStart?.(agent, abno, 'repression');

      expect(result?.cancelled).toBe(false);
      expect(abno.qliphoth).toBe(1);
      expect(result?.message).toContain('SOLEMN WARNING');
    });

    it('lets Judgement Bird execute an agent above its guilt threshold', () => {
      const abno = { name: 'Judgement Bird', script_id: 'O-02-62' };
      const agent: any = { name: 'Guilty', kills: 5, assignments: 12, fortitude: 1, hp: 100, status: 'idle' };
      const result = bot.getAbnormalityScript(abno)?.onWorkStart?.(agent, abno, 'instinct');
      expect(result?.cancelled).toBe(true);
      expect(agent.status).toBe('dead');
      expect(agent.hp).toBe(0);
    });

    it('lets Punishing Bird punish an attacker through its combat hook', () => {
      const abno = { name: 'Punishing Bird', script_id: 'O-02-56' };
      const agent: any = { hp: 100, status: 'idle' };
      const result = bot.getAbnormalityScript(abno)?.onCombat?.(agent, abno, 50);
      expect(result?.agentDamage).toBe(0);
      expect(result?.abnoDamage).toBe(9999);
      expect(agent.status).toBe('dead');
      expect(agent.hp).toBe(0);
    });

    it('lets Don\'t Touch Me breach every containment unit in its guild', () => {
      const guildId = 'g_dont_touch';
      seedAbnormality(guildId, { id: 1, name: 'A', is_breaching: 0, rage: 0 });
      seedAbnormality(guildId, { id: 2, name: "Don't Touch Me", script_id: 'DO-NOT-TOUCH', is_breaching: 0, rage: 0 });
      const agent: any = { name: 'Emu', guild_id: guildId, status: 'idle', sp: 100 };
      const result = bot.getAbnormalityScript({ script_id: 'DO-NOT-TOUCH' })?.onWorkStart?.(agent, { name: "Don't Touch Me" }, 'instinct');
      const rows = db.query(`SELECT * FROM abnormalities WHERE guild_id=?`).all(guildId) as any[];
      expect(result?.cancelled).toBe(true);
      expect(agent.status).toBe('panicked');
      expect(agent.sp).toBe(0);
      expect(rows.every(row => row.is_breaching === 1)).toBe(true);
      expect(rows.every(row => row.rage === 10)).toBe(true);
    });
  });
});
