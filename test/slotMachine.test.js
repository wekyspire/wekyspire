import { describe, it, expect } from 'vitest';
import '../src/core/content/index.js';
import { createRun } from '../src/core/run/runFlow.js';
import {
  SLOT, spinSlot, spinCost, slotView, takeSlotPrize, declineSlotPrize,
  devourSlot, devourReady, devourProgress, devourableRelics, devourableCards, slotUpgrade,
} from '../src/core/run/rooms/slotMachine.js';
import { grantRelic } from '../src/core/run/prep.js';
import { canPromoteRuntime } from '../src/core/run/promotion.js';
import { createSkillRuntime } from '../src/core/state/skillRuntime.js';
import { BODY_STARTER_DECK } from '../src/core/content/bodySkills.js';

// 老虎机引擎（SLOT_MACHINE.md）：涨价 / 保底 / 小奖大奖两档 / 产出可放弃 / 吞噬换金 /
// 故事模式苹果节拍。**银行机与恶魔 roll 尚未实装**，不在此文件覆盖。

function slotRun({ seed = 1, money = 1000, story = false, fruits = 0 } = {}) {
  const run = createRun({ seed });
  run.gameStage = 'room';
  run.currentRoom = 'slot';
  run.storyMode = story;
  run.player.money = money;
  run.remi.fruits = fruits;
  // 起始牌组（createRun 不填牌组——那是编排器/存档的事）
  run.player.deck = BODY_STARTER_DECK.map(id => createSkillRuntime(id));
  return run;
}

/** 领取本次产出（多选一取第一个；大奖的「免费指定升级」挂起时顺手选一张卡收尾）。 */
function settle(run, p) {
  if (!run.slotPending) return p; // 未中奖没有产出可结算（report-r1-A 缺陷#5）
  const choice = p.choices?.[0]?.id ?? p.relicChoices?.[0]?.id ?? null;
  const out = takeSlotPrize(run, choice);
  if (out.needsCardPick) {
    // 引擎保证"有可升级卡"时才发这个奖，这里取第一张真能升级的
    const target = run.player.deck.find(rt => canPromoteRuntime(rt, run));
    slotUpgrade(run, target.uniqueID);
  }
  return out;
}

/** 放弃当前产出；**未中奖时不存在 pending**，直接跳过（headless 试玩 report-r1-A 缺陷#5）。 */
function dropPending(run) { if (run.slotPending) declineSlotPrize(run); }

/** 拉一次杆并结算（默认放弃），返回本次产出。 */
function roll(run, { decline = true } = {}) {
  const p = spinSlot(run);
  if (decline) dropPending(run);
  else settle(run, p);
  return p;
}

describe('老虎机：涨价与保底', () => {
  it('单价 5 起，每次 roll 后 +6', () => {
    const run = slotRun();
    expect(spinCost(run)).toBe(SLOT.baseCost);
    roll(run);
    expect(spinCost(run)).toBe(SLOT.baseCost + SLOT.costStep);
    roll(run);
    expect(spinCost(run)).toBe(SLOT.baseCost + SLOT.costStep * 2);
  });

  it('扣费按当次单价；钱不够拒绝且不改状态', () => {
    const run = slotRun({ money: SLOT.baseCost });
    const before = run.player.money;
    spinSlot(run); dropPending(run);
    expect(run.player.money).toBe(before - SLOT.baseCost);

    const poor = slotRun({ money: SLOT.baseCost - 1 });
    expect(() => spinSlot(poor)).toThrow(/金币不足/);
    expect(poor.player.money).toBe(SLOT.baseCost - 1);
    expect(poor.slot).toBeNull(); // 失败不初始化机器状态
  });

  it('保底：小奖/大奖概率随未中次数上升，中奖后各自重置', () => {
    const run = slotRun({ seed: 7 });
    const c0 = slotView(run);
    expect(c0.minorChance).toBeCloseTo(SLOT.minorBase, 6);
    expect(c0.majorChance).toBeCloseTo(SLOT.majorBase, 6);

    // 连抽直到各自中一次，检查"未中即累加"
    let minorSeen = false;
    let majorSeen = false;
    for (let i = 0; i < 60 && !(minorSeen && majorSeen); i++) {
      const chanceBefore = slotView(run);
      const p = roll(run);
      if (p.tier === 'minor') {
        minorSeen = true;
        expect(slotView(run).minorChance).toBeCloseTo(SLOT.minorBase, 6); // 中奖重置
      } else if (!minorSeen) {
        expect(slotView(run).minorChance).toBeGreaterThan(chanceBefore.minorChance);
      }
      if (p.tier === 'major') {
        majorSeen = true;
        expect(slotView(run).majorChance).toBeCloseTo(SLOT.majorBase, 6);
      } else if (!majorSeen) {
        expect(slotView(run).majorChance).toBeGreaterThan(chanceBefore.majorChance);
      }
    }
    expect(minorSeen).toBe(true);
    expect(majorSeen).toBe(true); // 保底保证大奖迟早会来
  });

  it('两档奖项都能产出；产出挂起时不允许再拉杆', () => {
    const tiers = new Set();
    const kinds = new Set();
    const run = slotRun({ seed: 3, money: 5000000 });
    for (let i = 0; i < 300; i++) {
      const p = spinSlot(run);
      tiers.add(p.tier);
      kinds.add(p.kind);
      if (p.choices?.length) expect(p.choices.length).toBeGreaterThan(1); // 多选一给了候选
      // 未中奖不挂 pending：可以直接再抽（report-r1-A 缺陷#5）；有产出才拦第二抽
      if (run.slotPending) expect(() => spinSlot(run)).toThrow(/还没处理/);
      dropPending(run);
    }
    expect(tiers.has('minor')).toBe(true);
    expect(tiers.has('major')).toBe(true);
    expect(kinds.size).toBeGreaterThan(4);
  });
});

describe('老虎机：产出结算', () => {
  it('金币奖：领取才入账；放弃则一无所得（文档：产出总是可以放弃）', () => {
    const run = slotRun({ seed: 11, money: 1000000 });
    let p = null;
    for (let i = 0; i < 200 && !(p && p.money != null); i++) p = roll(run, { decline: true });
    expect(p.money).toBeGreaterThan(0);        // 抽到过金币奖
    let before = null;
    let q = null;
    for (let i = 0; i < 200 && !q; i++) {
      before = run.player.money;
      const r = spinSlot(run);
      if (r.money != null) { settle(run, r); q = r; break; }
      dropPending(run);
    }
    expect(q).toBeTruthy();
    expect(run.player.money).toBe(before - q.cost + q.money); // 领取才入账
  });

  it('卡多选一：必须给出候选里的 id；领取后进牌组', () => {
    const run = slotRun({ seed: 13, money: 500000 });
    let p = null;
    for (let i = 0; i < 300 && !p; i++) {
      const r = spinSlot(run);
      if (r.choices?.length) p = r; else dropPending(run);
    }
    expect(p).toBeTruthy();
    const deck0 = run.player.deck.length;
    expect(() => takeSlotPrize(run)).toThrow(/需要选一张卡/);
    expect(() => takeSlotPrize(run, 'noSuchCard')).toThrow(/不在候选里/);
    takeSlotPrize(run, p.choices[0].id);
    expect(run.player.deck.length).toBe(deck0 + 1);
    expect(run.slotPending).toBeNull();
  });

  it('A 级遗物三选一：领取后入背包（走抽选 SDK，已拥有不重复）', () => {
    const run = slotRun({ seed: 17, money: 500000 });
    let p = null;
    for (let i = 0; i < 400 && !p; i++) {
      const r = spinSlot(run);
      if (r.relicChoices?.length) p = r; else dropPending(run);
    }
    expect(p).toBeTruthy();
    const pick = p.relicChoices[0];
    takeSlotPrize(run, pick.id);
    expect(run.player.relics).toContain(pick.id);
  });

  it('免费指定升级：挂起后由 slotUpgrade 落地', () => {
    const run = slotRun({ seed: 23, money: 500000 });
    let p = null;
    for (let i = 0; i < 400 && !p; i++) {
      const r = spinSlot(run);
      if (r.upgrade?.kind === 'free') p = r; else dropPending(run);
    }
    expect(p).toBeTruthy();
    const out = takeSlotPrize(run);
    expect(out.needsCardPick).toBe(true);
    expect(run.slotUpgradePending).toBe(true);

    // 挑一张真能升级的卡（起始牌组里的拳/盾可升）
    const target = run.player.deck.find(rt => rt.defId === 'punch' || rt.defId === 'guard');
    expect(target).toBeTruthy();
    const res = slotUpgrade(run, target.uniqueID);
    expect(res.kind).toBe('freeUpgrade');
    expect(run.slotUpgradePending).toBe(false);
    expect(run.slotPending).toBeNull();
  });

  it('全状态恢复：回满生命与魏启并清除负面效果', () => {
    const run = slotRun({ seed: 29, money: 5000000 });
    run.player.hp = 5;
    run.player.mana = 0;
    run.player.addEffect('weaken', 2);
    run.player.addEffect('strength', 2);
    let p = null;
    for (let i = 0; i < 400 && !p; i++) {
      const r = spinSlot(run);
      if (r.fullRestore) p = r; else dropPending(run);
    }
    expect(p).toBeTruthy();
    takeSlotPrize(run);
    expect(run.player.hp).toBe(run.player.maxHp);
    expect(run.player.mana).toBe(run.player.maxMana);
    expect(run.player.getEffectStacks('weaken')).toBe(0);    // 负面清除
    expect(run.player.getEffectStacks('strength')).toBe(2);  // 正面保留
  });
});

describe('老虎机：吞噬（粉碎换金币）', () => {
  it('累积 roll 每满 7 次才可吞噬；用掉清零', () => {
    const run = slotRun({ money: 100000 });
    for (let i = 0; i < SLOT.devourEvery - 1; i++) roll(run);
    expect(devourProgress(run)).toBe(SLOT.devourEvery - 1);
    expect(devourReady(run)).toBe(false);
    expect(() => devourSlot(run, { kind: 'card', uniqueID: run.player.deck[0]?.uniqueID }))
      .toThrow(/进度不足/);

    roll(run);
    expect(devourReady(run)).toBe(true);
  });

  it('粉碎卡：按等阶换金币并从牌库移除', () => {
    const run = slotRun({ money: 300 });
    for (let i = 0; i < SLOT.devourEvery; i++) roll(run);
    const cards = devourableCards(run);
    expect(cards.length).toBeGreaterThan(0);
    const target = cards[0];
    const deck0 = run.player.deck.length;
    const money0 = run.player.money;
    const res = devourSlot(run, { kind: 'card', uniqueID: target.uniqueID });
    expect(res.gold).toBeGreaterThanOrEqual(0);
    expect(run.player.money).toBe(money0 + res.gold); // 增量 = 粉碎所得
    expect(run.player.deck.length).toBe(deck0 - 1);
    expect(run.player.deck.some(rt => rt.uniqueID === target.uniqueID)).toBe(false);
    expect(devourProgress(run)).toBe(0); // 用掉清零
  });

  it('粉碎遗物：按稀有度换金币；S 级嚼不动（抛错且状态不变）', () => {
    const run = slotRun({ money: 300 });
    grantRelic(run, 'dragonScale');       // A
    grantRelic(run, 'ceciliaBlessing');   // S
    for (let i = 0; i < SLOT.devourEvery; i++) roll(run);

    const list = devourableRelics(run);
    expect(list.map(r => r.id)).toContain('dragonScale');
    expect(list.map(r => r.id)).not.toContain('ceciliaBlessing'); // S 不上吞噬清单

    expect(() => devourSlot(run, { kind: 'relic', relicId: 'ceciliaBlessing' })).toThrow(/嚼不动/);
    expect(run.player.relics).toContain('ceciliaBlessing');

    const res = devourSlot(run, { kind: 'relic', relicId: 'dragonScale' });
    expect(res.gold).toBeGreaterThanOrEqual(SLOT.devourValue.relic.A[0]);
    expect(run.player.relics).not.toContain('dragonScale');
  });

  it('诅咒卡：吞噬后送一次免费 roll（不涨价）', async () => {
    const { registerSkill } = await import('../src/core/skills/registry.js');
    const { createSkillRuntime } = await import('../src/core/state/skillRuntime.js');
    registerSkill({ id: 'testCurse', name: '测试诅咒', tier: 'C', curse: true, cost: {}, describe: () => '' });
    const run = slotRun({ money: 300 });
    run.player.deck.push(createSkillRuntime('testCurse'));
    for (let i = 0; i < SLOT.devourEvery; i++) roll(run);

    const res = devourSlot(run, { kind: 'card', uniqueID: run.player.deck.at(-1).uniqueID });
    expect(res.freeRoll).toBe(true);

    const money = run.player.money;
    const costBefore = spinCost(run);
    spinSlot(run); dropPending(run);
    expect(run.player.money).toBe(money);        // 免费：不扣钱
    expect(spinCost(run)).toBe(costBefore);      // 免费 roll 不涨价
    expect(run.slotFreeRolls).toBe(0);
  });
});

describe('老虎机：故事模式节拍', () => {
  it('第 5 / 11 次小奖必为苹果；两个之后第 2 次大奖必为金苹果', () => {
    const run = slotRun({ seed: 31, money: 5000000, story: true });
    const minors = [];
    for (let i = 0; i < 2000 && (run.slotApples ?? 0) < 2; i++) {
      const p = spinSlot(run);
      if (p.tier === 'minor') minors.push(p.special ?? null);
      settle(run, p);
      if (p.special === 'apple') { /* 已计入 slotApples */ }
    }
    expect(run.slotApples).toBe(2);
    expect(minors[4]).toBe('apple');   // 第 5 次
    expect(minors[10]).toBe('apple');  // 第 11 次

    // 拿到两个苹果后：其后的第 2 次大奖必为金苹果
    let majors = 0;
    let goldApple = false;
    for (let i = 0; i < 2000 && !goldApple; i++) {
      const p = spinSlot(run);
      if (p.tier === 'major') { majors += 1; if (p.special === 'goldApple') goldApple = true; }
      settle(run, p);
    }
    expect(goldApple).toBe(true);
    expect(majors).toBe(2); // 恰好在第 2 次大奖上触发
  });

  it('肉鸽模式没有苹果节拍（第 5 次小奖不是苹果）', () => {
    const run = slotRun({ seed: 31, money: 5000000, story: false });
    const minors = [];
    for (let i = 0; i < 600 && minors.length < 6; i++) {
      const p = spinSlot(run);
      if (p.tier === 'minor') minors.push(p.special ?? null);
      dropPending(run);
    }
    expect(minors[4]).not.toBe('apple');
    expect(run.slotApples).toBe(0);
  });
});
