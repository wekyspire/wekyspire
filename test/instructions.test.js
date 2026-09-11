import { describe, it, expect, beforeEach } from 'vitest';
import BattleKernel from '../src/core/kernel/BattleKernel.js';
import BattleInstruction from '../src/core/kernel/BattleInstruction.js';
import Player from '../src/core/state/player.js';
import Enemy from '../src/core/state/enemy.js';
import { createRunState } from '../src/core/state/runState.js';
import { createBattleState, zoneOf } from '../src/core/state/battleState.js';
import { createSkillRuntime } from '../src/core/state/skillRuntime.js';
import { createRecordingPresenter } from '../src/core/presenter.js';
import { registerEffect, clearEffectRegistry } from '../src/core/effects/registry.js';
import { DealDamageInstruction, ApplyHealInstruction, GainShieldInstruction } from '../src/core/instructions/combat.js';
import { ConsumeManaInstruction, GainManaInstruction, ConsumeActionPointsInstruction } from '../src/core/instructions/resources.js';
import { AddEffectInstruction } from '../src/core/instructions/effects.js';
import { DrawCardsInstruction, BurnCardInstruction, DiscardCardInstruction } from '../src/core/instructions/cards.js';

function setup({ seed = 11 } = {}) {
  clearEffectRegistry();
  registerEffect({ id: 'strength', type: 'buff', stacking: 'count', statModifiers: { attack: s => s } });
  registerEffect({ id: 'burn', type: 'debuff', stacking: 'count' });

  const runState = createRunState({ player: new Player({ maxHp: 30, maxMana: 3, maxActionPoints: 3 }) });
  const enemy = new Enemy({ maxHp: 20, defense: 0 });
  const battleState = createBattleState({ enemies: [enemy], seed });
  const presenter = createRecordingPresenter();
  const kernel = new BattleKernel();
  const ctx = { runState, battleState, player: runState.player, kernel, presenter };
  return { ctx, enemy };
}

// 直接在单指令上跑完整流程（buildPayload + execute），不走内核
function settle(instr, ctx) {
  instr.buildPayload(ctx);
  instr.execute(ctx);
  return instr.result;
}

describe('DealDamageInstruction', () => {
  it('无防御无护盾：全额扣血，记录 history 与 presenter', () => {
    const { ctx, enemy } = setup();
    const r = settle(new DealDamageInstruction({ source: ctx.player, target: enemy, amount: 7 }), ctx);
    expect(enemy.hp).toBe(13);
    expect(r).toMatchObject({ damage: 7, defenseBlocked: 0, shieldAbsorbed: 0, dealt: 7, targetDead: false });
    expect(ctx.battleState.history.turn.damageDealt).toBe(7);
    expect(ctx.presenter.calls.filter(c => c.method === 'damage')).toHaveLength(1);
  });

  it('防御减免 + 护盾吸收，溢出才扣血', () => {
    const { ctx, enemy } = setup();
    enemy.defense = 2;
    enemy.shield = 3;
    const r = settle(new DealDamageInstruction({ source: ctx.player, target: enemy, amount: 8 }), ctx);
    expect(r).toMatchObject({ defenseBlocked: 2, shieldAbsorbed: 3, dealt: 3 });
    expect(enemy.shield).toBe(0);
    expect(enemy.hp).toBe(17);
  });

  it('pierce 跳过防御与护盾直伤 HP', () => {
    const { ctx, enemy } = setup();
    enemy.defense = 5;
    enemy.shield = 10;
    const r = settle(new DealDamageInstruction({ source: ctx.player, target: enemy, amount: 6, pierce: true }), ctx);
    expect(r.dealt).toBe(6);
    expect(enemy.shield).toBe(10);
    expect(enemy.hp).toBe(14);
  });

  it('致死：hp 归零、result.targetDead、发 unitDeath 意图', () => {
    const { ctx, enemy } = setup();
    const r = settle(new DealDamageInstruction({ source: ctx.player, target: enemy, amount: 999 }), ctx);
    expect(enemy.hp).toBe(0);
    expect(r.targetDead).toBe(true);
    expect(ctx.presenter.calls.some(c => c.method === 'unitDeath')).toBe(true);
  });

  it('PRE 订阅可翻倍伤害（斩灭类），veto 可闪避（登天术类）', () => {
    const { ctx, enemy } = setup();
    // 翻倍
    ctx.kernel.addSubscription({
      when: DealDamageInstruction, phase: 'pre', window: 'once',
      react: (instr) => instr.setPayload('damage', instr.payload.damage * 2),
    });
    ctx.kernel.run(new DealDamageInstruction({ source: ctx.player, target: enemy, amount: 5 }), ctx);
    expect(enemy.hp).toBe(10);

    // 闪避 veto
    ctx.kernel.addSubscription({
      when: DealDamageInstruction, phase: 'pre', window: 'once',
      react: (instr, ctx2) => ctx2.kernel.veto(instr, 'dodged'),
    });
    ctx.kernel.run(new DealDamageInstruction({ source: ctx.player, target: enemy, amount: 5 }), ctx);
    expect(enemy.hp).toBe(10); // 未受伤
  });
});

describe('ApplyHealInstruction / GainShieldInstruction', () => {
  it('治疗封顶 maxHp，记录 healing', () => {
    const { ctx, enemy } = setup();
    ctx.player.hp = 28;
    const r = settle(new ApplyHealInstruction({ target: ctx.player, amount: 10 }), ctx);
    expect(ctx.player.hp).toBe(30);
    expect(r.healed).toBe(2);
    expect(ctx.battleState.history.battle.healing).toBe(2);
  });

  it('护盾累加，PRE 可改数值', () => {
    const { ctx, enemy } = setup();
    settle(new GainShieldInstruction({ target: ctx.player, amount: 3 }), ctx);
    expect(ctx.player.shield).toBe(3);
    ctx.kernel.addSubscription({
      when: GainShieldInstruction, phase: 'pre',
      react: (instr) => instr.setPayload('amount', instr.payload.amount + 2),
    });
    ctx.kernel.run(new GainShieldInstruction({ target: ctx.player, amount: 3 }), ctx);
    expect(ctx.player.shield).toBe(8);
  });
});

describe('资源指令族', () => {
  it('消耗/获取按上下限截断', () => {
    const { ctx, enemy } = setup();
    settle(new ConsumeManaInstruction({ amount: 5 }), ctx);
    expect(ctx.player.mana).toBe(0);
    settle(new GainManaInstruction({ amount: 99 }), ctx);
    expect(ctx.player.mana).toBe(3);
    settle(new ConsumeActionPointsInstruction({ amount: 1 }), ctx);
    expect(ctx.player.actionPoints).toBe(2);
  });
});

describe('AddEffectInstruction', () => {
  it('施加效果并经 PRE 改层数', () => {
    const { ctx, enemy } = setup();
    ctx.kernel.addSubscription({
      when: AddEffectInstruction, phase: 'pre',
      react: (instr) => instr.setPayload('stacks', instr.payload.stacks * 2),
    });
    ctx.kernel.run(new AddEffectInstruction({ target: enemy, effectId: 'burn', stacks: 3 }), ctx);
    expect(enemy.getEffectStacks('burn')).toBe(6);
  });
});

describe('卡牌指令族', () => {
  function fillDeck(ctx, ids) {
    ctx.battleState.zones.deck = ids.map(id => createSkillRuntime(id));
  }

  it('从牌库顶（index 0）依次抽入手牌，记录 history', () => {
    const { ctx, enemy } = setup();
    fillDeck(ctx, ['a', 'b', 'c']);
    const r = settle(new DrawCardsInstruction({ count: 2 }), ctx);
    expect(r.drawn.map(c => c.defId)).toEqual(['a', 'b']);
    expect(ctx.battleState.zones.hand.map(c => c.defId)).toEqual(['a', 'b']);
    expect(ctx.battleState.zones.deck.map(c => c.defId)).toEqual(['c']);
    expect(ctx.battleState.history.turn.drawn).toBe(2);
  });

  it('牌库抽空即抽牌落空（FIFO 无重洗）', () => {
    const { ctx, enemy } = setup();
    fillDeck(ctx, ['a']);
    const r = settle(new DrawCardsInstruction({ count: 3 }), ctx);
    expect(r.drawn).toHaveLength(1); // 抽完牌库唯一一张即止
    expect(r.drawn[0].defId).toBe('a');
    expect(ctx.battleState.zones.deck).toHaveLength(0);
    // 空牌库再抽：完全落空，不判负
    const r2 = settle(new DrawCardsInstruction({ count: 2 }), ctx);
    expect(r2.drawn).toHaveLength(0);
  });

  it("from:'bottom' 从牌库末抽（回旋斩类）", () => {
    const { ctx, enemy } = setup();
    fillDeck(ctx, ['a', 'b', 'c']);
    const r = settle(new DrawCardsInstruction({ count: 1, from: 'bottom' }), ctx);
    expect(r.drawn[0].defId).toBe('c');
  });

  it('焚牌/弃牌迁移 zone 并记录 history', () => {
    const { ctx, enemy } = setup();
    const a = createSkillRuntime('a');
    const b = createSkillRuntime('b');
    ctx.battleState.zones.hand.push(a, b);

    settle(new BurnCardInstruction({ uniqueID: a.uniqueID }), ctx);
    expect(zoneOf(ctx.battleState, a.uniqueID)).toBe('burnt');
    expect(ctx.battleState.history.battle.burnt).toBe(1);

    settle(new DiscardCardInstruction({ uniqueID: b.uniqueID }), ctx);
    expect(zoneOf(ctx.battleState, b.uniqueID)).toBe('deck'); // 弃牌 = 置回牌库底（FIFO）
    expect(ctx.battleState.zones.deck.at(-1).uniqueID).toBe(b.uniqueID);
    expect(ctx.battleState.history.battle.discarded).toBe(1);
  });
});

describe('多单位：history 按阵营统计', () => {
  it('瑞米（Ally）的输出计入 damageDealt，承伤计入 damageTaken', async () => {
    const { ctx, enemy } = setup();
    const { default: Ally } = await import('../src/core/state/ally.js');
    const remi = new Ally({ maxHp: 15, defId: 'remi' });
    ctx.battleState.allies.push(remi);
    remi.side = 'player';

    settle(new DealDamageInstruction({ source: remi, target: enemy, amount: 4 }), ctx);
    expect(ctx.battleState.history.turn.damageDealt).toBe(4);

    settle(new DealDamageInstruction({ source: enemy, target: remi, amount: 3 }), ctx);
    expect(ctx.battleState.history.turn.damageTaken).toBe(3);
    // 敌方互殴（未来机制如混乱）不计入我方统计
    settle(new DealDamageInstruction({ source: enemy, target: enemy, amount: 2 }), ctx);
    expect(ctx.battleState.history.turn.damageDealt).toBe(4);
    expect(ctx.battleState.history.turn.damageTaken).toBe(3);
  });
});
