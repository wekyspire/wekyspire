import { describe, it, expect } from 'vitest';
import '../src/core/content/index.js';
import { BattleDriver } from '../src/core/sdk/driver.js';
import { registerSkill } from '../src/core/skills/registry.js';
import { registerAbility } from '../src/core/abilities/registry.js';
import { zoneOf, moveCard, firstAliveEnemy } from '../src/core/state/battleState.js';
import AwaitPlayerInputInstruction from '../src/core/instructions/input.js';
import { AddCardInstruction, TransformCardInstruction } from '../src/core/instructions/cards.js';
import { DealDamageInstruction } from '../src/core/instructions/combat.js';
import { PlayerTurnEndInstruction } from '../src/core/instructions/turn.js';

// ---- 卡牌转化原型：压测 TransformCardInstruction 与进出战斗元语 ----

// 锈刀：手牌中渡过回合则 power -4（常驻订阅，用来验证转化时的订阅换绑）
registerSkill({
  id: 'decayBlade', name: '锈刀',
  cost: { mana: 0, actionPoint: 1 },
  use(sctx) {
    sctx.kernel.submitInstruction(new DealDamageInstruction({
      source: sctx.player, target: firstAliveEnemy(sctx.battleState), amount: 4,
    }));
    return true;
  },
  subscriptions: (sctx) => [{
    when: PlayerTurnEndInstruction, phase: 'post',
    filter: (instr, ctx) => zoneOf(ctx.battleState, sctx.self.uniqueID) === 'hand',
    react: () => { sctx.self.power -= 4; },
  }],
});

// 充能卡：1 充能 2 回合冷却（验证转化后充能按新 def 重置）
registerSkill({
  id: 'chargedCard', name: '充能卡',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 2 },
  use() { return true; },
});

// 点化：选一张手牌，转化为点火（结算期输入 + 转化的集成；发动中自身已离手，剩余手牌皆候选）
registerSkill({
  id: 'transmute', name: '点化',
  cost: { mana: 0, actionPoint: 1 },
  use(sctx, stage) {
    if (stage === 0) {
      const hand = sctx.battleState.zones.hand;
      if (hand.length === 0) return true;
      sctx.self._input = new AwaitPlayerInputInstruction({
        request: { kind: 'selectHandCard', count: 1, candidates: hand.map(c => c.uniqueID) },
      });
      sctx.kernel.submitInstruction(sctx.self._input);
      return false;
    }
    const [uniqueID] = sctx.self._input.result.selection;
    sctx.self._input = null;
    sctx.kernel.submitInstruction(new TransformCardInstruction({ uniqueID, toDefId: 'inflame' }));
    return true;
  },
});

// 测试能力·升阶：转化为冲拳时改为转化为点火（PRE 改写 toDefId）
registerAbility({
  id: 'ascension', name: '升阶',
  subscriptions: () => [{
    when: TransformCardInstruction, phase: 'pre',
    filter: (instr) => instr.payload.toDefId === 'punch',
    react: (instr) => instr.setPayload('toDefId', 'inflame'),
  }],
});

// 洗牌不定起手：把指定牌挪进手牌（测试布置）
function bringToHand(d, defId) {
  const card = d.state.zones.deck.find(c => c.defId === defId);
  if (card) moveCard(d.state, card.uniqueID, 'hand');
  return d.state.zones.hand.find(c => c.defId === defId);
}

describe('转化：订阅换绑', () => {
  it('锈刀转化为冲拳后，回合结束不再衰败（旧订阅注销）', () => {
    const d = new BattleDriver({
      deck: ['decayBlade', 'punch', 'punch', 'punch'],
      enemies: ['slime'], seed: 5, config: { initialDraw: 4 },
    });
    d.start();
    const blade = bringToHand(d, 'decayBlade');
    expect(d.kernel.subscriptions.filter(s => s.owner === blade.uniqueID)).toHaveLength(1);

    d.dispatch(new TransformCardInstruction({ uniqueID: blade.uniqueID, toDefId: 'punch' }));
    expect(blade.defId).toBe('punch');
    expect(d.kernel.subscriptions.filter(s => s.owner === blade.uniqueID)).toHaveLength(0);

    d.endTurn(); // 留在手中渡过回合：不衰败
    expect(blade.power).toBe(0);

    d.play(blade.uniqueID); // 按冲拳结算
    expect(d.state.enemies[0].hp).toBe(20 - 6);
  });

  it('冲刀转化为锈刀后获得衰败订阅（新订阅注册）', () => {
    const d = new BattleDriver({
      deck: ['punch', 'punch', 'punch', 'punch'],
      enemies: ['slime'], seed: 5, config: { initialDraw: 4 },
    });
    d.start();
    const punch = d.state.zones.hand[0];

    d.dispatch(new TransformCardInstruction({ uniqueID: punch.uniqueID, toDefId: 'decayBlade' }));
    expect(d.kernel.subscriptions.filter(s => s.owner === punch.uniqueID)).toHaveLength(1);

    d.endTurn();
    expect(punch.power).toBe(-4);
  });

  it('AddCard 造出的新卡同样走进入战斗元语（常驻订阅注册）', () => {
    const d = new BattleDriver({
      deck: ['punch', 'punch', 'punch', 'punch'],
      enemies: ['slime'], seed: 5, config: { initialDraw: 4 },
    });
    d.start();

    d.dispatch(new AddCardInstruction({ defId: 'decayBlade', toZone: 'hand' }));
    const blade = d.state.zones.hand.find(c => c.defId === 'decayBlade');
    expect(d.kernel.subscriptions.filter(s => s.owner === blade.uniqueID)).toHaveLength(1);

    d.endTurn(); // 在手中渡过回合 → 衰败
    expect(blade.power).toBe(-4);
  });
});

describe('转化：身份延续', () => {
  it('牌库内转化保持位置与 uniqueID 不变', () => {
    const d = new BattleDriver({
      deck: ['punch', 'punch', 'punch', 'punch', 'punch', 'punch'],
      enemies: ['slime'], seed: 5,
    });
    d.start();
    const target = d.state.zones.deck[1];
    const id = target.uniqueID;

    d.dispatch(new TransformCardInstruction({ uniqueID: id, toDefId: 'guard' }));
    expect(d.state.zones.deck[1].uniqueID).toBe(id);
    expect(d.state.zones.deck[1].defId).toBe('guard');
    expect(d.state.history.battle.burnt).toBe(0); // 不是焚+造
  });

  it('充能按新 def 重置；power 默认保留、keepPower:false 时清空', () => {
    const d = new BattleDriver({
      deck: ['punch', 'punch', 'punch', 'punch'],
      enemies: ['slime'], seed: 5, config: { initialDraw: 4 },
    });
    d.start();
    const [a, b] = d.state.zones.hand;
    a.power = 5;
    b.power = 5;

    d.dispatch(new TransformCardInstruction({ uniqueID: a.uniqueID, toDefId: 'chargedCard' }));
    expect(a.remainingUses).toBe(1);        // chargedCard: max 1
    expect(a.currentCooldown).toBe(2);      // cooldownTurns 2
    expect(a.power).toBe(5);                // 默认保留

    d.dispatch(new TransformCardInstruction({ uniqueID: b.uniqueID, toDefId: 'chargedCard', keepPower: false }));
    expect(b.power).toBe(0);
  });
});

describe('转化：PRE 改写转化结果', () => {
  it('升阶能力把"转化为冲拳"改写为"转化为点火"', () => {
    const d = new BattleDriver({
      deck: ['punch', 'punch', 'punch', 'punch'],
      enemies: ['slime'], abilities: ['ascension'], seed: 5, config: { initialDraw: 4 },
    });
    d.start();
    const target = d.state.zones.hand[0];

    d.dispatch(new TransformCardInstruction({ uniqueID: target.uniqueID, toDefId: 'punch' }));
    expect(target.defId).toBe('inflame');
    expect(d.calls('cardTransformed')[0].args[0].toDefId).toBe('inflame');
  });
});

describe('转化：结算期输入集成（点化）', () => {
  it('选牌 → 转化为点火 → 可当点火打出', () => {
    const d = new BattleDriver({
      deck: ['transmute', 'punch', 'punch', 'punch'],
      enemies: ['slime'], seed: 5, config: { initialDraw: 4 },
    });
    const slime = d.state.enemies[0];
    d.start();
    bringToHand(d, 'transmute');

    d.play('transmute');
    expect(d.pendingInput?.request.kind).toBe('selectHandCard');
    const target = d.state.zones.hand.find(c => c.defId === 'punch');

    d.respond([target.uniqueID]);
    expect(target.defId).toBe('inflame');
    expect(zoneOf(d.state, target.uniqueID)).toBe('hand'); // 原地转化，仍在手牌

    d.play(target.uniqueID); // 按点火结算：3 伤 + 5 层燃烧
    expect(slime.hp).toBe(20 - 3);
    expect(slime.getEffectStacks('burn')).toBe(5);
  });
});

describe('转化：激活中的咏唱卡', () => {
  it('转化后 activated 订阅一并注销，isActivated 复位，卡留手牌', () => {
    const d = new BattleDriver({
      deck: ['focusChant', 'punch', 'punch', 'punch'],
      enemies: ['slime'], seed: 5, config: { initialDraw: 4 },
    });
    d.start();
    bringToHand(d, 'focusChant');

    d.play('focusChant');
    const chant = d.state.zones.hand.find(c => c.defId === 'focusChant');
    expect(chant.isActivated).toBe(true);
    const owned = () => d.kernel.subscriptions.filter(s => s.owner === chant.uniqueID);
    expect(owned().length).toBeGreaterThan(0);

    d.dispatch(new TransformCardInstruction({ uniqueID: chant.uniqueID, toDefId: 'punch' }));
    expect(chant.defId).toBe('punch');
    expect(chant.isActivated).toBe(false);
    expect(owned()).toHaveLength(0); // activated 与常驻同 owner，一并注销
    expect(zoneOf(d.state, chant.uniqueID)).toBe('hand'); // zone 不动（由技能逻辑负责）
  });
});
