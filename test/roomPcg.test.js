// 房间 PCG 契约门（红线法语义断言，不断言视觉参数）：
//   确定性（同种子同布局 / 异种子异布局）· 战场 keepout 零违例 · 红线不重叠 ·
//   场景契约齐备（update/sampleStandeeTint/moonlight）· 几何有限 · 合批族数有界。
// 视觉参数（密度观感/颜色/布光强度）一律不写断言——浏览器由用户验收。

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import '../src/core/content/index.js'; // 触发内容登记（本测试不依赖，保持与战斗测试同口径）
import { composeRoom, buildKeepout } from '../src/stage/scenes/rooms/composeRoom.js';
import { generateWallSkin, buildWallSkin } from '../src/stage/scenes/rooms/wallSkin.js';
import { createRng } from '../src/stage/scenes/kit/index.js';
import { RECIPES, getRecipe } from '../src/stage/scenes/rooms/presets.js';
import { FAMILIES } from '../src/stage/scenes/kit/materials.js';
import { getRoomScene, sceneIdForFloor } from '../src/stage/scenes/rooms/index.js';
import { propRegistry } from '../src/stage/scenes/props/index.js';
import { DUNGEON } from '../src/stage/scenes/dungeon.js';

const rectOf = p => ({ x0: p.x - p.fx - 1.2, x1: p.x + p.fx + 1.2, z0: p.z - p.fz - 1.2, z1: p.z + p.fz + 1.2 });
const intersect = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;

// 占地板红线的落地摆位（墙面/宿主顶/顶挂/构图定点除外；floorDecal 是贴地撒印，
// 按红线法语义允许进战场区——只避站位软红线，见下方各自用例）
const floorPlacements = room => room.placements.filter(p => !p.onWall && !p.hosted && !p.floating && !p.composition);
const solidPlacements = room => floorPlacements(room).filter(p => p.place === 'prop' || p.place === 'smallWall');
const decalPlacements = room => floorPlacements(room).filter(p => p.place === 'floorDecal');

function vertexHash(group) {
  let h = 0;
  group.updateMatrixWorld(true);
  group.traverse(o => {
    if (!o.isMesh) return;
    const arr = o.geometry.attributes.position.array;
    for (let i = 0; i < arr.length; i++) h = (Math.imul(h, 31) + (arr[i] * 1000 | 0)) | 0;
  });
  return h;
}

describe.each(Object.keys(RECIPES))('房间 PCG · 配方 %s', (recipeId) => {
  const room = composeRoom(recipeId, 'test-seed');

  it('场景契约齐备（group/update/sampleStandeeTint/moonlight/skydome）', () => {
    expect(room.group).toBeInstanceOf(THREE.Group);
    expect(typeof room.update).toBe('function');
    expect(typeof room.sampleStandeeTint).toBe('function');
    expect(room.moonlight).toBeInstanceOf(THREE.DirectionalLight);
    expect(room.skydome).toBeTruthy();
    expect(Array.isArray(room.torches)).toBe(true);
    expect(room.placements.length).toBeGreaterThan(0);
  });

  it('确定性：同种子同布局，异种子异布局', () => {
    const again = composeRoom(recipeId, 'test-seed');
    expect(vertexHash(again.group)).toBe(vertexHash(room.group));
    const other = composeRoom(recipeId, 'other-seed');
    expect(vertexHash(other.group)).not.toBe(vertexHash(room.group));
  });

  it('战场 keepout 零违例（落地道具；撒印按红线法只避站位软红线）', () => {
    const { hard, soft } = buildKeepout();
    const viol = solidPlacements(room).filter(p => hard.some(k => intersect(rectOf(p), k)));
    expect(viol.map(p => `${p.id}@${p.x.toFixed(1)},${p.z.toFixed(1)}`)).toEqual([]);
    // 撒印是贴地薄片：摆放器保证的是「中心点」避开站位软红线（scatter 的点式 keepout），
    // 片体微探入站位下方视觉上无害（血泊/水洼就在脚边）——只断言中心点不变量。
    const inRect = (x, z, r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
    const decalViol = decalPlacements(room).filter(p => soft.some(k => inRect(p.x, p.z, k)));
    expect(decalViol.map(p => `${p.id}@${p.x.toFixed(1)},${p.z.toFixed(1)}`)).toEqual([]);
  });

  it('红线不重叠（落地道具两两不交）', () => {
    const ps = solidPlacements(room);
    const bad = [];
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        if (intersect(rectOf(ps[i]), rectOf(ps[j]))) bad.push(`${ps[i].id}/${ps[j].id}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('火源充足：构图定点火 + 撒布火位点亮多盏点光', () => {
    // 回归哨：fireAnchorOf 曾把 tag 当 def 致撒布火位全灭（只剩构图定点 2-3 盏）
    expect(room.torches.length).toBeGreaterThanOrEqual(4);
  });

  it('几何有限（顶点无 NaN/Inf）', () => {
    // 逐顶点断言 expect 调用在皮肤层加入后超 5s 预算（~50 万顶点 × 3 分量）——
    // 改为计数汇总单次断言（语义不变：任一非有限值即红）
    let checked = 0; let bad = 0;
    room.group.traverse(o => {
      if (!o.isMesh || !o.geometry?.attributes?.position) return;
      const arr = o.geometry.attributes.position.array;
      for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) bad++;
      checked++;
    });
    expect(checked).toBeGreaterThan(0);
    expect(bad).toBe(0);
  });

  it('update 跑 60 帧不抛错，sampleStandeeTint 返回有限色', () => {
    for (let i = 0; i < 60; i++) room.update(1 / 60, null, null);
    const c = room.sampleStandeeTint(new THREE.Vector3(-32, -30, 15), new THREE.Color());
    expect(Number.isFinite(c.r + c.g + c.b)).toBe(true);
  });

  it('合批后材质族数 ≤ 族总数（同族一 draw call）', () => {
    const fams = new Set();
    room.group.traverse(o => {
      if (o.isMesh && o.material?.userData?.kitFamily) fams.add(o.material.userData.kitFamily);
    });
    expect(fams.size).toBeLessThanOrEqual(FAMILIES.length);
  });
});

describe('房间 PCG · 墙体皮肤（wallSkin）', () => {
  const spec = {
    u0: -80, u1: 100, side: 'left',
    openings: [{ u0: 12, u1: 22, sill: 16, top: 64 }],
    ribs: [{ u0: -30, u1: -26 }, { u0: 40, u1: 44 }],
    bandSegs: [{ u0: -80, u1: 100, y0: 34, y1: 36 }, { u0: -80, u1: 100, y0: 0, y1: 5.5 }],
  };
  const cfg = { spalls: 3, holes: 2, holeChance: 1, backHoleChance: 1, bites: 1, biteChance: 1, backBiteChance: 1 };

  it('确定性：同种子同深度图/洞，异种子不同', () => {
    const a = generateWallSkin(createRng('skin:a'), cfg, spec);
    const b = generateWallSkin(createRng('skin:a'), cfg, spec);
    expect(Array.from(b.grid.d)).toEqual(Array.from(a.grid.d));
    expect(b.holes).toEqual(a.holes);
    const c = generateWallSkin(createRng('skin:c'), cfg, spec);
    expect(Array.from(c.grid.d)).not.toEqual(Array.from(a.grid.d));
  });

  it('洞口与开口/肋/腰线保持隔离（margin 语义）', () => {
    for (const seed of ['s1', 's2', 's3', 's4', 's5']) {
      const skin = generateWallSkin(createRng(`skin:${seed}`), cfg, spec);
      for (const h of skin.holes) {
        // 开口 margin ≥2（雕刻时保证 ≥5，断言取保守值）
        for (const o of spec.openings) {
          const du = Math.max(o.u0 - h.u1, 0, h.u0 - o.u1);
          const dy = Math.max(o.sill - h.y1, 0, h.y0 - o.top);
          expect(Math.hypot(du, dy), `洞@${seed} 贴开口`).toBeGreaterThanOrEqual(2);
        }
        expect(h.u0).toBeGreaterThanOrEqual(spec.u0);
        expect(h.u1).toBeLessThanOrEqual(spec.u1);
        expect(h.y1).toBeLessThanOrEqual(120); // 皮肤带高度（视野带内纯体素，上方才用大盒挡光）
        // 不与肋体相交（抑制带语义）
        for (const r of spec.ribs) {
          expect(h.u1 < r.u0 + 1 || h.u0 > r.u1 - 1, `洞@${seed} 穿肋`).toBe(true);
        }
      }
    }
  });

  it('深度有界（|d| ≤ 6），几何发射量有界且有限', () => {
    const skin = generateWallSkin(createRng('skin:bound'), cfg, spec);
    for (let k = 0; k < skin.grid.d.length; k++) {
      expect(Math.abs(skin.grid.d[k])).toBeLessThanOrEqual(6);
    }
    const g = buildWallSkin(skin, 'z', -89);
    let n = 0; let bad = 0;
    g.traverse(o => {
      if (!o.isMesh) return;
      n++;
      const arr = o.geometry.attributes.position.array;
      for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) bad++;
    });
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(20000); // 单墙皮肤发射上限（特征件+逐格件）
    expect(bad).toBe(0);
  });
});

describe('房间 PCG · 配方处方合法性', () => {
  it('配方引用的道具 id 全部已登记', () => {
    for (const r of Object.values(RECIPES)) {
      for (const id of [...(r.bigSilhouettes || []), ...(r.fires || []).map(f => f.id),
        ...(r.guaranteed || []).map(g => g.id), r.compositionDecal?.id].filter(Boolean)) {
        expect(propRegistry.has(id), `${r.id} 引用未登记资产 ${id}`).toBe(true);
      }
    }
  });

  it('sceneIdForFloor：Boss 层（11/22/33/44）命中 pcg:boss，四阶段映射正确', () => {
    for (const f of [11, 22, 33, 44]) expect(sceneIdForFloor(f)).toBe('pcg:boss');
    for (const f of [1, 5, 10]) expect(sceneIdForFloor(f)).toBe('pcg:fortress');
    for (const f of [12, 15, 21]) expect(sceneIdForFloor(f)).toBe('pcg:palace');
    for (const f of [23, 29, 32]) expect(sceneIdForFloor(f)).toBe('pcg:manor');
    for (const f of [34, 40, 43]) expect(sceneIdForFloor(f)).toBe('pcg:library');
  });

  it('getRoomScene 与 DUNGEON 同构（战斗几何不动）', { timeout: 30000 }, () => {
    for (const id of ['fortress', 'palace', 'manor', 'library', 'boss', 'mezzanine']) {
      const s = getRoomScene(id, 's');
      expect(s.battleLine).toBe(DUNGEON.battleLine);
      expect(s.slots).toBe(DUNGEON.slots);
      const built = s.build3D();
      expect(built.group).toBeInstanceOf(THREE.Group);
    }
  });

  it('未知配方抛错', () => {
    expect(() => getRecipe('nope')).toThrow();
  });
});
