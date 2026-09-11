import { describe, it, expect } from 'vitest';
import '../src/core/content/index.js';
import { BattleDriver } from '../src/core/sdk/driver.js';
import { registerSkill } from '../src/core/skills/registry.js';
import { registerEffect } from '../src/core/effects/registry.js';
import { aliveEnemies, firstAliveEnemy, moveCard } from '../src/core/state/battleState.js';
import { DealDamageInstruction } from '../src/core/instructions/combat.js';
import { AddEffectInstruction } from '../src/core/instructions/effects.js';

// ---- 面板修正系统原型：灼脉术（燃烧转灵能）/ 集中 / 火焰主宰 ----
// 规则：面板只加性（getStat 读轨）；乘除/条件结算走 PRE 写轨；
// 技能算 amount 时显式读面板，describe 同源。跨实体衍生走 getStat 的 view 参数。
// 旧仓库未实现灵脉系，语义按设计文档+effectDescription 补齐。

// 集中：每层 +1 灵能（magic 面板）
registerEffect({
  id: 'focus', type: 'buff', stacking: 'count',
  statModifiers: { magic: (stacks) => stacks },
});

// 火焰主宰：每 3 层（敌人身上的）燃烧提供 1 点灵能——跨实体衍生，需要 view
registerEffect({
  id: 'flameLord', type: 'buff', stacking: 'boolean',
  statModifiers: {
    magic: (stacks, unit, view) => {
      if (!view) return 0;
      const burn = aliveEnemies(view)
        .reduce((sum, e) => sum + e.getEffectStacks('burn'), 0);
      return Math.floor(burn / 3);
    },
  },
});

// 火球（测试卡）：5 + 灵能 伤害，火系标签
registerSkill({
  id: 'fireBolt', name: '火球',
  cost: { mana: 1, actionPoint: 1 },
  use(sctx) {
    sctx.kernel.submitInstruction(new DealDamageInstruction({
      source: sctx.player, target: firstAliveEnemy(sctx.battleState),
      amount: 5 + sctx.player.getStat('magic', sctx.battleState), tags: ['fire'],
    }));
    return true;
  },
  describe: (sctx) => `造成 ${5 + sctx.player.getStat('magic', sctx.battleState)} 点伤害。`,
});

// 灼脉术（咏唱）：每对敌人施加 1 层燃烧，获得 1 层集中（燃烧转灵能）
registerSkill({
  id: 'burnVein', name: '灼脉术',
  cost: { mana: 1, actionPoint: 1 },
  cardMode: 'chant',
  use() { return true; },
  activated: {
    subscriptions: () => [{
      when: AddEffectInstruction, phase: 'post',
      filter: (instr) => instr.effectId === 'burn'
        && instr.target?.side === 'enemy' && instr.payload.stacks > 0,
      react: (instr, ctx) => ctx.kernel.submitInstruction(new AddEffectInstruction({
        target: ctx.player, effectId: 'focus', stacks: instr.payload.stacks,
      }), instr),
    }],
  },
});

function bringToHand(d, defId) {
  const card = d.state.zones.deck.find(c => c.defId === defId);
  if (card) moveCard(d.state, card.uniqueID, 'hand');
}

describe('面板修正：集中提供灵能', () => {
  it('火球伤害 = 5 + 灵能面板；describe 与结算同源', () => {
    const d = new BattleDriver({
      deck: ['fireBolt', 'punch', 'punch', 'punch'],
      enemies: ['slime'], seed: 5, config: { initialDraw: 4 },
    });
    const slime = d.state.enemies[0];
    d.start();
    bringToHand(d, 'fireBolt');

    d.dispatch(new AddEffectInstruction({ target: d.player, effectId: 'focus', stacks: 3 }));
    expect(d.player.getStat('magic', d.state)).toBe(3);

    d.play('fireBolt');
    expect(slime.hp).toBe(20 - 8); // 5 + 3
  });
});

describe('灼脉术：燃烧转灵能', () => {
  it('咏唱期间对敌人上燃烧即获得集中，火球随之增伤', () => {
    const d = new BattleDriver({
      deck: ['burnVein', 'fireBolt', 'inflame', 'punch'],
      enemies: ['slime'], seed: 5, config: { initialDraw: 4 },
      player: { maxMana: 5 },
    });
    const slime = d.state.enemies[0];
    d.start();
    bringToHand(d, 'burnVein');

    d.play('burnVein'); // 入咏唱槽
    d.play('inflame');  // 3 伤 + 5 层燃烧 → 灼脉术转 5 层集中
    expect(d.player.getEffectStacks('focus')).toBe(5);

    d.play('fireBolt'); // 5 + 5
    expect(slime.hp).toBe(20 - 3 - 10);
  });
});

describe('火焰主宰：跨实体面板衍生', () => {
  it('按敌人燃烧总层数 3:1 提供灵能，需要 view 参数', () => {
    const d = new BattleDriver({
      deck: ['fireBolt', 'punch', 'punch', 'punch'],
      enemies: ['slime', 'slime'], seed: 5, config: { initialDraw: 4 },
    });
    const [e1, e2] = d.state.enemies;
    d.start();
    d.dispatch(new AddEffectInstruction({ target: d.player, effectId: 'flameLord', stacks: 1 }));

    // 无 view：摸不到敌人燃烧，提供 0
    expect(d.player.getStat('magic')).toBe(0);

    d.dispatch(new AddEffectInstruction({ target: e1, effectId: 'burn', stacks: 3 }));
    d.dispatch(new AddEffectInstruction({ target: e2, effectId: 'burn', stacks: 2 }));
    // 共 5 层燃烧：floor(5/3) = 1
    expect(d.player.getStat('magic', d.state)).toBe(1);

    d.dispatch(new AddEffectInstruction({ target: e2, effectId: 'burn', stacks: 4 }));
    // 共 9 层：3 点灵能
    expect(d.player.getStat('magic', d.state)).toBe(3);

    bringToHand(d, 'fireBolt');
    d.play('fireBolt'); // 5 + 3，打前排
    expect(e1.hp).toBe(20 - 8);
  });
});
