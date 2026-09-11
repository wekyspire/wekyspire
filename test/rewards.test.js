import { describe, it, expect } from 'vitest';
import '../src/core/content/index.js'; // 注册全部最小内容
import { createRun, enterBattle, finishBattle } from '../src/core/run/runFlow.js';
import {
  REWARDS_PLACEHOLDER, spawnableCardPool, packCardPool, availablePacks,
  rollSkillChoices, maxRewardTier, spawnRewards, chooseSkillReward, isRewardsClaimed,
} from '../src/core/run/rewards.js';

const TIER_RANK = { D: 0, C: 1, B: 2, A: 3 };

describe('奖励卡池（RUN_DESIGN §2.1/§6.3 占位）', () => {
  it('卡池排除 S/Z 阶与 canSpawnAsReward=false', () => {
    const pool = spawnableCardPool();
    expect(pool.length).toBeGreaterThan(0);
    for (const def of pool) {
      expect(def.tier).not.toBe('S');
      expect(def.tier).not.toBe('Z');
      expect(def.canSpawnAsReward).not.toBe(false);
    }
  });

  it('等阶门禁：按该维度自己的等级出卡（0 级 D/C，1 级 B，2 级 A）', () => {
    const run = createRun({ seed: 1 });
    expect(maxRewardTier(run, 'body')).toBe('C');
    expect(maxRewardTier(run, 'fire')).toBe('C');
    expect(packCardPool(run, 'body').some(d => d.tier === 'B')).toBe(false);
    expect(packCardPool(run, 'body').some(d => d.tier === 'A')).toBe(false);

    run.player.leino.fire = 1; // 火灵脉专精：只惠及火包
    expect(maxRewardTier(run, 'fire')).toBe('B');
    expect(maxRewardTier(run, 'body')).toBe('C');
    expect(packCardPool(run, 'fire').some(d => d.tier === 'B')).toBe(true);
    expect(packCardPool(run, 'body').some(d => d.tier === 'B')).toBe(false);

    run.player.leino.fire = 2;
    expect(maxRewardTier(run, 'fire')).toBe('A');
    expect(packCardPool(run, 'fire').some(d => d.tier === 'A')).toBe(true);

    // 可开卡包：体修恒开；火灵脉需等级 ≥1；木/空无内容自动隐藏
    expect(availablePacks(createRun({ seed: 7 })).map(p => p.id)).toEqual(['body']);
    expect(availablePacks(run).map(p => p.id)).toEqual(['body', 'fire']);

    // 抽取候选与门禁同源：未进阶 run 的包内 3 选 1 不含 B/A
    const fresh = createRun({ seed: 7 });
    for (const id of rollSkillChoices(fresh, 'body')) {
      const def = packCardPool(fresh, 'body').find(d => d.id === id);
      expect(TIER_RANK[def.tier]).toBeLessThanOrEqual(TIER_RANK.C);
    }
  });

  it('3 选 1 候选：数量正确、不重复、全部来自卡池', () => {
    const run = createRun({ seed: 1 });
    const ids = rollSkillChoices(run);
    const poolIds = spawnableCardPool(run).map(d => d.id);
    expect(ids.length).toBe(REWARDS_PLACEHOLDER.skillChoiceCount);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(poolIds).toContain(id);
  });

  it('候选抽取确定性：同种子一致', () => {
    expect(rollSkillChoices(createRun({ seed: 9 }))).toEqual(rollSkillChoices(createRun({ seed: 9 })));
  });
});

describe('战后奖励生成与抉择', () => {
  const winFloor1 = (seed = 1) => {
    const run = createRun({ seed });
    enterBattle(run);
    finishBattle(run, 'victory');
    return run;
  };

  it('spawnRewards：金币入账 + 奖励结构完整且未抉择', () => {
    const run = createRun({ seed: 1 });
    const before = run.player.money;
    enterBattle(run);
    finishBattle(run, 'victory');
    expect(run.player.money).toBe(before + REWARDS_PLACEHOLDER.moneyPerBattle);
    expect(run.rewards.money).toBe(REWARDS_PLACEHOLDER.moneyPerBattle);
    expect(run.rewards.skillChoices.length).toBe(3);
    expect(run.rewards.chosenSkill).toBeUndefined();
    expect(isRewardsClaimed(run)).toBe(false);
  });

  it('领卡：候选入 deck，chosenSkill 记录 defId', () => {
    const run = winFloor1();
    const deckBefore = run.player.deck.length;
    const pick = run.rewards.skillChoices[1];
    chooseSkillReward(run, pick);
    expect(run.player.deck.length).toBe(deckBefore + 1);
    expect(run.player.deck.at(-1).defId).toBe(pick);
    expect(run.rewards.chosenSkill).toBe(pick);
    expect(isRewardsClaimed(run)).toBe(true);
  });

  it('跳过：不入 deck，chosenSkill 记为 null', () => {
    const run = winFloor1();
    const deckBefore = run.player.deck.length;
    chooseSkillReward(run, null);
    expect(run.player.deck.length).toBe(deckBefore);
    expect(run.rewards.chosenSkill).toBeNull();
    expect(isRewardsClaimed(run)).toBe(true);
  });

  it('非法候选与重复领取抛错', () => {
    const run = winFloor1();
    expect(() => chooseSkillReward(run, 'notACandidate')).toThrow(/不在奖励候选中/);
    chooseSkillReward(run, null);
    expect(() => chooseSkillReward(run, null)).toThrow(/已领取/);
  });

  it('奖励生成确定性：同种子逐层候选一致', () => {
    const a = winFloor1(42);
    const b = winFloor1(42);
    expect(a.rewards.skillChoices).toEqual(b.rewards.skillChoices);
  });
});
