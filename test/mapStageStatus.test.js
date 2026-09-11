import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import '../src/core/content/index.js';
import { MapStage } from '../src/stage/stages/MapStage.js';

// 地图舞台测试方针：只测路由与基础设施契约（setStatus 数值路由、血环显示值同步、
// 几何绕序回归、美术缓存注入回归、生命周期/释放、塔层重建 gameflow）。
// 视觉样式（颜色过渡/淡入淡出/摆位）不写测试，浏览器由用户验收。

// 驱动若干帧让血环的缓动收敛到目标（dt 大步进 → 快速吸附）
function settle(bar, frames = 200) {
  for (let i = 0; i < frames; i++) bar.update(0.05);
}

describe('MapStage uiScene 状态栏（与战斗共享契约）', () => {
  it('setStatus 同步 AP/魏启到状态栏，金币/遗物路由到顶端资源行', () => {
    const stage = new MapStage({});
    const baked = [];
    stage.topBar._bake = (text) => {
      baked.push(text);
      return { texture: {}, width: 10, height: 20 };
    };
    stage.setStatus({
      ap: 3, apMax: 3, mana: 2, manaMax: 3,
      money: 40,
    });
    // AP = 金币徽章（数字表达）；魏启 = 单水晶 + 数字（概念图语言）
    expect(stage.statusBar.apCoin.current).toBe(3);
    expect(stage.statusBar.apCoin.max).toBe(3);
    expect(stage.statusBar.manaCrystal.current).toBe(2);
    expect(stage.statusBar.manaCrystal.max).toBe(3);
    // 金币在顶端资源行烘焙；状态栏不再有金币行
    expect(baked).toContain('金币 40');
    expect(stage.statusBar.getObjectByName('moneyLabel')).toBeUndefined();
  });

  it('角色血条：环绕头像的血环随 hp/maxHp 变化，半血弧段顶点数正确', () => {
    const stage = new MapStage({});
    const bar = stage.statusBar;
    // 无数据时 update 安全（fill 不可见）
    bar.update(0.016);
    expect(bar.playerGauge.children.find(c => c.name === 'fill').visible).toBe(false);

    bar.setPlayerHp(15, 30); // 首次设值直接吸附到位（不播充能动画）
    settle(bar);
    expect(bar.playerGauge.displayFraction).toBe(0.5);
    const fill = bar.playerGauge.children.find(c => c.name === 'fill');
    expect(fill.visible).toBe(true);

    bar.setPlayerHp(30, 30);
    settle(bar);
    expect(bar.playerGauge.displayFraction).toBe(1);
  });

  it('血环弧段绕序朝 +z（正面不被背面剔除——回归：曾整环不可见只剩暗轨道）', () => {
    const stage = new MapStage({});
    const bar = stage.statusBar;
    bar.setPlayerHp(20, 30);
    settle(bar);
    const fill = bar.playerGauge.children.find(c => c.name === 'fill');
    const pos = fill.geometry.attributes.position;
    const idx = fill.geometry.index;
    // 抽查每个三角形叉积为正（逆时针 → FrontSide 下从 +z 可见）
    for (let t = 0; t < idx.count; t += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(t));
      const b = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(t + 1));
      const c = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(t + 2));
      const crossZ = (b.clone().sub(a)).cross(c.clone().sub(a)).z;
      expect(crossZ).toBeGreaterThan(0);
    }
  });

  it('遗物槽行（顶端资源行）：装备列表注入生成槽位，签名不变不重建', () => {
    const stage = new MapStage({});
    const bar = stage.topBar;
    const relics = [
      { id: 'warHorn', name: '战号', icon: null, usesLeft: null },
      { id: 'springFlask', name: '山泉壶', icon: null, usesLeft: 0 },
    ];
    bar.setRelics(relics);
    expect(bar.relicRow.children.map(c => c.name)).toEqual(['relic:warHorn', 'relic:springFlask']);
    const first = bar.relicRow.children[0];
    bar.setRelics(relics); // 幂等：同签名不重建
    expect(bar.relicRow.children[0]).toBe(first);
    bar.setRelics([relics[0]]); // 卸下一件 → 行缩短重建
    expect(bar.relicRow.children.length).toBe(1);
  });

  it('美术缓存注入：状态栏构造即拿到水晶/金币美术（回归：缓存晚赋值曾致塔楼层永远占位）', () => {
    const fullImg = { width: 2048, height: 2048 };
    const coinImg = { width: 2048, height: 2048 };
    const unitArt = {
      getFile: (f) => (f === 'mana_crystal_full.png' ? fullImg : f === 'ap_coin.png' ? coinImg : null),
      addOnLoad: () => () => {},
    };
    const stage = new MapStage({ unitArt });
    stage.setStatus({ ap: 3, apMax: 3, mana: 3, manaMax: 3 });
    expect(stage.statusBar.manaCrystal._crystalMaterial.map).toBeTruthy(); // 满晶贴图已挂
    expect(stage.statusBar.apCoin._coinMaterial.map).toBeTruthy();         // 金币面贴图已挂
  });

  it('onEnter 注册帧 tick 驱动资源点过渡；onExit 注销', () => {
    const stage = new MapStage({});
    const handlers = new Set();
    const manager = {
      onTick: (fn) => { handlers.add(fn); return () => handlers.delete(fn); },
    };
    stage.onEnter(manager);
    expect(handlers.size).toBe(1);
    // tick 可安全推进（颜色 lerp 不抛错）
    stage.setStatus({ ap: 3, apMax: 3, mana: 1, manaMax: 3 });
    for (const fn of handlers) fn(0.016);
    stage.onExit(manager);
    expect(handlers.size).toBe(0);
    // 重复 onExit 幂等
    stage.onExit(manager);
  });

  it('setFloor 塔身重建不受状态栏接入影响（回归）', () => {
    const stage = new MapStage({ totalFloors: 44 });
    stage.setFloor(1, 44);
    expect(stage._tower.children.length).toBe(6); // 底层窗口被截：1~6 层
    stage.setFloor(22, 44);
    expect(stage._tower.children.length).toBe(11); // 中层满窗口 VISIBLE_WINDOW
    // 当前层高亮（金色）
    const current = stage._tower.children.find(c => c.position.y === 0);
    expect(current.material.color.getHex()).toBe(0xffd75e);
  });

  it('dispose 释放塔身层块与星空（无几何/材质残留）', () => {
    const stage = new MapStage({ totalFloors: 44 });
    stage.setFloor(22, 44);
    expect(stage._tower.children.length).toBe(11);
    expect(stage._stars).toBeTruthy();
    stage.dispose();
    expect(stage._tower.children.length).toBe(0);            // 层块全部释放移除
    expect(stage.scene.children.includes(stage._stars)).toBe(false); // 星空移出场景
  });

  it('arriveFloor（S5）：当前层块自下而上长出，onDone 回执', async () => {
    const stage = new MapStage({ totalFloors: 44 });
    let done = false;
    stage.arriveFloor(5, 44, { onDone: () => { done = true; }, duration: 0.02 });
    const current = stage._tower.children.find(c => c.position.y === 0);
    expect(current).toBeTruthy();
    expect(current.scale.y).toBeLessThan(1); // 起始压缩态
    await new Promise(r => setTimeout(r, 150));
    expect(done).toBe(true);                 // 长出完成回执（sequencer 据此开闸）
    expect(current.scale.y).toBeCloseTo(1, 2);
  });
});
