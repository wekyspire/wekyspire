import { describe, it, expect } from 'vitest';
import '../src/core/content/index.js';
import { BattleDriver } from '../src/core/sdk/driver.js';
import Enemy from '../src/core/state/enemy.js';
import { registerSkill } from '../src/core/skills/registry.js';
import { registerAbility } from '../src/core/abilities/registry.js';
import { aliveEnemies, moveCard } from '../src/core/state/battleState.js';
import { DealDamageInstruction } from '../src/core/instructions/combat.js';
import { GainManaInstruction } from '../src/core/instructions/resources.js';

// ---- 火灵脉框架压力原型：群伤标记（tags）/ 爆发三倍 / 突破极限（可用性裁决链） ----

// 爆裂术：4 蓝群伤 12
registerSkill({
  id: 'burstFlame', name: '爆裂术',
  cost: { mana: 4, actionPoint: 1 },
  use(sctx) {
    for (const e of aliveEnemies(sctx.battleState)) {
      sctx.kernel.submitInstruction(new DealDamageInstruction({
        source: sctx.player, target: e, amount: 12, tags: ['aoe'],
      }));
    }
    return true;
  },
});

// 太虚绝炎：5 蓝群伤 20（用于超费测试）
registerSkill({
  id: 'novaFlame', name: '太虚绝炎',
  cost: { mana: 5, actionPoint: 1 },
  use(sctx) {
    for (const e of aliveEnemies(sctx.battleState)) {
      sctx.kernel.submitInstruction(new DealDamageInstruction({
        source: sctx.player, target: e, amount: 20, tags: ['aoe'],
      }));
    }
    return true;
  },
});

// 大师能力·爆发：群伤技能只命中一个敌人时，其受三倍伤害
registerAbility({
  id: 'eruption', name: '爆发',
  subscriptions: (ctx) => [{
    when: DealDamageInstruction, phase: 'pre',
    filter: (instr, c) => instr.tags.includes('aoe')
      && instr.source?.side === 'player'
      && aliveEnemies(c.battleState).length === 1,
    react: (instr) => instr.setPayload('damage', instr.payload.damage * 3),
  }],
});

// 精英能力·突破极限：蓝量大于 1 时，可以使用超出负担蓝耗的技能
registerAbility({
  id: 'breakLimit', name: '突破极限',
  canUseSkill: (sctx, { manaOk }) => (
    !manaOk && sctx.player.mana > 1 ? true : undefined
  ),
});

const bigSlime = () => new Enemy({ defId: 'slime', name: '史莱姆', maxHp: 200 });

function bringToHand(d, defId) {
  const card = d.state.zones.deck.find(c => c.defId === defId);
  if (card) moveCard(d.state, card.uniqueID, 'hand');
}

describe('爆裂术：群伤标记', () => {
  it('多目标各受 12，不触发爆发', () => {
    const d = new BattleDriver({
      deck: ['burstFlame', 'punch', 'punch', 'punch'],
      enemies: [bigSlime(), bigSlime()], abilities: ['eruption'], seed: 5,
      config: { initialDraw: 4 },
      player: { maxMana: 5 },
    });
    d.start();
    d.dispatch(new GainManaInstruction({ amount: 99 })); // 新魏启规则入战半满：测试补满回旧基准
    bringToHand(d, 'burstFlame');

    d.play('burstFlame');
    const [e1, e2] = d.state.enemies;
    expect(e1.hp).toBe(200 - 12);
    expect(e2.hp).toBe(200 - 12);
    expect(d.player.mana).toBe(5 - 4);
  });

  it('单目标时爆发三倍（12→36）；中途减员后后续群伤不再三倍', () => {
    const d = new BattleDriver({
      deck: ['burstFlame', 'punch', 'punch', 'punch'],
      enemies: [new Enemy({ defId: 'slime', name: '史莱姆', maxHp: 30 }), bigSlime()],
      abilities: ['eruption'], seed: 5, config: { initialDraw: 4 },
      player: { maxMana: 5 },
    });
    d.start();
    d.dispatch(new GainManaInstruction({ amount: 99 })); // 新魏启规则入战半满：测试补满回旧基准
    bringToHand(d, 'burstFlame');

    // 先单点杀掉前排，再群伤：只剩一个存活敌人 → 三倍
    const [e1, e2] = d.state.enemies;
    e1.hp = 1;
    d.dispatch(new DealDamageInstruction({ source: d.player, target: e1, amount: 5 }));
    expect(e1.isDead()).toBe(true);

    d.play('burstFlame'); // 只有 e2 存活：唯一一条伤害指令且被三倍
    expect(e2.hp).toBe(200 - 36);
  });
});

describe('突破极限：可用性裁决链', () => {
  it('蓝量 2 时可打出 5 蓝的太虚绝炎，蓝量扣到 0（clamp 兜底）', () => {
    const d = new BattleDriver({
      deck: ['novaFlame', 'punch', 'punch', 'punch'],
      enemies: [bigSlime()], abilities: ['breakLimit'], seed: 5,
      config: { initialDraw: 4 },
    });
    const slime = d.state.enemies[0];
    d.start();
    bringToHand(d, 'novaFlame');
    d.player.mana = 2;

    d.play('novaFlame'); // 裁决链放行
    expect(slime.hp).toBe(200 - 20);
    expect(d.player.mana).toBe(0); // 消耗指令 clamp，不出现负蓝
  });

  it('无能力时超费出牌被拒；蓝量 1 时裁决链也不放行', () => {
    const d = new BattleDriver({
      deck: ['novaFlame', 'punch', 'punch', 'punch'],
      enemies: [bigSlime()], seed: 5, config: { initialDraw: 4 },
    });
    d.start();
    bringToHand(d, 'novaFlame');
    d.player.mana = 2;
    expect(() => d.play('novaFlame')).toThrow('无法出牌');

    const d2 = new BattleDriver({
      deck: ['novaFlame', 'punch', 'punch', 'punch'],
      enemies: [bigSlime()], abilities: ['breakLimit'], seed: 5, config: { initialDraw: 4 },
    });
    d2.start();
    bringToHand(d2, 'novaFlame');
    d2.player.mana = 1; // 不大于 1，不放行
    expect(() => d2.play('novaFlame')).toThrow('无法出牌');
  });
});
