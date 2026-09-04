import { describe, expect, it } from 'bun:test';
import { MessageFlags } from 'discord.js';

process.env.BOT_TEST_MODE = '1';
process.env.NODE_ENV = 'test';
process.env.FACILITY_DB_PATH = ':memory:';
const { db, __test: engine, recordDepartmentProgress, syncDepartmentUnlocks } = await import('../index');
const P = await import('../src/game/progression');
const { handleProgressionCommand } = await import('../src/discord/progressionCommands');
let fixtureId = 0;

function fixture() {
  const guild = `progression_${++fixtureId}`;
  engine.ensureFacility(guild, 'manager');
  db.query(`INSERT INTO agents (guild_id, discord_id, name, fortitude, prudence, temperance, justice)
    VALUES (?, 'player', 'Player', 2, 2, 2, 2)`).run(guild);
  const source = engine.runAbnormalityTestAction(guild, 'add', 'One Sin').abnormality;
  const facility = () => db.query('SELECT * FROM facility WHERE guild_id=?').get(guild) as any;
  const agent = () => db.query('SELECT * FROM agents WHERE guild_id=? AND discord_id=?').get(guild, 'player') as any;
  const setProgress = (value: any) => db.query('UPDATE agents SET progression=? WHERE guild_id=?').run(JSON.stringify(value), guild);
  const setFacility = (value: any) => P.saveFacilityProgress(facility(), { ...P.facilityProgress(facility()), ...value });
  const observe = () => db.query(`INSERT INTO agent_abnormality_knowledge
    (guild_id, discord_id, abnormality_id, instinct_pe, insight_pe, attachment_pe, repression_pe)
    VALUES (?, 'player', ?, 2, 2, 2, 2)`).run(guild, source.id);
  return { guild, source, facility, agent, setProgress, setFacility, observe };
}

describe('guide mechanics: stats and personal LOB', () => {
  it('applies negative-box damage only once through the real work resolver', async () => {
    const f = fixture();
    const originalRandom = Math.random;
    const edits: any[] = [];
    Math.random = () => 0.999;
    try {
      const a = f.agent();
      const abno = { ...f.source, damage_type: 'RED', damage_amt: 2 };
      await engine.executeWork({ guildId: f.guild, deferred: true, editReply: async (value: any) => { edits.push(value); } }, a, abno, 'instinct', f.facility());
      const damage = engine.getPEBoxTotal(abno);
      expect(f.agent().hp).toBe(100 - damage);
      expect(edits.at(-1).content).toContain(`suffered **${damage} RED damage**`);
      expect(f.agent().status).toBe('idle');
    } finally { Math.random = originalRandom; }
  });

  it('migrates legacy tiers once and awards only the stat matching the work type', () => {
    const f = fixture();
    const a = f.agent();
    for (const [work, stat] of [['instinct', 'fortitude'], ['insight', 'prudence'], ['attachment', 'temperance'], ['repression', 'justice']] as const) {
      expect(P.awardWorkProgress(a, f.source, work, 3, f.facility())).toBe(1);
      expect(P.agentProgress(a).points[stat]).toBe(41);
    }
    engine.updateAgent(a);
    expect(P.agentProgress(f.agent()).points).toEqual({ fortitude: 41, prudence: 41, temperance: 41, justice: 41 });
    expect(P.agentProgress(f.agent()).pe[String(f.source.id)]).toBe(12);
    a.status = 'dead';
    expect(P.awardWorkProgress(a, f.source, 'instinct', 10, f.facility())).toBe(0);
    expect(P.agentProgress(a).pe[String(f.source.id)]).toBe(12);
  });

  it('enforces base 100, researched 150 and card-extended 175 caps', () => {
    const f = fixture();
    const a = f.agent();
    expect(P.growStat(a, 'fortitude', 500).current).toBe(100);
    expect(P.growStat(a, 'fortitude', 1).gain).toBe(0);
    f.setFacility({ research: ['extended_stats'] });
    expect(P.growStat(a, 'fortitude', 500, f.facility()).current).toBe(150);
    a.level = 5;
    P.awardWorkProgress(a, f.source, 'insight', 1, f.facility());
    expect(P.growStat(a, 'fortitude', 500, f.facility()).current).toBe(175);
    expect(P.agentProgress(a).cards).toEqual(['break_your_limits']);
    P.awardWorkProgress(a, f.source, 'insight', 1, f.facility());
    expect(P.agentProgress(a).cards).toHaveLength(1);
  });

  it('uses personal LOB and rejects out-of-intermission, invalid and unaffordable training atomically', () => {
    const f = fixture();
    const initialFacilityLob = f.facility().lob_points;
    expect(P.trainWithLob(f.guild, 'player', 'justice').gain).toBe(5);
    expect(P.agentProgress(f.agent()).lob).toBe(5);
    expect(f.facility().lob_points).toBe(initialFacilityLob);
    db.query('UPDATE facility SET phase=10 WHERE guild_id=?').run(f.guild);
    expect(() => P.trainWithLob(f.guild, 'player', 'justice')).toThrow('intermission');
    db.query('UPDATE facility SET phase=8 WHERE guild_id=?').run(f.guild);
    const before = f.agent().progression;
    expect(() => P.trainWithLob(f.guild, 'player', 'hp' as any)).toThrow('unknown stat');
    expect(f.agent().progression).toBe(before);
    P.trainWithLob(f.guild, 'player', 'justice');
    expect(() => P.trainWithLob(f.guild, 'player', 'justice')).toThrow('personal LOB');
    expect(P.agentProgress(f.agent()).points.justice).toBe(50);
  });
});

describe('guide mechanics: E.G.O. extraction and persistence', () => {
  it('requires personal full observation of the correct source, not guild codex data', () => {
    const f = fixture();
    f.setProgress({ lob: 100, pe: { [f.source.id]: 10 } });
    engine.maybeUnlockCodexEntry(f.guild, f.source, 4);
    expect(() => P.purchaseEgo(f.guild, 'player', 'penitence')).toThrow('fully observe');
    expect(P.agentProgress(f.agent()).lob).toBe(100);
    f.observe();
    expect(() => P.purchaseEgo(f.guild, 'player', 'mimicry')).toThrow('Nothing There');
    expect(P.agentProgress(f.agent()).lob).toBe(100);
  });

  it('spends only source PE, preserves knowledge, persists equipment, and re-equips owned items for free', () => {
    const f = fixture();
    f.observe();
    f.setProgress({ lob: 30, pe: { [f.source.id]: 8, unrelated: 100 } });
    P.purchaseEgo(f.guild, 'player', 'penitence');
    P.purchaseEgo(f.guild, 'player', 'penitence_suit');
    P.purchaseEgo(f.guild, 'player', 'penitence');
    engine.updateAgent(f.agent());
    expect(f.agent()).toMatchObject({ weapon: 'penitence', suit: 'penitence_suit' });
    expect(P.agentProgress(f.agent())).toMatchObject({ lob: 10, pe: { [f.source.id]: 2, unrelated: 100 } });
    const k = db.query('SELECT * FROM agent_abnormality_knowledge WHERE guild_id=?').get(f.guild) as any;
    expect(k.instinct_pe + k.insight_pe + k.attachment_pe + k.repression_pe).toBe(8);
  });

  it('does not deduct PE when LOB is insufficient', () => {
    const f = fixture(); f.observe();
    f.setProgress({ lob: 0, pe: { [f.source.id]: 8 } });
    expect(() => P.purchaseEgo(f.guild, 'player', 'penitence')).toThrow('personal LOB');
    expect(P.agentProgress(f.agent()).pe[String(f.source.id)]).toBe(8);
    expect(f.agent().weapon).toBe('riot_stick');
  });

  it('round-trips wallets, cards, research, cores, tenure, stims and equipment through deep saves', () => {
    const f = fixture(); f.observe();
    f.setProgress({ lob: 80, pe: { [f.source.id]: 10 }, cards: ['break_your_limits'], tenure: { welfare: 30 } });
    f.setFacility({ research: ['welfare_stims'], cores: ['command'], meltdown: 6 });
    P.purchaseEgo(f.guild, 'player', 'penitence');
    const before = engine.serializeFacility(f.guild);
    f.setProgress({ lob: 0 }); f.setFacility({ cores: [] });
    engine.restoreState(f.guild, before);
    expect(f.agent().progression).toBe(before.agents[0].progression);
    expect(f.agent().weapon).toBe('penitence');
    expect(f.facility().progression).toBe(before.facility.progression);
    expect(f.agent().stim_charges).toBe(before.agents[0].stim_charges);
  });
});

describe('guide mechanics: damage, stims and research', () => {
  it('applies a pale shield to actual percentage HP damage and returns the same damage', () => {
    const f = fixture(); const a = f.agent();
    Object.assign(a, { hp: 200, max_hp: 200, shield_pale: 25 });
    expect(engine.applyDamage(a, 20, 'PALE')).toBe(35); // 20% * 200 * 1.5 - 25
    expect(a.hp).toBe(165); expect(a.shield_pale).toBe(0); expect(a.sp).toBe(100);
  });

  it('black damages both pools; colored shields do not protect against other types', () => {
    const f = fixture(); const a = f.agent();
    a.shield_red = 25; a.shield_black = 5;
    expect(engine.applyDamage(a, 10, 'BLACK')).toBe(5);
    expect(a.hp).toBe(95); expect(a.sp).toBe(95); expect(a.shield_red).toBe(25);
    expect(engine.applyDamage(a, 10, 'WHITE')).toBe(10); expect(a.hp).toBe(95); expect(a.sp).toBe(85);
  });

  it('lower suit multipliers resist more damage', () => {
    const f = fixture(); const plain = f.agent(); const armored = { ...plain, suit: 'mimicry_suit' };
    expect(engine.applyDamage(armored, 20, 'RED')).toBeLessThan(engine.applyDamage(plain, 20, 'RED'));
  });

  it('restricts research by manager, department, funds and repeat completion', () => {
    const f = fixture();
    expect(() => P.researchProject(f.guild, 'player', 'welfare_stims')).toThrow('manager');
    expect(() => P.researchProject(f.guild, 'manager', 'welfare_stims')).toThrow('unlock welfare');
    db.query('UPDATE facility SET department_unlocks=? WHERE guild_id=?').run(JSON.stringify(['control', 'welfare']), f.guild);
    P.researchProject(f.guild, 'manager', 'welfare_stims');
    const lob = f.facility().lob_points;
    expect(() => P.researchProject(f.guild, 'manager', 'welfare_stims')).toThrow('already');
    expect(f.facility().lob_points).toBe(lob);
  });

  it('requires command research plus the command core for pale shields', () => {
    const f = fixture(); const a = f.agent(); a.stim_charges = JSON.stringify({ pale: 1 });
    expect(() => P.useStim(a, f.facility(), 'pale')).toThrow('research');
    f.setFacility({ research: ['command_shields'] });
    expect(() => P.useStim(a, f.facility(), 'pale')).toThrow('command core');
    f.setFacility({ cores: ['command'] });
    expect(P.useStim(a, f.facility(), 'pale')).toBe(0);
    expect(a.shield_pale).toBe(25);
    expect(() => P.useStim(a, f.facility(), 'pale')).toThrow('no charges');
  });

  it('does not waste healing at full health and clears panic metadata on sanity recovery', () => {
    const f = fixture(); f.setFacility({ research: ['welfare_stims'] });
    const a = f.agent(); a.stim_charges = JSON.stringify({ health: 1, sanity: 1 });
    expect(() => P.useStim(a, f.facility(), 'health')).toThrow('full');
    expect(JSON.parse(a.stim_charges).health).toBe(1);
    Object.assign(a, { sp: 0, status: 'panicked', panic_turns: 2, panic_behavior: 'hostile' });
    P.useStim(a, f.facility(), 'sanity');
    expect(a).toMatchObject({ sp: 25, status: 'recovering', panic_turns: 0, panic_behavior: '' });
  });
});

describe('guide mechanics: departments, cores, ordeals and recruitment', () => {
  it('has nine available departments and four service ranks', () => {
    expect(Object.keys(P.DEPARTMENTS)).toHaveLength(9);
    expect(P.DEPARTMENTS.command.sephirah).toBe('Tiphereth A and B');
    expect([0, 5, 15, 30].map(P.departmentRank)).toEqual(['level 1', 'level 2', 'level 3', 'captain']);
    expect(P.DEPARTMENTS).not.toHaveProperty('architecture');
  });

  it('extends the quest chain through Disciplinary, Welfare, Extraction and Record', () => {
    const f = fixture();
    for (const [dept, target] of [['control', 40], ['information', 3], ['security', 2], ['training', 3], ['command', 6], ['disciplinary', 5], ['welfare', 5], ['extraction', 3]] as const) {
      expect(recordDepartmentProgress(f.guild, dept, target)).toBe(target);
    }
    expect(syncDepartmentUnlocks(f.guild, f.facility())).toEqual(Object.keys(P.DEPARTMENTS));
  });

  it('credits already owned equipment when Extraction opens', () => {
    const f = fixture();
    f.setProgress({ inventory: ['riot_stick', 'penitence', 'penitence_suit', 'mimicry'] });
    db.query('UPDATE facility SET department_unlocks=? WHERE guild_id=?').run(JSON.stringify(['control', 'extraction']), f.guild);
    expect(syncDepartmentUnlocks(f.guild, f.facility())).toContain('record');
  });

  it('rejects ending the day while an ordeal is still active', async () => {
    const f = fixture(); f.setFacility({ meltdown: 1 });
    P.startOrdeal(f.facility());
    const replies: any[] = [];
    await engine.endDay({ guildId: f.guild, reply: async (v: any) => { replies.push(v); } }, f.facility());
    expect(replies[0].content).toContain('ordeal');
    expect(f.facility().day_count).toBe(1);
  });

  it('migrates an old active placeholder ordeal into a playable encounter only once', () => {
    const f = fixture();
    db.query("UPDATE facility SET ordeal_active=1, active_ordeal='green' WHERE guild_id=?").run(f.guild);
    engine.ensureFacility(f.guild, 'manager');
    expect(P.facilityProgress(f.facility()).ordeal).toMatchObject({ stage: 'dawn', color: 'green', hp: 100 });
    P.damageOrdeal(f.facility(), 10);
    engine.ensureFacility(f.guild, 'manager');
    expect(P.facilityProgress(f.facility()).ordeal.hp).toBe(90);
  });

  it('requires a completed quest, counts only matching good works, then grants meltdown immunity', () => {
    const f = fixture();
    expect(() => P.startCore(f.guild, 'player', 'control')).toThrow('manager');
    expect(() => P.startCore(f.guild, 'manager', 'control')).toThrow('quest');
    recordDepartmentProgress(f.guild, 'control', 40);
    P.startCore(f.guild, 'manager', 'control');
    expect(P.advanceCore(f.facility(), 'welfare', true)).toBe(false);
    expect(P.advanceCore(f.facility(), 'control', false)).toBe(false);
    for (let i = 0; i < 5; i++) P.advanceCore(f.facility(), 'control', true);
    expect(P.facilityProgress(f.facility()).cores).toEqual(['control']);
    expect(engine.triggerMeltdownAlarm(f.guild, f.facility())).toBe(false);
    expect(f.source.is_breaching).toBe(0);
  });

  it('drops a non-breaching abnormality counter to zero without inventing a breach', () => {
    const f = fixture();
    db.query("UPDATE abnormalities SET can_breach=0, meltdown_timer=1 WHERE id=?").run(f.source.id);
    db.query('UPDATE facility SET meltdown_alarm=1, meltdown_targets=? WHERE guild_id=?').run(JSON.stringify([f.source.id]), f.guild);
    expect(engine.resolveMeltdownTimers(f.guild, f.facility())).toHaveLength(0);
    expect(db.query('SELECT qliphoth, is_breaching FROM abnormalities WHERE id=?').get(f.source.id)).toEqual({ qliphoth: 0, is_breaching: 0 });
  });

  it('defuses only the worked containment target and preserves other timers', () => {
    const f = fixture();
    const other = engine.runAbnormalityTestAction(f.guild, 'add', 'Nothing There').abnormality;
    db.query('UPDATE facility SET meltdown_alarm=1, meltdown_targets=? WHERE guild_id=?').run(JSON.stringify([f.source.id, other.id]), f.guild);
    db.query('UPDATE abnormalities SET meltdown_timer=3 WHERE guild_id=?').run(f.guild);
    expect(P.defuseWorkMeltdown(f.guild, f.source)).toBe(true);
    expect(JSON.parse(f.facility().meltdown_targets)).toEqual([other.id]);
    expect(f.facility().meltdown_alarm).toBe(1);
    expect(P.defuseWorkMeltdown(f.guild, other)).toBe(true);
    expect(f.facility().meltdown_alarm).toBe(0);
  });

  it('makes all four ordeal stages reachable before the actual clock reaches 22:00', () => {
    const f = fixture();
    const stages: string[] = [];
    for (let phase = 8; phase < 22; phase = engine.nextPhase(phase)) {
      engine.triggerMeltdownAlarm(f.guild, f.facility());
      engine.resolveMeltdownTimers(f.guild, f.facility());
      if (engine.maybeTriggerOrdeal(f.guild, f.facility())) {
        stages.push(P.facilityProgress(f.facility()).ordeal.stage);
        P.damageOrdeal(f.facility(), 99999);
      }
      // Simulate suppression after timer breaches, allowing later alarms.
      db.query('UPDATE abnormalities SET is_breaching=0, qliphoth=max_qliphoth WHERE guild_id=?').run(f.guild);
    }
    expect(stages).toEqual(['dawn', 'noon', 'dusk', 'midnight']);
  });

  it('progresses Dawn → Noon → Dusk → Midnight once each and uses only the guide color pools', () => {
    const f = fixture();
    for (const stage of P.ORDEAL_STAGES) {
      f.setFacility({ meltdown: stage.meltdown - 1 });
      expect(P.startOrdeal(f.facility(), () => 0)).toBe(false);
      f.setFacility({ meltdown: stage.meltdown });
      expect(P.startOrdeal(f.facility(), () => 0.999)).toBe(true);
      const ordeal = P.facilityProgress(f.facility()).ordeal;
      expect(ordeal.stage).toBe(stage.name);
      expect(stage.colors as readonly string[]).toContain(ordeal.color);
      expect(P.startOrdeal(f.facility())).toBe(false);
      expect(P.damageOrdeal(f.facility(), 9999)).toBe(0);
    }
    f.setFacility({ meltdown: 100 });
    expect(P.startOrdeal(f.facility())).toBe(false);
  });

  it('refills only researched stims and awards personal LOB at a quota-complete day', () => {
    const f = fixture(); f.setFacility({ research: ['welfare_stims'], meltdown: 8, ordealIndex: 4 });
    P.resetProgressionDay(f.facility(), true);
    expect(P.agentProgress(f.agent()).lob).toBe(20);
    expect(JSON.parse(f.agent().stim_charges)).toEqual({ health: 2, sanity: 2, red: 0, white: 0, black: 0, pale: 0 });
    expect(P.facilityProgress(f.facility())).toMatchObject({ meltdown: 0, ordealIndex: 0 });
  });

  it('persists three offers and consumes one choice exactly once per day', () => {
    const f = fixture();
    expect(() => engine.recruitAbnormality(f.guild, 'player', null)).toThrow('manager');
    const first = engine.recruitAbnormality(f.guild, 'manager', null);
    expect(engine.recruitAbnormality(f.guild, 'manager', null)).toBe(first);
    expect(P.facilityProgress(f.facility()).offers).toHaveLength(3);
    engine.recruitAbnormality(f.guild, 'manager', 1);
    expect(() => engine.recruitAbnormality(f.guild, 'manager', 1)).toThrow('per day');
    expect(db.query('SELECT COUNT(*) AS n FROM abnormalities WHERE guild_id=?').get(f.guild)).toEqual({ n: 2 });
  });

  it('routes player /lob through the real command handler and rejects non-manager research', async () => {
    const f = fixture(); const replies: any[] = [];
    const interaction = { guildId: f.guild, user: { id: 'player' }, commandName: 'lob', options: { getString: () => 'justice' }, reply: async (value: any) => { replies.push(value); } };
    await handleProgressionCommand(interaction, { ...engine, recordDepartmentProgress });
    expect(replies[0].content).toContain('justice +5');
    interaction.commandName = 'research';
    await handleProgressionCommand(interaction, engine);
    expect(replies[1].content).toContain('manager');
    expect(replies.every(r => r.flags === MessageFlags.Ephemeral && !('ephemeral' in r))).toBe(true);
  });
});
