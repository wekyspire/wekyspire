import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { StageManager, WORLD_HEIGHT, CAMERA_LOOK_AT } from '../src/stage/StageManager.js';

function make() {
  const renders = [];
  const sm = new StageManager({
    createRenderer: () => ({
      render: (scene, camera) => renders.push({ scene, camera }),
      setSize: () => {},
      dispose: () => {},
    }),
  });
  sm.attach({});
  return { sm, renders };
}

describe('StageManager', () => {
  it('世界约定：z=0 平面屏幕高 = 100 世界单位，resize 只改相机', () => {
    const { sm } = make();
    sm.resize(1600, 900);
    expect(WORLD_HEIGHT).toBe(100);
    expect(sm.camera.aspect).toBeCloseTo(1600 / 900);
    expect(sm.worldWidth).toBeCloseTo(100 * 1600 / 900);
  });

  it('screenToWorld：屏幕中心 = lookAt 锚点，y 向上 x 向右（斜视约定）', () => {
    const { sm } = make();
    sm.resize(1000, 1000);
    const c = sm.screenToWorld(500, 500);
    expect(c.x).toBeCloseTo(0);
    expect(c.y).toBeCloseTo(CAMERA_LOOK_AT.y); // 视轴锚在牌桌上方（z=0 平面）
    // 单调性：屏幕上方世界 y 更大，右方 x 更大（斜视下 z=0 平面不再对称，只断方向）
    const up = sm.screenToWorld(500, 100);
    const down = sm.screenToWorld(500, 900);
    expect(up.y).toBeGreaterThan(c.y);
    expect(down.y).toBeLessThan(c.y);
    const right = sm.screenToWorld(900, 500);
    expect(right.x).toBeGreaterThan(0);
  });

  it('透视纵深：同 xy 不同 z 投影位置不同；worldToScreen/screenToWorld 互逆', () => {
    const { sm } = make();
    sm.resize(1000, 1000);
    // 透视：z>0（近）与 z<0（远）投影到不同屏幕位置（斜相机下不做轴向断言，断分离即可）
    const near = sm.worldToScreen(20, 0, 30);
    const far = sm.worldToScreen(20, 0, -30);
    expect(Math.hypot(near.x - far.x, near.y - far.y)).toBeGreaterThan(1);
    // 互逆：屏幕点 → z 平面求交 → 投影回原屏幕点
    const w = sm.screenToWorld(800, 200, 30);
    const s = sm.worldToScreen(w.x, w.y, 30);
    expect(s.x).toBeCloseTo(800);
    expect(s.y).toBeCloseTo(200);
  });

  it('UI 正交相机：布局坐标↔屏幕线性映射（无透视畸变），取景中心 -15', () => {
    const { sm } = make();
    sm.resize(1000, 1000); // aspect 1 → 视锥 ±50 × ±50（视图空间对称）
    const cam = sm.uiCamera;
    expect(cam.isOrthographicCamera).toBe(true);
    // 取景中心（0,-15）→ 屏幕中心；可视范围恰为 y∈[-65, +35]（底部留手牌构图）
    expect(sm.worldToScreen(0, -15, 0, cam).y).toBeCloseTo(500);
    expect(sm.worldToScreen(0, 35, 0, cam).y).toBeCloseTo(0);
    expect(sm.worldToScreen(0, -65, 0, cam).y).toBeCloseTo(1000);
    // 线性：同 y 差 → 同像素差，与 z 无关（正交无近大远小——咏唱槽 z=4 与手牌 z=20+ 不错位）
    const a = sm.worldToScreen(10, -40, 4, cam);
    const b = sm.worldToScreen(10, -40, 33, cam);
    expect(a.x).toBeCloseTo(b.x);
    expect(a.y).toBeCloseTo(b.y);
    const dy = sm.worldToScreen(0, -30, 0, cam).y - sm.worldToScreen(0, -40, 0, cam).y;
    expect(dy).toBeCloseTo(-100); // 10 世界单位 = 100 像素（1000px / 100wu）
    // 反投影互逆（UI 拖拽/拾取映射）
    const w = sm.screenToWorld(800, 200, 4, cam);
    const s = sm.worldToScreen(w.x, w.y, 4, cam);
    expect(s.x).toBeCloseTo(800);
    expect(s.y).toBeCloseTo(200);
  });

  it('场景切换触发 onExit/onEnter 生命周期', () => {
    const { sm } = make();
    const calls = [];
    const a = { name: 'battle', scene: new THREE.Scene(), onEnter: () => calls.push('enter-a'), onExit: () => calls.push('exit-a') };
    const b = { name: 'rest', scene: new THREE.Scene(), onEnter: () => calls.push('enter-b') };
    sm.setStage(a);
    sm.setStage(b);
    expect(calls).toEqual(['enter-a', 'exit-a', 'enter-b']);
    expect(sm.stage).toBe(b);
  });

  it('同名场景重复 setStage 不重复触发生命周期', () => {
    const { sm } = make();
    let enters = 0;
    const a = { name: 'battle', scene: new THREE.Scene(), onEnter: () => enters++ };
    sm.setStage(a);
    sm.setStage(a);
    expect(enters).toBe(1);
  });
});
