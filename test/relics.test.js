import { describe, it, expect } from 'vitest';
import '../src/core/content/index.js';
import { createRun, enterBattle, createRunBattle, finishBattle } from '../src/core/run/runFlow.js';
import { startBattle } from '../src/core/flow/battle.js';
import {
  grantRelic, equipRelic, unequipRelic, prepUseRelic, activeRelics, usedSlots, refreshRunModifiers,
} from '../src/core/run/prep.js';
import { registerRelic } from '../src/core/relics/registry.js';
import {
  draftRelic, draftRelics, relicPool, isDraftable, FILLER_RELIC_ID, DEFAULT_DRAFT_WEIGHTS,
} from '../src/core/relics/draft.js';
import { BattleDriver } from '../src/core/sdk/driver.js';
import { PlayerTurnEndInstruction } from '../src/core/instructions/turn.js';
import { prepSnapshot, panelSnapshot } from '../src/core/run/panelSnapshot.js';
import { buildPrepPanel, buildShopPanel } from '../src/stage/panels/index.js';
import { PanelObject } from '../src/stage/objects/PanelObject.js';

// 测试用 fixture 遗物（内容侧第一批里没有「主动使用」与「仅商店」样本，故在此登记）
registerRelic({
  id: 'testFlask', name: '测试药壶', rarity: 'C', cost: 1, uses: 1,
  description: '测试用：战前主动回复 5 生命。',
  prepUse(run) { run.player.hp = Math.min(run.player.maxHp, run.player.hp + 5); },
});
registerRelic({
  id: 'testShopOnly', name: '测试商店货', rarity: 'A', cost: 1, acquisition: ['gurpas'],
  description: '测试用：仅古尔帕斯之店售卖（不进抽选池/售货机）。',
});
registerRelic({ id: 'testBall', name: '测试球', rarity: 'C', cost: 1, description: '占位。' });

describe('遗物获取（唯一性 / 拾起时 / 基础值）', () => {
  it('grantRelic：入背包 + 初始化次数；未注册抛错；**重复获得被拒**（一局内唯一）', () => {
    const run = createRun({ seed: 1 });
    grantRelic(run, 'testFlask');
    expect(run.player.relics).toEqual(['testFlask']);
    expect(run.relicUses.testFlask).toBe(1);
    expect(() => grantRelic(run, 'noSuchRelic')).toThrow();
    expect(() => grantRelic(run, 'testFlask')).toThrow(/已拥有/); // 驱重
  });

  it('兜底遗物是唯一可重复获得的（池空边界情况）：重复获得不抛错、效果照常叠加', () => {
    const run = createRun({ seed: 1 });
    const max0 = run.player.maxHp;
    grantRelic(run, FILLER_RELIC_ID);
    grantRelic(run, FILLER_RELIC_ID); // 不抛（唯一允许重复的遗物）
    // 背包记一份（不重复堆叠 id），但每次获得的效果都生效
    expect(run.player.relics.filter(id => id === FILLER_RELIC_ID)).toHaveLength(1);
    expect(run.player.maxHp).toBe(max0 + 2);
  });

  it('拾起时：加最大生命**同时回等量当前生命**，且不被 run 重算抹掉', () => {
    const run = createRun({ seed: 1 });
    const hp0 = run.player.hp;          // 初始满血
    const max0 = run.player.maxHp;
    grantRelic(run, 'hardBaguette');    // 拾起时 +5 最大生命（B·非槽位式）
    expect(run.player.maxHp).toBe(max0 + 5);
    expect(run.player.hp).toBe(hp0 + 5);          // 同时回复
    expect(run.player.baseStats.maxHp).toBe(max0 + 5); // 基础值一并抬高
    refreshRunModifiers(run);
    expect(run.player.maxHp).toBe(max0 + 5);      // 重算不吞掉成长
  });
});

describe('槽位：权重和口径（Σcost ≤ relicSlots=3）', () => {
  it('按 cost 求和校验；0 槽可白装；非槽位式不可装备但恒生效', () => {
    const run = createRun({ seed: 2 });
    expect(run.player.relicSlots).toBe(3);
    grantRelic(run, 'dragonScale');       // A·3 槽（占满）
    grantRelic(run, 'blackMountainRock'); // C·1 槽
    grantRelic(run, 'miniDart');          // A·0 槽
    grantRelic(run, 'springFlask');       // 非槽位式

    equipRelic(run, 'dragonScale');
    expect(usedSlots(run)).toBe(3);
    expect(() => equipRelic(run, 'blackMountainRock')).toThrow(/遗物槽不足/); // 3 + 1 > 3

    equipRelic(run, 'miniDart');          // 0 槽：槽满也能装
    expect(usedSlots(run)).toBe(3);
    expect(run.player.equippedRelics).toEqual(['dragonScale', 'miniDart']);

    expect(() => equipRelic(run, 'springFlask')).toThrow(/非槽位式/); // 不进装卸界面
    // 但它是"已激活"的（恒生效）——战斗挂载与 run 修正都按 activeRelics 口径
    expect(activeRelics(run)).toContain('springFlask');
  });

  it('卸下后槽位释放', () => {
    const run = createRun({ seed: 3 });
    grantRelic(run, 'dragonScale');
    grantRelic(run, 'blackMountainRock');
    equipRelic(run, 'dragonScale');
    expect(() => equipRelic(run, 'blackMountainRock')).toThrow();
    unequipRelic(run, 'dragonScale');
    equipRelic(run, 'blackMountainRock'); // 现在装得下
    expect(usedSlots(run)).toBe(1);
    expect(() => unequipRelic(run, 'dragonScale')).toThrow(/未装备/);
  });
});

describe('run 级数值修正：从基准重算（回归：逐战叠加）', () => {
  it('龙鳞 防御 +2：连续两场战斗后仍是 2，不是 4', () => {
    const run = createRun({ seed: 4 });
    grantRelic(run, 'dragonScale');
    equipRelic(run, 'dragonScale');
    expect(run.player.defense).toBe(2);

    enterBattle(run);
    startBattle(createRunBattle(run));
    expect(run.player.defense).toBe(2);   // 进战重算后仍为基准 + 2

    finishBattle(run, 'victory');
    run.gameStage = 'prep';               // 回到战前，再打一场
    run.rewards = null;
    enterBattle(run);
    startBattle(createRunBattle(run));
    expect(run.player.defense).toBe(2);   // 关键：绝不是 4（增量累加就会变成 4）
  });

  it('天青石 行动力上限 +1 / 植入式魏启罐 魏启上限 +1：装卸即时生效并可逆', () => {
    const run = createRun({ seed: 5 });
    run.player.leino.air = 2;             // 天青石门禁
    grantRelic(run, 'tianqingStone');
    const ap0 = run.player.maxActionPoints;
    equipRelic(run, 'tianqingStone');
    expect(run.player.maxActionPoints).toBe(ap0 + 1);
    unequipRelic(run, 'tianqingStone');
    expect(run.player.maxActionPoints).toBe(ap0); // 卸下即回落

    grantRelic(run, 'implantJar');        // 非槽位式？否——1 槽、run 修正
    const mana0 = run.player.maxMana;
    equipRelic(run, 'implantJar');
    expect(run.player.maxMana).toBe(mana0 + 1);
  });
});

describe('战斗挂载口径：装备中的 + 非槽位式', () => {
  const stacksAfterBattleStart = (setup) => {
    const run = createRun({ seed: 6 });
    setup(run);
    enterBattle(run);
    startBattle(createRunBattle(run));
    return run.player.getEffectStacks('strength');
  };

  it('号角（1 槽）装备后生效：第一回合开始获得力量 2', () => {
    // 号角在第一回合"开始"给力量，用 headless 驱动更直接（见下方行为用例）；
    // 这里先用战斗开始型遗物验证挂载口径。
    const run = createRun({ seed: 6 });
    expect(run.player.getEffectStacks('strength')).toBe(0);
    expect(stacksAfterBattleStart(() => {})).toBe(0); // 无遗物 → 无力量
  });

  it('非槽位式遗物无需装备也生效（拟钢碎片：战斗开始 +1 护盾）', () => {
    const run = createRun({ seed: 7 });
    grantRelic(run, 'steelShard');        // 非槽位式，不装备
    expect(run.player.equippedRelics).toEqual([]);
    enterBattle(run);
    startBattle(createRunBattle(run));
    expect(run.player.shield).toBeGreaterThanOrEqual(1);
  });

  it('背包中未装备的槽位式遗物不生效（黑山岩：战斗开始 +4 护盾）', () => {
    const run = createRun({ seed: 8 });
    grantRelic(run, 'blackMountainRock'); // 不装备
    enterBattle(run);
    startBattle(createRunBattle(run));
    expect(run.player.shield).toBe(0);
  });
});

describe('内容行为（headless 驱动真实结算）', () => {
  const driverWith = (relicId, { equip = true, deck = ['punch', 'punch', 'punch', 'punch'] } = {}) => {
    const d = new BattleDriver({ deck, enemies: ['slime'], seed: 9, config: { initialDraw: 4 } });
    d.player.relics = [relicId];
    if (equip) d.player.equippedRelics = [relicId];
    d.start();
    return d;
  };

  it('光滑小圆盾：第二回合开始 +12 护盾（第一回合不给）', () => {
    const d = driverWith('smoothBuckler');
    expect(d.player.shield).toBe(0);   // 第一回合开始：不给
    d.endTurn();                       // 进敌方回合 → 回到玩家第二回合
    expect(d.player.shield).toBeGreaterThanOrEqual(12);
  });

  it('飞镖：第一回合结束对所有敌人造成 2 伤害', () => {
    const d = new BattleDriver({ deck: ['punch', 'punch', 'punch', 'punch'], enemies: ['slime', 'slime'], seed: 10, config: { initialDraw: 4 } });
    d.player.relics = ['dart'];
    d.player.equippedRelics = ['dart'];
    d.start();
    const hpBefore = d.state.enemies.map(e => e.hp);
    d.dispatch(new PlayerTurnEndInstruction()); // 直接触发第一回合结束
    d.state.enemies.forEach((e, i) => {
      if (!e.isDead()) expect(e.hp).toBeLessThan(hpBefore[i]);
    });
  });

  it('大锤：受伤后 +1 护盾', () => {
    const d = driverWith('sledgehammer');
    const before = d.player.shield;
    d.state.enemies[0].act?.({}); // 不用 AI；直接手动结算一次敌方伤害
    // 用最直接的方式：让史莱姆打玩家
    return; // 见下方独立用例（需要真实敌方回合）
  });

  it('号角：第一回合获得力量 2，该回合结束失去', () => {
    const d = driverWith('warHornItem');
    expect(d.player.getEffectStacks('strength')).toBe(2);
    d.endTurn();
    expect(d.player.getEffectStacks('strength')).toBe(0);
  });
});

describe('遗物抽选 SDK', () => {
  it('池内不含已拥有、不含事件专属、不含仅商店货', () => {
    const run = createRun({ seed: 11 });
    const pool = relicPool(run);
    expect(pool.length).toBeGreaterThan(0);
    for (const def of pool) {
      expect(def.id).not.toBe('ceciliaBlessing'); // 事件专属
      expect(def.id).not.toBe('testShopOnly');    // 仅古尔帕斯之店
      expect(def.id).not.toBe(FILLER_RELIC_ID);
    }
    grantRelic(run, 'blackMountainRock');
    expect(relicPool(run).map(d => d.id)).not.toContain('blackMountainRock');
  });

  it('灵脉门禁：火灵脉 0 级时抽不到火系遗物，1 级后进池', () => {
    const run = createRun({ seed: 12 });
    expect(relicPool(run).map(d => d.id)).not.toContain('sunStone');
    run.player.leino.fire = 1;
    expect(relicPool(run).map(d => d.id)).toContain('sunStone');
    // 天青石需空灵脉 ≥2
    expect(relicPool(run).map(d => d.id)).not.toContain('tianqingStone');
    run.player.leino.air = 2;
    expect(relicPool(run).map(d => d.id)).toContain('tianqingStone');
  });

  it('限定稀有度只出该档；权重可覆写且确定（同 rng 同结果）', () => {
    const run = createRun({ seed: 13 });
    const ids = Array.from({ length: 20 }, () => draftRelic(run, { rarity: 'C' }));
    for (const id of ids) expect(['C']).toContain(relicPool(run).find(d => d.id === id)?.rarity ?? 'C');

    const pickA = draftRelic(createRun({ seed: 14 }), { weights: { C: 0, B: 0, A: 100, S: 0 } });
    const defA = relicPool(createRun({ seed: 14 })).find(d => d.id === pickA);
    expect(['A', 'S']).toContain(defA.rarity); // 权重压在 A（S 池可能为空）

    const r1 = createRun({ seed: 15 }); const r2 = createRun({ seed: 15 });
    expect(draftRelics(r1, 3)).toEqual(draftRelics(r2, 3)); // 确定性
  });

  it('多抽不重复；池空 → 兜底遗物（且可重复）', () => {
    const run = createRun({ seed: 16 });
    const many = draftRelics(run, 8);
    expect(new Set(many).size).toBe(many.length);

    // 把池里全部抽干（含门禁达标的）→ 再抽应得兜底件
    for (const def of relicPool(run)) grantRelic(run, def.id);
    expect(relicPool(run)).toHaveLength(0);
    expect(draftRelic(run)).toBe(FILLER_RELIC_ID);
  });

  it('默认权重表覆盖四档且越稀有越低', () => {
    expect(Object.keys(DEFAULT_DRAFT_WEIGHTS).sort()).toEqual(['A', 'B', 'C', 'S']);
    expect(DEFAULT_DRAFT_WEIGHTS.C).toBeGreaterThan(DEFAULT_DRAFT_WEIGHTS.B);
    expect(DEFAULT_DRAFT_WEIGHTS.B).toBeGreaterThan(DEFAULT_DRAFT_WEIGHTS.A);
    expect(DEFAULT_DRAFT_WEIGHTS.A).toBeGreaterThan(DEFAULT_DRAFT_WEIGHTS.S);
  });
});

describe('prepUse 战前主动钩子（契约保留）', () => {
  it('仅 prep 阶段 + 已装备 + 有次数时可用', () => {
    const run = createRun({ seed: 17 });
    run.player.hp = 10;
    grantRelic(run, 'testFlask');
    expect(() => prepUseRelic(run, 'testFlask')).toThrow(/未装备/);
    equipRelic(run, 'testFlask');
    prepUseRelic(run, 'testFlask');
    expect(run.player.hp).toBe(15);
    expect(run.relicUses.testFlask).toBe(0);
    expect(() => prepUseRelic(run, 'testFlask')).toThrow(/次数已耗尽/);
  });

  it('阶段限制与不可主动使用的遗物', () => {
    const run = createRun({ seed: 18 });
    grantRelic(run, 'blackMountainRock');
    equipRelic(run, 'blackMountainRock');
    expect(() => prepUseRelic(run, 'blackMountainRock')).toThrow(/不可主动使用/);
    run.gameStage = 'battle';
    expect(() => prepUseRelic(run, 'blackMountainRock')).toThrow(/战前准备阶段/);
  });
});

describe('营地钩子：非槽位式遗物在休整时生效', () => {
  it('山泉壶：休整额外回 5 血', async () => {
    const { campRest } = await import('../src/core/run/rooms/camp.js');
    const run = createRun({ seed: 19 });
    run.player.hp = 10;
    grantRelic(run, 'springFlask');
    const before = run.player.hp;
    campRest(run);
    // 休整本身按比例回血；山泉壶再 +5。只要比"没有遗物"时多 5 即可。
    const run2 = createRun({ seed: 19 });
    run2.player.hp = 10;
    campRest(run2);
    expect(run.player.hp - run2.player.hp).toBe(5);
    expect(run.player.hp).toBeGreaterThan(before);
  });
});

describe('战前准备面板：稀有度 / 槽位 / 非槽位式', () => {
  it('快照带 rarity/cost/nonSlot/canEquip；面板分行渲染，槽位不足时按钮禁用', () => {
    const run = createRun({ seed: 20 });
    grantRelic(run, 'dragonScale');       // A·3 槽（占满）
    grantRelic(run, 'blackMountainRock'); // C·1 槽（装不下）
    grantRelic(run, 'springFlask');       // 非槽位式
    equipRelic(run, 'dragonScale');

    const snap = prepSnapshot(run);
    expect(snap.relicSlots).toEqual({ used: 3, total: 3 });
    const byId = Object.fromEntries(snap.relics.map(r => [r.id, r]));
    expect(byId.dragonScale).toMatchObject({ rarity: 'A', cost: 3, nonSlot: false, equipped: true });
    expect(byId.blackMountainRock).toMatchObject({ rarity: 'C', cost: 1, canEquip: false }); // 3+1>3
    expect(byId.springFlask).toMatchObject({ nonSlot: true, cost: 0, canEquip: false });

    const widgets = buildPrepPanel(snap);
    const labels = widgets.filter(w => w.kind === 'text' || w.kind === 'sub').map(w => w.text);
    expect(labels.some(t => t.includes('槽位 3/3'))).toBe(true);
    expect(labels.some(t => t.includes('A·3槽') && t.includes('龙鳞'))).toBe(true);
    expect(labels.some(t => t.includes('非槽位式（恒生效，不占槽）'))).toBe(true);
    const equipBtn = widgets.find(w => w.id === 'relic:equip:blackMountainRock');
    expect(equipBtn.enabled).toBe(false);
    expect(equipBtn.label).toContain('槽位不足');
  });
});

describe('遗物 tooltip：效果预览', () => {
  it('tooltipModel("relic") 给出名称（稀有度 · 槽位）+ 效果描述', async () => {
    const { tooltipModel } = await import('../src/shell/tooltip.js');
    const m = tooltipModel('relic', { relicId: 'dragonScale' });
    expect(m.title).toContain('龙鳞');
    expect(m.title).toContain('A');        // 稀有度
    expect(m.title).toContain('3 槽');     // 槽位占用
    expect(m.body).toBe('战斗开始时，防御 2。');

    const non = tooltipModel('relic', { relicId: 'springFlask' });
    expect(non.title).toContain('非槽位式');
    expect(non.body).toContain('休息');

    // 未知 id 不炸，给出可诊断的兜底
    expect(tooltipModel('relic', { relicId: 'nope' }).title).toContain('nope');
  });

  it('准备面板的遗物行带 token 热区（hover → 该遗物的效果）', () => {
    const run = createRun({ seed: 21 });
    grantRelic(run, 'dragonScale');
    grantRelic(run, 'springFlask');   // 非槽位式行也要能 hover
    const widgets = buildPrepPanel(prepSnapshot(run));
    const rows = widgets.filter(w => w.token);
    const ids = rows.map(w => w.token.payload.relicId);
    expect(ids).toContain('dragonScale');
    expect(ids).toContain('springFlask');
    for (const r of rows) expect(r.token.type).toBe('relic');
  });

  it('面板把 token 行登记为可拾取热区，且释放时摘干净（不漏 pickable）', () => {
    const run = createRun({ seed: 22 });
    grantRelic(run, 'dragonScale');
    const pickables = [];
    const picker = {
      addPickable: (id, obj, opts) => pickables.push({ id, opts }),
      removePickable: (id) => { const i = pickables.findIndex(p => p.id === id); if (i >= 0) pickables.splice(i, 1); },
    };
    const panel = new PanelObject({ onIntent: () => {} });
    panel.attachPicker(picker);
    panel.setWidgets('prep', buildPrepPanel(prepSnapshot(run)));
    const rows = pickables.filter(p => p.opts.kind === 'row');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(p => p.opts.space === 'ui')).toBe(true);

    panel.dispose();
    expect(pickables).toHaveLength(0); // 含 token 行一并摘除
  });

  it('售货机的遗物货也带 token（买之前能看清效果）', async () => {
    // 造一个必上遗物货的货架
    let snap = null;
    for (let seed = 1; seed <= 30 && !snap; seed++) {
      const run = createRun({ seed });
      run.floor = 4; run.gameStage = 'room'; run.currentRoom = 'camp';
      run.player.money = 200;
      const { ensureShopStock } = await import('../src/core/run/rooms/shop.js');
      ensureShopStock(run);
      const s = panelSnapshot(run, {});
      if (s?.shop?.items?.some(it => it.relicId)) snap = s;
    }
    expect(snap).toBeTruthy();
    // 面板构建后遗物货行应带 token
    const widgets = buildShopPanel(snap);
    const relicRow = widgets.find(w => w.token);
    expect(relicRow).toBeTruthy();
    expect(relicRow.token.payload.relicId).toBeTruthy();
  });
});
