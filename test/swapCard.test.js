import { describe, it, expect } from 'vitest';
import '../src/core/content/index.js';
import { BattleDriver } from '../src/core/sdk/driver.js';
import { registerSkill } from '../src/core/skills/registry.js';
import { registerAbility } from '../src/core/abilities/registry.js';
import { zoneOf, moveCard, swapCostOf } from '../src/core/state/battleState.js';
import { AddEffectInstruction } from '../src/core/instructions/effects.js';
import { DrawCardsInstruction } from '../src/core/instructions/cards.js';
import { PlayerTurnStartInstruction } from '../src/core/instructions/turn.js';

// ---- 换牌流程 / 咏唱槽扩容 / 锚定咏唱原型 ----
// 换牌语义对齐旧仓库：费用 = swapBaseCost(0) + 本场换牌次数，逐次 +1；
// 刀客/刀圣封顶（cap），归元秘术重置次数。

// 精英能力·刀客：换卡开销不超过 3
registerAbility({
  id: 'bladeDisciple', name: '刀客',
  onBattleStart: (ctx) => { ctx.battleState.swapCostCap = 3; },
});

// 精英能力·心宽：手牌上限 +2（咏唱槽时代「武神加槽」的继任者——咏唱压力统一进
// 手牌上限，扩容 = 更多咏唱空间）
registerAbility({
  id: 'vastMind', name: '心宽',
  onBattleStart: (ctx) => { ctx.player.maxHandSize += 2; },
});

// 归元秘术（消耗性）：重置换牌行动力消耗
registerSkill({
  id: 'resetOrigin', name: '归元秘术',
  cost: { mana: 0, actionPoint: 0 },
  keywords: ['exhaust'],
  use(sctx) {
    sctx.battleState.swapCount = 0;
    return true;
  },
});

// 燃心决（咏唱，anchored）：无法撤下；回合开始获得 1 层燃烧
registerSkill({
  id: 'burnHeartMantra', name: '燃心决',
  cost: { mana: 0, actionPoint: 1 },
  cardMode: 'chant',
  keywords: ['anchored'],
  use() { return true; },
  activated: {
    subscriptions: (sctx) => [{
      when: PlayerTurnStartInstruction, phase: 'post',
      react: (instr, ctx) => ctx.kernel.submitInstruction(new AddEffectInstruction({
        target: ctx.player, effectId: 'burn', stacks: 1,
      }), instr),
    }],
  },
});

function bringToHand(d, defId) {
  const card = d.state.zones.deck.find(c => c.defId === defId);
  if (card) moveCard(d.state, card.uniqueID, 'hand');
}

describe('换牌：费用阶梯', () => {
  it('首次 0 AP，逐次 +1；费用不足时被拒', () => {
    const d = new BattleDriver({
      deck: Array(9).fill('punch'),
      enemies: ['slime'], seed: 5, config: { initialDraw: 4 },
    });
    d.start();
    expect(swapCostOf(d.state)).toBe(0);

    const first = d.state.zones.hand[0];
    d.swap(first.uniqueID); // 0 AP
    expect(d.player.actionPoints).toBe(3);
    expect(zoneOf(d.state, first.uniqueID)).toBe('deck'); // 换牌弃置 = 落牌库底（FIFO 数组尾）
    expect(d.state.zones.deck.at(-1).uniqueID).toBe(first.uniqueID);
    expect(d.state.zones.hand).toHaveLength(4); // 弃 1 抽 1
    expect(d.state.swapCount).toBe(1);

    d.swap('punch'); // 1 AP
    expect(d.player.actionPoints).toBe(2);
    d.swap('punch'); // 2 AP
    expect(d.player.actionPoints).toBe(0);
    expect(d.state.swapCount).toBe(3);

    expect(swapCostOf(d.state)).toBe(3);
    expect(() => d.swap('punch')).toThrow('无法换牌'); // 费用不足
  });
});

describe('换牌：刀客封顶', () => {
  it('费用 cap 3：跨回合第 5 次换牌仍只要 3 AP；无能力时第 5 次要 4 AP 被拒', () => {
    const withCap = new BattleDriver({
      deck: Array(12).fill('punch'),
      enemies: ['slime'], abilities: ['bladeDisciple'], seed: 5, config: { initialDraw: 4 },
    });
    withCap.start();
    withCap.swap('punch'); // 0
    withCap.swap('punch'); // 1
    withCap.swap('punch'); // 2 → AP 0
    withCap.endTurn();
    withCap.swap('punch'); // min(3,3)=3 → AP 0
    withCap.endTurn();
    expect(swapCostOf(withCap.state)).toBe(3); // min(4, 3)
    withCap.swap('punch'); // 仍 3 AP
    expect(withCap.state.swapCount).toBe(5);

    const noCap = new BattleDriver({
      deck: Array(12).fill('punch'),
      enemies: ['slime'], seed: 5, config: { initialDraw: 4 },
    });
    noCap.start();
    noCap.swap('punch');
    noCap.swap('punch');
    noCap.swap('punch');
    noCap.endTurn();
    noCap.swap('punch'); // 3
    noCap.endTurn();
    expect(swapCostOf(noCap.state)).toBe(4);
    expect(() => noCap.swap('punch')).toThrow('无法换牌'); // 4 > 3 AP
  });
});

describe('归元秘术：重置换牌费用', () => {
  it('两次换牌后打出归元秘术，下次换牌回到 0 AP', () => {
    const d = new BattleDriver({
      deck: ['resetOrigin', ...Array(9).fill('punch')],
      enemies: ['slime'], seed: 5, config: { initialDraw: 5 },
    });
    d.start();
    bringToHand(d, 'resetOrigin');

    d.swap('punch'); // 0
    d.swap('punch'); // 1 → AP 2
    expect(d.player.actionPoints).toBe(2);

    d.play('resetOrigin'); // 0 AP，消耗入焚毁区
    expect(d.state.swapCount).toBe(0);

    d.swap('punch'); // 重新从 0 计
    expect(d.player.actionPoints).toBe(2);
    expect(d.state.swapCount).toBe(1);
  });
});

describe('咏唱：手牌压力统一（无激活数上限）', () => {
  it('发动合法性：激活后加权手牌数 ≤ 手牌上限，不足被拒；无数量上限可多张并存', () => {
    const d = new BattleDriver({
      deck: ['focusChant', 'focusChant', 'punch', 'punch', 'punch'],
      enemies: ['slime'], seed: 5, config: { initialDraw: 5 },
      player: { maxMana: 5, maxHandSize: 8 },
    });
    d.start();
    // 手 5 张（含咏唱3×2、加权 5）：激活一张 → 5+2 = 7 ≤ 8 可行
    d.play('focusChant');
    expect(d.state.zones.hand.filter(c => c.isActivated)).toHaveLength(1);
    // 再激活第二张（咏唱3）：7+2 = 9 > 8 被拒——压力阀门在手牌上限，不在咏唱数量
    //（play 按名解析会命中已激活那张 = 免费解除，须按 uniqueID 指定未激活者）
    const second = d.state.zones.hand.find(c => c.defId === 'focusChant' && !c.isActivated);
    expect(() => d.play(second.uniqueID)).toThrow(/无法出牌|出牌失败/);
    // 出一张拳（加权 6）后：6+2 = 8 ≤ 8 第二张也可发动（双咏唱并存）
    d.play('punch');
    d.play(second.uniqueID);
    expect(d.state.zones.hand.filter(c => c.isActivated)).toHaveLength(2);
    expect(d.state.zones.hand.filter(c => c.defId === 'focusChant')).toHaveLength(2); // 都住手牌
  });

  it('加权满手：激活咏唱占位阻断抽牌；免费解除回牌库释放压力', () => {
    const d = new BattleDriver({
      deck: ['focusChant', ...Array(6).fill('punch')],
      enemies: ['slime'], seed: 5, config: { initialDraw: 4, drawPerTurn: 0 },
      player: { maxMana: 5, maxHandSize: 6 },
    });
    d.start(); // 手 4 张：咏唱 + 3 拳
    d.play('punch'); // 手 3（加权 3）
    d.play('focusChant'); // 激活（咏唱3）：加权 3+2 = 5
    d.dispatch(new DrawCardsInstruction({ count: 3 })); // 5+1 = 6 到上限 → 只抽 1
    expect(d.state.zones.hand).toHaveLength(4);
    d.dispatch(new DrawCardsInstruction({ count: 1 })); // 加权 6 满：不抽
    expect(d.state.zones.hand).toHaveLength(4);

    // 再次打出（免费）→ 解除并回牌库：压力随离手释放，抽牌恢复
    const mana0 = d.player.mana;
    const ap0 = d.player.actionPoints;
    const chant = d.state.zones.hand.find(c => c.defId === 'focusChant');
    d.play('focusChant');
    expect(chant.isActivated).toBe(false);
    expect(zoneOf(d.state, chant.uniqueID)).toBe('deck');
    expect(d.player.mana).toBe(mana0); // 免费解除
    expect(d.player.actionPoints).toBe(ap0);
    d.dispatch(new DrawCardsInstruction({ count: 2 })); // 手 3（加权 3）→ 可抽 2
    expect(d.state.zones.hand).toHaveLength(5);
  });

  it('扩容能力（心宽）：上限 +2 → 同局面下原本被拒的发动可行', () => {
    const base = {
      deck: ['focusChant', 'punch', 'punch', 'punch', 'punch', 'punch'],
      enemies: ['slime'], seed: 5, config: { initialDraw: 5, drawPerTurn: 0 },
    };
    const d = new BattleDriver({ ...base, player: { maxMana: 5, maxHandSize: 5 } });
    d.start(); // 手 5（加权 5）：激活咏唱3 → 5+2 = 7 > 5 被拒
    expect(() => d.play('focusChant')).toThrow('无法出牌');

    const d2 = new BattleDriver({ ...base, abilities: ['vastMind'], player: { maxMana: 5, maxHandSize: 5 } });
    d2.start();
    expect(d2.player.maxHandSize).toBe(7); // 能力生效
    d2.play('focusChant'); // 5+2 = 7 ≤ 7 可行
    expect(d2.state.zones.hand.find(c => c.defId === 'focusChant').isActivated).toBe(true);
  });
});

describe('燃心决：锁定（anchored）不可主动解除', () => {
  it('已激活的 anchored 咏唱不可再打出；被弃（离手）时照常熄灭', () => {
    const d = new BattleDriver({
      deck: ['burnHeartMantra', 'punch', 'punch', 'punch', 'punch', 'punch'],
      enemies: ['slime'], seed: 5, config: { initialDraw: 4 },
    });
    d.start();
    d.play('burnHeartMantra');
    const mantra = d.state.zones.hand.find(c => c.defId === 'burnHeartMantra');
    expect(mantra.isActivated).toBe(true); // 发动：留手牌点亮
    const owned = () => d.kernel.subscriptions.filter(s => s.owner === mantra.uniqueID);
    expect(owned().length).toBeGreaterThan(0);

    // 锁定：连免费解除（再次打出）都不可用
    expect(() => d.play('burnHeartMantra')).toThrow('无法出牌');

    // 离手（换牌弃掉）：物理熄灭——订阅注销、效果终止（锁定只挡主动解除）
    d.swap(mantra.uniqueID);
    expect(mantra.isActivated).toBe(false);
    expect(zoneOf(d.state, mantra.uniqueID)).toBe('deck'); // 被弃（离手）= 落牌库底
    expect(d.state.zones.deck.at(-1).uniqueID).toBe(mantra.uniqueID); // FIFO 数组尾
    expect(owned()).toHaveLength(0);
  });
});
