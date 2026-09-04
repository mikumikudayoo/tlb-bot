import { db } from './database';
import { initializeProgressionSchema } from '../game/progression';

export function addColumnIfMissing(table: string, column: string, definition: string) {
  const columns = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some(c => c.name === column)) {
    db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

export function initializeSchema() {
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
      death_count INTEGER DEFAULT 0,
      panic_turns INTEGER DEFAULT 0,
      panic_behavior TEXT DEFAULT '',
      PRIMARY KEY (guild_id, discord_id)
    )
  `).run();

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
        death_count INTEGER DEFAULT 0,
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

  for (const [column, definition] of [
    ['level', 'INTEGER DEFAULT 1'], ['fortitude', 'INTEGER DEFAULT 1'], ['prudence', 'INTEGER DEFAULT 1'],
    ['temperance', 'INTEGER DEFAULT 1'], ['justice', 'INTEGER DEFAULT 1'], ['experience', 'INTEGER DEFAULT 0'],
    ['trait', "TEXT DEFAULT 'calm'"], ['recovery_days', 'INTEGER DEFAULT 0'], ['assignments', 'INTEGER DEFAULT 0'],
    ['kills', 'INTEGER DEFAULT 0'], ['promotions', 'INTEGER DEFAULT 0'], ['death_count', 'INTEGER DEFAULT 0'],
    ['ego_gifts', "TEXT DEFAULT '[]'"], ['equipped_gift', "TEXT DEFAULT ''"], ['department', "TEXT DEFAULT 'general'"], ['auto_response', "TEXT DEFAULT ''"],
    ['travel_origin', "TEXT DEFAULT ''"], ['travel_destination', "TEXT DEFAULT ''"], ['travel_remaining', 'INTEGER DEFAULT 0'],
    ['panic_turns', 'INTEGER DEFAULT 0'], ['panic_behavior', "TEXT DEFAULT ''"],
    ['stat_limit', 'INTEGER DEFAULT 100'], ['pe_boxes', 'INTEGER DEFAULT 0'],
    ['stim_charges', "TEXT DEFAULT '{\"health\":2,\"sanity\":2,\"red\":1,\"white\":1,\"black\":1,\"pale\":0}'"],
    ['shield_red', 'INTEGER DEFAULT 0'], ['shield_white', 'INTEGER DEFAULT 0'],
    ['shield_black', 'INTEGER DEFAULT 0'], ['shield_pale', 'INTEGER DEFAULT 0']
  ] as const) addColumnIfMissing('agents', column, definition);

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

  initializeProgressionSchema();
}

initializeSchema();
