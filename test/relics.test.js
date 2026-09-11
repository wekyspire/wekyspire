import { describe, it, expect } from 'vitest';
import '../src/core/content/index.js';
import { createRun, enterBattle, createRunBattle } from '../src/core/run/runFlow.js';
import { startBattle } from '../src/core/flow/battle.js';
import { grantRelic, equipRelic, unequipRelic, prepUseRelic } from '../src/core/run/prep.js';
import { registerRelic } from '../src/core/relics/registry.js';

// 第三件测试遗物（验证装备上限用）
registerRelic({ id: 'testBall', name: '测试球', description: '占位。' });

describe('遗物获取与装卸（RUN_DESIGN §4.5/§6.3）', () => {
  it('grantRelic：入背包 + 初始化次数；未注册遗物抛错', () => {
    const run = createRun({ seed: 1 });
    grantRelic(run, 'springFlask');
    expect(run.player.relics).toEqual(['springFlask']);
    expect(run.relicUses.springFlask).toBe(1);
    grantRelic(run, 'warHorn'); // 无 uses 字段不记次数
    expect(run.relicUses.warHorn).toBeUndefined();
    expect(() => grantRelic(run, 'noSuchRelic')).toThrow();
  });

  it('装备上限 relicSlots=2：装卸规则', () => {
    const run = createRun({ seed: 1 });
    expect(() => equipRelic(run, 'warHorn')).toThrow(/背包中没有/);
    grantRelic(run, 'warHorn');
    grantRelic(run, 'springFlask');
    grantRelic(run, 'testBall');

    equipRelic(run, 'warHorn');
    expect(() => equipRelic(run, 'warHorn')).toThrow(/已装备/);
    equipRelic(run, 'springFlask');
    expect(run.player.equippedRelics).toEqual(['warHorn', 'springFlask']);
    expect(() => equipRelic(run, 'testBall')).toThrow(/遗物栏已满/);

    unequipRelic(run, 'warHorn');
    expect(run.player.equippedRelics).toEqual(['springFlask']);
    expect(() => unequipRelic(run, 'warHorn')).toThrow(/未装备/);
  });
});

describe('prepUse 战前主动钩子', () => {
  it('仅 prep 阶段 + 已装备 + 有次数时可用', () => {
    const run = createRun({ seed: 1 });
    run.player.maxHp = 30;
    run.player.hp = 10;
    grantRelic(run, 'springFlask');
    expect(() => prepUseRelic(run, 'springFlask')).toThrow(/未装备/);
    equipRelic(run, 'springFlask');
    prepUseRelic(run, 'springFlask');
    expect(run.player.hp).toBe(15);
    expect(run.relicUses.springFlask).toBe(0);
    expect(() => prepUseRelic(run, 'springFlask')).toThrow(/次数已耗尽/);
  });

  it('阶段限制与被动遗物不可主动使用', () => {
    const run = createRun({ seed: 1 });
    grantRelic(run, 'warHorn');
    equipRelic(run, 'warHorn');
    expect(() => prepUseRelic(run, 'warHorn')).toThrow(/不可主动使用/);
    run.gameStage = 'battle';
    expect(() => prepUseRelic(run, 'warHorn')).toThrow(/战前准备阶段/);
  });
});

describe('战斗挂载：仅装备中的遗物生效', () => {
  const battleStartStrength = (equip) => {
    const run = createRun({ seed: 1 });
    grantRelic(run, 'warHorn');
    if (equip) equipRelic(run, 'warHorn');
    enterBattle(run);
    const battle = createRunBattle(run);
    startBattle(battle);
    return run.player.getEffectStacks('strength');
  };

  it('装备 → 战时获得力量；背包装备栏外 → 不生效', () => {
    expect(battleStartStrength(true)).toBe(1);
    expect(battleStartStrength(false)).toBe(0);
  });
});
