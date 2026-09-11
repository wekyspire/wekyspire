import { describe, it, expect } from 'vitest';
import '../src/core/content/index.js';
import { BattleDriver } from '../src/core/sdk/driver.js';
import { registerSkill } from '../src/core/skills/registry.js';
import { registerEffect } from '../src/core/effects/registry.js';
import { moveCard } from '../src/core/state/battleState.js';
import { DealDamageInstruction } from '../src/core/instructions/combat.js';
import { AddEffectInstruction } from '../src/core/instructions/effects.js';
import { TurnEndInstruction } from '../src/core/instructions/turn.js';
import { PLAYER_BASE_HP } from '../src/core/state/player.js';

// ---- 伤害生命周期三态原型：反伤（POST）/ 闪避（PRE 归零）/ 不灭（minHp 地板）----
// 语义对齐旧仓库：闪避=伤害减到 0 且层数 -1；不灭=不会死亡，回合结束层数 -1。
// 反伤旧仓库未实现（仅设计文档提及），按通行语义：受击后以层数为伤害回击攻击者。

// 反伤：受到伤害后对攻击者造成等层数伤害（不反 0 伤、不反自己、无来源不反）
registerEffect({
  id: 'thorns', type: 'buff', stacking: 'count',
  subscriptions: (unit) => [{
    when: DealDamageInstruction, phase: 'post',
    filter: (instr) => instr.target === unit
      && instr.source && instr.source !== unit && instr.result.dealt > 0,
    react: (instr, ctx) => ctx.kernel.submitInstruction(new DealDamageInstruction({
      source: unit, target: instr.source, amount: unit.getEffectStacks('thorns'),
    }), instr),
  }],
});

// 闪避：伤害归零，层数 -1
registerEffect({
  id: 'dodge', type: 'buff', stacking: 'count',
  subscriptions: (unit) => [{
    when: DealDamageInstruction, phase: 'pre',
    filter: (instr) => instr.target === unit,
    react: (instr, ctx) => {
      instr.setPayload('damage', 0);
      ctx.kernel.submitInstruction(
        new AddEffectInstruction({ target: unit, effectId: 'dodge', stacks: -1 }), instr);
    },
  }],
});

// 不灭：hp 不会低于 1（minHp 地板走 statModifiers 读轨）；己方回合结束层数 -1
registerEffect({
  id: 'undying', type: 'buff', stacking: 'count',
  statModifiers: { minHp: () => 1 },
  subscriptions: (unit) => [{
    when: TurnEndInstruction, phase: 'post',
    filter: (instr) => instr.side === unit.side,
    react: (instr, ctx) => ctx.kernel.submitInstruction(
      new AddEffectInstruction({ target: unit, effectId: 'undying', stacks: -1 }), instr),
  }],
});

// 塞西莉亚奇迹（木灵脉代表卡）：获得 3 层不灭
registerSkill({
  id: 'ceciliaMiracle', name: '塞西莉亚奇迹',
  cost: { mana: 2, actionPoint: 1 },
  use(sctx) {
    sctx.kernel.submitInstruction(new AddEffectInstruction({
      target: sctx.player, effectId: 'undying', stacks: 3,
    }));
    return true;
  },
});

const hitPlayer = (d, amount) => d.dispatch(new DealDamageInstruction({
  source: d.state.enemies[0], target: d.player, amount,
}));

function bringToHand(d, defId) {
  const card = d.state.zones.deck.find(c => c.defId === defId);
  if (card) moveCard(d.state, card.uniqueID, 'hand');
}

describe('反伤：受击回击', () => {
  it('敌人打中玩家，受到等层数反伤', () => {
    const d = new BattleDriver({
      deck: ['punch', 'punch', 'punch', 'punch'],
      enemies: ['slime'], seed: 5,
    });
    const slime = d.state.enemies[0];
    d.start();
    d.dispatch(new AddEffectInstruction({ target: d.player, effectId: 'thorns', stacks: 3 }));

    hitPlayer(d, 5);
    expect(d.player.hp).toBe(PLAYER_BASE_HP - 5);
    expect(slime.hp).toBe(20 - 3); // 反伤 3
  });

  it('闪避把伤害归零后不触发反伤（dealt=0）', () => {
    const d = new BattleDriver({
      deck: ['punch', 'punch', 'punch', 'punch'],
      enemies: ['slime'], seed: 5,
    });
    const slime = d.state.enemies[0];
    d.start();
    d.dispatch(new AddEffectInstruction({ target: d.player, effectId: 'thorns', stacks: 3 }));
    d.dispatch(new AddEffectInstruction({ target: d.player, effectId: 'dodge', stacks: 1 }));

    hitPlayer(d, 8);
    expect(d.player.hp).toBe(PLAYER_BASE_HP);          // 闪避归零
    expect(d.player.getEffectStacks('dodge')).toBe(0);
    expect(slime.hp).toBe(20);             // dealt=0，不反伤

    hitPlayer(d, 8);                       // 闪避耗尽，正常承伤+反伤
    expect(d.player.hp).toBe(PLAYER_BASE_HP - 8);
    expect(slime.hp).toBe(20 - 3);
  });
});

describe('不灭：minHp 地板', () => {
  it('致命伤害锁 1 血；层数在己方回合结束递减，耗尽后可被击杀', () => {
    const d = new BattleDriver({
      deck: ['punch', 'punch', 'punch', 'punch'],
      enemies: ['slime'], seed: 5,
    });
    d.start();
    d.player.hp = 5;
    d.dispatch(new AddEffectInstruction({ target: d.player, effectId: 'undying', stacks: 1 }));

    hitPlayer(d, 50); // 致命 → 锁 1 血
    expect(d.player.hp).toBe(1);
    expect(d.player.isDead()).toBe(false);
    expect(d.verdict).toBeNull();

    d.endTurn(); // 不灭 1 → 0（玩家回合结束）；随后敌方回合史莱姆攻击 3 伤
    expect(d.player.getEffectStacks('undying')).toBe(0);
    expect(d.player.hp).toBe(0); // 不灭已耗尽：max(1-3, 0)，地板失效
    expect(d.player.isDead()).toBe(true);
    expect(d.verdict).toBe('defeat');
  });

  it('塞西莉亚奇迹：3 层不灭撑过三个回合结束', () => {
    const d = new BattleDriver({
      deck: ['ceciliaMiracle', 'punch', 'punch', 'punch', 'punch'],
      enemies: ['slime'], seed: 5, config: { initialDraw: 4 },
    });
    d.start();
    bringToHand(d, 'ceciliaMiracle');

    d.play('ceciliaMiracle');
    expect(d.player.getEffectStacks('undying')).toBe(3);

    d.endTurn(); // 3 → 2（敌方行动：攻 3）
    expect(d.player.getEffectStacks('undying')).toBe(2);
    d.endTurn(); // 2 → 1（敌方行动：盾 4，不打人）
    expect(d.player.getEffectStacks('undying')).toBe(1);
    d.endTurn(); // 1 → 0，注销（敌方行动：攻 3）
    expect(d.player.getEffect('undying')).toBeNull();
    expect(d.player.hp).toBe(PLAYER_BASE_HP - 12); // 史莱姆攻/盾交替，只命中两次
  });
});
