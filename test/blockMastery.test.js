import { describe, it, expect } from 'vitest';
import '../src/core/content/index.js';
import { BattleDriver } from '../src/core/sdk/driver.js';
import { registerAbility } from '../src/core/abilities/registry.js';
import { DealDamageInstruction } from '../src/core/instructions/combat.js';
import { PLAYER_BASE_HP } from '../src/core/state/player.js';

// ---- 武者/武帝（格挡≥3 减免）原型：压测 PRE 伤害修饰与优先级叠加 ----

// 精英能力·武者：护盾 3 层及以上时，改为减免 75% 伤害
registerAbility({
  id: 'warrior', name: '武者',
  description: '你的护盾在 3 层及以上时，受到的伤害改为减免 75%。',
  subscriptions: (ctx) => [{
    when: DealDamageInstruction, phase: 'pre', priority: 0,
    filter: (instr) => instr.target === ctx.player && ctx.player.shield >= 3,
    react: (instr) => instr.setPayload('damage', Math.floor(instr.payload.damage * 0.25)),
  }],
});

// 大师能力·武帝：护盾 3 层及以上时，减免全部伤害
registerAbility({
  id: 'emperor', name: '武帝',
  description: '你的护盾在 3 层及以上时，减免全部伤害。',
  subscriptions: (ctx) => [{
    when: DealDamageInstruction, phase: 'pre', priority: 0,
    filter: (instr) => instr.target === ctx.player && ctx.player.shield >= 3,
    react: (instr) => instr.setPayload('damage', 0),
  }],
});

// 测试专用：敌方战鼓，对玩家伤害 +6（priority 10，先于减免结算）
registerAbility({
  id: 'warDrums', name: '战鼓',
  subscriptions: (ctx) => [{
    when: DealDamageInstruction, phase: 'pre', priority: 10,
    filter: (instr) => instr.target === ctx.player,
    react: (instr) => instr.setPayload('damage', instr.payload.damage + 6),
  }],
});

const hitPlayer = (d, amount) => d.dispatch(new DealDamageInstruction({
  source: d.state.enemies[0], target: d.player, amount,
}));

describe('武者：格挡（护盾）≥3 时减免 75% 伤害', () => {
  it('护盾 5 时 12 伤减为 3，由护盾吸收', () => {
    const d = new BattleDriver({
      deck: ['punch', 'punch', 'punch', 'punch'],
      enemies: ['slime'], abilities: ['warrior'], seed: 5,
    });
    d.start();
    d.player.shield = 5;

    hitPlayer(d, 12); // 12 → floor(12×0.25)=3 → 护盾吸收
    expect(d.player.hp).toBe(PLAYER_BASE_HP);
    expect(d.player.shield).toBe(2);
  });

  it('护盾不足 3 层时不减免，正常扣血', () => {
    const d = new BattleDriver({
      deck: ['punch', 'punch', 'punch', 'punch'],
      enemies: ['slime'], abilities: ['warrior'], seed: 5,
    });
    d.start();
    d.player.shield = 2;

    hitPlayer(d, 12);
    expect(d.player.hp).toBe(PLAYER_BASE_HP - 10); // 护盾吸收 2
    expect(d.player.shield).toBe(0);
  });

  it('与其它 PRE 修饰按 priority 降序叠加：先加伤后减免', () => {
    const d = new BattleDriver({
      deck: ['punch', 'punch', 'punch', 'punch'],
      enemies: ['slime'], abilities: ['warrior', 'warDrums'], seed: 5,
    });
    d.start();
    d.player.shield = 5;

    // priority 10 战鼓先结算：12+6=18；武者后结算：floor(18×0.25)=4
    // （若顺序反了：12→3→9，护盾只够吸 5，会掉 4 血）
    hitPlayer(d, 12);
    expect(d.player.hp).toBe(PLAYER_BASE_HP);
    expect(d.player.shield).toBe(1);
  });
});

describe('武帝：格挡（护盾）≥3 时减免全部伤害', () => {
  it('护盾 3 时 12 伤减为 0，护盾不消耗', () => {
    const d = new BattleDriver({
      deck: ['punch', 'punch', 'punch', 'punch'],
      enemies: ['slime'], abilities: ['emperor'], seed: 5,
    });
    d.start();
    d.player.shield = 3;

    hitPlayer(d, 12);
    expect(d.player.hp).toBe(PLAYER_BASE_HP);
    expect(d.player.shield).toBe(3);
  });
});
