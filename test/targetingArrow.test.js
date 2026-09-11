import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  TargetingArrowObject, ARROW_COLOR_FREE, ARROW_COLOR_LOCK,
} from '../src/stage/objects/TargetingArrowObject.js';

// TargetingArrowObject 无头单测：曲线排布、头尾位置、锁定变色、显隐。
// node 环境无 document → 圆点贴图为 null（方块占位），几何/颜色逻辑不受影响。

describe('TargetingArrowObject', () => {
  it('show 后可见：圆点沿弧线排布，首点近牌、末点近指针、箭头在指针处', () => {
    const arrow = new TargetingArrowObject();
    expect(arrow.visible).toBe(false);

    const from = new THREE.Vector3(0, -40, 0);
    const to = new THREE.Vector3(40, 0, 0);
    arrow.show(from);
    arrow.update(from, to);

    expect(arrow.visible).toBe(true);
    const dots = arrow._dots;
    // 首点距起点近、末点距终点近（曲线参数化单调推进）
    expect(dots[0].position.distanceTo(from)).toBeLessThan(dots[dots.length - 1].position.distanceTo(from));
    expect(dots[dots.length - 1].position.distanceTo(to)).toBeLessThan(dots[0].position.distanceTo(to));
    // 圆点尾小头大（指向性）
    expect(dots[dots.length - 1].scale.x).toBeGreaterThan(dots[0].scale.x);
    // 箭头钉在指针处
    expect(arrow._head.position.x).toBeCloseTo(to.x);
    expect(arrow._head.position.y).toBeCloseTo(to.y);
    // 弧线向上凸：中点圆点应高于两端连线中点
    const mid = dots[Math.floor(dots.length / 2)].position;
    expect(mid.y).toBeGreaterThan((from.y + to.y) / 2);
  });

  it('setTargetValid 切换锁定色；hide 隐藏；零距离不崩', () => {
    const arrow = new TargetingArrowObject();
    const p = new THREE.Vector3(1, 2, 0);
    arrow.show(p);
    arrow.update(p, p); // 原地：无切线/无法向，不应产生 NaN
    expect(Number.isNaN(arrow._dots[0].position.x)).toBe(false);

    expect(arrow.targetValid).toBe(false);
    expect(arrow._material.color.getHex()).toBe(ARROW_COLOR_FREE);
    arrow.setTargetValid(true);
    expect(arrow.targetValid).toBe(true);
    expect(arrow._material.color.getHex()).toBe(ARROW_COLOR_LOCK);
    arrow.setTargetValid(false);
    expect(arrow.targetValid).toBe(false);

    arrow.hide();
    expect(arrow.visible).toBe(false);
  });

  it('箭头朝向沿末端切线（向右上瞄准时箭头指向右上）', () => {
    const arrow = new TargetingArrowObject();
    const from = new THREE.Vector3(0, 0, 0);
    const to = new THREE.Vector3(30, 30, 0);
    arrow.show(from);
    arrow.update(from, to);
    // 三角形尖端本朝 +Y，rotation.z 后尖端应大致指向 (to-ctrl) 方向（第一象限）
    const tipAngle = arrow._head.rotation.z + Math.PI / 2; // 尖端实际朝向
    expect(tipAngle).toBeGreaterThan(0);
    expect(tipAngle).toBeLessThan(Math.PI / 2);
  });
});
