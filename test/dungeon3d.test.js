import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildDungeon3D } from '../src/stage/scenes/dungeon3D.js';

// 程序化地牢场景契约：纯几何/灯光（node 可建）、火把闪烁、氛围粒子发射、立牌染色采样
describe('dungeon3D 程序化场景', () => {
  it('构建：水平地板 + 背景墙 + 柱列 + 12 火源（各带点光）+ 基础灯光 + 月光浮尘云', () => {
    const { group, torches } = buildDungeon3D();
    expect(torches).toHaveLength(12); // 10 壁灯 + 2 立地火盆
    const lights = [];
    group.traverse(o => { if (o.isPointLight) lights.push(o); });
    expect(lights).toHaveLength(16); // 12 火源 + 1 吊灯 + 2 月光落地反弹 + 1 战场主补光（假 GI）
    expect(group.getObjectByName('dungeon3D')).toBe(group);
    // 月光浮尘云：常驻噪音浮尘（shadow map 未就绪前隐藏不渲染）
    const dust = group.getObjectByName('moonDust');
    expect(dust).toBeTruthy();
    expect(dust.visible).toBe(false);
    // 每个火把都有火焰锥与点光
    for (const t of torches) {
      expect(t.light.isPointLight).toBe(true);
      expect(t.flame).toBeTruthy();
    }
  });

  it('火把闪烁：update 推进后点光强度偏离基准且随时间变化', () => {
    const { torches, update } = buildDungeon3D();
    const base = torches[0].light.intensity;
    update(0.37, null);
    const i1 = torches.map(t => t.light.intensity);
    expect(i1.some(i => Math.abs(i - base) / base > 0.01)).toBe(true);
    update(0.53, null);
    const i2 = torches.map(t => t.light.intensity);
    expect(i2.some((i, k) => Math.abs(i - i1[k]) / base > 0.005)).toBe(true);
  });

  it('氛围粒子：火焰粒子从火把锚点发射（上浮）', () => {
    const { torches, update } = buildDungeon3D();
    const calls = [];
    const fakeParticles = { spawn: (x, y, o) => calls.push({ x, y, ...o }) };
    update(0.5, fakeParticles); // 0.5s ≈ 每火把 4-5 粒火焰
    const flames = calls.filter(c => c.ttl < 1);
    expect(flames.length).toBeGreaterThanOrEqual(8);
    const torchZs = new Set(torches.map(t => t.z));
    expect(flames.every(f => torchZs.has(f.z))).toBe(true); // 火焰都从火把锚点出
    expect(flames.every(f => f.gravity > 0)).toBe(true); // 火焰上浮
  });

  it('立牌染色采样：幽火旁更亮且蓝紫主导、远处保持冷蓝紫底；远端单位被纵深压暗', () => {
    const { torches, sampleStandeeTint } = buildDungeon3D();
    // 幽火衰减半径内的中厅点（柱列火把 XY 投影互相堆叠，正上方采样会顶满 1.12 clamp，
    // 失去比较意义；这里取只被 doorway 火把/吊灯弱照射的未饱和区）
    const nearTorch = sampleStandeeTint({ x: 0, y: -25, z: 0 }, new THREE.Color());
    // 采样只算 XY 距离：选一个离全部火把/吊灯都远的真暗角（场景拉长后火源更多，
    // (120,-60) 距最近火源 XY 也 >58 衰减半径）
    const farAway = sampleStandeeTint({ x: 120, y: -60, z: 0 }, new THREE.Color());
    expect(nearTorch.b).toBeGreaterThan(farAway.b); // 幽火光衰
    // 冷调统一（蓝白紫）：任何处 b 主导（蓝紫），r 永不主导（不许转暖）
    expect(nearTorch.b).toBeGreaterThan(nearTorch.r);
    expect(nearTorch.b).toBeGreaterThan(nearTorch.g);
    expect(farAway.b).toBeGreaterThanOrEqual(farAway.r);
    // 纵深压暗：同 xy，z=-28（敌人排）比 z=16（玩家排）暗
    const near2 = sampleStandeeTint({ x: 0, y: 0, z: 16 }, new THREE.Color());
    const far2 = sampleStandeeTint({ x: 0, y: 0, z: -28 }, new THREE.Color());
    expect(far2.r + far2.g + far2.b).toBeLessThan(near2.r + near2.g + near2.b);
  });
});
