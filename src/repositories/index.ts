/**
 * Repositories — Database abstraction layer
 * 
 * All SQL queries and database interactions for agents, abnormalities, facilities, 
 * relationships, observations, and game state are consolidated here.
 * This keeps data access separated from Discord event handlers and game simulation.
 */

import { db } from '../db/database';
import { json } from '../utils/json';
import { clamp } from '../utils/clamp';
import { getWorkType } from '../config/workTypes';
import type { WorkType, GiftDef } from '../types/game';

// ==========================================
// 📋 AGENT KNOWLEDGE & OBSERVATIONS
// ==========================================

export function ensureAgentKnowledge(guildId: string, discordId: string, abnormalityId: number) {
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

export function getAgentKnowledge(guildId: string, discordId: string, abnormalityId: number) {
  return ensureAgentKnowledge(guildId, discordId, abnormalityId);
}

export function totalUniquePE(knowledge: any) {
  return ['instinct_pe', 'insight_pe', 'attachment_pe', 'repression_pe']
    .reduce((sum, key) => sum + clamp(Number(knowledge?.[key] ?? 0), 0, 2), 0);
}

export function updateAgentKnowledge(
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

export function getObservationConfidence(attempts: number) {
  if (attempts >= 10) return 'confirmed';
  if (attempts >= 7) return 'consistent';
  if (attempts >= 4) return 'probable';
  if (attempts >= 2) return 'suspected';
  return 'unconfirmed';
}

export function getAgentObservations(guildId: string, discordId: string, abnormalityId: number) {
  return db.query(`
    SELECT * FROM agent_abnormality_observations
    WHERE guild_id=? AND discord_id=? AND abnormality_id=?
    ORDER BY work_type
  `).all(guildId, discordId, abnormalityId) as any[];
}

// ==========================================
// 💝 AGENT RELATIONSHIPS
// ==========================================

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

export function recordSharedShiftRelationships(guildId: string, workerId: string, result: 'good' | 'normal' | 'bad' | 'critical') {
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

export function getRelationshipLabel(trust: number) {
  if (trust >= 6) return 'trusting';
  if (trust >= 2) return 'friendly';
  if (trust <= -6) return 'uneasy';
  if (trust <= -2) return 'distrustful';
  return 'neutral';
}

// ==========================================
// 👤 AGENT QUERIES & UPDATES
// ==========================================

export function findAgent(userId: string, guildId?: string) {
  if (guildId) return db.query(`SELECT * FROM agents WHERE discord_id = ? AND guild_id = ?`).get(userId, guildId) as any;
  return db.query(`SELECT * FROM agents WHERE discord_id = ?`).get(userId) as any;
}

export function adoptLegacyAgent(discordId: string, guildId: string) {
  const legacy = db.query(`SELECT * FROM agents WHERE discord_id = ? AND guild_id = ''`).get(discordId) as any;
  if (!legacy) return;
  const existing = db.query(`SELECT * FROM agents WHERE discord_id = ? AND guild_id = ?`).get(discordId, guildId) as any;
  if (existing) return;
  db.query(`UPDATE agents SET guild_id = ? WHERE discord_id = ? AND guild_id = ''`).run(guildId, discordId);
}

export function getTrait(agent: any) {
  return agent?.trait ?? 'calm';
}

export function getSuit(agent: any) {
  return agent?.suit ?? 'basic_suit';
}

export function getWeapon(agent: any) {
  return agent?.weapon ?? 'riot_stick';
}

export function getGift(agent: any): GiftDef | null {
  const giftId = agent?.equipped_gift;
  if (!giftId) return null;
  // This will be populated from EGO_GIFTS in the main module
  return (globalThis as any).__EGO_GIFTS?.[giftId] ?? null;
}

export function updateAgent(agent: any) {
  db.query(`
    UPDATE agents
    SET hp=?, max_hp=?, sp=?, max_sp=?, status=?, level=?, fortitude=?, prudence=?,
        temperance=?, justice=?, experience=?, trait=?, recovery_days=?, assignments=?,
        kills=?, promotions=?, ego_gifts=?, equipped_gift=?, department=?, auto_response=?,
        travel_origin=?, travel_destination=?, travel_remaining=?, panic_turns=?, panic_behavior=?, death_count=?
    WHERE discord_id=? AND guild_id=?
  `).run(
    agent.hp, agent.max_hp, agent.sp, agent.max_sp, agent.status, agent.level,
    agent.fortitude, agent.prudence, agent.temperance, agent.justice, agent.experience,
    agent.trait, agent.recovery_days, agent.assignments, agent.kills, agent.promotions,
    json(agent.ego_gifts ?? []), agent.equipped_gift, agent.department, agent.auto_response,
    agent.travel_origin, agent.travel_destination, agent.travel_remaining,
    agent.panic_turns, agent.panic_behavior, Math.max(0, Number(agent.death_count ?? 0)), agent.discord_id, agent.guild_id
  );
}

// ==========================================
// 🏢 FACILITY QUERIES & UPDATES
// ==========================================

export function ensureFacility(guildId: string, managerId: string) {
  db.query(`INSERT OR IGNORE INTO facility (guild_id, manager_id) VALUES (?, ?)`).run(guildId, managerId);
  let facility = db.query(`SELECT * FROM facility WHERE guild_id = ?`).get(guildId) as any;

  if (!facility) {
    db.query(`INSERT INTO facility (guild_id, manager_id) VALUES (?, ?)`).run(guildId, managerId);
    facility = db.query(`SELECT * FROM facility WHERE guild_id = ?`).get(guildId) as any;
  } else if (facility.manager_id !== managerId) {
    db.query(`UPDATE facility SET manager_id = ? WHERE guild_id = ?`).run(managerId, guildId);
  }

  if (!facility.meltdown_targets || !Number(facility.meltdown_alarm)) {
    db.query(`UPDATE facility SET meltdown_targets='[]' WHERE guild_id=?`).run(guildId);
  }
  if (!facility.ordeal_active) {
    db.query(`UPDATE facility SET ordeal_active=0, active_ordeal='', ordeal_timer=0 WHERE guild_id=?`).run(guildId);
  }

  return facility;
}

export function logEvent(guildId: string, day: number, phase: number, type: string, message: string) {
  db.query(`INSERT INTO facility_events (guild_id, day, phase, type, message) VALUES (?, ?, ?, ?, ?)`).run(
    guildId, day, phase, type, message
  );
}

// ==========================================
// 💾 SAVE/CHECKPOINT SYSTEM
// ==========================================

export function createMemoryCheckpoint(guildId: string, facility: any) {
  db.query(`INSERT INTO memory_checkpoints (guild_id, day_count, energy, quota, facility_json) VALUES (?, ?, ?, ?, ?)`).run(
    guildId, facility.day_count, facility.energy, facility.quota, json(facility)
  );
  db.query(`
    DELETE FROM memory_checkpoints
    WHERE guild_id=? AND id NOT IN (
      SELECT id FROM memory_checkpoints WHERE guild_id=? ORDER BY id DESC LIMIT 5
    )
  `).run(guildId, guildId);
}

export function loadLatestCheckpoint(guildId: string): boolean {
  const latest = db.query(`SELECT * FROM memory_checkpoints WHERE guild_id = ? ORDER BY id DESC LIMIT 1`).get(guildId) as any;
  if (!latest || !latest.facility_json) return false;

  db.query(`UPDATE facility SET day_count=?, energy=?, quota=? WHERE guild_id=?`).run(latest.day_count, latest.energy, latest.quota, guildId);
  return true;
}

export function serializeFacility(guildId: string): string {
  const facility = db.query(`SELECT * FROM facility WHERE guild_id = ?`).get(guildId) as any;
  const agents = db.query(`SELECT * FROM agents WHERE guild_id = ?`).all(guildId) as any[];
  const abnormalities = db.query(`SELECT * FROM abnormalities WHERE guild_id = ?`).all(guildId) as any[];

  return json({ facility, agents, abnormalities });
}

export function restoreState(guildId: string, stateJson: string): boolean {
  try {
    const state = JSON.parse(stateJson);
    if (!state.facility || !Array.isArray(state.agents) || !Array.isArray(state.abnormalities)) return false;

    db.query(`DELETE FROM agents WHERE guild_id = ?`).run(guildId);
    db.query(`DELETE FROM abnormalities WHERE guild_id = ?`).run(guildId);

    db.query(`UPDATE facility SET day_count=?, energy=?, quota=? WHERE guild_id = ?`).run(
      state.facility.day_count, state.facility.energy, state.facility.quota, guildId
    );

    for (const agent of state.agents) {
      db.query(`
        INSERT INTO agents (discord_id, guild_id, name, hp, max_hp, sp, max_sp, weapon, suit, status,
          level, fortitude, prudence, temperance, justice, experience, trait, recovery_days,
          assignments, kills, promotions, ego_gifts, equipped_gift, department, auto_response,
          travel_origin, travel_destination, travel_remaining, panic_turns, panic_behavior, death_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        agent.discord_id, agent.guild_id, agent.name, agent.hp, agent.max_hp, agent.sp, agent.max_sp,
        agent.weapon, agent.suit, agent.status, agent.level, agent.fortitude, agent.prudence,
        agent.temperance, agent.justice, agent.experience, agent.trait, agent.recovery_days,
        agent.assignments, agent.kills, agent.promotions, agent.ego_gifts, agent.equipped_gift,
        agent.department, agent.auto_response, agent.travel_origin, agent.travel_destination,
        agent.travel_remaining, agent.panic_turns, agent.panic_behavior, Math.max(0, Number(agent.death_count ?? 0))
      );
    }

    for (const abno of state.abnormalities) {
      db.query(`
        INSERT INTO abnormalities (id, guild_id, name, risk, hp, max_hp, qliphoth, max_qliphoth,
          damage_type, damage_amt, is_breaching, work_instinct, work_insight, work_attachment,
          work_repression, escape_chance, behaviour, description, rage, breaches, suppressed_count,
          last_worked_by, work_streak, gift_id, current_work_process, meltdown_timer, meltdown_state,
          sector, observation_level, research_points, can_breach, is_tool, script_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        abno.id, abno.guild_id, abno.name, abno.risk, abno.hp, abno.max_hp, abno.qliphoth, abno.max_qliphoth,
        abno.damage_type, abno.damage_amt, abno.is_breaching, abno.work_instinct, abno.work_insight,
        abno.work_attachment, abno.work_repression, abno.escape_chance, abno.behaviour, abno.description,
        abno.rage, abno.breaches, abno.suppressed_count, abno.last_worked_by, abno.work_streak, abno.gift_id,
        abno.current_work_process, abno.meltdown_timer, abno.meltdown_state, abno.sector, abno.observation_level,
        abno.research_points, abno.can_breach, abno.is_tool, abno.script_id
      );
    }

    return true;
  } catch {
    return false;
  }
}
