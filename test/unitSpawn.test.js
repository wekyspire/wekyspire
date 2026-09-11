import { describe, it, expect } from 'vitest';
import '../src/core/content/index.js'; // 触发登记（bigSlime/slime/…）
import { BattleDriver } from '../src/core/sdk/driver.js';
import { getEnemyDefinition } from '../src/core/enemies/registry.js';
import { UnitSpawnInstruction } from '../src/core/instructions/units.js';
import { PLAYER_BASE_HP } from '../src/core/state/player.js';

// UnitSpawnInstruction + 大史莱姆召唤行为。
// 约定锚点（详见 content/enemies.js）：
//   * 召唤条件 = 场上无存活史莱姆 && enemies 未满 config.maxEnemies（默认 4，
//     与前端敌排槽数对齐）&& 上一回合没召唤（lastSummonTurn 冷却一整轮）；
//   * 召唤出的史莱姆尾插 enemies——本回合行动循环快照在召唤前已取，下回合起参战；
//   * 否则攻 10（+attack 面板）+ 盾 5。

describe('UnitSpawnInstruction', () => {
  it('尾插敌方、指派 side、播报 unitSpawned（source 随载荷）', () => {
    const d = new BattleDriver({ deck: Array(5).fill('punch'), enemies: ['bigSlime'] });
    d.start();
    const big = d.state.enemies[0];
    d.presenter.clear();
    const slime = getEnemyDefinition('slime').createUnit();
    d.dispatch(new UnitSpawnInstruction({ unit: slime, source: big }));

    expect(d.state.enemies).toHaveLength(2);
    expect(d.state.enemies[1]).toBe(slime);
    expect(slime.side).toBe('enemy');
    const call = d.presenter.calls.find(c => c.method === 'unitSpawned');
    expect(call.args[0]).toMatchObject({ source: big, unit: slime });
  });
});

describe('大史莱姆：条件召唤', () => {
  it('首个敌方回合召唤史莱姆（不攻击），新单位本回合不行动', () => {
    const d = new BattleDriver({ deck: Array(10).fill('punch'), enemies: ['bigSlime'] });
    d.start();
    // 初始意图（PreBattle 计算）：召唤
    expect(d.state.enemies[0].intention.kinds).toEqual(['summon']);

    d.endTurn(); // 敌方回合 1

    expect(d.state.enemies).toHaveLength(2);
    const slime = d.state.enemies[1];
    expect(slime.defId).toBe('slime');
    expect(slime.side).toBe('enemy');
    expect(slime.actionIndex).toBe(0);          // 本回合没轮到它行动
    expect(d.player.hp).toBe(PLAYER_BASE_HP);               // 大史莱姆召唤而非攻击
    expect(d.presenter.calls.some(c => c.method === 'unitSpawned'
      && c.args[0].source === d.state.enemies[0])).toBe(true);
    // 行动后意图：场上已有史莱姆 → 攻击+防御
    expect(d.state.enemies[0].intention).toMatchObject({ kinds: ['attack', 'defend'], damage: 10 });
  });

  it('召唤后一回合内不重复召唤：攻 10 + 盾 5，被召史莱姆同步参战', () => {
    const d = new BattleDriver({ deck: Array(10).fill('punch'), enemies: ['bigSlime'] });
    d.start();
    d.endTurn(); // 敌 1：召唤

    d.endTurn(); // 敌 2（玩家回合 2 无操作）
    expect(d.state.enemies).toHaveLength(2);    // 冷却中：不再召唤
    expect(d.state.enemies[0].shield).toBe(5);  // 攻 10 + 盾 5
    expect(d.player.hp).toBe(PLAYER_BASE_HP - 10 - 6);      // 大史莱姆 10 + 史莱姆（首次行动）6

    d.endTurn(); // 敌 3：史莱姆仍存活 → 继续攻防（史莱姆转盾）
    expect(d.state.enemies).toHaveLength(2);
    expect(d.player.hp).toBe(PLAYER_BASE_HP - 10 - 6 - 10);
  });

  it('史莱姆死亡后隔一回合重新召唤', () => {
    const d = new BattleDriver({ deck: Array(10).fill('punch'), enemies: ['bigSlime'] });
    d.start();
    d.endTurn();                                  // 敌 1：召唤
    d.state.enemies[1].hp = 0;                    // 玩家回合 2：击杀史莱姆
    d.endTurn();                                  // 敌 2：冷却 → 攻 10
    expect(d.state.enemies).toHaveLength(2);
    expect(d.player.hp).toBe(40);

    d.endTurn();                                  // 敌 3：无史莱姆 + 已过冷却 → 再召唤
    expect(d.state.enemies).toHaveLength(3);
    const revived = d.state.enemies[2];
    expect(revived.defId).toBe('slime');
    expect(revived.actionIndex).toBe(0);
    expect(d.player.hp).toBe(40);                 // 召唤回合不再攻击
  });

  it('敌排无空位（enemies 满 maxEnemies）时不召唤，改为攻击', () => {
    const d = new BattleDriver({
      deck: Array(10).fill('punch'),
      enemies: ['bigSlime', 'slime', 'pyro', 'gargoyle'],
    });
    d.start();
    d.state.enemies[1].hp = 0;    // 史莱姆死亡（尸体占位：槽位不释放）
    d.endTurn();
    expect(d.state.enemies).toHaveLength(4);      // 无空位：不召唤
    // 攻击照常：大史莱姆 10 + 燃焰术士 10（石像卫士该轮再生不动手）
    expect(d.player.hp).toBe(PLAYER_BASE_HP - 10 - 10);
    expect(d.state.enemies[0].shield).toBe(5);
  });
});
