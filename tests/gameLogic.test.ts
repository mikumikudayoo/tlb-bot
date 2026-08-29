import { describe, it, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';

process.env.DISCORD_TOKEN = 'test-token';

import * as botModule from '../index.ts';
import { resolvePanicBehavior, createMemoryCheckpoint, evaluateDepartmentUnlocks, updateDepartmentQuestProgress, ensureDepartmentQuestRows, travelToDepartment } from '../index.ts';

const moduleDb = botModule.db;

function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(val, min), max);
}

function calculateWorkChance(agentStat: number, abnoWorkRate: number, riskLevel: string): number {
  const baseRate = agentStat * 0.15 + abnoWorkRate;
  const riskPenalty = riskLevel === 'ALEPH' ? 0.2 : riskLevel === 'WAW' ? 0.1 : 0;
  return clamp(baseRate - riskPenalty, 0.05, 0.95);
}

function applyDamage(agent: { hp: number; sp: number; max_hp: number; max_sp: number; status: string }, amount: number, type: string) {
  if (type === 'R' || type === 'RED') {
    agent.hp -= amount;
  } else if (type === 'W' || type === 'WHITE') {
    agent.sp -= amount;
  } else if (type === 'B' || type === 'BLACK') {
    agent.hp -= amount * 0.5;
    agent.sp -= amount * 0.5;
  }

  if (agent.hp <= 0) {
    agent.hp = 0;
    agent.status = 'dead';
  } else if (agent.sp <= 0) {
    agent.sp = 0;
    agent.status = 'panicked';
  }
  return agent;
}

describe('Lobotomy Game Engine Logic Tests', () => {
  let db: Database;

  beforeEach(() => {
    // In-memory SQLite DB using Bun's native C implementation
    db = new Database(':memory:');
    db.run(`
      CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        guild_id TEXT,
        name TEXT,
        hp INTEGER,
        max_hp INTEGER,
        sp INTEGER,
        max_sp INTEGER,
        status TEXT
      );
      CREATE TABLE abnormalities (
        id INTEGER PRIMARY KEY,
        guild_id TEXT,
        name TEXT,
        is_breaching INTEGER DEFAULT 0
      );
      CREATE TABLE facility (
        guild_id TEXT PRIMARY KEY,
        manager_id TEXT,
        dictator_mode INTEGER DEFAULT 0,
        day_count INTEGER DEFAULT 1,
        department_unlocks TEXT DEFAULT '[]',
        current_sector TEXT DEFAULT 'control'
      );
    `);
  });

  describe('Mathematical Boundary Clamping', () => {
    it('should clamp success chance between 5% and 95%', () => {
      const maxChance = calculateWorkChance(100, 0.8, 'ZAYIN');
      expect(maxChance).toBe(0.95);

      const minChance = calculateWorkChance(0, -0.5, 'ALEPH');
      expect(minChance).toBe(0.05);
    });

    it('should correctly set status to dead when HP reaches 0', () => {
      const agent = { hp: 20, sp: 50, max_hp: 50, max_sp: 50, status: 'ok' };
      const result = applyDamage(agent, 25, 'RED');
      expect(result.hp).toBe(0);
      expect(result.status).toBe('dead');
    });

    it('should correctly set status to panicked when SP reaches 0', () => {
      const agent = { hp: 50, sp: 10, max_hp: 50, max_sp: 50, status: 'ok' };
      const result = applyDamage(agent, 15, 'WHITE');
      expect(result.sp).toBe(0);
      expect(result.status).toBe('panicked');
    });
  });

  describe('Database State Integrity', () => {
    it('should block non-managers when dictator mode is active', () => {
      db.run(`INSERT INTO facility (guild_id, manager_id, dictator_mode) VALUES (?, ?, ?)`, ['guild_123', 'manager_456', 1]);

      const facility = db.query(`SELECT * FROM facility WHERE guild_id = ?`).get('guild_123') as any;
      const actingUserId = 'agent_789';

      const canExecute = !facility.dictator_mode || facility.manager_id === actingUserId;
      expect(canExecute).toBe(false);
    });

    it('should correctly prevent breaching abnormalities from appearing in work lists', () => {
      db.run(`INSERT INTO abnormalities (id, guild_id, name, is_breaching) VALUES (?, ?, ?, ?)`, [1, 'guild_123', 'One Sin', 0]);
      db.run(`INSERT INTO abnormalities (id, guild_id, name, is_breaching) VALUES (?, ?, ?, ?)`, [2, 'guild_123', 'Red Shoes', 1]);

      const availableAbnos = db.query(`SELECT * FROM abnormalities WHERE guild_id=? AND is_breaching=0`).all('guild_123') as any[];

      expect(availableAbnos.length).toBe(1);
      expect(availableAbnos[0].name).toBe('One Sin');
    });
  });

  describe('Work visual roll mapping', () => {
    it('should render PE and NE boxes from the actual split roll counts', () => {
      const buildPEVisualString = (positive: number, negative: number) => {
        const boxIcons: string[] = [];

        for (let i = 0; i < positive; i++) {
          boxIcons.push('🟩 PE');
        }

        for (let i = 0; i < negative; i++) {
          boxIcons.push('💔 NE');
        }

        return boxIcons.join(' · ');
      };

      expect(buildPEVisualString(3, 2)).toBe('🟩 PE · 🟩 PE · 🟩 PE · 💔 NE · 💔 NE');
      expect(buildPEVisualString(0, 4)).toBe('💔 NE · 💔 NE · 💔 NE · 💔 NE');
    });

    it('should use a full-value Qliphoth icon when at max, else the reduced icon', () => {
      const getQliphothDisplayIcon = (current: number, max: number) => current === max ? '💎' : '🔻';

      expect(getQliphothDisplayIcon(3, 3)).toBe('💎');
      expect(getQliphothDisplayIcon(2, 3)).toBe('🔻');
    });
  });

  describe('Reset loop and panic logic', () => {
    it('should resolve a panic action from the dominant stat', () => {
      const prudenceAgent = { sp: 0, fortitude: 1, prudence: 6, temperance: 2, justice: 3 };
      const fortitudeAgent = { sp: 0, fortitude: 8, prudence: 1, temperance: 2, justice: 3 };

      expect(resolvePanicBehavior(prudenceAgent)).toContain('breach');
      expect(resolvePanicBehavior(fortitudeAgent)).toContain('containment');
    });

    it('should create a checkpoint snapshot for the facility', () => {
      const created = createMemoryCheckpoint('guild_reset_test', { day_count: 7, energy: 40, quota: 120 });
      expect(created).toBe(true);
    });
  });

  describe('Department routing and quests', () => {
    it('should unlock departments based on facility day progression', () => {
      const unlocked = evaluateDepartmentUnlocks({ day_count: 5, department_unlocks: '[]' });
      expect(unlocked).toContain('control');
      expect(unlocked).toContain('information');
      expect(unlocked).toContain('security');
      expect(unlocked).toContain('training');
    });

    it('should advance and complete a quest when the target is reached', () => {
      moduleDb.run(`CREATE TABLE IF NOT EXISTS department_quests (guild_id TEXT, department TEXT, description TEXT, goal TEXT, progress INTEGER DEFAULT 0, complete INTEGER DEFAULT 0, PRIMARY KEY (guild_id, department, goal))`);
      ensureDepartmentQuestRows('guild_department_test');
      const before = updateDepartmentQuestProgress('guild_department_test', 'security', 2);
      const row = moduleDb.query(`SELECT * FROM department_quests WHERE guild_id=? AND department=? AND goal=?`).get('guild_department_test', 'security', 'suppress 2 breaches') as any;

      expect(before).toBe(2);
      expect(row.progress).toBe(2);
      expect(row.complete).toBe(1);
    });

    it('should travel to an unlocked department and update the current sector', () => {
      moduleDb.query(`DELETE FROM facility WHERE guild_id=?`).run('guild_route_test');
      moduleDb.run(`INSERT INTO facility (guild_id, manager_id, day_count, department_unlocks, current_sector) VALUES (?, ?, ?, ?, ?)`, ['guild_route_test', 'manager_1', 5, JSON.stringify(['control', 'information', 'security']), 'control']);

      const result = travelToDepartment('guild_route_test', 'security');
      const row = moduleDb.query(`SELECT * FROM facility WHERE guild_id=?`).get('guild_route_test') as any;

      expect(result).toBe('security');
      expect(row.current_sector).toBe('security');
    });
  });

  describe('Event hook system', () => {
    it('should cancel work with onWorkStart hook when Nothing There fortitude check fails', () => {
      // Import the hook system directly from index
      const { getAbnormalityScript } = botModule;
      
      // Create Nothing There abnormality with script_id
      const nothingThere = {
        id: 'nothing_there_1',
        name: 'Nothing There',
        risk: 'ALEPH',
        script_id: 'O-06-20',
        damage_amt: 30,
        damage_type: 'RED'
      };

      // Create low-fortitude agent
      const weakAgent = {
        id: 'weak_agent',
        name: 'Rookie',
        hp: 100,
        max_hp: 100,
        sp: 100,
        max_sp: 100,
        fortitude: 2,  // Below the threshold of 4
        status: 'active'
      };

      // Get the script and test onWorkStart
      const script = getAbnormalityScript(nothingThere);
      expect(script).toBeDefined();
      
      const result = script?.onWorkStart?.(weakAgent, nothingThere, 'instinct');
      expect(result?.cancelled).toBe(true);
      expect(result?.message).toContain('💀');
      expect(weakAgent.status).toBe('dead');
      expect(weakAgent.hp).toBe(0);
    });

    it('should allow work when onWorkStart hook fortitude check passes', () => {
      const { getAbnormalityScript } = botModule;
      
      const nothingThere = {
        id: 'nothing_there_2',
        name: 'Nothing There',
        risk: 'ALEPH',
        script_id: 'O-06-20',
        damage_amt: 30,
        damage_type: 'RED'
      };

      // Create strong agent
      const strongAgent = {
        id: 'strong_agent',
        name: 'Veteran',
        hp: 100,
        max_hp: 100,
        sp: 100,
        max_sp: 100,
        fortitude: 5,  // Above the threshold of 4
        status: 'active'
      };

      const script = getAbnormalityScript(nothingThere);
      const result = script?.onWorkStart?.(strongAgent, nothingThere, 'instinct');
      expect(result).toBeNull();  // No cancellation
      expect(strongAgent.status).toBe('active');  // Unchanged
    });

    it('should apply onCombat hook damage modification for Punishing Bird', () => {
      const { getAbnormalityScript } = botModule;
      
      const punishingBird = {
        id: 'punishing_bird_1',
        name: 'Punishing Bird',
        risk: 'ALEPH',
        script_id: 'O-02-56',
        damage_amt: 25,
        damage_type: 'RED'
      };

      const attacker = {
        id: 'attacker',
        name: 'Agent',
        hp: 100,
        max_hp: 100,
        sp: 100,
        max_sp: 100,
        status: 'active'
      };

      const script = getAbnormalityScript(punishingBird);
      const incomingDamage = 50;
      const result = script?.onCombat?.(attacker, punishingBird, incomingDamage);
      
      expect(result?.agentDamage).toBe(0);  // Attacker takes no damage
      expect(result?.abnoDamage).toBe(9999);  // Punishing Bird takes massive damage
      expect(attacker.status).toBe('dead');  // Attacker dies
    });

    it('should restore SP and calm the agent for One Sin and Hundreds of Good Deeds', () => {
      const { getAbnormalityScript } = botModule;

      const oneSin = {
        id: 'one_sin_1',
        name: 'One Sin and Hundreds of Good Deeds',
        risk: 'ZAYIN',
        script_id: 'F-01-02',
        max_sp: 80
      };

      const agent = {
        id: 'helper',
        name: 'Helper',
        hp: 70,
        max_hp: 100,
        sp: 12,
        max_sp: 80,
        status: 'panicked',
        assignments: 4,
        fortitude: 2,
        kills: 0
      };

      const script = getAbnormalityScript(oneSin);
      const result = script?.onWorkStart?.(agent, oneSin, 'repression');

      expect(result?.cancelled).toBe(false);
      expect(agent.status).toBe('idle');
      expect(agent.sp).toBeGreaterThanOrEqual(56);
    });

    it('should trigger the Judgement Bird execution check when guilt exceeds the threshold', () => {
      const { getAbnormalityScript } = botModule;

      const judgementBird = {
        id: 'judgement_bird_1',
        name: 'Judgement Bird',
        risk: 'ALEPH',
        script_id: 'O-02-62'
      };

      const agent = {
        id: 'guilty',
        name: 'Guilty Agent',
        hp: 100,
        max_hp: 100,
        sp: 100,
        max_sp: 100,
        status: 'active',
        kills: 5,
        assignments: 12,
        fortitude: 1
      };

      const script = getAbnormalityScript(judgementBird);
      const result = script?.onWorkStart?.(agent, judgementBird, 'instinct');

      expect(result?.cancelled).toBe(true);
      expect(agent.status).toBe('dead');
      expect(agent.hp).toBe(0);
    });

    it('should trigger a catastrophic facility-wide breach for Don\'t Touch Me', () => {
      const { getAbnormalityScript, db } = botModule;

      db.run(`DELETE FROM abnormalities WHERE guild_id = ?`, ['guild_dont_touch_test']);
      db.run(`INSERT INTO abnormalities (guild_id, name, risk, hp, max_hp, qliphoth, max_qliphoth, damage_type, damage_amt, is_breaching, behaviour, description, script_id, can_breach, is_tool) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        'guild_dont_touch_test', 'Punishing Bird', 'ALEPH', 100, 100, 2, 2, 'RED', 30, 0, 'predatory', 'test', 'O-02-56', 1, 0
      ]);
      db.run(`INSERT INTO abnormalities (guild_id, name, risk, hp, max_hp, qliphoth, max_qliphoth, damage_type, damage_amt, is_breaching, behaviour, description, script_id, can_breach, is_tool) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        'guild_dont_touch_test', 'Don\'t Touch Me', 'ALEPH', 150, 150, 2, 2, 'RED', 40, 0, 'predatory', 'a troll anomaly', 'DO-NOT-TOUCH', 1, 0
      ]);

      const agent = {
        id: 'troll_agent',
        name: 'Troll Agent',
        guild_id: 'guild_dont_touch_test',
        hp: 60,
        max_hp: 100,
        sp: 80,
        max_sp: 100,
        status: 'active',
        assignments: 1,
        kills: 1
      };

      const script = getAbnormalityScript({ script_id: 'DO-NOT-TOUCH' });
      const result = script?.onWorkStart?.(agent, { name: 'Don\'t Touch Me' }, 'instinct');

      const rows = db.query(`SELECT * FROM abnormalities WHERE guild_id = ?`).all('guild_dont_touch_test') as any[];
      expect(result).toBeTruthy();
      expect(agent.status).toBe('panicked');
      expect(agent.sp).toBe(0);
      expect(rows.every((row: any) => row.is_breaching === 1)).toBe(true);
      expect(rows.every((row: any) => row.rage === 10)).toBe(true);
    });
  });
});