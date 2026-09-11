import { describe, it, expect } from 'vitest';
import '../src/core/content/index.js';
import { BattleDriver } from '../src/core/sdk/driver.js';
import Enemy from '../src/core/state/enemy.js';
import { zoneOf } from '../src/core/state/battleState.js';
import { AddEffectInstruction } from '../src/core/instructions/effects.js';
import { DealDamageInstruction } from '../src/core/instructions/combat.js';
import { GainManaInstruction } from '../src/core/instructions/resources.js';
import { getSkillDefinition } from '../src/core/skills/registry.js';

// ---- 火灵脉·叠炎组合（fireEmberSkills）：点火 / 燃元 / 控火 真实结算测试 ----
// 全部走 BattleDriver 驱动真实内核（不 mock Core）；燃烧层数直读 getEffectStacks。

// 统一装配：4 张牌全数起手（initialDraw 4），玩家面板攻击 0（裸基数即可精确断言）
function setup({ deck, enemies = ['slime'], player = {} } = {}) {
  const d = new BattleDriver({
    deck, enemies, seed: 5, config: { initialDraw: 4 }, player,
  });
  d.start();
  return d;
}

// 补满魏启（走指令管线，受上限截断；化焰测试不适用——溢出会触发其被动）
const fillMana = (d) => d.dispatch(new GainManaInstruction({ amount: 99 }));

const burnOn = (d, unit, stacks) =>
  d.dispatch(new AddEffectInstruction({ target: unit, effectId: 'burn', stacks }));

describe('点火系列：烈焰 / 炙焰', () => {
  it('3 伤害叠燃烧 7/10；敌方回合开始按层数跳固定伤并 -1', () => {
    const d = setup({
      deck: ['blaze', 'inferno', 'punch', 'punch'],
      enemies: [new Enemy({ defId: 'slime', name: '史莱姆', maxHp: 200 })],
    });
    const slime = d.state.enemies[0];

    d.play('blaze');
    expect(slime.hp).toBe(197);                       // 200 - 3
    expect(slime.getEffectStacks('burn')).toBe(7);

    d.play('inferno');
    expect(slime.hp).toBe(194);                       // 200 - 3 - 3
    expect(slime.getEffectStacks('burn')).toBe(17);   // 7 + 10

    d.endTurn(); // 敌方回合开始：燃烧 17 固定跳伤 → 194-17=177，层数 -1
    expect(slime.hp).toBe(177);
    expect(slime.getEffectStacks('burn')).toBe(16);
  });

  it('点火晋升链完整：点火 → 烈焰 → 炙焰', () => {
    expect(getSkillDefinition('inflame').promotesTo).toBe('blaze');
    expect(getSkillDefinition('blaze').promotesTo).toBe('inferno');
    expect(getSkillDefinition('inferno').promotesTo).toBeUndefined();
  });
});

describe('燃元系列：燃元 / 炼心', () => {
  it('燃元：敌方每 4 层燃烧魏启上限 +1（战斗内永久），消耗入坟，战后回滚', () => {
    const d = setup({
      deck: ['emberOrigin', 'punch', 'punch', 'punch'],
      enemies: ['slime', 'slime'], player: { maxMana: 6 },
    });
    const [e1, e2] = d.state.enemies;
    burnOn(d, e1, 6);
    burnOn(d, e2, 6); // 敌方全体总和 12 → floor(12/4) = 3
    d.player.mana = 2;
    const card = d.state.zones.hand.find(c => c.defId === 'emberOrigin');

    d.play('emberOrigin');
    expect(d.player.maxMana).toBe(9);   // 6 + 3
    expect(d.player.mana).toBe(2);      // 只涨上限，不涨当前
    expect(zoneOf(d.state, card.uniqueID)).toBe('burnt'); // 消耗 → 焚毁区

    // 战斗结束（击杀全部敌人）→ 上限回滚：抬升只在战斗内成立
    d.dispatch(new DealDamageInstruction({ source: d.player, target: e1, amount: 99 }));
    d.dispatch(new DealDamageInstruction({ source: d.player, target: e2, amount: 99 }));
    expect(d.verdict).toBe('victory');
    expect(d.isFinished()).toBe(true);
    expect(d.player.maxMana).toBe(6);
  });

  it('炼心：敌方每 4 层燃烧获得 1 魏启（受上限截断）', () => {
    const d = setup({
      deck: ['refineHeart', 'punch', 'punch', 'punch'], player: { maxMana: 6 },
    });
    burnOn(d, d.state.enemies[0], 9); // floor(9/4) = 2
    d.player.mana = 0;

    d.play('refineHeart');
    expect(d.player.mana).toBe(2);
  });
});

describe('燃元系列：激热（触发一次燃烧结算）', () => {
  it('按燃烧规则立即结算：等层数穿透伤害 + 层数 -1', () => {
    const d = setup({ deck: ['heatSurge', 'punch', 'punch', 'punch'] });
    const slime = d.state.enemies[0];
    burnOn(d, slime, 7);

    d.play('heatSurge');
    expect(slime.hp).toBe(13); // 20 - 7（穿透）
    expect(slime.getEffectStacks('burn')).toBe(6);
  });

  it('防火：伤害结算被跳过，层数照常 -1', () => {
    const d = setup({ deck: ['heatSurge', 'punch', 'punch', 'punch'] });
    const slime = d.state.enemies[0];
    d.dispatch(new AddEffectInstruction({ target: slime, effectId: 'fireproof', stacks: 1 }));
    burnOn(d, slime, 7);

    d.play('heatSurge');
    expect(slime.hp).toBe(20); // 伤害被 veto
    expect(slime.getEffectStacks('burn')).toBe(6); // 层数照常 -1
  });

  it('目标无燃烧：落空不报错', () => {
    const d = setup({ deck: ['heatSurge', 'punch', 'punch', 'punch'] });
    const slime = d.state.enemies[0];
    d.play('heatSurge');
    expect(slime.hp).toBe(20);
    expect(slime.getEffectStacks('burn')).toBe(0);
  });
});

describe('燃元系列：化焰（溢出魏启 → 全场燃烧）', () => {
  it('在手时每点溢出魏启为所有单位施加燃烧 1；打出离手后失效', () => {
    const d = setup({
      deck: ['meltFlame', 'punch', 'punch', 'punch'], player: { maxMana: 10 },
    });
    const slime = d.state.enemies[0];
    const card = d.state.zones.hand.find(c => c.defId === 'meltFlame');

    d.player.mana = 10; // 直接置满（不经指令，避免注入前提前触发）
    d.dispatch(new GainManaInstruction({ amount: 3 })); // gained 0 → 溢出 3
    expect(d.player.getEffectStacks('burn')).toBe(3);
    expect(slime.getEffectStacks('burn')).toBe(3);

    d.play('meltFlame'); // 0 费打出：被动失效，回牌库底
    expect(zoneOf(d.state, card.uniqueID)).toBe('deck');
    d.player.mana = 10;
    d.dispatch(new GainManaInstruction({ amount: 2 }));
    expect(d.player.getEffectStacks('burn')).toBe(3); // 不再追加
    expect(slime.getEffectStacks('burn')).toBe(3);
  });
});

describe('控火术：燃 / 灭 / 灼', () => {
  it('燃：伤害 12，目标每层燃烧伤害 +1', () => {
    const d = setup({
      deck: ['fireControlBurn', 'punch', 'punch', 'punch'], player: { maxMana: 6 },
    });
    const slime = d.state.enemies[0];
    fillMana(d);
    burnOn(d, slime, 5);

    d.play('fireControlBurn');
    expect(slime.hp).toBe(3); // 20 - (12 + 5)
    expect(d.player.mana).toBe(3); // 6 - 3费
  });

  it('灭：驱散 9 层燃烧；不足 9 层则清空', () => {
    const d1 = setup({
      deck: ['fireControlExtinguish', 'punch', 'punch', 'punch'], player: { maxMana: 6 },
    });
    const slime1 = d1.state.enemies[0];
    fillMana(d1);
    burnOn(d1, slime1, 12);
    d1.play('fireControlExtinguish');
    expect(slime1.getEffectStacks('burn')).toBe(3); // 12 - 9

    const d2 = setup({
      deck: ['fireControlExtinguish', 'punch', 'punch', 'punch'], player: { maxMana: 6 },
    });
    const slime2 = d2.state.enemies[0];
    fillMana(d2);
    burnOn(d2, slime2, 5);
    d2.play('fireControlExtinguish');
    expect(slime2.getEffect('burn')).toBeNull(); // 负溢出无害，直接移除
  });

  it('灼：下次攻击每造成 3 伤害赋予燃烧 1（余数丢弃），仅生效一次', () => {
    const d = setup({
      deck: ['fireControlScorch', 'punch', 'punch', 'punch'], player: { maxMana: 6 },
    });
    const slime = d.state.enemies[0];
    fillMana(d);
    d.play('fireControlScorch');

    d.play('punch'); // 6 伤害 → floor(6/3) = 2 层燃烧
    expect(slime.hp).toBe(14);
    expect(slime.getEffectStacks('burn')).toBe(2);

    d.play('punch'); // 灼已消耗：不再赋予
    expect(slime.hp).toBe(8);
    expect(slime.getEffectStacks('burn')).toBe(2);
  });
});

describe('控火术：散 / 收 / 扰', () => {
  it('散：消耗目标全部燃烧，全额叠加到其阵营其它成员', () => {
    const d = setup({
      deck: ['fireControlSpread', 'punch', 'punch', 'punch'],
      enemies: ['slime', 'slime'], player: { maxMana: 6 },
    });
    const [e1, e2] = d.state.enemies;
    fillMana(d);
    burnOn(d, e1, 8); // 默认目标 = 首个存活敌人 e1
    burnOn(d, e2, 2);

    d.play('fireControlSpread');
    expect(e1.getEffect('burn')).toBeNull();
    expect(e2.getEffectStacks('burn')).toBe(10); // 2 + 8（全额传播）
  });

  it('收：消耗目标全部燃烧，每 3 层获得 1 魏启', () => {
    const d = setup({
      deck: ['fireControlHarvest', 'punch', 'punch', 'punch'], player: { maxMana: 6 },
    });
    const slime = d.state.enemies[0];
    fillMana(d);
    burnOn(d, slime, 10);

    d.play('fireControlHarvest');
    expect(d.player.mana).toBe(6); // 6 - 3费 + floor(10/3)=3
    expect(slime.getEffect('burn')).toBeNull();
  });

  it('收：目标无燃烧时落空（只付费用）', () => {
    const d = setup({
      deck: ['fireControlHarvest', 'punch', 'punch', 'punch'], player: { maxMana: 6 },
    });
    fillMana(d);
    d.play('fireControlHarvest');
    expect(d.player.mana).toBe(3);
    expect(d.state.enemies[0].hp).toBe(20);
  });

  it('扰：消耗自身全部燃烧，每层获得 3 护盾', () => {
    const d = setup({
      deck: ['fireControlDisturb', 'punch', 'punch', 'punch'], player: { maxMana: 6 },
    });
    fillMana(d);
    burnOn(d, d.player, 4);

    d.play('fireControlDisturb');
    expect(d.player.shield).toBe(12); // 4 × 3
    expect(d.player.getEffect('burn')).toBeNull();
    expect(d.player.mana).toBe(3);
  });
});

describe('控火术：爆 / 聚 / 炼', () => {
  it('爆：消耗所有敌人的全部燃烧，每层对全体敌人造成 1 群伤', () => {
    const big = () => new Enemy({ defId: 'slime', name: '史莱姆', maxHp: 200 });
    const d = setup({
      deck: ['fireControlDetonate', 'punch', 'punch', 'punch'],
      enemies: [big(), big()], player: { maxMana: 8 },
    });
    const [e1, e2] = d.state.enemies;
    fillMana(d);
    burnOn(d, e1, 6);
    burnOn(d, e2, 4);

    d.play('fireControlDetonate');
    expect(e1.hp).toBe(190); // 200 - (6+4)
    expect(e2.hp).toBe(190);
    expect(e1.getEffect('burn')).toBeNull();
    expect(e2.getEffect('burn')).toBeNull();
    expect(d.player.mana).toBe(2); // 8 - 6费
  });

  it('爆：群伤途中团灭立即胜利，后续结算安全收尾', () => {
    const d = setup({
      deck: ['fireControlDetonate', 'punch', 'punch', 'punch'],
      enemies: [
        new Enemy({ defId: 'slime', name: '甲', maxHp: 3 }),
        new Enemy({ defId: 'slime', name: '乙', maxHp: 3 }),
      ],
      player: { maxMana: 8 },
    });
    const [e1, e2] = d.state.enemies;
    fillMana(d);
    burnOn(d, e1, 4);
    burnOn(d, e2, 2); // 总 6 层 → 全体 6 伤害，两个残血敌人当场团灭

    d.play('fireControlDetonate');
    expect(e1.isDead()).toBe(true);
    expect(e2.isDead()).toBe(true);
    expect(d.verdict).toBe('victory');
    expect(d.isFinished()).toBe(true);
  });

  it('聚：场上所有燃烧（含自身）迁移至目标', () => {
    const d = setup({
      deck: ['fireControlGather', 'punch', 'punch', 'punch'],
      enemies: ['slime', 'slime'], player: { maxMana: 6 },
    });
    const [e1, e2] = d.state.enemies;
    fillMana(d);
    burnOn(d, d.player, 3);
    burnOn(d, e2, 5); // 默认目标 e1 自身无燃烧

    d.play('fireControlGather');
    expect(e1.getEffectStacks('burn')).toBe(8); // 3 + 5
    expect(e2.getEffect('burn')).toBeNull();
    expect(d.player.getEffect('burn')).toBeNull();
  });

  it('炼：燃烧与负面效果两两抵消（按效果顺序贪心分配）', () => {
    const d = setup({
      deck: ['fireControlRefine', 'punch', 'punch', 'punch'], player: { maxMana: 6 },
    });
    const slime = d.state.enemies[0];
    fillMana(d);
    burnOn(d, slime, 6);
    d.dispatch(new AddEffectInstruction({ target: slime, effectId: 'weaken', stacks: 4 }));
    d.dispatch(new AddEffectInstruction({ target: slime, effectId: 'poison', stacks: 3 }));

    d.play('fireControlRefine'); // min(6, 4+3)=6 对：燃尽，虚弱尽，中毒 3-2=1
    expect(slime.getEffect('burn')).toBeNull();
    expect(slime.getEffect('weaken')).toBeNull();
    expect(slime.getEffectStacks('poison')).toBe(1);
  });

  it('炼：增益类效果（格挡/防火/纳气）不参与抵消', () => {
    const d = setup({
      deck: ['fireControlRefine', 'punch', 'punch', 'punch'], player: { maxMana: 6 },
    });
    const slime = d.state.enemies[0];
    fillMana(d);
    burnOn(d, slime, 2);
    d.dispatch(new AddEffectInstruction({ target: slime, effectId: 'fireproof', stacks: 3 }));

    d.play('fireControlRefine'); // 无可配对负面：全部保留
    expect(slime.getEffectStacks('burn')).toBe(2);
    expect(slime.getEffectStacks('fireproof')).toBe(3);
  });
});

describe('控火术：无上（发现 0 费控火术）', () => {
  const ZERO_IDS = [
    'fireControlBurnZero', 'fireControlExtinguishZero', 'fireControlScorchZero',
    'fireControlSpreadZero', 'fireControlHarvestZero', 'fireControlDisturbZero',
    'fireControlDetonateZero', 'fireControlGatherZero', 'fireControlRefineZero',
  ];

  it('随机发现一张 0 费控火术镜像入手（不入奖励池）', () => {
    const d = setup({ deck: ['fireControlSupreme', 'punch', 'punch', 'punch'] });
    d.play('fireControlSupreme'); // 1 费（起手 2 蓝，足够）

    const found = d.state.zones.hand.filter(c => ZERO_IDS.includes(c.defId));
    expect(found).toHaveLength(1);
    const def = getSkillDefinition(found[0].defId);
    expect(def.cost).toEqual({ mana: 0, actionPoint: 0 });
    expect(def.series).toBe('fireControl');
    expect(def.canSpawnAsReward).toBe(false);
    // 发现池不含无上自身（防 0 费自我复制链）
    expect(d.state.zones.hand.some(c => c.defId === 'fireControlSupremeZero')).toBe(false);
  });
});

describe('边界：无燃烧 / 无加成时落空不崩溃', () => {
  it('聚 / 炼 在零燃烧场面无变化；燃 无燃烧加成时仍造成裸 12 伤害', () => {
    const d = setup({
      deck: ['fireControlGather', 'fireControlRefine', 'fireControlBurn', 'punch'],
      player: { maxMana: 14 },
    });
    const slime = d.state.enemies[0];
    fillMana(d);

    d.play('fireControlGather');  // 14 → 8
    d.play('fireControlRefine');  // 8 → 4
    expect(slime.hp).toBe(20);
    expect(slime.effects).toHaveLength(0);

    d.play('fireControlBurn');    // 4 → 1：裸 12 伤害
    expect(slime.hp).toBe(8);
    expect(d.player.mana).toBe(1);
  });
});
