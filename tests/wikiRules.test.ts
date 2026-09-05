import { describe, expect, it } from 'bun:test';
import * as W from '../src/game/wikiRules';
import wikiData from '../src/config/wikiAbnormalities.json';
import gear from '../src/config/wikiEquipment.json';

process.env.BOT_TEST_MODE = '1';
process.env.NODE_ENV = 'test';
process.env.FACILITY_DB_PATH = ':memory:';
const { db, __test: engine } = await import('../index');
const P = await import('../src/game/progression');
const { handleProgressionCommand } = await import('../src/discord/progressionCommands');
let n = 0;
function fixture() {
  const guild = `wiki_rules_${++n}`;
  engine.ensureFacility(guild, 'manager');
  db.query("INSERT INTO agents (guild_id, discord_id, name, fortitude, prudence, temperance, justice, department) VALUES (?, 'player', 'Player', 2, 2, 2, 2, 'control')").run(guild);
  const facility = () => db.query('SELECT * FROM facility WHERE guild_id=?').get(guild) as any;
  const agent = () => db.query('SELECT * FROM agents WHERE guild_id=?').get(guild) as any;
  return { guild, facility, agent };
}

describe('exported wiki rules', () => {
  it('uses TLB stat boundaries and summed stat tiers', () => {
    expect([1,29,30,44,45,64,65,84,85,175].map(W.statTier)).toEqual([1,1,2,2,3,3,4,4,5,5]);
    expect(W.agentTier([29,29,29,29])).toBe(1);
    expect(W.agentTier([30,30,29,29])).toBe(2);
    expect(W.agentTier([45,45,30,30])).toBe(3);
    expect(W.agentTier([65,65,45,45])).toBe(4);
    expect(W.agentTier([85,85,65,65])).toBe(5);
  });
  it('preserves stored raw points and safely handles missing identities', () => {
    expect(W.rawPoints({fortitude: 2}, 'fortitude')).toBe(40);
    expect(W.rawPoints({fortitude: 2, progression: '{"points":{"fortitude":49}}'}, 'fortitude')).toBe(49);
    expect(W.wikiAbnormality({})).toBeUndefined();
    expect(W.wikiAbnormality({script_id:'X-XX-XX'})).toBeUndefined();
    expect(W.wikiAbnormality({name:'Nothing There'})?.maxEnergy).toBe(33);
  });
  it('imports complete preference tables without fabricating missing numbers', () => {
    expect(wikiData.abnormalities.length).toBe(98);
    for (const entry of wikiData.abnormalities) {
      for (const rates of Object.values(entry.preferences)) {
        expect(rates).toHaveLength(5);
        expect(rates.every((rate: number) => Number.isFinite(rate))).toBe(true);
      }
    }
    expect(W.wikiAbnormality({name:'Dozer'})?.maxEnergy).toBeNull();
  });
  it('uses matching stat tiers, temperance, observation bonuses and overload caps', () => {
    const a = {fortitude:1,temperance:1, progression: JSON.stringify({points:{fortitude:29,temperance:20}})};
    const abno = {name:'Dummy'};
    expect(W.wikiWorkChance(a, abno)('instinct')).toBeCloseTo(0.84);
    a.progression = JSON.stringify({points:{fortitude:30,temperance:20}});
    expect(W.wikiWorkChance(a, abno)('instinct')).toBeCloseTo(0.74);
    expect(W.wikiWorkChance(a, abno,3)('instinct')).toBeCloseTo(0.84);
    expect(W.wikiWorkChance(a, abno,3,20)('instinct')).toBeCloseTo(0.7);
  });
  it('rolls exactly one box per capacity and derives mood from the final PE count', () => {
    expect(W.rollWikiWork({name:'Dummy'},1,()=>0.5)).toEqual({boxes:10,tier:'good'});
    expect(W.rollWikiWork({name:'Dummy'},0,()=>0.5)).toEqual({boxes:0,tier:'bad'});
    let roll = 0;
    expect(W.rollWikiWork({name:'Dummy'},0.5,()=>roll++ < 5 ? 0 : 1)).toEqual({boxes:5,tier:'normal'});
    expect(W.rollWikiWork({name:'unknown'},1)).toBeNull();
  });
  it('uses half of LC growth with TLB tiers and carries damage only from the current work', () => {
    expect(W.workGrowth(40,'ZAYIN',12,'fortitude')).toBeCloseTo(1.056);
    expect(W.workGrowth(40,'ZAYIN',12,'justice',0.9,0.9)).toBeCloseTo(1.32);
    expect(W.workGrowth(40,'ZAYIN',12,'fortitude',0.5)).toBeCloseTo(2.64);
    expect(W.workGrowth(85,'ZAYIN',12,'fortitude')).toBeLessThan(W.workGrowth(40,'ZAYIN',12,'fortitude'));
  });
  it('credits both wallets, stores fractional growth, and excludes dead agents', () => {
    const f=fixture(), a=f.agent();
    const abno={id:1,risk:'HE'};
    P.awardWorkProgress(a,abno,'attachment',1,f.facility());
    const p=P.agentProgress(a);
    expect(p.lob).toBe(11); expect(p.pe['1']).toBe(1);
    expect(p.growth.temperance).toBeCloseTo(0.11);
    expect(P.facilityProgress(f.facility()).overload['1']).toBe(2);
    a.status='dead';
    expect(P.awardWorkProgress(a,abno,'attachment',10,f.facility())).toBe(0);
    expect(P.agentProgress(a).lob).toBe(11);
  });
  it('keeps rank modifiers directional and scales extraction prices additively to 3x', () => {
    expect(W.riskMultiplier('ALEPH','ZAYIN')).toBe(2);
    expect(W.riskMultiplier('ZAYIN','ALEPH')).toBe(0.4);
    expect(W.riskMultiplier('TETH','ZAYIN')).toBe(1);
    expect(W.extractionMultiplier('HE',3)).toBeCloseTo(1.9);
    expect(W.extractionMultiplier('ALEPH',100)).toBe(3);
    expect(W.trainingCost('justice')).toBe(200);
    expect(W.trainingCost('fortitude')).toBe(100);
    expect(W.dayLob(6,2)).toBe(45);
  });
  it('keeps every imported equipment item usable in runtime maps and paginates the catalogue', async () => {
    const f=fixture();
    expect(gear).toHaveLength(109);
    for (const item of gear) {
      const a={...f.agent(), [item.category]:item.id};
      expect(item.category==='weapon' ? engine.getWeapon(a)?.name : engine.getSuit(a)?.name).toBe(item.name);
    }
    for (let page=1;page<=Math.ceil(P.EGO_CATALOG.length/8);page++) {
      let response:any;
      await handleProgressionCommand({guildId:f.guild,user:{id:'player'},commandName:'ego',options:{getString:()=>null,getInteger:()=>page},reply:async(v:any)=>{response=v;}},engine);
      expect(response.content.length).toBeLessThanOrEqual(2000);
      expect(response.content).toContain(`${page}/`);
    }
  });
  it('requires the actual day for every ordeal and pays quota energy exactly once', () => {
    const f=fixture();
    for(const [index,stage] of P.ORDEAL_STAGES.entries()) {
      db.query('UPDATE facility SET day_count=? WHERE guild_id=?').run(stage.day-1,f.guild);
      P.saveFacilityProgress(f.facility(),{...P.facilityProgress(f.facility()),meltdown:stage.meltdown,ordealIndex:index});
      expect(P.startOrdeal(f.facility())).toBe(false);
      db.query('UPDATE facility SET day_count=? WHERE guild_id=?').run(stage.day,f.guild);
      expect(P.startOrdeal(f.facility())).toBe(true);
      const before=f.facility().energy, stale=f.facility();
      P.damageOrdeal(stale,99999);
      expect(f.facility().energy-before).toBe(Math.floor(f.facility().quota*stage.reward));
      expect(()=>P.damageOrdeal(stale,99999)).toThrow('no active ordeal');
    }
  });
  it('uses only white ordeals on days 46–49', () => {
    const f=fixture();
    db.query('UPDATE facility SET day_count=46 WHERE guild_id=?').run(f.guild);
    P.saveFacilityProgress(f.facility(),{...P.facilityProgress(f.facility()),meltdown:1});
    P.startOrdeal(f.facility());
    expect(P.facilityProgress(f.facility()).ordeal.color).toBe('white');
  });
  it('replaces shields instead of stacking and expires them after 20 seconds', () => {
    const f=fixture(), a=f.agent();
    const facility={...f.facility(),progression:JSON.stringify({research:['command_shields']})};
    a.stim_charges=JSON.stringify({red:2,black:1});
    P.useStim(a,facility,'red'); P.useStim(a,facility,'red');
    expect(a.shield_red).toBe(50);
    P.useStim(a,facility,'black');
    expect(a.shield_red).toBe(0); expect(a.shield_black).toBe(50);
    a.progression=JSON.stringify({...P.agentProgress(a),shieldExpiresAt:Date.now()-1});
    engine.applyDamage(a,5,'BLACK');
    expect(a.shield_black).toBe(0);
    expect(a.hp).toBe(95); expect(a.sp).toBe(95);
  });
  it('restores fixed HP amounts and respects the improved stim research', () => {
    const f=fixture(), a=f.agent(); a.hp=1; a.max_hp=200;
    a.stim_charges=JSON.stringify({health:2});
    const facility={...f.facility(),progression:JSON.stringify({research:['welfare_stims']})};
    P.useStim(a,facility,'health'); expect(a.hp).toBe(21);
    facility.progression=JSON.stringify({research:['welfare_stims','improved_stims']});
    P.useStim(a,facility,'health'); expect(a.hp).toBe(56);
  });
});
