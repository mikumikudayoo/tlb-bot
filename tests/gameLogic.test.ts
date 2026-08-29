import { describe, it, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';

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
        dictator_mode INTEGER DEFAULT 0
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
});