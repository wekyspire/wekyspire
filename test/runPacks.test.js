import { describe, it, expect } from 'vitest';
import '../src/core/content/index.js';
import { createRun, enterBattle, finishBattle, completeRoom } from '../src/core/run/runFlow.js';
import {
  LEINO_DIMENSIONS, SEED_OFFERING, seedPool, rollSeedCards,
  chooseAscension, chooseSeedCards, rerollSeedOffering,
} from '../src/core/run/ascension.js';
import {
  PACKS, availablePacks, packCardPool, packOf, chooseRewardPack,
  chooseSkillReward, spawnRewards,
} from '../src/core/run/rewards.js';
import { RunDriver } from '../src/core/run/runDriver.js';
import { getSkillDefinition } from '../src/core/skills/registry.js';

// ---- 种子包（首次点亮体系：九选三 + 一次刷新）与卡包制奖励 ----

// 造一个「训练达标 → ascension 阶段」的 run（与 ascension.test.js 同法）
function toAscension(seed = 1) {
  const run = createRun({ seed });
  run.player.trainingCount = 3; // 第 1 次进阶门槛
  run.gameStage = 'ascension';
  return run;
}

describe('种子包：首次点亮体系', () => {
  it('维度选择只含已实装灵脉（木/空屏蔽；体修走隐藏等级，不是灵脉维度）', () => {
    expect(LEINO_DIMENSIONS).toEqual(['fire']);
  });

  it('种子池只有 D/C、排除组合件与不可出池卡', () => {
    const run = createRun({ seed: 1 });
    for (const dim of LEINO_DIMENSIONS) {
      const pool = seedPool(run, dim);
      expect(pool.length).toBeGreaterThanOrEqual(SEED_OFFERING.cards);
      for (const def of pool) {
        expect(['D', 'C']).toContain(def.tier);
        expect(def.canSpawnAsReward).not.toBe(false);
        expect(packOf(def)).toBe(dim);
      }
      // 组合件必须被排除（抽样：控火术/添柴/花刀/飞刀）
      const ids = pool.map(d => d.id);
      expect(ids).not.toContain('fireControlExtinguish');
      expect(ids).not.toContain('fuelTheFire');
      expect(ids).not.toContain('handCleave');
      expect(ids).not.toContain('flyingDagger');
    }
  });

  it('首次 0→1 挂起九选三；选定三张入牌组后事件收尾', () => {
    const run = toAscension();
    const deckBefore = run.player.deck.length;
    chooseAscension(run, 'fire');
    expect(run.cardOffering).toBeTruthy();
    expect(run.cardOffering.dimension).toBe('fire');
    expect(run.cardOffering.cards).toHaveLength(SEED_OFFERING.cards);
    expect(new Set(run.cardOffering.cards).size).toBe(SEED_OFFERING.cards); // 互不重复
    expect(run.cardOffering.rerollsLeft).toBe(1);
    // 挂起期间不可再次升级
    expect(() => chooseAscension(run, 'fire')).toThrow(/种子卡尚未选定/);

    const pick = run.cardOffering.cards.slice(0, 3);
    chooseSeedCards(run, pick);
    expect(run.cardOffering).toBeNull();
    // 获赠 2 张（点火+火弹术直入牌组）+ 选定 3 张种子卡
    expect(run.player.deck.length).toBe(deckBefore + 5);
    expect(run.player.deck.slice(-3).map(c => c.defId)).toEqual(pick);
  });

  it('刷新一次：重抽九张且互不重复；用尽后再刷抛错', () => {
    const run = toAscension();
    chooseAscension(run, 'fire');
    rerollSeedOffering(run);
    expect(run.cardOffering.rerollsLeft).toBe(0);
    expect(run.cardOffering.cards).toHaveLength(SEED_OFFERING.cards);
    expect(new Set(run.cardOffering.cards).size).toBe(SEED_OFFERING.cards);
    expect(() => rerollSeedOffering(run)).toThrow(/没有可用的刷新次数/);
  });

  it('非法选卡抛错：数量不对 / 重复 / 不在候选', () => {
    const run = toAscension();
    chooseAscension(run, 'fire');
    const cards = run.cardOffering.cards;
    expect(() => chooseSeedCards(run, cards.slice(0, 2))).toThrow(/必须选 3 张/);
    expect(() => chooseSeedCards(run, [cards[0], cards[0], cards[1]])).toThrow(/不可重复/);
    expect(() => chooseSeedCards(run, ['notInOffering', cards[0], cards[1]])).toThrow(/不在候选中/);
  });

  it('同种子同维度：候选完全一致（确定性）', () => {
    const a = toAscension(7); const b = toAscension(7);
    chooseAscension(a, 'fire'); chooseAscension(b, 'fire');
    expect(a.cardOffering.cards).toEqual(b.cardOffering.cards);
  });

  it('同维度第二次升级不再开种子包', () => {
    const run = toAscension();
    chooseAscension(run, 'fire');
    chooseSeedCards(run, run.cardOffering.cards.slice(0, 3));
    // 再进一次进阶事件
    run.player.trainingCount = 6;
    run.gameStage = 'ascension';
    chooseAscension(run, 'fire');
    expect(run.cardOffering).toBeNull();
    expect(run.player.leino.fire).toBe(2);
  });

  it('rollSeedCards 返回完整九张且互不重复', () => {
    const run = createRun({ seed: 3 });
    const cards = rollSeedCards(run, 'fire');
    expect(cards).toHaveLength(SEED_OFFERING.cards);
    expect(new Set(cards).size).toBe(SEED_OFFERING.cards);
  });
});

describe('卡包制奖励', () => {
  it('体修包恒开；火灵脉需等级 ≥1；通用包不可直接选', () => {
    const run = createRun({ seed: 1 });
    expect(availablePacks(run).map(p => p.id)).toEqual(['body']);
    expect(PACKS.body.name).toBe('体修');

    run.player.leino.fire = 1;
    expect(availablePacks(run).map(p => p.id)).toEqual(['body', 'fire']);
    expect(availablePacks(run).some(p => p.id === 'common')).toBe(false);
  });

  it('体修包门禁看隐藏的 bodyLevel（跳过进阶 +1）', () => {
    const run = createRun({ seed: 1 });
    expect(packCardPool(run, 'body').some(d => d.tier === 'B')).toBe(false);
    run.player.bodyLevel = 1;
    expect(packCardPool(run, 'body').some(d => d.tier === 'B')).toBe(true);
    expect(packCardPool(run, 'fire').some(d => d.tier === 'B')).toBe(false); // 火灵脉不受影响
  });

  it('通用卡独立成包：不在体修/火灵脉池与种子池中', () => {
    const run = createRun({ seed: 1 });
    for (const pool of [packCardPool(run, 'body'), packCardPool(run, 'fire'), seedPool(run, 'fire')]) {
      for (const def of pool) expect(packOf(def)).not.toBe('common');
    }
    expect(packCardPool(run, 'common').some(d => d.id === 'manaJar')).toBe(true);
  });

  it('开包后候选来自该包；卡包选定后不可更改', () => {
    const run = createRun({ seed: 1 });
    run.player.leino.fire = 1;
    enterBattle(run);
    finishBattle(run, 'victory');
    expect(run.rewards.packs).toEqual(['body', 'fire']);
    expect(run.rewards.packId).toBeNull(); // 多包不自动开

    chooseRewardPack(run, 'fire');
    const poolIds = packCardPool(run, 'fire').map(d => d.id);
    for (const id of run.rewards.skillChoices) expect(poolIds).toContain(id);
    expect(() => chooseRewardPack(run, 'body')).toThrow(/卡包已选择/);

    const deckBefore = run.player.deck.length;
    chooseSkillReward(run, run.rewards.skillChoices[0]);
    expect(run.player.deck.length).toBe(deckBefore + 1);
  });

  it('只有一个可开卡包时自动开包（开局即体修）', () => {
    const run = createRun({ seed: 1 });
    enterBattle(run);
    finishBattle(run, 'victory');
    expect(run.rewards.packId).toBe('body');
    expect(run.rewards.skillChoices).toHaveLength(3);
  });

  it('通用卡注入：保底计数到期必注入，且替换的槽位被记录', () => {
    const run = createRun({ seed: 1 });
    run.commonPity = 3; // 再开一次必注入
    enterBattle(run);
    finishBattle(run, 'victory'); // 只有体修包 → 自动开包（走注入判定）
    expect(run.rewards.commonInjected).toBe(true);
    expect(run.commonPity).toBe(0);
    const slot = run.rewards.commonSlot;
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(run.rewards.skillChoices).toHaveLength(3);
    expect(packOf(getSkillDefinition(run.rewards.skillChoices[slot]))).toBe('common');
  });

  it('整局跑通：种子包与卡包在 RunDriver 下自动结算', () => {
    // 坦克玩家：确保推进到进阶事件（缺省策略会在半途阵亡）
    const d = new RunDriver({ seed: 11, totalFloors: 11, player: { maxHp: 999, hp: 999 } }).start();
    d.runToEnd();
    expect(d.isFinished()).toBe(true);
    expect(d.run.player.ascensionCount).toBeGreaterThan(0); // 经历过进阶
    // 种子包三张已入牌组：牌组里存在火灵脉卡（缺省加火灵脉）
    const hasFire = d.run.player.deck.some(c => getSkillDefinition(c.defId)?.type === 'fire');
    expect(hasFire).toBe(true);
  });
});

describe('进阶节奏（2026-09 调前）', () => {
  it('首进阶落在第 2 层：打完第 2 层战斗 → 训练房 → 进阶事件', () => {
    const d = new RunDriver({ seed: 11, totalFloors: 11, player: { maxHp: 999, hp: 999 } }).start();
    let firstAscFloor = null;
    let guard = 0;
    while (!d.isFinished() && guard++ < 400) {
      if (d.run.gameStage === 'ascension' && firstAscFloor === null) firstAscFloor = d.run.floor;
      d.step();
    }
    expect(firstAscFloor).toBe(2);
    expect(d.run.player.ascensionCount).toBeGreaterThanOrEqual(1);
  });
});
