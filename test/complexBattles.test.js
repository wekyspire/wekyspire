import { describe, it, expect, beforeEach } from 'vitest';
import '../src/core/content/index.js'; // 最小内容（punch/guard/inflame/focusChant/slime/pyro/remi/battleFocus/burn/strength）
import { BattleDriver } from '../src/core/sdk/driver.js';
import Enemy from '../src/core/state/enemy.js';
import { zoneOf, aliveAllies } from '../src/core/state/battleState.js';
import { registerEffect } from '../src/core/effects/registry.js';
import { registerSkill } from '../src/core/skills/registry.js';
import { registerEnemy, getEnemyDefinition } from '../src/core/enemies/registry.js';
import AIActInstruction from '../src/core/instructions/aiAct.js';
import AwaitPlayerInputInstruction from '../src/core/instructions/input.js';
import { AddEffectInstruction } from '../src/core/instructions/effects.js';
import { DiscardCardInstruction } from '../src/core/instructions/cards.js';
import { DrawCardsInstruction } from '../src/core/instructions/cards.js';
import { DealDamageInstruction } from '../src/core/instructions/combat.js';
import { PLAYER_BASE_HP } from '../src/core/state/player.js';

// ---- 本批次专用测试内容 ----

// 凝滞：行动被 veto，层数递减（替代指令补位）
registerEffect({
  id: 'stun', type: 'debuff', stacking: 'count',
  subscriptions: (unit) => [{
    when: AIActInstruction, phase: 'pre',
    filter: (instr) => instr.unit === unit,
    react: (instr, ctx) => {
      ctx.kernel.veto(instr, 'stunned', [
        new AddEffectInstruction({ target: unit, effectId: 'stun', stacks: -1 }),
      ]);
    },
  }],
});

// 斩灭：下一次伤害翻倍（once），生效后自我移除
registerEffect({
  id: 'execution', type: 'buff', stacking: 'boolean',
  subscriptions: (unit) => [{
    when: DealDamageInstruction, phase: 'pre', window: 'once',
    filter: (instr) => instr.source === unit,
    react: (instr) => {
      instr.setPayload('damage', instr.payload.damage * 2);
      unit.removeEffect('execution');
    },
  }],
});

// 呼吸：本回合内丢牌时抽牌（turn 窗口订阅）
registerSkill({
  id: 'breathing', name: '呼吸', cost: { mana: 0, actionPoint: 1 },
  use(sctx) {
    sctx.kernel.addSubscription({
      when: DiscardCardInstruction, phase: 'post', window: 'turn',
      react: (instr, ctx) => ctx.kernel.submitInstruction(new DrawCardsInstruction({ count: 1 }), instr),
    });
    return true;
  },
});

// 完美花刀：多阶段 + 结算期输入（造成伤害 → 自选一张手牌丢弃）
registerSkill({
  id: 'perfectCut', name: '完美花刀', cost: { mana: 0, actionPoint: 1 },
  use(sctx, stage) {
    if (stage === 0) {
      sctx.kernel.submitInstruction(new DealDamageInstruction({
        source: sctx.player,
        target: sctx.battleState.enemies.find(e => !e.isDead()),
        amount: 3,
      }));
      return false;
    }
    if (stage === 1) {
      sctx.self._input = new AwaitPlayerInputInstruction({
        request: { kind: 'selectCards', source: 'hand', count: 1 },
      });
      sctx.kernel.submitInstruction(sctx.self._input);
      return false;
    }
    const [uniqueID] = sctx.self._input.result.selection;
    sctx.self._input = null;
    sctx.kernel.submitInstruction(new DiscardCardInstruction({ uniqueID }));
    return true;
  },
});

// 猎瑞米者：优先攻击瑞米，瑞米死后攻击玩家
registerEnemy({
  id: 'remiHunter', name: '猎瑞米者',
  createUnit: () => new Enemy({ defId: 'remiHunter', name: '猎瑞米者', maxHp: 50 }),
  act(actx) {
    const remi = aliveAllies(actx.battleState)[0];
    actx.kernel.submitInstruction(new DealDamageInstruction({
      source: actx.unit, target: remi ?? actx.player, amount: 8,
    }));
  },
});

// 杀手：一击致命（失败路径专用）
registerEnemy({
  id: 'killer', name: '杀手',
  createUnit: () => new Enemy({ defId: 'killer', name: '杀手', maxHp: 50 }),
  act(actx) {
    actx.kernel.submitInstruction(new DealDamageInstruction({
      source: actx.unit, target: actx.player, amount: 100,
    }));
  },
});

beforeEach(() => { /* 内容注册为模块级副作用，重复注册同 id 覆盖即可 */ });

describe('复杂战斗：多敌人', () => {
  it('默认目标为首个存活敌人；前排死亡后自动指向后排；敌人按数组序行动', () => {
    const d = new BattleDriver({
      deck: ['punch', 'punch', 'punch', 'punch', 'punch', 'punch'],
      enemies: ['slime', 'slime'],
      seed: 3,
    });
    const [e1, e2] = d.state.enemies;
    d.start();

    // 回合 1：三拳打前排
    d.playAll(['punch', 'punch', 'punch']);
    expect(e1.hp).toBe(2);
    expect(e2.hp).toBe(20);

    // 敌方回合：两敌人按序攻击
    d.endTurn();
    const hits = d.calls('damage').filter(c => c.args[0].target === d.player);
    expect(hits.map(c => c.args[0].source)).toEqual([e1, e2]);
    expect(d.player.hp).toBe(38);

    // 回合 2：补刀前排，后续出牌自动打后排
    d.play('punch');
    expect(e1.isDead()).toBe(true);
    d.play('punch');
    expect(e2.hp).toBe(14);
  });
});

describe('复杂战斗：veto（眩晕）', () => {
  it('被眩晕的敌人行动被否决且层数递减，下回合恢复行动', () => {
    const d = new BattleDriver({ deck: ['punch', 'punch', 'punch', 'punch'], enemies: ['slime'], seed: 3 });
    const slime = d.state.enemies[0];
    d.start();

    d.dispatch(new AddEffectInstruction({ target: slime, effectId: 'stun', stacks: 1 }));
    expect(slime.getEffectStacks('stun')).toBe(1);

    d.endTurn(); // 敌方回合：行动应被 veto
    expect(d.player.hp).toBe(PLAYER_BASE_HP);
    expect(slime.getEffectStacks('stun')).toBe(0); // 替代指令补位执行，层数扣尽
    expect(slime.actionIndex).toBe(0);             // 行动未发生，游标未推进

    d.endTurn(); // 再一回合：正常行动
    expect(d.player.hp).toBe(44);
    expect(slime.actionIndex).toBe(1);
  });
});

describe('复杂战斗：once 修饰（斩灭）', () => {
  it('下一次伤害翻倍只生效一次并自我移除', () => {
    const d = new BattleDriver({ deck: ['punch', 'punch', 'punch', 'punch'], enemies: ['slime'], seed: 3 });
    const slime = d.state.enemies[0];
    d.start();

    d.dispatch(new AddEffectInstruction({ target: d.player, effectId: 'execution', stacks: 1 }));
    d.play('punch');
    expect(slime.hp).toBe(8); // 6×2
    expect(d.player.getEffect('execution')).toBeNull();
    d.play('punch');
    expect(slime.hp).toBe(2); // 第二次不再翻倍
  });
});

describe('复杂战斗：turn 窗口（呼吸）', () => {
  it('本回合弃牌抽牌；回合结束后订阅被清扫', () => {
    const d = new BattleDriver({
      deck: ['breathing', 'punch', 'punch', 'punch'],
      enemies: ['slime'], seed: 3, config: { initialDraw: 4 },
    });
    d.start();
    expect(d.handIds()).toContain('breathing');

    d.play('breathing');
    const punch = d.state.zones.hand.find(s => s.defId === 'punch');
    d.dispatch(new DiscardCardInstruction({ uniqueID: punch.uniqueID }));
    expect(d.state.history.turn.drawn).toBe(1); // 呼吸触发：丢 1 抽 1
    expect(d.state.zones.hand).toHaveLength(3); // 4 - breathing - punch + 抽1

    d.endTurn(); // turn 窗口应被清扫（回合 2 抽 3 张后手牌 3+3=6... 回合1结束手牌3，回合2抽3）
    const drawnBefore = d.state.history.battle.drawn;
    const punch2 = d.state.zones.hand.find(s => s.defId === 'punch');
    d.dispatch(new DiscardCardInstruction({ uniqueID: punch2.uniqueID }));
    expect(d.state.history.battle.drawn).toBe(drawnBefore); // 不再触发
  });
});

describe('复杂战斗：结算期输入（完美花刀）', () => {
  it('伤害 → WAIT 选牌 → 应答后弃牌，结算继续', () => {
    const d = new BattleDriver({
      deck: ['perfectCut', 'punch', 'punch', 'punch'],
      enemies: ['slime'], seed: 3, config: { initialDraw: 4 },
    });
    const slime = d.state.enemies[0];
    d.start();

    d.play('perfectCut');
    expect(slime.hp).toBe(17);                       // stage 0 伤害已结算
    expect(d.pendingInput).toBeTruthy();             // 泵停在输入请求
    expect(d.pendingInput.request.kind).toBe('selectCards');
    expect(d.isWaiting()).toBe(false);               // 不是回合级 WAIT

    const target = d.state.zones.hand.find(s => s.defId === 'punch');
    d.respond([target.uniqueID]);
    expect(zoneOf(d.state, target.uniqueID)).toBe('deck'); // 弃牌 = 落牌库底（FIFO）
    expect(d.state.zones.deck.at(-1).defId).toBe('perfectCut'); // 被弃牌先落位，完美花刀收尾居末位
    expect(d.pendingInput).toBeNull();
    expect(d.isWaiting()).toBe(true);                // 回到回合级等待
  });
});

describe('复杂战斗：队友死亡', () => {
  it('瑞米意图：开局即预告固定行动（2伤害 + 索敌说明），回合轮转后仍有效', () => {
    const d = new BattleDriver({
      deck: ['punch', 'punch', 'punch', 'punch'],
      enemies: ['slime'], allies: ['remi'], seed: 3,
    });
    d.start();
    const remi = d.state.allies[0];
    // 开局预告（与实际 act 同口径：固定 2 伤害 + 最靠前存活敌人）
    expect(remi.intention).toMatchObject({ kinds: ['attack'], hits: 1, damage: 2 });
    expect(remi.intention.note).toContain('最靠前的存活敌人');

    d.endTurn(); // 瑞米行动（P7）+ 敌方回合末意图重刷
    expect(d.state.enemies[0].hp).toBeLessThan(d.state.enemies[0].maxHp);
    expect(remi.intention).toMatchObject({ kinds: ['attack'], hits: 1, damage: 2 });
  });

  it('瑞米被杀后不再行动，战斗继续，猎人转火玩家', () => {
    const d = new BattleDriver({
      deck: ['punch', 'punch', 'punch', 'punch'],
      enemies: ['remiHunter'], allies: ['remi'], seed: 3,
    });
    const hunter = d.state.enemies[0];
    const remi = d.state.allies[0];
    d.start();
    expect(hunter.hp).toBe(50); // 盟友在玩家回合结束后行动（P7）：起手瑞米未动

    d.endTurn(); // 玩家回合结束 → 瑞米行动（50→48）；敌方回合猎人打瑞米 8
    expect(hunter.hp).toBe(48);
    expect(remi.hp).toBe(7);

    d.endTurn(); // 瑞米再动（48→46），猎人击杀瑞米
    expect(hunter.hp).toBe(46);
    expect(remi.isDead()).toBe(true);
    expect(d.isFinished()).toBe(false); // 瑞米死亡不算败北

    const hpBefore = hunter.hp;
    d.endTurn(); // 回合 3：瑞米不再行动；猎人转火玩家
    expect(hunter.hp).toBe(hpBefore);
    expect(d.player.hp).toBe(42); // 50-8
  });
});

describe('复杂战斗：效果致死', () => {
  it('残血敌人在敌方回合开始被燃烧跳死，胜利在回合中段判定', () => {
    const d = new BattleDriver({
      deck: ['inflame', 'punch', 'punch', 'punch'],
      enemies: ['slime'], seed: 3, config: { initialDraw: 4 },
    });
    const slime = d.state.enemies[0];
    slime.maxHp = 4;
    slime.hp = 4;
    d.start();

    d.play('inflame'); // 点火：3 伤害 + 燃烧5 → 剩 1 血（2026-09 火系数值：点火 3伤/燃烧5）
    expect(slime.hp).toBe(1);
    d.endTurn();       // 敌方回合开始：燃烧跳 5（固定伤害，护盾可挡）→ 死亡

    expect(slime.isDead()).toBe(true);
    expect(d.verdict).toBe('victory');
    expect(d.isFinished()).toBe(true);
    expect(d.calls('battleEnd')).toHaveLength(1);
    expect(d.kernel.subscriptions).toHaveLength(0);
  });
});

describe('复杂战斗：失败路径', () => {
  it('玩家死于敌方回合：后续敌人行动被 abort，战后清理照常', () => {
    const d = new BattleDriver({ deck: ['punch'], enemies: ['killer', 'killer'], seed: 3 });
    const [k1, k2] = d.state.enemies;
    d.start();

    d.endTurn(); // 敌方回合：k1 一击致命

    expect(d.verdict).toBe('defeat');
    expect(d.player.hp).toBe(0);
    expect(k1.actionIndex).toBe(1);  // k1 行动过
    expect(k2.actionIndex).toBe(0);  // k2 被 abort 未曾行动（终局 abort 的是 TurnLoop 而非根节点）
    expect(d.calls('battleEnd')[0].args[0].result).toBe('defeat');
    expect(d.kernel.subscriptions).toHaveLength(0);
  });
});

describe('复杂战斗：敌方施加状态', () => {
  it('燃焰术士给玩家上燃烧，玩家回合开始跳伤并递减', () => {
    const pyro = getEnemyDefinition('pyro').createUnit();
    pyro.maxHp = 200; // 木桩化：活过四次行动（第 3 次给玩家上 2 层燃烧）
    pyro.hp = 200;
    const d = new BattleDriver({ deck: ['punch'], enemies: [pyro], seed: 5 });
    d.start();

    for (let i = 0; i < 4 && !d.isFinished(); i++) d.endTurn();

    // 燃烧 tick = 无来源的固定伤害（2026-09 起：燃烧由穿透改为固定伤害/护盾可挡，
    // 故不再按 pierce 过滤，改按「无来源 + 打玩家」识别）
    const burnTicks = d.calls('damage')
      .filter(c => c.args[0].target === d.player && c.args[0].source === null);
    expect(burnTicks.length).toBeGreaterThan(0);
    expect(d.player.getEffectStacks('burn')).toBeLessThanOrEqual(1);
  });
});
