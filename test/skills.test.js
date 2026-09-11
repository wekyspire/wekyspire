import { describe, it, expect, beforeEach } from 'vitest';
import BattleKernel from '../src/core/kernel/BattleKernel.js';
import Player from '../src/core/state/player.js';
import Enemy from '../src/core/state/enemy.js';
import { createRunState } from '../src/core/state/runState.js';
import { createBattleState, zoneOf, moveCard, firstAliveEnemy } from '../src/core/state/battleState.js';
import { createSkillRuntime } from '../src/core/state/skillRuntime.js';
import { createRecordingPresenter } from '../src/core/presenter.js';
import { registerSkill, clearSkillRegistry } from '../src/core/skills/registry.js';
import { canUseSkill, registerSkillSubscriptions } from '../src/core/skills/helpers.js';
import {
  UseSkillInstruction, SkillCooldownInstruction,
  SweepSkillCooldownInstruction,
} from '../src/core/instructions/skill.js';
import { DrawCardsInstruction, DiscardCardInstruction } from '../src/core/instructions/cards.js';
import { ConsumeManaInstruction } from '../src/core/instructions/resources.js';
import { DealDamageInstruction } from '../src/core/instructions/combat.js';

// ---- 测试技能定义 ----

const punch = {
  id: 'punch', name: '冲拳', tier: 'D',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',
  use(sctx) {
    sctx.kernel.submitInstruction(new DealDamageInstruction({
      source: sctx.player, target: firstAliveEnemy(sctx.battleState), amount: 6 + sctx.self.power,
    }));
    return true;
  },
  describe: () => '造成 6 点伤害。',
};

const heavy = {
  id: 'heavy', name: '大力一击', tier: 'C',
  cost: { mana: 2, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 2 },
  cardMode: 'normal',
  keywords: ['exhaust'],
  use(sctx) {
    sctx.kernel.submitInstruction(new DealDamageInstruction({
      source: sctx.player, target: firstAliveEnemy(sctx.battleState), amount: 10,
    }));
    return true;
  },
};

const chantFlags = { enabled: false, disabledReason: null };
const chanter = {
  id: 'chanter', name: '蓄力术', tier: 'C',
  cost: { mana: 1, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant',
  use() { return true; },
  activated: {
    onEnable() { chantFlags.enabled = true; },
    onDisable(_sctx, reason) { chantFlags.disabledReason = reason; },
    subscriptions: (sctx) => [{
      when: DrawCardsInstruction, phase: 'post',
      react: () => { sctx.player.mana = Math.min(sctx.player.mana + 1, sctx.player.maxMana); },
    }],
  },
};

const stagesSeen = [];
const multiStage = {
  id: 'multiStage', name: '三段拳', tier: 'D',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity },
  use(_sctx, stage) {
    stagesSeen.push(stage);
    return stage >= 2;
  },
};

const triggerLog = [];
const triggerCard = {
  id: 'triggerCard', name: '崩拳', tier: 'C',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 1 },
  use() { return true; },
  // 仅在手牌中时：任意技能结算完即刻冷却（崩拳类机制）
  subscriptions: (sctx) => [{
    when: UseSkillInstruction, phase: 'post',
    filter: () => zoneOf(sctx.battleState, sctx.self.uniqueID) === 'hand',
    react: () => triggerLog.push('cooled'),
  }],
};

function setup() {
  clearSkillRegistry();
  [punch, heavy, chanter, multiStage, triggerCard].forEach(registerSkill);
  chantFlags.enabled = false;
  chantFlags.disabledReason = null;
  stagesSeen.length = 0;
  triggerLog.length = 0;

  const runState = createRunState({ player: new Player({ maxHp: 30, maxMana: 3, maxActionPoints: 3 }) });
  const enemy = new Enemy({ maxHp: 20 });
  const battleState = createBattleState({ enemies: [enemy], seed: 5 });
  const presenter = createRecordingPresenter();
  const kernel = new BattleKernel();
  const ctx = { runState, battleState, player: runState.player, kernel, presenter };
  return { ctx, enemy };
}

function putInHand(ctx, defId, overrides = {}) {
  const rt = createSkillRuntime(defId, overrides);
  ctx.battleState.zones.hand.push(rt);
  return rt;
}

// ---- 用例 ----

describe('canUseSkill：可用性检查', () => {
  it('费用/充能/咏唱槽约束', () => {
    const { ctx } = setup();
    const p = putInHand(ctx, 'punch');
    expect(canUseSkill(ctx, p)).toBe(true);

    ctx.player.actionPoints = 0;
    expect(canUseSkill(ctx, p)).toBe(false);
    ctx.player.actionPoints = 3;

    p.remainingUses = 0;
    expect(canUseSkill(ctx, p)).toBe(false);

    const c = putInHand(ctx, 'chanter', { remainingUses: 1 });
    // 咏唱发动合法性：激活后（默认咏唱值 2）加权手牌数超上限 → 不可发动
    ctx.player.maxHandSize = 1; // 手中已有这张咏唱（计 1），激活后计 2 > 1
    expect(canUseSkill(ctx, c)).toBe(false);
    ctx.player.maxHandSize = 10;
  });
});

describe('UseSkillInstruction：完整流程', () => {
  it('资源消耗 → 激活 → 收尾落牌库底，history 与 presenter 正确', () => {
    const { ctx, enemy } = setup();
    const p = putInHand(ctx, 'punch');
    ctx.kernel.run(new UseSkillInstruction({ skill: p }), ctx);

    expect(enemy.hp).toBe(14);
    expect(ctx.player.actionPoints).toBe(2);
    expect(ctx.battleState.history.turn.played).toBe(1);
    expect(zoneOf(ctx.battleState, p.uniqueID)).toBe('deck'); // 非消耗卡收尾落牌库底（FIFO 数组尾）
    expect(ctx.battleState.zones.deck.at(-1).uniqueID).toBe(p.uniqueID);
    expect(ctx.presenter.calls.some(c => c.method === 'skillUsed')).toBe(true);
  });

  it('费用走资源指令：PRE 订阅改费对技能生效（费用管线）', () => {
    const { ctx } = setup();
    const h = putInHand(ctx, 'heavy');
    ctx.kernel.addSubscription({
      when: ConsumeManaInstruction, phase: 'pre',
      react: (instr) => instr.setPayload('amount', instr.payload.amount * 2),
    });
    ctx.kernel.run(new UseSkillInstruction({ skill: h }), ctx);
    expect(ctx.player.mana).toBe(0); // 2×2=4，截断到 0
    expect(zoneOf(ctx.battleState, h.uniqueID)).toBe('burnt'); // exhaust
  });

  it('多阶段技能按 stage 推进', () => {
    const { ctx } = setup();
    const m = putInHand(ctx, 'multiStage');
    ctx.kernel.run(new UseSkillInstruction({ skill: m }), ctx);
    expect(stagesSeen).toEqual([0, 1, 2]);
  });
});

describe('咏唱卡生命周期（双态开关）', () => {
  it('发动：付费回手点亮；再次打出：免费解除并回牌库；订阅随熄灭注销', () => {
    const { ctx } = setup();
    const c = putInHand(ctx, 'chanter');
    ctx.kernel.run(new UseSkillInstruction({ skill: c }), ctx);

    // 发动：卡留手牌、点亮激活、onEnable 生效、费用照付（3 蓝 −1 = 2）
    expect(zoneOf(ctx.battleState, c.uniqueID)).toBe('hand');
    expect(c.isActivated).toBe(true);
    expect(chantFlags.enabled).toBe(true);
    expect(ctx.player.mana).toBe(2);
    expect(ctx.player.actionPoints).toBe(2);
    expect(ctx.presenter.calls.some(x => x.method === 'chantToggled' && x.args[0].on === true)).toBe(true);

    // 激活订阅：抽牌回蓝
    ctx.battleState.zones.deck.push(createSkillRuntime('punch'));
    ctx.player.mana = 0;
    ctx.kernel.run(new DrawCardsInstruction({ count: 1 }), ctx);
    expect(ctx.player.mana).toBe(1);

    // 再次打出（已激活）：免费解除 → onDisable('played')、回牌库、费用不动
    const mana0 = ctx.player.mana;
    const ap0 = ctx.player.actionPoints;
    ctx.kernel.run(new UseSkillInstruction({ skill: c }), ctx);
    expect(chantFlags.disabledReason).toBe('played');
    expect(c.isActivated).toBe(false);
    expect(zoneOf(ctx.battleState, c.uniqueID)).toBe('deck');
    expect(ctx.player.mana).toBe(mana0);
    expect(ctx.player.actionPoints).toBe(ap0);

    // 订阅已注销：再抽牌不回蓝
    ctx.battleState.zones.deck.push(createSkillRuntime('punch'));
    ctx.player.mana = 0;
    ctx.kernel.run(new DrawCardsInstruction({ count: 1 }), ctx);
    expect(ctx.player.mana).toBe(0);
  });

  it('离手不变量：弃牌熄灭咏唱（onDisable + 注销 + 播报）', () => {
    const { ctx } = setup();
    const c = putInHand(ctx, 'chanter');
    ctx.kernel.run(new UseSkillInstruction({ skill: c }), ctx);
    expect(c.isActivated).toBe(true);

    ctx.kernel.run(new DiscardCardInstruction({ uniqueID: c.uniqueID }), ctx);
    expect(c.isActivated).toBe(false);
    expect(zoneOf(ctx.battleState, c.uniqueID)).toBe('deck'); // 弃牌 = 落牌库底（FIFO 数组尾）
    expect(ctx.battleState.zones.deck.at(-1).uniqueID).toBe(c.uniqueID);
    expect(chantFlags.disabledReason).toBe('leave-hand');
    expect(ctx.presenter.calls.some(x => x.method === 'chantToggled' && x.args[0].on === false)).toBe(true);
  });
});

describe('技能触发订阅（zone 限定）', () => {
  it('仅在手牌中时响应其他技能的使用', () => {
    const { ctx } = setup();
    const t = putInHand(ctx, 'triggerCard');
    registerSkillSubscriptions(ctx, t);

    const p1 = putInHand(ctx, 'punch');
    ctx.kernel.run(new UseSkillInstruction({ skill: p1 }), ctx);
    expect(triggerLog).toEqual(['cooled']);

    // 移到牌库后不再触发
    moveCard(ctx.battleState, t.uniqueID, 'deck');
    const p2 = putInHand(ctx, 'punch');
    ctx.kernel.run(new UseSkillInstruction({ skill: p2 }), ctx);
    expect(triggerLog).toEqual(['cooled']);
  });
});

describe('SweepSkillCooldownInstruction：自然冷却扫掠（展开为定向推进）', () => {
  it('按 cooldownZones 推进并充能；焚毁区（不在默认 zones）不冷却', () => {
    const { ctx } = setup();
    // heavy 在手牌中，模拟已用尽
    const h = putInHand(ctx, 'heavy', { remainingUses: 0, currentCooldown: 2 });
    ctx.kernel.run(new SweepSkillCooldownInstruction(), ctx);
    expect(h.currentCooldown).toBe(1);
    expect(h.remainingUses).toBe(0);
    ctx.kernel.run(new SweepSkillCooldownInstruction(), ctx);
    expect(h.currentCooldown).toBe(0);
    expect(h.remainingUses).toBe(1);

    // 焚毁区（不在默认 cooldownZones）的技能不冷却
    const h2 = createSkillRuntime('heavy', { remainingUses: 0, currentCooldown: 2 });
    ctx.battleState.zones.burnt.push(h2);
    ctx.kernel.run(new SweepSkillCooldownInstruction(), ctx);
    expect(h2.remainingUses).toBe(0);
  });

  it('扫掠展开的定向推进可被 PRE 逐卡 veto：只拦那一张，其余照常', () => {
    const { ctx } = setup();
    const h = putInHand(ctx, 'heavy', { remainingUses: 0, currentCooldown: 2 });
    const d = createSkillRuntime('heavy', { remainingUses: 0, currentCooldown: 2 });
    ctx.battleState.zones.deck.push(d);
    ctx.kernel.addSubscription({
      when: SkillCooldownInstruction, phase: 'pre',
      filter: (instr) => instr.skill === h,
      react: (instr, kctx) => kctx.kernel.veto(instr, '测试拦截'),
    });
    ctx.kernel.run(new SweepSkillCooldownInstruction(), ctx);
    expect(h.currentCooldown).toBe(2);      // 被拦
    expect(d.currentCooldown).toBe(1);      // 不受影响
  });
});

describe('SkillCooldownInstruction：定向推进（加速/衰败统一路径）', () => {
  it('正向推进与归零回充；满充能时正向落空且不播报', () => {
    const { ctx } = setup();
    const h = putInHand(ctx, 'heavy', { remainingUses: 0, currentCooldown: 1 });
    ctx.kernel.run(new SkillCooldownInstruction({ skill: h, delta: 1 }), ctx);
    expect(h.currentCooldown).toBe(0);
    expect(h.remainingUses).toBe(1); // 回充
    const ticks = ctx.presenter.calls.filter(c => c.method === 'cooldownTick').length;
    ctx.kernel.run(new SkillCooldownInstruction({ skill: h, delta: 1 }), ctx); // 满充能：无处推进
    expect(h.remainingUses).toBe(1);
    expect(ctx.presenter.calls.filter(c => c.method === 'cooldownTick').length).toBe(ticks); // 不播报
  });

  it('负向衰败推进计时并播报负 delta；满充能衰败不生效', () => {
    const { ctx } = setup();
    const h = putInHand(ctx, 'heavy', { remainingUses: 0, currentCooldown: 2 });
    ctx.kernel.run(new SkillCooldownInstruction({ skill: h, delta: -1 }), ctx);
    expect(h.currentCooldown).toBe(3);
    expect(ctx.presenter.calls).toContainEqual({ method: 'cooldownTick', args: [{ skill: h, delta: -1 }] });

    h.remainingUses = 1; h.currentCooldown = 0; // 满充能：无处分反
    ctx.kernel.run(new SkillCooldownInstruction({ skill: h, delta: -1 }), ctx);
    expect(h.currentCooldown).toBe(0);
  });
});
