import { describe, expect, it } from 'bun:test';
import { createBoss, damageBoss, bossResistance, nextBossAttack, startBossSpecial, clearBossTarget } from '../src/game/coreBoss';
process.env.BOT_TEST_MODE = '1';
process.env.NODE_ENV = 'test';
process.env.FACILITY_DB_PATH = ':memory:';
const { db, __test: engine } = await import('../index');
const P = await import('../src/game/progression');
const { fightCore } = await import('../src/game/coreCombat');
const { handleProgressionCommand } = await import('../src/discord/progressionCommands');
let serial = 0;
function fixture(department = 'disciplinary') {
  const guild = `core_boss_${++serial}`;
  engine.ensureFacility(guild, 'manager');
  db.query('UPDATE facility SET day_count=41, is_started=1, phase=8, department_unlocks=? WHERE guild_id=?').run(JSON.stringify([department]), guild);
  db.query('INSERT OR REPLACE INTO department_quests (guild_id, department, progress, complete) VALUES (?, ?, 99, 1)').run(guild, department);
  db.query("INSERT INTO agents (guild_id,discord_id,name,hp,max_hp,sp,max_sp,department) VALUES (?,'player','Player',1000,1000,1000,1000,?)").run(guild, department);
  engine.runAbnormalityTestAction(guild, 'add', 'Nothing There');
  P.startCore(guild, 'manager', department);
  const facility = () => db.query('SELECT * FROM facility WHERE guild_id=?').get(guild) as any;
  const agent = () => db.query('SELECT * FROM agents WHERE guild_id=?').get(guild) as any;
  return { guild, facility, agent };
}

describe('phased core encounters', () => {
  it('uses separate phase pools and never skips phases with overkill', () => {
    const b = createBoss('red_mist');
    for (let phase = 1; phase < 4; phase++) {
      expect(b.phase).toBe(phase);
      expect(damageBoss(b, 100000)).toBe('phase');
      expect(b.hp).toBe(3000);
    }
    expect(damageBoss(b, 100000)).toBe('defeated');
    expect(b.hp).toBe(0);
    expect(() => damageBoss(b, NaN)).toThrow();
  });
  it('changes resistance, attack sequences, and phase 3.5 at their boundaries', () => {
    const b = createBoss('red_mist');
    expect(bossResistance(b,'RED',0)).toBe(.4);
    expect(nextBossAttack(b).name).toBe('Red Eyes');
    b.turn=1; expect(nextBossAttack(b).hits[0]?.type).toBe('WHITE');
    b.hp=1900; expect(nextBossAttack(b).name).toBe('The Road of Gold');
    damageBoss(b,9999);
    expect(bossResistance(b,'WHITE',0)).toBe(.1);
    damageBoss(b,9999); b.hp=1500; b.turn=3;
    expect(nextBossAttack(b).name).toBe('Great Split: Horizontal');
    expect(nextBossAttack(b).hits[0]?.max).toBe(1000);
    damageBoss(b,9999);
    expect(bossResistance(b,'PALE',0)).toBe(.8);
    expect(nextBossAttack(b).hits).toHaveLength(24);
  });
  it('requires all containment targets and expires Gold/Fog at the exact deadline', () => {
    const b=createBoss('arbiter'); startBossSpecial(b,[1,2,2],1000);
    expect(b.special?.targets).toEqual([1,2]);
    expect(clearBossTarget(b,3,1001,1)).toBe(false);
    expect(clearBossTarget(b,1,1001,1)).toBe(true);
    expect(b.stunnedUntil).toBe(0);
    expect(clearBossTarget(b,2,61000,1)).toBe(false);
    expect(clearBossTarget(b,2,60999,1)).toBe(true);
    expect(b.stunnedUntil).toBe(80999);
    b.turn=4; startBossSpecial(b,[3],90000);
    expect(b.special?.kind).toBe('fog');
    clearBossTarget(b,3,90001,5);
    expect(bossResistance(b,'RED',90001)).toBe(1.5);
    expect(bossResistance(b,'RED',115001)).toBe(.4);
  });
  it('resets special effects across Arbiter phases and makes bindings immune', () => {
    const b=createBoss('arbiter'); b.stunnedUntil=99999; b.fogCleared=true;
    damageBoss(b,99999);
    expect(b.stunnedUntil).toBe(0); expect(b.fogCleared).toBe(false);
    damageBoss(b,99999); startBossSpecial(b,[7],0);
    expect(b.special?.kind).toBe('fairies');
    expect(bossResistance(b,'PALE',0)).toBe(0);
    clearBossTarget(b,7,100000,1);
    expect(bossResistance(b,'PALE',100000)).toBe(.1);
  });
  it('persists actions, rejects duplicate cooldowns and prevents cross-guild actions', () => {
    const f=fixture();
    const result=fightCore(f.guild,'player','dodge',engine,1000,()=>0);
    expect(result.agent.hp).toBe(1000);
    expect(P.facilityProgress(f.facility()).core.boss.turn).toBe(1);
    expect(() => fightCore(f.guild,'player','fight',engine,1001)).toThrow('wait');
    expect(() => fightCore('absent','player','fight',engine,3000)).toThrow('no active');
    expect(() => fightCore(f.guild,'intruder','fight',engine,3000)).toThrow('living');
    expect(P.facilityProgress(f.facility()).core.boss.turn).toBe(1);
  });
  it('blocks at half damage without attacking, while unblockable attacks bypass block', () => {
    const f=fixture(); const seen:number[]=[];
    fightCore(f.guild,'player','block',{...engine,applyDamage: (_a:any,amount:number)=>{seen.push(amount);return amount;}},1000,()=>0);
    expect(seen).toEqual([20]);
    const p=P.facilityProgress(f.facility()); p.core.boss.phase=2; p.core.boss.turn=2;
    P.saveFacilityProgress(f.facility(),p); seen.length=0;
    fightCore(f.guild,'player','block',{...engine,applyDamage: (_a:any,amount:number)=>{seen.push(amount);return amount;}},3000,()=>0);
    expect(seen).toEqual([5]);
  });
  it('does not consume cooldown or mutate bosses when the shift is paused', () => {
    const f=fixture(); const before=f.facility().progression;
    db.query('UPDATE facility SET is_paused=1 WHERE guild_id=?').run(f.guild);
    expect(() => fightCore(f.guild,'player','fight',engine,1000)).toThrow('running');
    expect(f.facility().progression).toBe(before);
    expect(P.agentProgress(f.agent()).coreActionAfter).toBeUndefined();
  });
  it('requires the final phase and waits for any active ordeal before clearing once', () => {
    const f=fixture(), p=P.facilityProgress(f.facility());
    db.query("UPDATE agents SET weapon='mimicry' WHERE guild_id=?").run(f.guild);
    p.core.boss.hp=1; p.core.boss.phase=4;
    p.core.boss.stunnedUntil=99999;
    p.ordeal={stage:'dawn',color:'green',hp:1};
    P.saveFacilityProgress(f.facility(),p);
    fightCore(f.guild,'player','fight',engine,1000,()=>0);
    expect(P.facilityProgress(f.facility()).cores).toEqual([]);
    expect(P.facilityProgress(f.facility()).core.boss.hp).toBe(0);
    P.damageOrdeal(f.facility(),999);
    expect(P.advanceCore(f.facility(),'',false)).toBe(true);
    expect(P.advanceCore(f.facility(),'',false)).toBe(false);
    expect(P.facilityProgress(f.facility()).cores).toEqual(['disciplinary']);
  });
  it('lets players inspect and fight but reserves starting a core for the manager', async () => {
    const f=fixture(), replies:any[]=[];
    const interaction={guildId:f.guild,user:{id:'player'},commandName:'core',options:{getString:(_name:string)=>null as string|null},reply:async(v:any)=>{replies.push(v);}};
    await handleProgressionCommand(interaction,engine);
    expect(replies[0].content).toContain('The Red Mist');
    interaction.options.getString=(name:string)=>name==='department'?'disciplinary':null;
    await handleProgressionCommand(interaction,engine);
    expect(replies[1].content).toContain('manager');
    expect(replies[0].content.length).toBeLessThan(2000);
  });
  it('resolves Binah targets through the work helper only in the owning guild', () => {
    const f=fixture('extraction'), other=fixture('extraction');
    const target=P.facilityProgress(f.facility()).core.boss.special.targets[0];
    expect(P.defuseBossMeltdown(other.guild,target)).toBe(false);
    expect(P.defuseBossMeltdown(f.guild,target)).toBe(true);
    expect(P.facilityProgress(f.facility()).core.boss.special).toBeNull();
    expect(P.defuseBossMeltdown(f.guild,target)).toBe(false);
  });
  it('round-trips phase, containment targets and cooldown through real saves', () => {
    const f=fixture('extraction');
    fightCore(f.guild,'player','dodge',engine,Date.now(),()=>0);
    const snapshot=engine.serializeFacility(f.guild);
    const p=P.facilityProgress(f.facility());p.core.boss.phase=3;p.core.boss.special=null;
    P.saveFacilityProgress(f.facility(),p);
    engine.restoreState(f.guild,snapshot);
    expect(f.facility().progression).toBe(snapshot.facility.progression);
    expect(f.agent().progression).toBe(snapshot.agents[0].progression);
  });
  it('keeps an in-progress legacy five-work core compatible', () => {
    const f=fixture(), p=P.facilityProgress(f.facility());
    p.core={department:'disciplinary',progress:4,target:5};
    P.saveFacilityProgress(f.facility(),p);
    expect(P.advanceCore(f.facility(),'control',true)).toBe(false);
    expect(P.advanceCore(f.facility(),'disciplinary',true)).toBe(true);
  });
  it('routes a boss death through the existing three-death wipe policy', async () => {
    const f=fixture();
    db.query('UPDATE agents SET hp=1, death_count=2 WHERE guild_id=?').run(f.guild);
    let response:any;
    await handleProgressionCommand({guildId:f.guild,user:{id:'player'},commandName:'core',options:{getString:(name:string)=>name==='action'?'fight':null},reply:async(v:any)=>{response=v;}},engine);
    expect(response.content).toContain('third death');
    expect(f.agent()).toBeNull();
  });
});
