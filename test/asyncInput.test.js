import { describe, it, expect } from 'vitest';
import '../src/core/content/index.js';
import { BattleDriver } from '../src/core/sdk/driver.js';
import { registerSkill } from '../src/core/skills/registry.js';
import { zoneOf, moveCard, handNeighbors, firstAliveEnemy } from '../src/core/state/battleState.js';
import { handNeighborsAtPlay } from '../src/core/skills/helpers.js';
import AwaitPlayerInputInstruction from '../src/core/instructions/input.js';
import { BurnCardInstruction, DiscardCardInstruction, MoveCardInstruction } from '../src/core/instructions/cards.js';
import { DealDamageInstruction } from '../src/core/instructions/combat.js';
import { EnemyTurnStartInstruction } from '../src/core/instructions/turn.js';
import { PLAYER_BASE_HP } from '../src/core/state/player.js';

// ---- 异步结算（结算期玩家输入）鲁棒性批次 ----
// 压测 WAIT 挂起/恢复、连续多段输入、非玩家回合输入、守卫与终局截断。

// 完美飞刀：焚掉两侧手牌，然后从牌库中检索一张牌入手（选牌输入在结算中段）
registerSkill({
  id: 'perfectDagger', name: '完美飞刀',
  cost: { mana: 0, actionPoint: 1 },
  use(sctx, stage) {
    if (stage === 0) {
      const { left, right } = handNeighborsAtPlay(sctx); // 出牌时点邻位（结算中自身已离手进 pending）
      for (const card of [left, right]) {
        if (card) sctx.kernel.submitInstruction(new BurnCardInstruction({ uniqueID: card.uniqueID }));
      }
      return false;
    }
    if (stage === 1) {
      if (sctx.battleState.zones.deck.length === 0) return true; // 无牌可找，提前收尾
      sctx.self._input = new AwaitPlayerInputInstruction({
        request: {
          kind: 'selectDeckCard', count: 1,
          candidates: sctx.battleState.zones.deck.map(c => c.uniqueID),
        },
      });
      sctx.kernel.submitInstruction(sctx.self._input);
      return false;
    }
    const [uniqueID] = sctx.self._input.result.selection;
    sctx.self._input = null;
    sctx.kernel.submitInstruction(new MoveCardInstruction({ uniqueID, toZone: 'hand' }));
    return true;
  },
});

// 双问（测试卡）：一次结算内连续两次请求选牌，应答后各弃一张
registerSkill({
  id: 'doubleAsk', name: '双问',
  cost: { mana: 0, actionPoint: 1 },
  use(sctx, stage) {
    if (stage === 0) {
      sctx.self._a = new AwaitPlayerInputInstruction({ request: { kind: 'selectHandCard', count: 1 } });
      sctx.kernel.submitInstruction(sctx.self._a);
      return false;
    }
    if (stage === 1) {
      sctx.self._b = new AwaitPlayerInputInstruction({ request: { kind: 'selectHandCard', count: 1 } });
      sctx.kernel.submitInstruction(sctx.self._b);
      return false;
    }
    const [a] = sctx.self._a.result.selection;
    const [b] = sctx.self._b.result.selection;
    sctx.self._a = null;
    sctx.self._b = null;
    sctx.kernel.submitInstruction(new DiscardCardInstruction({ uniqueID: a }));
    sctx.kernel.submitInstruction(new DiscardCardInstruction({ uniqueID: b }));
    return true;
  },
});

// 反制架势（测试卡）：下一次敌方回合开始时请求玩家确认，确认则反击 7 伤。
// 订阅触发里无法走技能多阶段，输入指令子类化挂后续动作。
class CounterInputInstruction extends AwaitPlayerInputInstruction {
  execute(ctx) {
    const done = super.execute(ctx);
    if (done === true && this.result.selection === true) {
      ctx.kernel.submitInstruction(new DealDamageInstruction({
        source: ctx.player, target: firstAliveEnemy(ctx.battleState), amount: 7,
      }), this);
    }
    return done;
  }
}

registerSkill({
  id: 'counterStance', name: '反制架势',
  cost: { mana: 0, actionPoint: 1 },
  use(sctx) {
    sctx.kernel.addSubscription({
      when: EnemyTurnStartInstruction, phase: 'post', window: 'once',
      react: (instr, ctx) => ctx.kernel.submitInstruction(
        new CounterInputInstruction({ request: { kind: 'confirm' } }), instr),
    });
    return true;
  },
});

// 致命一刀（测试卡）：stage 0 高额伤害，stage 1 请求选牌——用于验证终局截断
registerSkill({
  id: 'lethalCut', name: '致命一刀',
  cost: { mana: 0, actionPoint: 1 },
  use(sctx, stage) {
    if (stage === 0) {
      sctx.kernel.submitInstruction(new DealDamageInstruction({
        source: sctx.player, target: firstAliveEnemy(sctx.battleState), amount: 50,
      }));
      return false;
    }
    if (stage === 1) {
      sctx.self._input = new AwaitPlayerInputInstruction({ request: { kind: 'selectHandCard', count: 1 } });
      sctx.kernel.submitInstruction(sctx.self._input);
      return false;
    }
    return true;
  },
});

// 把手牌中 defId 对应的牌挪到指定位置（测试布置）
function placeAt(driver, defId, index) {
  const hand = driver.state.zones.hand;
  const i = hand.findIndex(c => c.defId === defId);
  const [card] = hand.splice(i, 1);
  hand.splice(index, 0, card);
  return card;
}

describe('异步结算：完美飞刀（焚两侧 + 牌库检索）', () => {
  it('焚掉两侧手牌 → WAIT 选牌库牌 → 应答后入手，可立即打出', () => {
    const d = new BattleDriver({
      deck: ['perfectDagger', 'punch', 'punch', 'punch', 'punch', 'punch'],
      enemies: ['slime'], seed: 3, config: { initialDraw: 4 },
    });
    const slime = d.state.enemies[0];
    d.start();

    // 洗牌不落定起手，直接布置：完美飞刀移入手牌并放到 index 1（确保两侧有牌）
    const pdRuntime = [...d.state.zones.hand, ...d.state.zones.deck]
      .find(c => c.defId === 'perfectDagger');
    if (zoneOf(d.state, pdRuntime.uniqueID) !== 'hand') {
      moveCard(d.state, pdRuntime.uniqueID, 'hand');
    }
    const pd = placeAt(d, 'perfectDagger', 1);
    const { left, right } = handNeighbors(d.state, pd.uniqueID);
    const handBefore = d.state.zones.hand.length;

    d.play('perfectDagger');
    expect(zoneOf(d.state, left.uniqueID)).toBe('burnt');
    expect(zoneOf(d.state, right.uniqueID)).toBe('burnt');
    expect(d.state.history.battle.burnt).toBe(2);
    expect(d.pendingInput?.request.kind).toBe('selectDeckCard');
    expect(d.pendingInput.request.candidates.sort())
      .toEqual(d.state.zones.deck.map(c => c.uniqueID).sort());

    const picked = d.state.zones.deck.at(-1);
    d.respond([picked.uniqueID]);
    expect(zoneOf(d.state, picked.uniqueID)).toBe('hand');
    expect(d.pendingInput).toBeNull();
    expect(d.isWaiting()).toBe(true); // 回到回合级等待
    // 手牌：布置数 - 2焚 - 1完美飞刀自身 + 1检索
    expect(d.state.zones.hand).toHaveLength(handBefore - 2);

    d.play(picked.uniqueID); // 检索来的牌可立即使用
    expect(slime.hp).toBe(20 - 6);
  });

  it('牌库为空时跳过检索，不产生输入请求', () => {
    const d = new BattleDriver({
      deck: ['perfectDagger', 'punch', 'punch', 'punch'],
      enemies: ['slime'], seed: 3, config: { initialDraw: 4 },
    });
    d.start();
    expect(d.state.zones.deck).toHaveLength(0);

    d.play('perfectDagger');
    expect(d.calls('requestInput')).toHaveLength(0);
    expect(d.pendingInput).toBeNull();
    expect(d.isWaiting()).toBe(true);
  });
});

describe('异步结算：连续多段输入（双问）', () => {
  it('第一次应答后泵再次挂起于第二个请求，全部应答后结算收尾', () => {
    const d = new BattleDriver({
      deck: ['doubleAsk', 'punch', 'punch', 'punch'],
      enemies: ['slime'], seed: 3, config: { initialDraw: 4 },
    });
    d.start();

    d.play('doubleAsk');
    expect(d.pendingInput).toBeTruthy();
    expect(d.isWaiting()).toBe(false);

    const [a, b] = d.state.zones.hand.filter(c => c.defId === 'punch');
    d.respond([a.uniqueID]);
    // 第一次应答后：不是回合级等待，而是挂起在第二个输入请求上
    expect(d.isWaiting()).toBe(false);
    expect(d.pendingInput).toBeTruthy();
    expect(zoneOf(d.state, a.uniqueID)).toBe('hand'); // 弃牌发生在全部应答之后

    d.respond([b.uniqueID]);
    expect(zoneOf(d.state, a.uniqueID)).toBe('deck'); // 弃牌 = 落牌库底（FIFO 数组尾）
    expect(zoneOf(d.state, b.uniqueID)).toBe('deck');
    // FIFO：先 a 后 b 依次压尾，双问自身收尾居末位
    expect(d.state.zones.deck.at(-3).uniqueID).toBe(a.uniqueID);
    expect(d.state.zones.deck.at(-2).uniqueID).toBe(b.uniqueID);
    expect(d.state.zones.deck.at(-1).defId).toBe('doubleAsk');
    expect(d.pendingInput).toBeNull();
    expect(d.isWaiting()).toBe(true);
    expect(d.calls('requestInput')).toHaveLength(2);
  });
});

describe('异步结算：输入挂起期间的守卫', () => {
  it('待应答时出牌/结束回合被拒绝，重复应答被拒绝', () => {
    const d = new BattleDriver({
      deck: ['doubleAsk', 'punch', 'punch', 'punch'],
      enemies: ['slime'], seed: 3, config: { initialDraw: 4 },
    });
    d.start();

    d.play('doubleAsk');
    expect(() => d.play('punch')).toThrow('出牌失败');
    expect(() => d.endTurn()).toThrow('无法结束回合');

    const [a, b] = d.state.zones.hand.filter(c => c.defId === 'punch');
    d.respond([a.uniqueID]);
    expect(() => d.endTurn()).toThrow('无法结束回合'); // 第二个请求挂起中依然拒绝

    d.respond([b.uniqueID]);
    expect(() => d.respond([a.uniqueID])).toThrow('当前没有待应答的输入请求');
    expect(d.isWaiting()).toBe(true);
  });

  it('runToEnd 遇到结算期输入会抛错而非死循环', () => {
    const d = new BattleDriver({
      deck: ['perfectDagger', 'punch', 'punch', 'punch', 'punch'],
      enemies: ['slime'], seed: 3, config: { initialDraw: 4 },
    });
    d.start();
    let first = true;
    expect(() => d.runToEnd({
      policy: () => { if (first) { first = false; return 'perfectDagger'; } return null; },
    })).toThrow('结算期输入');
  });
});

describe('异步结算：非玩家回合的输入（反制架势）', () => {
  it('敌方回合开始触发确认输入，确认则反击，随后敌方行动照常', () => {
    const d = new BattleDriver({
      deck: ['counterStance', 'punch', 'punch', 'punch'],
      enemies: ['slime'], seed: 3, config: { initialDraw: 4 },
    });
    const slime = d.state.enemies[0];
    d.start();

    d.play('counterStance');
    d.endTurn(); // 进入敌方回合：回合开始结算触发输入请求
    expect(d.state.turn.side).toBe('enemy');
    expect(d.pendingInput?.request.kind).toBe('confirm');
    expect(d.isWaiting()).toBe(false);
    expect(() => d.play('punch')).toThrow(); // 敌方回合本就不可出牌

    d.respond(true); // 确认反击
    expect(slime.hp).toBe(20 - 7);
    expect(d.player.hp).toBe(PLAYER_BASE_HP - 6); // 反击后敌方行动照常结算
    expect(d.isWaiting()).toBe(true);  // 回到下一玩家回合
    expect(d.state.turn.side).toBe('player');
  });

  it('拒绝则不反击，敌方行动照常', () => {
    const d = new BattleDriver({
      deck: ['counterStance', 'punch', 'punch', 'punch'],
      enemies: ['slime'], seed: 3, config: { initialDraw: 4 },
    });
    const slime = d.state.enemies[0];
    d.start();

    d.play('counterStance');
    d.endTurn();
    d.respond(false);
    expect(slime.hp).toBe(20);
    expect(d.player.hp).toBe(PLAYER_BASE_HP - 6);
    expect(d.isWaiting()).toBe(true);
  });
});

describe('异步结算：终局截断', () => {
  it('伤害阶段致死即终局，后续输入阶段不再执行，无残留请求', () => {
    const d = new BattleDriver({
      deck: ['lethalCut', 'punch', 'punch', 'punch'],
      enemies: ['slime'], seed: 3, config: { initialDraw: 4 },
    });
    d.start();

    d.play('lethalCut'); // 50 伤直接击杀
    expect(d.verdict).toBe('victory');
    expect(d.isFinished()).toBe(true);
    expect(d.calls('requestInput')).toHaveLength(0); // 输入阶段被终局截断
    expect(d.pendingInput).toBeNull();
    expect(d.kernel.subscriptions).toHaveLength(0);
  });
});
