/**
 * Game State Helpers — Travel, Departments, Meltdowns, Daily Events
 * 
 * Pure simulation logic for:
 * - Agent travel and department routing
 * - Department quest management and progression
 * - Meltdown/qliphoth escalation
 * - Daily event triggers and state resets
 * - Ordeal escalation
 * 
 * These functions do not depend on Discord and can be tested independently.
 */

import { db } from '../db/database';
import { json } from '../utils/json';
import { clamp } from '../utils/clamp';
import { rand, pick } from '../utils/random';
import type { DepartmentName, WorkType } from '../types/game';

// ==========================================
// 🚶 TRAVEL & DEPARTMENT ROUTING
// ==========================================

export const DEPARTMENT_SECTORS: Record<DepartmentName, string> = {
  general: 'central-command',
  control: 'control-dept',
  information: 'information-dept',
  security: 'security-dept',
  training: 'training-dept',
  command: 'central-command'
};

export const DEPARTMENT_CHAIN: DepartmentName[] = ['control', 'information', 'security', 'training', 'command'];

export const TRAVEL_DISTANCES: Record<string, Record<string, number>> = {
  control: { information: 2, security: 3, training: 4, command: 5, control: 0 },
  information: { control: 2, security: 2, training: 3, command: 4, information: 0 },
  security: { control: 3, information: 2, training: 2, command: 3, security: 0 },
  training: { control: 4, information: 3, security: 2, command: 2, training: 0 },
  command: { control: 5, information: 4, security: 3, training: 2, command: 0 }
};

export function getTravelDuration(origin: string, destination: string): number {
  return (TRAVEL_DISTANCES[origin] as any)?.[destination] ?? 3;
}

export function startAgentTravel(guildId: string, discordId: string, department: string) {
  const agent = db.query(`SELECT * FROM agents WHERE discord_id=? AND guild_id=?`).get(discordId, guildId) as any;
  if (!agent) return { success: false, error: 'agent not found' };

  const origin = agent.travel_origin || agent.department || 'control';
  if (origin === department) return { success: true, already_there: true };

  const duration = getTravelDuration(origin, department);
  db.query(`
    UPDATE agents SET travel_origin=?, travel_destination=?, travel_remaining=?
    WHERE discord_id=? AND guild_id=?
  `).run(origin, department, duration, discordId, guildId);

  return { success: true, duration, origin, destination: department };
}

export function resolveAgentTravel(guildId: string) {
  const agents = db.query(`SELECT * FROM agents WHERE guild_id=? AND travel_remaining>0`).all(guildId) as any[];
  for (const agent of agents) {
    agent.travel_remaining--;
    if (agent.travel_remaining <= 0) {
      agent.department = agent.travel_destination;
      agent.travel_origin = '';
      agent.travel_destination = '';
    }
    db.query(`
      UPDATE agents SET travel_remaining=?, department=?, travel_origin=?, travel_destination=?
      WHERE discord_id=? AND guild_id=?
    `).run(agent.travel_remaining, agent.department, agent.travel_origin, agent.travel_destination, agent.discord_id, guildId);
  }
}

export function getDepartmentRouteSummary(facility: any, agent?: any): string {
  const unlocked = evaluateDepartmentUnlocks(facility);
  const summary = unlocked
    .map((dept: string) => {
      const quest = db.query(`SELECT * FROM department_quests WHERE guild_id=? AND department=? AND complete=0 LIMIT 1`).get(
        facility.guild_id,
        dept
      ) as any;
      if (!quest) return `✓ **${dept}** (unlocked, no active quests)`;
      const progress = `${quest.progress}/${quest.goal}`;
      return `▶ **${dept}** — ${quest.description} [${progress}]`;
    })
    .join('\n');

  if (agent) {
    if (agent.travel_remaining > 0) {
      return summary + `\n\n🚶 **${agent.name}** is in transit to **${agent.travel_destination}** (arrives in ${agent.travel_remaining} phases)`;
    }
    return summary + `\n\n📍 **${agent.name}** is in **${agent.department || 'control'}**`;
  }

  return summary;
}

// ==========================================
// 📋 DEPARTMENT QUESTS
// ==========================================

export function ensureDepartmentQuestRows(guildId: string) {
  const existing = db.query(`SELECT COUNT(*) as count FROM department_quests WHERE guild_id=?`).get(guildId) as any;
  if (Number(existing?.count ?? 0) > 0) return;

  db.query(`INSERT INTO department_quests (guild_id, department, description, goal, progress, complete) VALUES (?, ?, ?, ?, ?, ?)`).run(
    guildId, 'control', 'Monitor the facility', 40, 0, 0
  );
}

export function evaluateDepartmentUnlocks(facility: any): string[] {
  const unlocked = ['control'];
  if (Number(facility?.energy ?? 0) >= 40) unlocked.push('information');
  if (Number(facility?.energy ?? 0) >= 100) unlocked.push('security');
  if (Number(facility?.energy ?? 0) >= 200) unlocked.push('training');
  if (Number(facility?.energy ?? 0) >= 350) unlocked.push('command');
  return unlocked;
}

export function syncDepartmentUnlocks(guildId: string, facility: any) {
  const unlocked = evaluateDepartmentUnlocks(facility);
  const current = JSON.parse(facility?.department_unlocks ?? '[]') as string[];

  for (const dept of DEPARTMENT_CHAIN) {
    if (unlocked.includes(dept) && !current.includes(dept)) {
      const next = DEPARTMENT_CHAIN[DEPARTMENT_CHAIN.indexOf(dept) + 1];
      if (next && !current.includes(next)) {
        db.query(`
          INSERT INTO department_quests (guild_id, department, description, goal, progress, complete)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(guildId, next, `Complete the ${next} objectives`, 40, 0, 0);
      }
      current.push(dept);
    }
  }

  if (JSON.stringify(current.sort()) !== JSON.stringify(unlocked.sort())) {
    db.query(`UPDATE facility SET department_unlocks=? WHERE guild_id=?`).run(json(unlocked), guildId);
  }
}

export function updateDepartmentQuestProgress(guildId: string, department: string, delta: number) {
  const quest = db.query(`SELECT * FROM department_quests WHERE guild_id=? AND department=? AND complete=0 LIMIT 1`).get(guildId, department) as any;
  if (!quest) return false;

  const newProgress = clamp(Number(quest?.progress ?? 0) + delta, 0, Number(quest?.goal ?? 40));
  const complete = newProgress >= Number(quest?.goal ?? 40) ? 1 : 0;

  db.query(`UPDATE department_quests SET progress=?, complete=? WHERE guild_id=? AND department=? AND goal=?`).run(
    newProgress, complete, guildId, department, quest.goal
  );

  return complete === 1;
}

export function recordDepartmentProgress(guildId: string, department: string, delta: number) {
  const completed = updateDepartmentQuestProgress(guildId, department, delta);
  if (completed) {
    db.query(`INSERT OR IGNORE INTO department_quests (guild_id, department, description, goal, progress, complete) VALUES (?, ?, ?, ?, ?, ?)`).run(
      guildId, department, `Continue operations in ${department}`, 60, 0, 0
    );
  }
}

export function travelToDepartment(guildId: string, department: string) {
  const result = db.query(`SELECT * FROM department_quests WHERE guild_id=? AND department=?`).get(guildId, department) as any;
  if (!result) return { unlocked: false };

  return { unlocked: true, department, description: result?.description ?? '' };
}

// ==========================================
// 🔴 MELTDOWNS & QLIPHOTH
// ==========================================

export function triggerMeltdownAlarm(guildId: string, facility: any) {
  const breaches = db.query(`SELECT * FROM abnormalities WHERE guild_id=? AND is_breaching=0 ORDER BY qliphoth ASC LIMIT 3`).all(guildId) as any[];
  if (!breaches.length) return false;

  const targets = breaches.map((b: any) => ({ id: b.id, name: b.name, qliphoth: b.qliphoth }));
  db.query(`UPDATE facility SET meltdown_alarm=1, meltdown_targets=? WHERE guild_id=?`).run(json(targets), guildId);
  return true;
}

export function resolveMeltdownTimers(guildId: string, facility: any): any[] {
  const abnos = db.query(`SELECT * FROM abnormalities WHERE guild_id=?`).all(guildId) as any[];
  const breached: any[] = [];

  for (const abno of abnos) {
    if (Number(abno.meltdown_timer ?? 0) <= 0) continue;

    const newTimer = Number(abno.meltdown_timer) - 1;
    if (newTimer <= 0) {
      abno.is_breaching = 1;
      breached.push(abno);
      db.query(`UPDATE abnormalities SET is_breaching=1, meltdown_timer=0, meltdown_state='meltdown' WHERE id=?`).run(abno.id);
    } else {
      db.query(`UPDATE abnormalities SET meltdown_timer=? WHERE id=?`).run(newTimer, abno.id);
    }
  }

  return breached;
}

// ==========================================
// ⏰ DAILY EVENTS & RESET
// ==========================================

export function resolveDailyRecovery(guildId: string) {
  const agents = db.query(`SELECT * FROM agents WHERE guild_id=? AND recovery_days>0`).all(guildId) as any[];
  for (const agent of agents) {
    agent.recovery_days = Math.max(0, Number(agent.recovery_days) - 1);
    if (agent.recovery_days <= 0) {
      agent.status = 'idle';
      agent.sp = agent.max_sp;
      agent.panic_turns = 0;
      agent.panic_behavior = '';
    }
    db.query(`UPDATE agents SET recovery_days=?, status=?, sp=?, panic_turns=0, panic_behavior='' WHERE discord_id=? AND guild_id=?`).run(
      agent.recovery_days, agent.status, agent.sp, agent.discord_id, guildId
    );
  }
}

export function resetDailyOperationalState(guildId: string) {
  db.query(`UPDATE abnormalities SET meltdown_alarm=0, meltdown_targets='[]' WHERE guild_id=?`).run(guildId);
}

export function runDailyEvent(guildId: string, facility: any): string | null {
  const eventRoll = Math.random();
  let seed = Number(facility?.event_seed ?? Math.random());
  Math.random = () => {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
  };

  if (eventRoll < 0.30) {
    const variation = rand(-5, 15);
    db.query(`UPDATE facility SET research=CASE WHEN research+?<0 THEN 0 ELSE research+? END WHERE guild_id=?`).run(variation, variation, guildId);
    return `🔬 a research fluctuation occurred! research ${variation > 0 ? '+' : ''}${variation}%.`;
  }

  if (eventRoll < 0.60) {
    const welfare = rand(-2, 8);
    db.query(`UPDATE facility SET welfare_level=CASE WHEN welfare_level+?<1 THEN 1 ELSE welfare_level+? END WHERE guild_id=?`).run(welfare, welfare, guildId);
    return `📦 welfare supplies arrived! welfare level ${welfare > 0 ? '+' : ''}${welfare}.`;
  }

  return null;
}

export function maybeTriggerSpontaneousBreaches(guildId: string, facility: any): any[] {
  const breaches: any[] = [];
  const containment = Number(facility?.containment_level ?? 1);
  const abnos = db.query(`SELECT * FROM abnormalities WHERE guild_id=? AND can_breach=1 AND is_breaching=0 ORDER BY RANDOM() LIMIT 5`).all(guildId) as any[];

  for (const abno of abnos) {
    const escapeThreshold = (Number(abno.escape_chance) || 0.1) * containment;
    if (Math.random() < escapeThreshold) {
      abno.is_breaching = 1;
      breaches.push(abno);
      db.query(`UPDATE abnormalities SET is_breaching=1 WHERE id=?`).run(abno.id);
    }
  }

  return breaches;
}

// ==========================================
// 🏛️ ORDEALS
// ==========================================

export const ORDEAL_STAGES = [
  { threshold: 150, color: 'amber', label: 'Amber Ordeal' },
  { threshold: 300, color: 'crimson', label: 'Crimson Ordeal' },
  { threshold: 500, color: 'green', label: 'Green Ordeal' }
] as const;

export function maybeTriggerOrdeal(guildId: string, facility: any) {
  if (!facility || facility.ordeal_active) return false;
  for (const stage of ORDEAL_STAGES) {
    if (Number(facility.energy) >= stage.threshold) {
      const color = stage.color;
      const expiresAt = Date.now() + 60000;
      db.query(`UPDATE facility SET ordeal_active=1, active_ordeal=?, ordeal_timer=? WHERE guild_id=?`).run(color, expiresAt, guildId);
      db.query(`INSERT INTO ordeal_events (guild_id, color, threshold, active, expires_at) VALUES (?, ?, ?, 1, ?)`).run(guildId, color, stage.threshold, expiresAt);
      return true;
    }
  }
  return false;
}
