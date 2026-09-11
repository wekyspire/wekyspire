import { describe, it, expect } from 'vitest';
import '../src/core/content/index.js';
import { BattleDriver } from '../src/core/sdk/driver.js';
import { registerSkill, getSkillDefinition } from '../src/core/skills/registry.js';
import { zoneOf, moveCard, firstAliveEnemy } from '../src/core/state/battleState.js';
import AwaitPlayerInputInstruction from '../src/core/instructions/input.js';
import {
  AddCardInstruction, DiscardCardInstruction, DrawCardsInstruction, MoveCardInstruction,
} from '../src/core/instructions/cards.js';
import { DealDamageInstruction } from '../src/core/instructions/combat.js';
import { PlayerTurnEndInstruction } from '../src/core/instructions/turn.js';

// ---- 铸牌/回库体系原型：开刃·锻刀（回合结束自动回牌库）、真空斩（随机插虚无）----
// 压测：TurnEnd POST zone 迁移（once 订阅）、rng 随机落点造牌（AddCardInstruction）。

// 回合结束自动回牌库：消耗性卡牌共用模式（开刃/锻刀/斩灭）。
// 出牌时注册 once 订阅，卡在焚毁区则在回合结束 POST 移回牌库。
function returnToDeckAtTurnEnd(sctx) {
  sctx.kernel.addSubscription({
    when: PlayerTurnEndInstruction, phase: 'post', window: 'once',
    filter: (instr, ctx) => zoneOf(ctx.battleState, sctx.self.uniqueID) === 'burnt',
    react: (instr, ctx) => ctx.kernel.submitInstruction(
      new MoveCardInstruction({ uniqueID: sctx.self.uniqueID, toZone: 'deck' }), instr),
  });
}

// 测试刀法牌：1 充能 2 回合冷却，keywords 带 blade
registerSkill({
  id: 'testBlade', name: '测试刀',
  cost: { mana: 0, actionPoint: 1 },
  keywords: ['blade'],
  charges: { max: 1, cooldownTurns: 2 },
  use(sctx) {
    sctx.kernel.submitInstruction(new DealDamageInstruction({
      source: sctx.player, target: firstAliveEnemy(sctx.battleState), amount: 4,
    }));
    return true;
  },
});

// 开刃（消耗性）：即刻冷却手中全部刀法牌；回合结束时自动进入牌库
registerSkill({
  id: 'honeEdge', name: '开刃',
  cost: { mana: 0, actionPoint: 1 },
  keywords: ['exhaust'],
  use(sctx) {
    returnToDeckAtTurnEnd(sctx);
    for (const card of sctx.battleState.zones.hand) {
      const def = getSkillDefinition(card.defId);
      if (!def.keywords?.includes('blade')) continue;
      card.currentCooldown = 0;
      card.remainingUses = def.charges?.max ?? card.remainingUses;
    }
    return true;
  },
});

// 锻刀（消耗性）：选一张手中刀法牌 power +3 并丢弃；回合结束时自动进入牌库
registerSkill({
  id: 'forgeBlade', name: '锻刀',
  cost: { mana: 0, actionPoint: 1 },
  keywords: ['exhaust'],
  use(sctx, stage) {
    if (stage === 0) {
      returnToDeckAtTurnEnd(sctx);
      const blades = sctx.battleState.zones.hand.filter(c =>
        c.uniqueID !== sctx.self.uniqueID
        && getSkillDefinition(c.defId).keywords?.includes('blade'));
      if (blades.length === 0) return true; // 无刀可锻，直接收尾
      sctx.self._input = new AwaitPlayerInputInstruction({
        request: { kind: 'selectCards', source: 'hand', count: 1, candidates: blades.map(c => c.uniqueID) },
      });
      sctx.kernel.submitInstruction(sctx.self._input);
      return false;
    }
    const [uniqueID] = sctx.self._input.result.selection;
    sctx.self._input = null;
    const blade = sctx.battleState.zones.hand.find(c => c.uniqueID === uniqueID);
    blade.power += 3;
    sctx.kernel.submitInstruction(new DiscardCardInstruction({ uniqueID }));
    return true;
  },
});

// 虚无：0 开销、无效果的填充牌（真空斩/假动作等插入牌库用）
registerSkill({
  id: 'voidCard', name: '虚无',
  cost: { mana: 0, actionPoint: 0 },
  use() { return true; },
});

// 真空斩：10 伤，并向牌库随机插入一张虚无
registerSkill({
  id: 'vacuumSlash', name: '真空斩',
  cost: { mana: 0, actionPoint: 1 },
  use(sctx) {
    sctx.kernel.submitInstruction(new DealDamageInstruction({
      source: sctx.player, target: firstAliveEnemy(sctx.battleState), amount: 10,
    }));
    sctx.kernel.submitInstruction(new AddCardInstruction({
      defId: 'voidCard', toZone: 'deck', index: 'random',
    }));
    return true;
  },
});

// 假动作（拳组合深入）：0AP 抽 3 张，并向牌库随机插入等量虚无
registerSkill({
  id: 'feint', name: '假动作',
  cost: { mana: 0, actionPoint: 0 },
  keywords: ['exhaust'],
  use(sctx, stage) {
    if (stage === 0) {
      sctx.self._draw = new DrawCardsInstruction({ count: 3 });
      sctx.kernel.submitInstruction(sctx.self._draw);
      return false;
    }
    const n = sctx.self._draw.result.drawn.length; // 等量：按实际抽到的计
    sctx.self._draw = null;
    for (let i = 0; i < n; i++) {
      sctx.kernel.submitInstruction(new AddCardInstruction({
        defId: 'voidCard', toZone: 'deck', index: 'random',
      }));
    }
    return true;
  },
});

// 洗牌不定起手：把指定牌挪进手牌（测试布置）
function bringToHand(d, defId) {
  const card = d.state.zones.deck.find(c => c.defId === defId);
  if (card) moveCard(d.state, card.uniqueID, 'hand');
}

describe('开刃：即刻冷却手中刀法牌 + 回合结束回牌库', () => {
  it('手中冷却中的刀法牌立刻可用；开刃焚毁后在回合结束回到牌库', () => {
    const d = new BattleDriver({
      deck: ['testBlade', 'honeEdge', 'punch', 'punch'],
      enemies: ['slime'], seed: 5, config: { initialDraw: 4, drawPerTurn: 0 },
    });
    const slime = d.state.enemies[0];
    d.start();

    // PreBattle 按定义重置充能，这里直接布置"已用过、冷却中"的状态
    const blade = d.state.zones.hand.find(c => c.defId === 'testBlade');
    blade.remainingUses = 0;
    blade.currentCooldown = 2;

    d.play('honeEdge');
    expect(blade.currentCooldown).toBe(0);
    expect(blade.remainingUses).toBe(1);
    expect(zoneOf(d.state, d.state.zones.burnt[0].uniqueID)).toBe('burnt');

    d.play('testBlade'); // 即刻冷却生效，本回合即可打出
    expect(slime.hp).toBe(20 - 4);

    const honeEdge = d.state.zones.burnt.find(c => c.defId === 'honeEdge');
    d.endTurn();
    expect(zoneOf(d.state, honeEdge.uniqueID)).toBe('deck'); // 回合结束自动回库
    expect(d.kernel.subscriptions.filter(s => s.window === 'once')).toHaveLength(0); // once 触发后注销
  });
});

describe('锻刀：选牌强化并丢弃 + 回合结束回牌库', () => {
  it('选刀 power +3 落牌库底；锻刀焚毁后回合结束回库；FIFO 循环后强化保留', () => {
    const d = new BattleDriver({
      deck: ['forgeBlade', 'testBlade', 'punch', 'punch'],
      enemies: ['slime'], seed: 5, config: { initialDraw: 4 },
    });
    d.start();

    d.play('forgeBlade');
    expect(d.pendingInput?.request.kind).toBe('selectCards');
    const blade = d.state.zones.hand.find(c => c.defId === 'testBlade');
    expect(d.pendingInput.request.candidates).toEqual([blade.uniqueID]); // 只可选刀法牌

    d.respond([blade.uniqueID]);
    expect(blade.power).toBe(3);
    expect(zoneOf(d.state, blade.uniqueID)).toBe('deck'); // 弃牌 = 落牌库底（FIFO 数组尾）
    expect(d.state.zones.deck.at(-1).uniqueID).toBe(blade.uniqueID);
    const forge = d.state.zones.burnt.find(c => c.defId === 'forgeBlade');
    expect(forge).toBeTruthy();

    d.endTurn(); // 锻刀回合结束回牌库（FIFO 落在测试刀之后）；回合 2 从牌库头依次抽回两张
    expect(zoneOf(d.state, forge.uniqueID)).not.toBe('burnt');
    const bladeNow = [...d.state.zones.hand, ...d.state.zones.deck]
      .find(c => c.uniqueID === blade.uniqueID);
    expect(bladeNow.power).toBe(3); // 强化随卡保留，不因 zone 迁移丢失
    expect(d.handIds()).toContain('forgeBlade'); // 回库后被重新抽到
  });
});

describe('真空斩：向牌库随机插入虚无', () => {
  it('造牌经 AddCardInstruction 入场，同种子落点可复现', () => {
    const make = () => new BattleDriver({
      deck: ['vacuumSlash', ...Array(7).fill('punch')],
      enemies: ['slime'], seed: 9, config: { initialDraw: 4 },
    });
    const d1 = make();
    const d2 = make();
    for (const d of [d1, d2]) {
      d.start();
      bringToHand(d, 'vacuumSlash');
      d.play('vacuumSlash');
    }

    const slime = d1.state.enemies[0];
    expect(slime.hp).toBe(20 - 10);

    const voids1 = d1.state.zones.deck.filter(c => c.defId === 'voidCard');
    expect(voids1).toHaveLength(1);
    const idx1 = d1.state.zones.deck.findIndex(c => c.defId === 'voidCard');
    const idx2 = d2.state.zones.deck.findIndex(c => c.defId === 'voidCard');
    expect(idx1).toBe(idx2); // 同种子同落点
    expect(d1.calls('cardAdded')).toHaveLength(1);

    // 虚无 0 开销：抽上手后可无成本打出且不产生任何效果
    moveCard(d1.state, voids1[0].uniqueID, 'hand');
    const hpBefore = slime.hp;
    d1.play(voids1[0].uniqueID);
    expect(slime.hp).toBe(hpBefore);
    expect(d1.player.actionPoints).toBe(3 - 1); // 只有真空斩花了 1 AP
  });
});

describe('假动作：0AP 抽牌并插入等量虚无', () => {
  it('抽 3 插 3，不耗行动力，牌库总数守恒', () => {
    const d = new BattleDriver({
      deck: ['feint', ...Array(9).fill('punch')],
      enemies: ['slime'], seed: 5, config: { initialDraw: 4 },
    });
    d.start();
    bringToHand(d, 'feint');
    const deckBefore = d.state.zones.deck.length;
    const handBefore = d.state.zones.hand.length;

    d.play('feint');
    expect(d.player.actionPoints).toBe(3); // 0AP
    expect(d.state.zones.hand).toHaveLength(handBefore + 3 - 1); // 抽3，自身入焚毁区
    expect(d.state.zones.deck.filter(c => c.defId === 'voidCard')).toHaveLength(3);
    expect(d.state.zones.deck).toHaveLength(deckBefore - 3 + 3); // 抽3插3，守恒
    expect(zoneOf(d.state, d.state.zones.burnt.at(-1).uniqueID)).toBe('burnt');
  });
});
