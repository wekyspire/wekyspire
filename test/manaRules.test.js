import { describe, it, expect } from 'vitest';
import '../src/core/content/index.js'; // 注册全部最小内容
import { BattleDriver } from '../src/core/sdk/driver.js';
import { createRecordingPresenter } from '../src/core/presenter.js';
import { getEnemyDefinition } from '../src/core/enemies/registry.js';
import { createBattle, startBattle } from '../src/core/flow/battle.js';
import { GainManaInstruction, GainActionPointsInstruction } from '../src/core/instructions/resources.js';
import { createRunState } from '../src/core/state/runState.js';
import Player from '../src/core/state/player.js';

// 魏启（mana）新规则（battle_gameplay/battle.md §6，2026-08 改版）：
//   战斗内资源——入战置为上限一半（下取整），每玩家回合开始 +1，获取受上限截断；
//   AP 获取不受上限截断（爆发蓄能），回合开始「回满」设回上限值。
describe('魏启：入战半满 + 回合恢复', () => {
  it('入战置为上限一半（下取整），回合开始 +1', () => {
    const d = new BattleDriver({ deck: ['punch', 'punch', 'punch'], enemies: ['slime'], seed: 3 });
    d.start(); // PreBattle 半满(1) → 首回合开始 +1 = 2
    expect(d.player.mana).toBe(2);

    d.endTurn(); // 敌方回合（不恢复）→ 第二玩家回合 +1 = 3（恰抵上限）
    expect(d.player.mana).toBe(3);
    d.endTurn(); // 已抵上限，+1 被截断
    expect(d.player.mana).toBe(3);
  });

  it('跨战斗重置：上一场的余量不带入下一场', () => {
    const d = new BattleDriver({ deck: ['purify'], enemies: ['slime'], seed: 5 });
    d.start();
    expect(d.player.mana).toBe(2); // 半满1 + 回合恢复1
    d.play('purify');
    expect(d.player.mana).toBe(1);

    // 复用同一 runState 开启第二场战斗（模拟爬塔进入下一层）
    const battle2 = createBattle({
      runState: d.ctx.runState,
      enemies: [getEnemyDefinition('slime').createUnit()],
      seed: 6,
      presenter: createRecordingPresenter(),
    });
    startBattle(battle2);
    expect(d.player.mana).toBe(2); // 重新半满(1) + 首回合恢复(1)，上一场余量 1 被丢弃
    expect(battle2.ctx.player).toBe(d.player);
  });

  it('获取受上限截断', () => {
    const d = new BattleDriver({ deck: ['punch', 'punch'], enemies: ['slime'], seed: 3 });
    d.start();
    expect(d.player.mana).toBe(2);
    d.dispatch(new GainManaInstruction({ amount: 99 }));
    expect(d.player.mana).toBe(3); // min(2+99, maxMana)
  });
});

describe('AP：获取不受上限截断', () => {
  it('满 AP 时再获取可超出上限；下回合开始回满设回上限值', () => {
    const d = new BattleDriver({ deck: ['punch', 'punch'], enemies: ['slime'], seed: 3 });
    d.start();
    expect(d.player.actionPoints).toBe(3);
    d.dispatch(new GainActionPointsInstruction({ amount: 2 }));
    expect(d.player.actionPoints).toBe(5); // 不截断
    d.endTurn(); // 敌方回合 → 下玩家回合开始回满
    expect(d.player.actionPoints).toBe(3); // 「回满」= 设回上限
  });

  it('肾上腺素在满 AP 时打出仍有净收益（当回合内）', () => {
    const d = new BattleDriver({ deck: ['adrenaline', 'punch'], enemies: ['slime'], seed: 5 });
    d.start();
    const ap = d.player.actionPoints;
    d.play('adrenaline');
    expect(d.player.actionPoints).toBe(ap + 1); // 0 费 +1：获取不截断，可超上限
  });
});

describe('纳气：回合开始整取', () => {
  it('获得层数点魏启后层数归零（一次性整取，非逐层递减）', () => {
    const d = new BattleDriver({ deck: ['manaJarPlus', 'punch', 'punch'], enemies: ['slime'], seed: 3 });
    d.start();
    const before = d.player.mana;
    d.play('manaJarPlus'); // 高级魏启罐：纳气2，消耗
    expect(d.player.getEffectStacks('naqi')).toBe(2);
    expect(d.player.mana).toBe(before - 0); // 罐 0 费，纳气尚未兑现
    d.endTurn(); // 敌方回合 → 玩家回合开始：+1 常规恢复 + 纳气整取 2
    expect(d.player.mana).toBe(Math.min(before + 3, d.player.maxMana));
    expect(d.player.getEffectStacks('naqi')).toBe(0); // 归零
  });
});

// 构造奇数上限玩家验证「下取整」
describe('入战半满的下取整', () => {
  it('上限 4 → 入战 2；上限 5 → 入战 2', () => {
    for (const [maxMana, expected] of [[4, 2], [5, 2]]) {
      const runState = createRunState({ player: new Player({ maxHp: 30, maxMana }) });
      const battle = createBattle({
        runState,
        enemies: [getEnemyDefinition('slime').createUnit()],
        seed: 1,
        presenter: createRecordingPresenter(),
      });
      startBattle(battle); // 半满 + 首回合恢复1
      expect(runState.player.mana).toBe(expected + 1);
    }
  });
});
