import { describe, it, expect } from 'vitest';
import '../src/core/content/index.js';
import { BattleDriver } from '../src/core/sdk/driver.js';
import Enemy from '../src/core/state/enemy.js';
import { registerSkill } from '../src/core/skills/registry.js';
import { registerAbility } from '../src/core/abilities/registry.js';
import { DrawCardsInstruction } from '../src/core/instructions/cards.js';
import { UseSkillInstruction } from '../src/core/instructions/skill.js';
import { GainActionPointsInstruction } from '../src/core/instructions/resources.js';
import { moveCard } from '../src/core/state/battleState.js';

// 洗牌不定起手：把无量挪进手牌（测试布置）
function bringToHand(d, defId) {
  const card = d.state.zones.deck.find(c => c.defId === defId);
  if (card) moveCard(d.state, card.uniqueID, 'hand');
}

// ---- 行动力回复引擎原型：无量（抽牌计数）/ 拳师·拳王（出牌计数）----
// 计数器放 skillRuntime 或直接读 history.turn.played（按阵营/回合自动重置），不藏闭包。

// 无量（咏唱，太极深入分支）：每抽 11 张牌，回复 1 行动力。跨回合计数，余数保留。
registerSkill({
  id: 'wuliang', name: '无量',
  cost: { mana: 0, actionPoint: 1 },
  cardMode: 'chant',
  use() { return true; },
  activated: {
    subscriptions: (sctx) => [{
      when: DrawCardsInstruction, phase: 'post',
      react: (instr, ctx) => {
        sctx.self.chantCount = (sctx.self.chantCount ?? 0) + instr.result.drawn.length;
        while (sctx.self.chantCount >= 11) {
          sctx.self.chantCount -= 11;
          ctx.kernel.submitInstruction(new GainActionPointsInstruction({ amount: 1 }), instr);
        }
      },
    }],
  },
});

// 精英能力·拳师：每回合打出第 5 张卡后，回复 1 行动力
registerAbility({
  id: 'boxer', name: '拳师',
  description: '每回合打出第 5 张卡后，回复 1 行动力。',
  subscriptions: (ctx) => [{
    when: UseSkillInstruction, phase: 'post',
    filter: () => ctx.battleState.history.turn.played === 5,
    react: (instr, c) => c.kernel.submitInstruction(new GainActionPointsInstruction({ amount: 1 }), instr),
  }],
});

// 大师能力·拳王：每回合打出第 5、8 张卡后，各回复 1 行动力
registerAbility({
  id: 'champion', name: '拳王',
  description: '每回合打出第 5、8 张卡后，各回复 1 行动力。',
  subscriptions: (ctx) => [{
    when: UseSkillInstruction, phase: 'post',
    filter: () => [5, 8].includes(ctx.battleState.history.turn.played),
    react: (instr, c) => c.kernel.submitInstruction(new GainActionPointsInstruction({ amount: 1 }), instr),
  }],
});

const bigSlime = () => new Enemy({ defId: 'slime', name: '史莱姆', maxHp: 200 });

describe('无量：每抽 11 张牌回 1 行动力', () => {
  it('抽牌跨指令累积计数，满 11 触发回复，余数保留', () => {
    const d = new BattleDriver({
      deck: ['wuliang', ...Array(24).fill('punch')],
      enemies: [bigSlime()], seed: 5,
      config: { initialDraw: 5, drawPerTurn: 0 },
      player: { maxHandSize: 30 }, // 抽牌计数需越过默认上限 10（咏唱占位语义不参与本用例）
    });
    d.start();
    // 起手 5 张已抽（计数从激活后开始，不含起手）
    bringToHand(d, 'wuliang');

    d.play('wuliang'); // 3 AP → 2 AP，发动（留手牌点亮）
    expect(d.player.actionPoints).toBe(2);
    const wuliang = d.state.zones.hand.find(c => c.defId === 'wuliang');

    d.dispatch(new DrawCardsInstruction({ count: 6 }));
    expect(wuliang.chantCount).toBe(6);
    expect(d.player.actionPoints).toBe(2);

    d.dispatch(new DrawCardsInstruction({ count: 6 })); // 累计 12 → 回 1，余 1
    expect(wuliang.chantCount).toBe(1);
    expect(d.player.actionPoints).toBe(3);
  });

  it('计数跨回合保留，回合开始抽牌也计入', () => {
    const d = new BattleDriver({
      deck: ['wuliang', ...Array(24).fill('punch')],
      enemies: [bigSlime()], seed: 5,
      config: { initialDraw: 5, drawPerTurn: 3 },
      player: { maxHandSize: 30 },
    });
    d.start();

    bringToHand(d, 'wuliang');
    d.play('wuliang');
    const wuliang = d.state.zones.hand.find(c => c.defId === 'wuliang');
    d.dispatch(new DrawCardsInstruction({ count: 10 }));
    expect(wuliang.chantCount).toBe(10);

    d.endTurn(); // 回合 2 开始抽 3 张：10 + 3 = 13 → 回 1，余 2
    expect(wuliang.chantCount).toBe(2);
    expect(d.player.actionPoints).toBe(4); // 回合重置为 3，+1 不受上限截断（battle.md §6）
  });
});

describe('拳师：每回合第 5 张卡回 1 行动力', () => {
  it('5 点行动力打出第 6 张牌（第 5 张后回 1）', () => {
    const d = new BattleDriver({
      deck: Array(7).fill('punch'),
      enemies: [bigSlime()], abilities: ['boxer'], seed: 5,
      config: { initialDraw: 7 },
      player: { maxActionPoints: 5 },
    });
    const slime = d.state.enemies[0];
    d.start();

    d.playAll(['punch', 'punch', 'punch', 'punch']);
    expect(d.player.actionPoints).toBe(1);
    d.play('punch'); // 第 5 张：AP 1→0，随后拳师回 1
    expect(d.player.actionPoints).toBe(1);

    d.play('punch'); // 第 6 张得以打出
    expect(d.player.actionPoints).toBe(0);
    expect(slime.hp).toBe(200 - 36);
    expect(d.state.history.turn.played).toBe(6);
  });

  it('计数按回合重置：上回合打 4 张，本回合第 1 张不触发', () => {
    const d = new BattleDriver({
      deck: Array(8).fill('punch'),
      enemies: [bigSlime()], abilities: ['boxer'], seed: 5,
      config: { initialDraw: 4, drawPerTurn: 4 },
      player: { maxActionPoints: 5 },
    });
    d.start();

    d.playAll(['punch', 'punch', 'punch', 'punch']); // 4 张，AP 1
    d.endTurn(); // 回合 2：AP 重置为 5，抽 4 张
    expect(d.player.actionPoints).toBe(5);

    d.play('punch'); // 本回合第 1 张（战斗第 5 张）——不触发
    expect(d.player.actionPoints).toBe(4);
    expect(d.state.history.turn.played).toBe(1);
  });
});

describe('拳王：每回合第 5、8 张卡各回 1 行动力', () => {
  it('7 点行动力打出 9 张牌（两次回复），第 10 张无力打出', () => {
    const d = new BattleDriver({
      deck: Array(10).fill('punch'),
      enemies: [bigSlime()], abilities: ['champion'], seed: 5,
      config: { initialDraw: 10 },
      player: { maxActionPoints: 7, maxHandSize: 10 }, // 一回合连打 9 张：起手需越过默认上限 7
    });
    const slime = d.state.enemies[0];
    d.start();

    d.playAll(Array(9).fill('punch'));
    // 7 - 5 = 2 → 第5张回1 = 3；3 - 3 = 0 → 第8张回1 = 1；第9张 1→0
    expect(d.player.actionPoints).toBe(0);
    expect(d.state.history.turn.played).toBe(9);
    expect(slime.hp).toBe(200 - 54);

    expect(() => d.play('punch')).toThrow('无法出牌'); // 第 10 张 AP 不足
  });
});
