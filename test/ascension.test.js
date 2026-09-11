import { describe, it, expect } from 'vitest';
import '../src/core/content/index.js';
import { createRun, completeRoom } from '../src/core/run/runFlow.js';
import {
  ASCENSION_PLACEHOLDER, LEINO_DIMENSIONS, totalLeino, SEED_OFFERING,
  ascensionReady, chooseAscension, chooseAscensionAbility, chooseSeedCards,
  seedPool, rollSeedCards, rerollSeedOffering,
} from '../src/core/run/ascension.js';

// 构造"刚离开训练房"的 run：floor 1 训练房，手动设置训练次数
const leaveTraining = (trainings) => {
  const run = createRun({ seed: 1 });
  run.gameStage = 'room';
  run.currentRoom = 'training';
  run.player.trainingCount = trainings;
  return run;
};

describe('进阶触发判定（RUN_DESIGN §5.3）', () => {
  it('门槛曲线：首进阶 1 次训练（第 2 层），此后每 2 次训练 +1 级', () => {
    expect(ascensionReady(leaveTraining(0))).toBe(false);
    expect(ascensionReady(leaveTraining(1))).toBe(true); // 第 2 层训练房
    const second = leaveTraining(2);
    second.player.ascensionCount = 1;
    expect(ascensionReady(second)).toBe(false); // 第二次需 3 次训练
    second.player.trainingCount = 3;
    expect(ascensionReady(second)).toBe(true);
  });

  it('进阶次数封顶后不再触发', () => {
    const run = leaveTraining(99);
    run.player.ascensionCount = ASCENSION_PLACEHOLDER.maxAscensions; // 已达总次数封顶
    expect(ascensionReady(run)).toBe(false);
  });

  it('累计制门槛：进阶次数越多，所需训练次数越多', () => {
    const run = leaveTraining(1);
    run.player.ascensionCount = 3;
    expect(ascensionReady(run)).toBe(false); // 第 4 次需 7 次训练
    run.player.trainingCount = 7;
    expect(ascensionReady(run)).toBe(true);
  });
});

describe('进阶事件结算', () => {
  it('离开训练房达标 → 直接进入 ascension 阶段（无延后）', () => {
    const run = leaveTraining(1);
    completeRoom(run);
    expect(run.gameStage).toBe('ascension');
    expect(run.floor).toBe(1); // 楼层尚未推进
  });

  it('未达标 → 正常推进下一层', () => {
    const run = leaveTraining(0);
    completeRoom(run);
    expect(run.gameStage).toBe('prep');
    expect(run.floor).toBe(2);
  });

  it('选维度升级：等级+1、魏启上限提升、全恢复、推进下一层', () => {
    const run = leaveTraining(1);
    run.player.hp = 5;
    run.player.mana = 0;
    const maxManaBefore = run.player.maxMana;
    completeRoom(run);
    chooseAscension(run, 'fire');
    // 首次点亮灵脉 → 种子包九选三（选定后事件才收尾）
    expect(run.cardOffering).toBeTruthy();
    expect(run.cardOffering.cards.length).toBe(SEED_OFFERING.cards);
    const deckBefore = run.player.deck.length;
    chooseSeedCards(run, run.cardOffering.cards.slice(0, SEED_OFFERING.picks));
    expect(run.cardOffering).toBeNull();
    expect(run.player.deck.length).toBe(deckBefore + SEED_OFFERING.picks);
    expect(run.player.leino.fire).toBe(1);
    expect(totalLeino(run)).toBe(1);
    expect(run.player.ascensionCount).toBe(1);
    expect(run.player.maxMana).toBe(maxManaBefore + ASCENSION_PLACEHOLDER.manaGain);
    expect(run.player.mana).toBe(run.player.maxMana); // 全恢复（魏启）
    expect(run.player.hp).toBe(5 + ASCENSION_PLACEHOLDER.healAmount); // 定量恢复（生命，2026-09）
    expect(run.gameStage).toBe('prep');
    expect(run.floor).toBe(2);
  });

  it('跳过进阶：体修隐藏等级 +1、不开种子包、灵脉不变、消耗一次进阶', () => {
    const run = leaveTraining(1);
    completeRoom(run);
    expect(run.gameStage).toBe('ascension');
    const manaBefore = run.player.maxMana;
    chooseAscension(run, null); // 跳过
    expect(run.player.bodyLevel).toBe(1);
    expect(run.cardOffering).toBeNull();     // 体修不给种子包
    expect(totalLeino(run)).toBe(0);         // 灵脉未动
    expect(run.player.ascensionCount).toBe(1);
    expect(run.player.maxMana).toBe(manaBefore + ASCENSION_PLACEHOLDER.manaGain);
    expect(run.gameStage).toBe('prep');
  });

  it('非法输入抛错：阶段不符/未知维度', () => {
    const run = createRun({ seed: 1 });
    expect(() => chooseAscension(run, 'fire')).toThrow(/阶段不符/);
    const asc = leaveTraining(1);
    completeRoom(asc);
    expect(() => chooseAscension(asc, 'water')).toThrow(/未知灵脉维度/);
    for (const d of LEINO_DIMENSIONS) expect(typeof asc.player.leino[d]).toBe('number');
  });

  it('能力授予占位：无待授予能力时直接调用 chooseAscensionAbility 抛错', () => {
    const run = createRun({ seed: 1 });
    expect(() => chooseAscensionAbility(run, 'x')).toThrow(/没有待授予的能力/);
  });
});

describe('种子包构成（用户 2026-09 定）', () => {
  const firePoolIds = () => seedPool(createRun({ seed: 1 }), 'fire').map(d => d.id);

  it('进阶链只开链头：同链 C 阶（晋升目标）不进池，D 阶链头在池', () => {
    const ids = firePoolIds();
    // 火箭链 fireBolt(D)→fireArrow(C)→fireBall(B)、首发射链 firstShot(D)→firstArrow(C)→…
    expect(ids).toContain('fireBolt');
    expect(ids).toContain('firstShot');
    expect(ids).not.toContain('fireArrow');   // 链中 C 阶是晋升目标，与 D 并列是噪音
    expect(ids).not.toContain('firstArrow');
    expect(ids).not.toContain('flameSurge');  // flameBirth(C)→flameSurge(B) 同理
  });

  it('无必出卡：点火改为获赠直发（seedGuaranteed 已移除），九选三纯自选', () => {
    const pool = new Set(firePoolIds());
    for (const seed of [1, 2, 3, 42, 99]) {
      const cards = rollSeedCards(createRun({ seed }), 'fire');
      expect(cards.length).toBe(SEED_OFFERING.cards);
      expect(new Set(cards).size).toBe(cards.length); // 互不重复
      for (const id of cards) expect(pool.has(id), id).toBe(true); // 全部出自种子池
    }
    // 刷新（exclude 避让已见卡）重抽九张，不再有必出卡占位
    const run = leaveTraining(1);
    completeRoom(run);
    chooseAscension(run, 'fire');
    expect(run.cardOffering.cards).toHaveLength(SEED_OFFERING.cards);
    rerollSeedOffering(run);
    expect(run.cardOffering.cards).toHaveLength(SEED_OFFERING.cards);
    for (const id of run.cardOffering.cards) expect(pool.has(id), id).toBe(true);
  });

  it('首次点亮火系：获赠 点火+火弹术 直入牌组 + 体系能力火灵脉', () => {
    const run = leaveTraining(1);
    completeRoom(run);
    const deckBefore = run.player.deck.map(c => c.defId);
    chooseAscension(run, 'fire');
    // 获赠两张基石卡直入牌组（点火不再走种子包必出位）
    expect(run.player.deck.filter(c => c.defId === 'inflame')).toHaveLength(1);
    expect(run.player.deck.filter(c => c.defId === 'fireBolt')).toHaveLength(1);
    expect(run.player.deck.length).toBe(deckBefore.length + 2);
    expect(run.player.abilities).toContain('fireVein');
  });
});
