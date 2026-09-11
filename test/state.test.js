import { describe, it, expect, beforeEach } from 'vitest';
import Unit from '../src/core/state/unit.js';
import Player from '../src/core/state/player.js';
import Enemy from '../src/core/state/enemy.js';
import Ally from '../src/core/state/ally.js';
import { createRunState } from '../src/core/state/runState.js';
import {
  createBattleState, zoneOf, moveCard, handNeighbors, resetTurnHistory,
  aliveEnemies, aliveAllies, firstAliveEnemy, unitsOfSide, allAliveUnits,
} from '../src/core/state/battleState.js';
import { createSkillRuntime, cloneSkillRuntime } from '../src/core/state/skillRuntime.js';
import { createRng } from '../src/core/state/rng.js';
import { registerEffect, clearEffectRegistry } from '../src/core/effects/registry.js';
import '../src/core/effects/definitions/strength.js';

beforeEach(() => {
  clearEffectRegistry();
  // 清表后重新登记测试用效果
  registerEffect({
    id: 'strength', type: 'buff', stacking: 'count',
    statModifiers: { attack: (s) => s },
  });
  registerEffect({ id: 'flying', type: 'buff', stacking: 'boolean' });
  registerEffect({ id: 'guard', type: 'buff', stacking: 'count', statModifiers: { defense: (s) => 2 * s } });
});

describe('Unit：效果数据面', () => {
  it('count 叠层累加，boolean 只存在与否', () => {
    const u = new Unit({ maxHp: 10 });
    u.addEffect('strength', 2);
    u.addEffect('strength', 3);
    expect(u.getEffectStacks('strength')).toBe(5);

    u.addEffect('flying');
    u.addEffect('flying');
    expect(u.getEffectStacks('flying')).toBe(1);
    expect(u.effects.filter(e => e.effectId === 'flying').length).toBe(1);
  });

  it('removeEffect 按层数扣减，扣尽移除；clearEffects 支持谓词', () => {
    const u = new Unit({ maxHp: 10 });
    u.addEffect('strength', 5);
    u.removeEffect('strength', 2);
    expect(u.getEffectStacks('strength')).toBe(3);
    u.removeEffect('strength');
    expect(u.getEffect('strength')).toBeNull();

    u.addEffect('strength', 1);
    u.addEffect('flying');
    u.clearEffects(e => e.effectId === 'flying');
    expect(u.getEffect('flying')).toBeNull();
    expect(u.getEffectStacks('strength')).toBe(1);
  });

  it('未注册效果 addEffect 抛错', () => {
    const u = new Unit({ maxHp: 10 });
    expect(() => u.addEffect('nonexistent')).toThrow(/未注册/);
  });
});

describe('Unit：getStat 读轨', () => {
  it('base + Σ statModifiers，随效果增删动态变化', () => {
    const u = new Unit({ maxHp: 10, attack: 3, defense: 1 });
    expect(u.getStat('attack')).toBe(3);
    u.addEffect('strength', 2);
    u.addEffect('guard', 1);
    expect(u.getStat('attack')).toBe(5);
    expect(u.getStat('defense')).toBe(3);
    u.removeEffect('strength', 1);
    expect(u.getStat('attack')).toBe(4);
  });
});

describe('skillRuntime：定义/运行时分离', () => {
  it('创建带唯一 id，克隆保留字段但换新 id', () => {
    const rt = createSkillRuntime('punch', { power: 2, remainingUses: 3 });
    const clone = cloneSkillRuntime(rt);
    expect(clone.uniqueID).not.toBe(rt.uniqueID);
    expect(clone.defId).toBe('punch');
    expect(clone.power).toBe(2);
    expect(clone.remainingUses).toBe(3);
    // 克深不影响原对象
    clone.power = 9;
    expect(rt.power).toBe(2);
  });
});

describe('battleState：zones 模型', () => {
  function setup() {
    const bs = createBattleState({ enemies: [new Enemy({ maxHp: 20 })], seed: 7 });
    const a = createSkillRuntime('a');
    const b = createSkillRuntime('b');
    const c = createSkillRuntime('c');
    bs.zones.hand.push(a, b, c);
    return { bs, a, b, c };
  }

  it('zoneOf 反查各区域', () => {
    const { bs, a, b } = setup();
    expect(zoneOf(bs, a.uniqueID)).toBe('hand');
    moveCard(bs, a.uniqueID, 'deck');
    expect(zoneOf(bs, a.uniqueID)).toBe('deck');
    moveCard(bs, b.uniqueID, 'burnt'); // 正解：移动而非 push，数组唯一事实源
    expect(zoneOf(bs, b.uniqueID)).toBe('burnt');
    expect(zoneOf(bs, 'nonexistent')).toBeNull();
  });

  it('moveCard 支持指定位置插入（牌序语义）', () => {
    const { bs, a, c } = setup();
    moveCard(bs, c.uniqueID, 'deck', { index: 0 });
    expect(bs.zones.deck[0].uniqueID).toBe(c.uniqueID);
    expect(bs.zones.hand.map(x => x.defId)).toEqual(['a', 'b']);
    expect(zoneOf(bs, a.uniqueID)).toBe('hand');
  });

  it('handNeighbors 给出左右邻（飞刀弃两侧类机制）', () => {
    const { bs, a, b, c } = setup();
    expect(handNeighbors(bs, b.uniqueID)).toEqual({ left: a, right: c });
    expect(handNeighbors(bs, a.uniqueID)).toEqual({ left: null, right: b });
  });

  it('history 回合段可重置，战斗段保留', () => {
    const { bs } = setup();
    bs.history.turn.played = 3;
    bs.history.battle.played = 3;
    resetTurnHistory(bs);
    expect(bs.history.turn.played).toBe(0);
    expect(bs.history.battle.played).toBe(3);
  });
});

describe('rng：确定性', () => {
  it('同种子同序列；shuffle 可复现；getState/setState 可断点续跑', () => {
    const r1 = createRng(42);
    const r2 = createRng(42);
    const seq1 = [r1.next(), r1.next(), r1.next()];
    const seq2 = [r2.next(), r2.next(), r2.next()];
    expect(seq1).toEqual(seq2);

    const s1 = createRng(9).shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    const s2 = createRng(9).shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(s1).toEqual(s2);

    const r3 = createRng(5);
    r3.next();
    const saved = r3.getState();
    const a = r3.next();
    const r4 = createRng(0);
    r4.setState(saved);
    expect(r4.next()).toBe(a);
  });

  it('shuffle 是标准 Fisher-Yates：恒为排列（无丢失/重复）、无位置偏置', () => {
    // 固定种子集（确定性测试）：首卡在各下标均出现过 → 每个位置可达，
    // 排除「换牌位受限」之类的偏置洗法；多重集恒保持（交换不增删元素）
    const N = 8;
    const identity = Array.from({ length: N }, (_, i) => i);
    const seen = new Set();
    for (let seed = 0; seed < 400; seed++) {
      const arr = createRng(seed).shuffle([...identity]);
      expect([...arr].sort((a, b) => a - b)).toEqual(identity);
      seen.add(arr.indexOf(0));
    }
    expect(seen.size).toBe(N);
  });

  it('int 闭区间不越界', () => {
    const r = createRng(1);
    for (let i = 0; i < 200; i++) {
      const v = r.int(2, 5);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(5);
    }
  });
});

describe('可序列化约束', () => {
  it('runState/battleState JSON 往返后状态字段完好', () => {
    const run = createRunState({ player: new Player({ maxHp: 30, maxMana: 4 }) });
    run.player.deck.push(createSkillRuntime('punch', { power: 1 }));
    run.player.addEffect('strength', 2);
    const bs = createBattleState({ enemies: [new Enemy({ maxHp: 20, defId: 'slime' })], seed: 3 });
    bs.turn.count = 5;

    const runRevived = JSON.parse(JSON.stringify(run));
    const bsRevived = JSON.parse(JSON.stringify(bs));

    expect(runRevived.player.hp).toBe(30);
    expect(runRevived.player.maxMana).toBe(4);
    expect(runRevived.player.deck[0].defId).toBe('punch');
    expect(runRevived.player.effects).toEqual([{ effectId: 'strength', stacks: 2 }]);
    expect(bsRevived.enemies[0].defId).toBe('slime');
    expect(bsRevived.turn.count).toBe(5);
    expect(bsRevived.zones).toEqual({ hand: [], deck: [], burnt: [], pending: [] });
  });
});

describe('多单位：阵营与选择器', () => {
  function setupUnits() {
    const player = new Player({ maxHp: 30 });
    const e1 = new Enemy({ maxHp: 10 });
    const e2 = new Enemy({ maxHp: 10 });
    const remi = new Ally({ maxHp: 15, defId: 'remi' });
    const bs = createBattleState({ enemies: [e1, e2], allies: [remi], seed: 1 });
    return { player, e1, e2, remi, bs };
  }

  it('createBattleState 指派 side，单位带 uniqueID', () => {
    const { player, e1, remi } = setupUnits();
    expect(e1.side).toBe('enemy');
    expect(remi.side).toBe('player');
    expect(player.side).toBe('player');
    expect(new Set([player.uniqueID, e1.uniqueID, remi.uniqueID]).size).toBe(3);
  });

  it('存活过滤与默认目标：第一个存活敌人', () => {
    const { e1, e2, remi, bs } = setupUnits();
    e1.hp = 0;
    expect(aliveEnemies(bs)).toEqual([e2]);
    expect(firstAliveEnemy(bs)).toBe(e2);
    expect(aliveAllies(bs)).toEqual([remi]);
  });

  it('unitsOfSide / allAliveUnits 按阵营聚合', () => {
    const { player, e1, e2, remi, bs } = setupUnits();
    expect(unitsOfSide(bs, player, 'player')).toEqual([player, remi]);
    expect(unitsOfSide(bs, player, 'player', { includePlayer: false })).toEqual([remi]);
    expect(unitsOfSide(bs, player, 'enemy')).toEqual([e1, e2]);
    expect(allAliveUnits(bs, player)).toEqual([player, remi, e1, e2]);
  });
});
