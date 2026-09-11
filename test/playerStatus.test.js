import { describe, it, expect } from 'vitest';
import { PlayerStatusObject } from '../src/stage/objects/PlayerStatusObject.js';
import { ManaCrystalObject } from '../src/stage/objects/ManaCrystalObject.js';
import { ApCoinObject } from '../src/stage/objects/ApCoinObject.js';

// 玩家状态栏测试方针：只测基础设施契约（美术图异步补挂 = 前端绘制同步、
// dispose 订阅退订 = 资源卸载、悬浮开销交互态机 = 面板功能骨干）。
// 视觉样式（布局/颜色/淡入淡出曲线等）不写测试，浏览器由用户验收。
describe('PlayerStatusObject 玩家状态栏（基础设施契约）', () => {
  it('美术图注入：unitArt 提供水晶/金币图 → 按态挂载；onLoad 回调补挂', () => {
    const fullImg = { width: 2048, height: 2048 };
    const listeners = [];
    const unitArt = {
      getFile: (f) => (f === 'mana_crystal_full.png' ? fullImg : null),
      addOnLoad: (fn) => { listeners.push(fn); return () => listeners.splice(listeners.indexOf(fn), 1); },
    };
    const bar = new PlayerStatusObject({ unitArt });
    expect(listeners).toHaveLength(1);
    // 有魏启（current>0）→ 满晶图挂载
    bar.manaCrystal.setValue(2, 3);
    expect(bar.manaCrystal._crystalMaterial.map).toBeTruthy();
    // onLoad：缓存补齐空晶/金币图后回调 → 0 魏启切空晶、金币挂美术面
    const emptyImg = { width: 2048, height: 2048 };
    const coinImg = { width: 2048, height: 2048 };
    unitArt.getFile = (f) => (f === 'mana_crystal_empty.png' ? emptyImg : f === 'ap_coin.png' ? coinImg : null);
    listeners[0]();
    bar.manaCrystal.setValue(0, 3);
    expect(bar.manaCrystal._crystalMaterial.map).toBeTruthy(); // 空晶图
    expect(bar.apCoin._coinMaterial.map).toBeTruthy();         // 金币美术面
  });

  it('dispose：水晶/金币/盾徽随父级销毁，美术订阅退订', () => {
    const listeners = [];
    const unitArt = {
      getFile: () => null,
      addOnLoad: (fn) => { listeners.push(fn); return () => listeners.splice(listeners.indexOf(fn), 1); },
    };
    const bar = new PlayerStatusObject({ unitArt });
    bar.manaCrystal.setValue(3, 3);
    bar.apCoin.setValue(3, 3);
    bar.setPlayerShield(5);
    bar.setRemi({ present: true, hp: 15 });
    expect(() => bar.dispose()).not.toThrow();
    expect(listeners).toHaveLength(0); // 退订
  });

  it('瑞米区：setRemi 显隐与血量数字去抖重烘；头像补挂走专用材质', () => {
    const bar = new PlayerStatusObject({});
    const remi = () => bar.getObjectByName('remi');
    expect(remi().visible).toBe(false); // 初始隐藏（出战状态由注入驱动）

    bar.setRemi({ present: true, hp: 15 });
    expect(remi().visible).toBe(true);
    const tex1 = bar.getObjectByName('remiHpText').material.map;
    expect(tex1).toBeTruthy();
    bar.setRemi({ present: true, hp: 15 }); // 同值不重烘（签名去抖）
    expect(bar.getObjectByName('remiHpText').material.map).toBe(tex1);
    bar.setRemi({ present: true, hp: 9 });  // 血量变化重烘
    expect(bar.getObjectByName('remiHpText').material.map).not.toBe(tex1);

    bar.setRemi({ present: false });        // 未出战/被打跑 → 整区隐藏
    expect(remi().visible).toBe(false);

    bar.setRemiAvatar({ width: 1024, height: 1024 }); // 近方肖像整图入圆
    expect(bar.getObjectByName('remiAvatar').material.map).toBeTruthy();
  });

  it('层级契约：瑞米区压过骑士头像/血环栈（含血环内件偏移），仍让位盾徽', () => {
    // 状态层法则：面板内部件层级只认局部 z 错层。回归点——血环（RingGaugeObject）
    // 内件自带 +0.62/+0.66 偏移，瑞米区若只比血环组 z 高会被血环盖住。
    const bar = new PlayerStatusObject({});
    const remi = bar.getObjectByName('remi');
    const knightRingTop = bar.playerGauge.position.z +
      Math.max(...bar.playerGauge.children.map((c) => c.position.z));
    const remiZs = remi.children.map((c) => remi.position.z + c.position.z);
    expect(Math.min(...remiZs)).toBeGreaterThan(knightRingTop); // 整区最低件也盖过血环栈
    expect(Math.min(...remiZs)).toBeGreaterThan(bar.getObjectByName('avatar').position.z);
    expect(Math.max(...remiZs)).toBeLessThan(bar.playerShieldBadge.position.z); // 让位盾徽
  });

  it('悬浮开销交互态机：零开销=normal，可负担=highlight，不满足=insufficient（覆盖高亮）', () => {
    const mana = new ManaCrystalObject({});
    const ap = new ApCoinObject({});
    mana.setValue(2, 3);
    ap.setValue(3, 3);

    mana.setHoverCost(0, 2);
    ap.setHoverCost(0, 3);
    expect(mana.mode).toBe('normal');
    expect(ap.mode).toBe('normal');

    mana.setHoverCost(2, 2); // 恰好可负担
    ap.setHoverCost(1, 3);
    expect(mana.mode).toBe('highlight');
    expect(ap.mode).toBe('highlight');

    mana.setHoverCost(3, 2); // 超出可用 → 不足态覆盖高亮
    ap.setHoverCost(4, 3);
    expect(mana.mode).toBe('insufficient');
    expect(ap.mode).toBe('insufficient');

    // 回到常态可从不足态直接切回高亮（悬浮切卡场景）
    ap.setHoverCost(1, 3);
    expect(ap.mode).toBe('highlight');
  });
});
