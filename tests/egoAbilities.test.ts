import { describe, expect, it } from 'bun:test';
import { rollEgoAttack, finishEgoAttack } from '../src/game/egoAbilities';
process.env.BOT_TEST_MODE='1'; process.env.NODE_ENV='test'; process.env.FACILITY_DB_PATH=':memory:';
const { __test: engine } = await import('../index');
const P = await import('../src/game/progression');
const { EGO_SUITS } = await import('../src/game/logic');

describe('wiki E.G.O. abilities', () => {
  const weapon={min:10,max:14};
  it('rolls Mimicry Downslam and returns its 50% defense modifier', () => {
    expect(rollEgoAttack({weapon:'mimicry'},weapon,true,()=>0)).toMatchObject({damage:80,defense:.5});
    expect(rollEgoAttack({weapon:'mimicry'},weapon,true,()=>.999).damage).toBe(130);
    expect(()=>rollEgoAttack({weapon:'riot_stick'},weapon,true)).toThrow('no implemented');
  });
  it('resolves Da Capo multi-hits and its finishing swing', () => {
    expect(rollEgoAttack({weapon:'da_capo'},weapon,false,()=>0).damage).toBe(26);
    expect(rollEgoAttack({weapon:'da_capo'},weapon,false,()=>.999).damage).toBe(31);
  });
  it('caps Smile at ten corpses and uses the exact growth table', () => {
    const expected=[12,14,16,18,21,23,26,28,31,33,36];
    for(let i=0;i<=10;i++) expect(rollEgoAttack({weapon:'smile',progression:JSON.stringify({smileCorpses:i})},weapon,false,()=>0).damage).toBe(expected[i]!);
    expect(rollEgoAttack({weapon:'smile',progression:'{"smileCorpses":99}'},weapon,false,()=>.999).damage).toBe(42);
  });
  it('credits Smile once per kill, preserves unrelated progress, and heals living agents only', () => {
    const a={weapon:'smile',hp:10,max_hp:100,status:'idle',progression:'{"lob":333,"smileCorpses":9}'};
    finishEgoAttack(a,20,false); expect(a.hp).toBe(10);
    finishEgoAttack(a,20,true); expect(a.hp).toBe(35);
    expect(JSON.parse(a.progression)).toEqual({lob:333,smileCorpses:10});
    a.status='dead'; a.hp=0; finishEgoAttack(a,1000,true); expect(a.hp).toBe(0);
  });
  it('bases Mimicry healing on actual damage and never revives a dead attacker', () => {
    const a={weapon:'mimicry',hp:80,max_hp:100,status:'idle'};
    finishEgoAttack(a,12,false); expect(a.hp).toBe(83);
    finishEgoAttack(a,1000,false); expect(a.hp).toBe(100);
    a.hp=0;a.status='dead'; finishEgoAttack(a,1000,true); expect(a.hp).toBe(0);
  });
  it('supports negative suit resistance without spending shields or reviving dead agents', () => {
    EGO_SUITS.test_absorption={name:'test absorption',red:-.5,white:-.5,black:-.5,pale:-.5,defense:0};
    try {
      const a={suit:'test_absorption',hp:50,max_hp:100,sp:50,max_sp:100,status:'idle',shield_black:50};
      expect(engine.applyDamage(a,20,'BLACK')).toBe(0);
      expect(a.hp).toBe(60);expect(a.sp).toBe(60);expect(a.shield_black).toBe(50);
      a.status='dead';a.hp=0;engine.applyDamage(a,20,'BLACK');expect(a.hp).toBe(0);
    } finally { delete EGO_SUITS.test_absorption; }
  });
  it('grants Record stat caps by stat rather than changing stored base points', () => {
    const a={fortitude:2,justice:2,progression:'{}'};
    const f={progression:'{"cores":["record"]}'};
    expect(P.statLimit(a,f,'fortitude')).toBe(110);
    expect(P.statLimit(a,f,'justice')).toBe(130);
    expect(P.agentProgress(a).points.justice).toBe(40);
  });
});
