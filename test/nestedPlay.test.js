import { describe, it, expect } from 'vitest';
import '../src/core/content/index.js';
import { BattleDriver } from '../src/core/sdk/driver.js';
import { registerSkill } from '../src/core/skills/registry.js';
import { zoneOf, moveCard, firstAliveEnemy } from '../src/core/state/battleState.js';
import AwaitPlayerInputInstruction from '../src/core/instructions/input.js';
import { UseSkillInstruction } from '../src/core/instructions/skill.js';
import { DealDamageInstruction } from '../src/core/instructions/combat.js';

// ---- 万变拳（嵌套出牌 + 费用豁免）原型：压测技能契约的递归性 ----
// 语义：0AP 选一张手牌，以其费用全免的方式打出（costOverride）。
// 嵌套出牌不经 playerUseSkill 的可用性检查（合法性由技能逻辑负责），
// 但费用/充能消耗与收尾 zone 迁移仍走 UseSkillInstruction 标准管线。

// 万变拳：0 费，选一张手牌免费打出（发动中自身已离手进 pending，剩余手牌皆候选）
registerSkill({
  id: 'wildFist', name: '万变拳',
  cost: { mana: 0, actionPoint: 0 },
  use(sctx, stage) {
    if (stage === 0) {
      const hand = sctx.battleState.zones.hand;
      if (hand.length === 0) return true;
      sctx.self._input = new AwaitPlayerInputInstruction({
        request: { kind: 'selectCards', source: 'hand', count: 1, candidates: hand.map(c => c.uniqueID) },
      });
      sctx.kernel.submitInstruction(sctx.self._input);
      return false;
    }
    const [uniqueID] = sctx.self._input.result.selection;
    sctx.self._input = null;
    const skill = sctx.battleState.zones.hand.find(c => c.uniqueID === uniqueID);
    sctx.kernel.submitInstruction(
      new UseSkillInstruction({ skill, costOverride: { mana: 0, actionPoint: 0 } }));
    return true;
  },
});

// 充能刀（测试卡）：1 充能 2 冷却，验证嵌套出牌的充能消耗
registerSkill({
  id: 'nestedBlade', name: '充能刀',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 2 },
  use(sctx) {
    sctx.kernel.submitInstruction(new DealDamageInstruction({
      source: sctx.player, target: firstAliveEnemy(sctx.battleState), amount: 4,
    }));
    return true;
  },
});

function bringToHand(d, defId) {
  const card = d.state.zones.deck.find(c => c.defId === defId);
  if (card) moveCard(d.state, card.uniqueID, 'hand');
}

describe('万变拳：嵌套出牌 + 费用豁免', () => {
  it('0 资源打出 1AP 的点火：资源不动，效果照常，双方计入出牌数', () => {
    const d = new BattleDriver({
      deck: ['wildFist', 'inflame', 'punch', 'punch'],
      enemies: ['slime'], seed: 5, config: { initialDraw: 4 },
    });
    const slime = d.state.enemies[0];
    d.start();
    bringToHand(d, 'wildFist');

    d.play('wildFist');
    const inflame = d.state.zones.hand.find(c => c.defId === 'inflame');
    d.respond([inflame.uniqueID]);

    expect(d.player.mana).toBe(2);        // 费用全免（新魏启规则：开局半满1+回合恢复1）
    expect(d.player.actionPoints).toBe(3);
    expect(slime.hp).toBe(20 - 3);        // 点火效果照常
    expect(slime.getEffectStacks('burn')).toBe(5);
    expect(zoneOf(d.state, inflame.uniqueID)).toBe('deck');      // 收尾迁移走标准管线（非消耗 → 牌库底）
    // FIFO：内层点火先落牌库底，外层万变拳收尾居末位
    expect(d.state.zones.deck.at(-2).uniqueID).toBe(inflame.uniqueID);
    expect(d.state.zones.deck.at(-1).defId).toBe('wildFist');
    expect(d.state.history.turn.played).toBe(2); // 万变拳 + 点火都计数（拳师类机制兼容）
    expect(d.isWaiting()).toBe(true);
  });

  it('嵌套打咏唱卡：回手点亮激活，订阅生效', () => {
    const d = new BattleDriver({
      deck: ['wildFist', 'focusChant', 'punch', 'punch'],
      enemies: ['slime'], seed: 5, config: { initialDraw: 4 },
    });
    d.start();
    bringToHand(d, 'wildFist');

    d.play('wildFist');
    const chant = d.state.zones.hand.find(c => c.defId === 'focusChant');
    d.respond([chant.uniqueID]);

    const chanted = d.state.zones.hand.find(c => c.defId === 'focusChant');
    expect(chanted.isActivated).toBe(true); // 嵌套发动：回手点亮（无槽，住手牌）
    expect(zoneOf(d.state, chanted.uniqueID)).toBe('hand');
  });

  it('嵌套打充能卡：照常消耗充能并启动冷却', () => {
    const d = new BattleDriver({
      deck: ['wildFist', 'nestedBlade', 'punch', 'punch'],
      enemies: ['slime'], seed: 5, config: { initialDraw: 4 },
    });
    const slime = d.state.enemies[0];
    d.start();
    bringToHand(d, 'wildFist');

    d.play('wildFist');
    const blade = d.state.zones.hand.find(c => c.defId === 'nestedBlade');
    d.respond([blade.uniqueID]);

    expect(slime.hp).toBe(20 - 4);
    expect(blade.remainingUses).toBe(0);
    expect(blade.currentCooldown).toBe(2);
  });
});
