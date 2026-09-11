import { describe, it, expect } from 'vitest';
import '../src/core/content/index.js';
import { createRun } from '../src/core/run/runFlow.js';
import {
  SHOP_FLOORS, isShopFloor, ensureShopStock, buyShopItem, takeShopCard, canBuy, shelfSize, remiLevel,
} from '../src/core/run/rooms/shop.js';
import { panelSnapshot } from '../src/core/run/panelSnapshot.js';
import { buildRoomPanel, buildShopPanel } from '../src/stage/panels/index.js';
import { PanelObject } from '../src/stage/objects/PanelObject.js';
import { MapStage } from '../src/stage/stages/MapStage.js';
import { StageManager } from '../src/stage/StageManager.js';
import mitt from 'mitt';

// 售货机（SHOP.md §一）：常规补给；与奖励房并存、不占房间名额；每次遇到刷新，买光不补。

function shopRun({ seed = 1, floor = 4, story = false, money = 200, fruits = 0, drivenOff = false } = {}) {
  const run = createRun({ seed });
  run.floor = floor;
  run.gameStage = 'room';
  run.currentRoom = 'camp';
  run.storyMode = story;
  run.player.money = money;
  run.remi.fruits = fruits;
  run.remi.drivenOff = drivenOff;
  ensureShopStock(run);
  return run;
}

describe('售货机出没与货架', () => {
  it('只在这些层的休息阶段出现，且避开训练层 / Boss 层 / Boss 前营地层', () => {
    expect([...SHOP_FLOORS]).toEqual([4, 8, 15, 19, 25, 29, 36, 40]);
    for (const f of SHOP_FLOORS) expect(isShopFloor(f)).toBe(true);
    // 训练层 4N-2 / Boss 层 11N / Boss 前营地层
    for (const f of [2, 6, 10, 11, 14, 18, 21, 22, 26, 30, 32, 33, 34, 38, 42, 43, 44]) {
      expect(isShopFloor(f)).toBe(false);
    }
  });

  it('非商店层没有货架；商店层按楼层缓存（同层不重掷），换层换新货', () => {
    const run = shopRun({ seed: 2, floor: 3 });
    expect(run.shop).toBeNull();
    ensureShopStock(run);
    expect(run.shop).toBeNull();

    run.floor = 4; ensureShopStock(run);
    const first = JSON.stringify(run.shop.items);
    ensureShopStock(run);                      // 同层再进：不重掷（买光不补的前提）
    expect(JSON.stringify(run.shop.items)).toBe(first);

    buyShopItem(run, 0);                       // 买掉第一件
    run.floor = 8; ensureShopStock(run);       // 下一处商店：换新货
    expect(run.shop.floor).toBe(8);
    expect(run.shop.items.some(it => it.sold)).toBe(false);
  });

  it('恢复药剂总是有且只有一件；货架件数：肉鸽 3 / 故事随瑞米等级 3→5', () => {
    const rg = shopRun({ seed: 3, story: false });
    expect(rg.shop.items.filter(it => it.kind === 'potion')).toHaveLength(1);
    expect(rg.shop.items.length).toBe(3);
    expect(shelfSize(rg)).toBe(3);

    const s0 = shopRun({ seed: 4, story: true, fruits: 0 });
    expect(shelfSize(s0)).toBe(3);
    const s2 = shopRun({ seed: 4, story: true, fruits: 2 });
    expect(shelfSize(s2)).toBe(4);
    const s4 = shopRun({ seed: 4, story: true, fruits: 4 });
    expect(shelfSize(s4)).toBe(5);
    expect(remiLevel(s4)).toBe(4);
  });

  it('故事模式瑞米被打跑：货架不完整（少一件）+ 附道歉文案；肉鸽模式无此事', () => {
    const broken = shopRun({ seed: 5, story: true, drivenOff: true });
    expect(broken.shop.broken).toBe(true);
    expect(broken.shop.items.length).toBe(2); // 3 - 1
    const rg = shopRun({ seed: 5, story: false, drivenOff: true });
    expect(rg.shop.broken).toBe(false);
    expect(rg.shop.items.length).toBe(3);
  });

  it('折扣：仅故事模式且瑞米等级 ≥3 时可能打到 8 折；肉鸽永不折扣', () => {
    for (let seed = 1; seed <= 30; seed++) {
      expect(shopRun({ seed, story: false, fruits: 9 }).shop.discount).toBe(1);
    }
    const seen = new Set();
    for (let seed = 1; seed <= 40; seed++) seen.add(shopRun({ seed, story: true, fruits: 3 }).shop.discount);
    expect(seen.has(1)).toBe(true);
    expect(seen.has(0.8)).toBe(true);
  });

  it('遗物货按稀有度入柜（C/B），且不会与玩家已拥有的重复', () => {
    const run = shopRun({ seed: 6 });
    for (const it of run.shop.items) {
      if (it.kind !== 'relic') continue;
      expect(['C', 'B']).toContain(it.rarity);
      expect(run.player.relics).not.toContain(it.relicId);
    }
  });

  it('肉鸽模式货架上不出现苹果', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const run = shopRun({ seed, story: false });
      expect(run.shop.items.some(it => it.kind === 'apple')).toBe(false);
    }
  });
});

describe('购买', () => {
  const firstOf = (run, kind) => run.shop.items.findIndex(it => it.kind === kind);

  it('扣费与发货同步；钱不够 → 抛错且状态不变；已售出不能重复买', () => {
    const run = shopRun({ seed: 7, money: 200 });
    const i = firstOf(run, 'relic');
    if (i < 0) return; // 该种子没上遗物
    const price = run.shop.items[i].price;
    const money0 = run.player.money;
    buyShopItem(run, i);
    expect(run.player.money).toBe(money0 - price);
    expect(run.shop.items[i].sold).toBe(true);
    expect(run.player.relics).toContain(run.shop.items[i].relicId);
    expect(() => buyShopItem(run, i)).toThrow(/已经卖掉/);

    const poor = shopRun({ seed: 7, money: 0 });
    const before = JSON.stringify(poor.shop.items);
    expect(() => buyShopItem(poor, 0)).toThrow(/金币不足/);
    expect(JSON.stringify(poor.shop.items)).toBe(before);
    expect(poor.player.money).toBe(0);
  });

  it('恢复药剂：恢复 15% 生命上限', () => {
    const run = shopRun({ seed: 8, money: 200 });
    run.player.hp = 10;
    const i = firstOf(run, 'potion');
    buyShopItem(run, i);
    expect(run.player.hp).toBe(10 + Math.ceil(run.player.maxHp * 0.15));
  });

  it('苹果：故事模式可买（果实 +1、全流程仅一件）；肉鸽模式买不到、货架也没有', () => {
    let run = null;
    for (let seed = 1; seed <= 30 && !run; seed++) {
      const r = shopRun({ seed, story: true, money: 400 });
      if (r.shop.items.some(it => it.kind === 'apple')) run = r;
    }
    expect(run).toBeTruthy(); // 苹果"偶尔能见到"——多试几个种子必出
    const i = firstOf(run, 'apple');
    const fruits0 = run.remi.fruits;
    buyShopItem(run, i);
    expect(run.remi.fruits).toBe(fruits0 + 1);
    expect(run.shopAppleBought).toBe(true);

    // 买过之后不再上架（换层刷新也不再有）
    run.floor = 8; ensureShopStock(run);
    expect(run.shop.items.some(it => it.kind === 'apple')).toBe(false);
  });

  it('卡包：买到即开——金币先扣、挂起三选一，选完才入组', () => {
    let run = null;
    for (let seed = 1; seed <= 30 && !run; seed++) {
      const r = shopRun({ seed, money: 400 });
      if (r.shop.items.some(it => it.kind === 'pack')) run = r;
    }
    expect(run).toBeTruthy();
    const i = firstOf(run, 'pack');
    const packId = run.shop.items[i].packId;
    const money0 = run.player.money;
    const deck0 = run.player.deck.length;

    buyShopItem(run, i);
    expect(run.player.money).toBe(money0 - run.shop.items[i].price); // 先扣费（不能退款）
    expect(run.shopPending.packId).toBe(packId);
    expect(run.shopPending.choices).toHaveLength(3);
    expect(run.player.deck.length).toBe(deck0); // 还没选 → 还没入组

    expect(() => takeShopCard(run, 'noSuchCard')).toThrow(/不在候选里/);
    takeShopCard(run, run.shopPending.choices[0]);
    expect(run.player.deck.length).toBe(deck0 + 1);
    expect(run.shopPending).toBeNull();
    expect(() => takeShopCard(run, run.shopPending?.choices?.[0])).toThrow(/没有待选择的卡包/);
  });

  it('canBuy：钱够、未售出才算买得起', () => {
    const run = shopRun({ seed: 9, money: 0 });
    expect(canBuy(run, 0)).toBe(false); // 药剂 20 金
    run.player.money = 100;
    expect(canBuy(run, 0)).toBe(true);
    buyShopItem(run, 0);
    expect(canBuy(run, 0)).toBe(false); // 已售出
  });
});

describe('售货机界面（与房间并存，不占房间名额）', () => {
  function fakeManager() {
    const sm = new StageManager({ createRenderer: () => ({ render() {}, setSize() {}, dispose() {} }) });
    sm._viewWidth = 1920; sm._viewHeight = 1080;
    return sm;
  }

  it('商店层的房间面板多一个「自动售货机」入口，且是本地动作（不消耗房间行动）', () => {
    const run = shopRun({ seed: 10 });
    const snap = panelSnapshot(run, {});
    expect(snap.shop).toBeTruthy();
    const widgets = buildRoomPanel(snap);
    const btn = widgets.find(w => w.id === 'room:shop');
    expect(btn).toBeTruthy();
    expect(btn.action).toEqual({ action: 'openShop', local: true });

    // 非商店层：没有这个入口
    const off = shopRun({ seed: 10, floor: 3 });
    expect(buildRoomPanel(panelSnapshot(off, {})).find(w => w.id === 'room:shop')).toBeUndefined();
  });

  it('打开/关闭售货机：同一份快照下的本地视图切换，不重建面板、不动 core', () => {
    const run = shopRun({ seed: 11, money: 200 });
    const stage = new MapStage({});
    const intents = [];
    stage.setPanelIntentHandler((a) => intents.push(a));
    stage.attachInput({ stageManager: fakeManager(), bus: mitt() });
    stage.setPanel(panelSnapshot(run, {}));
    const panelRef = stage.panel;

    expect(stage._buttonActionsOf('room:shop').action.local).toBe(true);
    stage._panel.onClick({ kind: 'button', id: 'room:shop' });   // 本地动作
    expect(stage.panel).toBe(panelRef);                          // 面板对象没重建
    expect(stage.panel.kind).toBe('shop');                       // 视图切到售货机
    expect(intents).toHaveLength(0);                             // 不惊动 core
    expect(stage._buttonActionsOf('shop:leave')).toBeTruthy();

    stage._panel.onClick({ kind: 'button', id: 'shop:leave' });
    expect(stage.panel.kind).toBe('room');
    stage.dispose();
  });

  it('购买按钮：上报 buyShopItem 意图；钱不够时禁用', () => {
    const run = shopRun({ seed: 12, money: 0 });
    const stage = new MapStage({});
    const intents = [];
    stage.setPanelIntentHandler((a) => intents.push(a));
    stage.attachInput({ stageManager: fakeManager(), bus: mitt() });
    stage.setPanel(panelSnapshot(run, {}));
    stage._panel.onClick({ kind: 'button', id: 'room:shop' });
    expect(stage._buttonActionsOf('shop:buy:0').enabled).toBe(false); // 0 金币买不起 20 金药剂
    stage.dispose();

    const rich = shopRun({ seed: 12, money: 200 });
    const s2 = new MapStage({});
    const intents2 = [];
    s2.setPanelIntentHandler((a) => intents2.push(a));
    s2.attachInput({ stageManager: fakeManager(), bus: mitt() });
    s2.setPanel(panelSnapshot(rich, {}));
    s2._panel.onClick({ kind: 'button', id: 'room:shop' });
    expect(s2._buttonActionsOf('shop:buy:0').enabled).toBe(true);
    s2._panel.onClick({ kind: 'button', id: 'shop:buy:0' });
    expect(intents2).toEqual([{ action: 'buyShopItem', index: 0 }]);
    s2.dispose();
  });

  it('卡包待选：售货机面板切换为三选一卡面，点卡上报 takeShopCard', () => {
    let run = null;
    for (let seed = 1; seed <= 30 && !run; seed++) {
      const r = shopRun({ seed, money: 400 });
      if (r.shop.items.some(it => it.kind === 'pack')) run = r;
    }
    const i = run.shop.items.findIndex(it => it.kind === 'pack');
    buyShopItem(run, i);
    const snap = panelSnapshot(run, {});
    expect(snap.shop.pending).toBeTruthy();

    const widgets = buildShopPanel(snap);
    const cardsWidget = widgets.find(w => w.kind === 'cards');
    expect(cardsWidget.items).toHaveLength(3);

    const panel = new PanelObject({ form: 'modal', onIntent: () => {} });
    panel.setWidgets('shop', widgets);
    expect(panel._cards).toHaveLength(3);
    panel.dispose();
  });
});
