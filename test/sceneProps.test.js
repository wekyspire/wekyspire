// 场景道具管线契约测试（WORKFLOW §7 + SCENE_TASKS T1.4）。
// 两个部分：
//   1. kit 契约——调色板主题键集/材质族/图元烘焙/撒布确定性/静态合并；
//   2. 资产契约——**fs 扫描 src/stage/scenes/props/ 自动发现**（未登记文件也过门）：
//      过门与登记解耦，多代理并行生产互不相扰；orchestrator 串行登记后跑全量即闭环。
// 视觉参数（颜色深浅、比例美感）一律不断言——浏览器验收归 propGallery.html。

import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as THREE from 'three';
import {
  P, PALETTES, setTheme, getTheme, shade,
} from '../src/stage/scenes/kit/palette.js';
import { M, FAMILIES, materialOf, familyMaterial } from '../src/stage/scenes/kit/materials.js';
import {
  box, cyl, cone, prism, lathe, sphereLo, plate, tilt, jitter, chip, mirror, put, paint,
} from '../src/stage/scenes/kit/primitives.js';
import { createRng, scatter } from '../src/stage/scenes/kit/scatter.js';
import { mergeStatic } from '../src/stage/scenes/kit/merge.js';

// ---- 预算常量（WORKFLOW §3；超预算 = 拆资产或简化，不是调大常量） ----
const MESH_MAX = 40;
const VERT_MAX = 3000;
const FAMILY_MAX = 3;

const PROPS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'stage', 'scenes', 'props');

// ---------------------------------------------------------------- kit 契约

describe('kit 调色板', () => {
  it('各主题 token 键集一致（P.* 换主题换值不换键）', () => {
    const ref = Object.keys(PALETTES.dungeon).sort();
    for (const [name, t] of Object.entries(PALETTES)) {
      expect(Object.keys(t).sort(), `主题 ${name}`).toEqual(ref);
    }
  });

  it('未知 token 抛错（宁可炸也别白）', () => {
    expect(() => P.noSuchToken).toThrow(/未知 token/);
  });

  it('setTheme 切换活动主题且 P.* 跟随；shade 明暗方向正确', () => {
    expect(getTheme()).toBe('dungeon');
    const dungeonStone = P.stone;
    setTheme('boss');
    expect(P.stone).not.toBe(dungeonStone);
    setTheme('dungeon');
    expect(P.stone).toBe(dungeonStone);
    expect(shade(P.stone, 0.3)).not.toBe(P.stone);
    expect(shade(P.stone, -0.3)).not.toBe(P.stone);
    // 色值合理性：提亮后各通道不低于原值（线性空间插白）
    const base = new THREE.Color(P.stone), up = new THREE.Color(shade(P.stone, 0.3));
    expect(up.r + up.g + up.b).toBeGreaterThan(base.r + base.g + base.b);
  });
});

describe('kit 材质族', () => {
  it('五族 + unlit 单例：flatShading、顶点色、带 kitFamily 标记', () => {
    expect(FAMILIES).toEqual(['stone', 'wood', 'metal', 'glass', 'cloth', 'unlit']);
    for (const f of FAMILIES) {
      const m = M[f];
      expect(m.userData.kitFamily).toBe(f);
      if (f !== 'unlit') expect(m.flatShading).toBe(true);
      expect(m.vertexColors).toBe(true);
    }
    expect(M.cloth.side).toBe(THREE.DoubleSide);
    expect(M.unlit.fog).toBe(false);
    expect(() => materialOf('plasma')).toThrow(/未知材质族/);
  });

  it('familyMaterial 收敛工厂：颜色落位、关顶点色、保留族标记', () => {
    const m = familyMaterial('metal', { color: P.iron });
    expect(m.color.getHex()).toBe(P.iron);
    expect(m.vertexColors).toBe(false);
    expect(m.userData.kitFamily).toBe('metal');
    expect(m.metalness).toBe(M.metal.metalness);
  });
});

describe('kit 图元与修饰器', () => {
  it('图元烘焙顶点色（color attribute 与 position 等长、无 NaN）', () => {
    const prims = [
      box({ color: P.wood, size: [1, 2, 3] }),
      cyl({ color: P.wood, r: 1, rTop: 0.5, h: 2, seg: 6 }),
      cone({ color: P.flameCore, r: 1, h: 2, family: 'unlit' }),
      prism({ color: P.stone, size: [2, 1, 3] }),
      lathe({ color: P.clay, profile: [[0.5, 0], [0.3, 1]] }),
      sphereLo({ color: P.rock, r: 1, jitter: 0.3, rng: createRng(7) }),
      plate({ color: P.slab, w: 2, d: 3 }),
    ];
    for (const m of prims) {
      const { position, color } = m.geometry.attributes;
      expect(color, m.type).toBeTruthy();
      expect(color.count).toBe(position.count);
      for (let i = 0; i < position.count; i++) {
        expect(Number.isFinite(position.getX(i))
          && Number.isFinite(position.getY(i))
          && Number.isFinite(position.getZ(i))).toBe(true);
      }
    }
    // 图元必填 color
    expect(() => box({})).toThrow(/color/);
    // plate 自动落底
    expect(plate({ color: P.slab, th: 0.5 }).position.y).toBeCloseTo(0.25);
  });

  it('修饰器：tilt 累加 / chip 削角位移 / mirror 负 scale / jitter 确定性', () => {
    const b = tilt(box({ color: P.wood }), 0.1, 0.2, 0.3);
    tilt(b, 0.1, 0, 0);
    expect(b.rotation.x).toBeCloseTo(0.2);
    expect(b.rotation.y).toBeCloseTo(0.2);

    const br = box({ color: P.slab, size: [2, 2, 2] });
    const geo = br.geometry.attributes.position;
    const before = new Set(Array.from({ length: geo.count }, (_, i) =>
      `${geo.getX(i)},${geo.getY(i)},${geo.getZ(i)}`));
    chip(br, { corner: [1, 1, 1], amount: 0.3 });
    let moved = 0;
    for (let i = 0; i < br.geometry.attributes.position.count; i++) {
      const p = br.geometry.attributes.position;
      if (!before.has(`${p.getX(i)},${p.getY(i)},${p.getZ(i)}`)) moved++;
    }
    expect(moved).toBeGreaterThan(0); // 匹配角顶点确被位移

    const m = mirror(box({ color: P.iron }));
    expect(m.scale.x).toBe(-1);

    const j1 = jitter(box({ color: P.wood }), createRng(42), { pos: 1, rot: 1, scale: 0.2 });
    const j2 = jitter(box({ color: P.wood }), createRng(42), { pos: 1, rot: 1, scale: 0.2 });
    expect(j2.position.toArray()).toEqual(j1.position.toArray());
    for (const axis of ['x', 'y', 'z']) {
      expect(j2.rotation[axis]).toBeCloseTo(j1.rotation[axis]);
      expect(j2.scale[axis]).toBeCloseTo(j1.scale[axis]);
    }
  });
});

describe('kit 撒布', () => {
  it('createRng 确定性（number/string 种子皆可）', () => {
    const a = createRng(123), b = createRng(123);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    const s1 = createRng('room-1'), s2 = createRng('room-1'), s3 = createRng('room-2');
    expect(s1()).toBe(s2());
    expect(s1()).not.toBe(s3());
  });

  it('scatter：确定性 + keepout 硬拒 + 间距互斥 + 宁缺毋滥', () => {
    const area = { x0: -10, z0: -10, x1: 10, z1: 10 };
    const keepout = [{ x0: -2, z0: -2, x1: 2, z1: 2 }];
    const run = () => scatter(createRng(9), { count: 12, area, avoid: keepout, spacing: 3 });
    const p1 = run(), p2 = run();
    expect(p1).toEqual(p2); // 确定性
    expect(p1.length).toBeGreaterThan(0);
    for (const p of p1) {
      expect(p.x >= -2 && p.x <= 2 && p.z >= -2 && p.z <= 2).toBe(false); // 不进红线
      expect(p.x >= area.x0 && p.x <= area.x1).toBe(true);
    }
    for (const [i, a] of p1.entries()) for (const [j, b2] of p1.entries()) {
      if (i < j) expect(Math.hypot(a.x - b2.x, a.z - b2.z)).toBeGreaterThanOrEqual(3);
    }
    // 密不下的区域：数量 < 请求数也不挤进红线
    const squeezed = scatter(createRng(5), {
      count: 10, area: { x0: 0, z0: 0, x1: 2, z1: 2 }, spacing: 1.5,
    });
    expect(squeezed.length).toBeLessThan(10);
  });
});

describe('kit 静态合并', () => {
  it('按族分桶合并、世界变换烘进顶点、interactive 子树整棵跳过', () => {
    const root = new THREE.Group();
    const a = put(box({ color: P.stone, size: [2, 2, 2] }), -5, 1, 0);
    const b = put(box({ color: P.rock, size: [1, 1, 1] }), 5, 0.5, 3);
    const wood = put(box({ color: P.wood, size: [1, 1, 1], family: 'wood' }), 0, 0.5, 0);
    const live = put(grpOf(box({ color: P.iron, size: [1, 1, 1], family: 'metal' })), 2, 0.5, 2);
    live.userData.interactive = true; // 挂行为者：不并
    root.add(a, b, wood, live);
    const out = mergeStatic(root);
    const meshes = [];
    out.traverse(o => { if (o.isMesh) meshes.push(o); });
    expect(meshes.length).toBe(3); // stone(2合1) + wood + 跳过的铁件独立
    const liveMesh = meshes.find(m => m.material.userData.kitFamily === 'metal');
    const stoneMesh = meshes.find(m => m.material.userData.kitFamily === 'stone');
    expect(stoneMesh.geometry.attributes.position.count).toBeGreaterThan(24); // 两块合一起
    expect(out.getObjectById(live.id)).toBeTruthy(); // interactive 原样保留（引用可继续动）
    // 合并产物几何规整为 position/normal/color（interactive 原样保留原几何）
    for (const m of meshes) {
      if (m === liveMesh) continue;
      expect(m.geometry.index).toBeNull();
      expect(m.geometry.attributes.uv).toBeFalsy();
      expect(m.geometry.attributes.color).toBeTruthy();
    }
  });

  it('非 kit 材质网格合并即抛错（资产禁自建材质）', () => {
    const root = new THREE.Group();
    root.add(new THREE.Mesh(
      paint(new THREE.BoxGeometry(1, 1, 1), 0xffffff),
      new THREE.MeshStandardMaterial()));
    expect(() => mergeStatic(root)).toThrow(/非 kit 族材质/);
  });

  it('mirror 负 scale 网格参与合并时绕序被翻正（烘焙后面朝相机可见）', () => {
    const root = new THREE.Group();
    const m = mirror(box({ color: P.stone, size: [1, 1, 1] }));
    root.add(put(m, 3, 0.5, 0));
    const out = mergeStatic(root);
    const merged = out.children.find(c => c.isMesh);
    const geo = merged.geometry;
    // 合并后绕序健康度：每三角形法线（右手定则）应与内置 normal 属性同向
    const pos = geo.attributes.position, nor = geo.attributes.normal;
    const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 3) {
      v0.fromBufferAttribute(pos, i); v1.fromBufferAttribute(pos, i + 1); v2.fromBufferAttribute(pos, i + 2);
      e1.subVectors(v1, v0); e2.subVectors(v2, v0);
      n.crossVectors(e1, e2);
      expect(n.dot(new THREE.Vector3(
        nor.getX(i), nor.getY(i), nor.getZ(i)))).toBeGreaterThan(0);
    }
  });
});

function grpOf(...children) {
  const g = new THREE.Group();
  g.add(...children);
  return g;
}

// ---------------------------------------------------------------- 资产契约（fs 自动发现）

/**
 * 精确包围盒：逐顶点套世界矩阵求 min/max。three 的 Box3.setFromObject 对旋转网格
 * 用"旋转后的 AABB"保守放大（spiky 几何可虚涨 30%+），契约测量必须用真值。
 */
function exactBounds(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  root.traverse(o => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      box.expandByPoint(v);
    }
  });
  return box;
}

const PLACE_SET = new Set([
  'roomWall', 'smallWall', 'floor', 'prop', 'floorDecal', 'wallStructure', 'wallDecor',
]);
const MOUNT_SET = new Set(['floor', 'smallWallTop', 'ceiling']);
const BAND_SET = new Set(['high', 'mid', 'low']);
// 贴地类：build 产物应底部着地（bbox.min.y ≥ -GROUND_TOL）
const GROUNDED = new Set(['prop', 'floorDecal', 'smallWall']);
// 必须声明 footprint 的类（keepout/地块匹配依据；宁大勿小）
const NEED_FOOTPRINT = new Set(['prop', 'floorDecal', 'smallWall']);

const files = readdirSync(PROPS_DIR)
  .filter(f => f.endsWith('.js') && f !== 'index.js')
  .sort();
expect(files.length).toBeGreaterThan(0); // 模块加载即守：扫描不到资产 = 目录接线坏了

describe.each(files.map(f => [f]))('场景资产契约：%s', (f) => {
  let def;
  let src;
  let built;

  beforeAll(async () => {
    ({ default: def } = await import(`../src/stage/scenes/props/${f}`));
    src = readFileSync(path.join(PROPS_DIR, f), 'utf8');
    built = def.build({ rng: createRng(20260828) });
  });

  it('契约字段：id=文件名、place 枚举、tags 非空、build 函数、behaviors 为空（P5 前）', () => {
    expect(def.id).toBe(f.replace(/\.js$/, ''));
    expect(PLACE_SET.has(def.place), `place "${def.place}"`).toBe(true);
    expect(Array.isArray(def.tags)).toBe(true);
    expect(def.tags.length).toBeGreaterThan(0);
    expect(def.tags.every(t => typeof t === 'string')).toBe(true);
    expect(typeof def.build).toBe('function');
    expect(def.behaviors ?? []).toEqual([]);
  });

  it('类专属字段：mount/band/bayWidth 按摆放类补齐（CATALOG §2）', () => {
    if (def.place === 'prop') {
      // mount 可单值或数组（目录双宿主条目如 floor/smallWallTop）
      const mounts = Array.isArray(def.mount) ? def.mount : [def.mount ?? 'floor'];
      expect(mounts.length).toBeGreaterThan(0);
      for (const mo of mounts) expect(MOUNT_SET.has(mo), `mount "${mo}"`).toBe(true);
    }
    if (def.place === 'wallDecor') {
      const bands = Array.isArray(def.band) ? def.band : [def.band];
      expect(bands.length).toBeGreaterThan(0);
      for (const b of bands) expect(BAND_SET.has(b), `band "${b}"`).toBe(true);
    }
    if (def.place === 'wallStructure') {
      expect([1, 2]).toContain(def.bayWidth);
    }
    if (NEED_FOOTPRINT.has(def.place)) {
      expect(def.footprint).toBeTruthy();
      expect(def.footprint.x).toBeGreaterThan(0);
      expect(def.footprint.z).toBeGreaterThan(0);
    }
    if (def.topY !== undefined) {
      expect(typeof def.topY).toBe('number');
      expect(def.topY).toBeGreaterThan(0);
    }
  });

  it('build 返回 Group；网格/顶点/材质族预算内且全部为 kit 族；无 NaN', () => {
    expect(built).toBeInstanceOf(THREE.Group);
    const meshes = [];
    built.traverse(o => { if (o.isMesh) meshes.push(o); });
    expect(meshes.length).toBeGreaterThan(0);
    expect(meshes.length, '网格数超预算（拆件或简化）').toBeLessThanOrEqual(MESH_MAX);
    let verts = 0;
    const families = new Set();
    for (const m of meshes) {
      const pos = m.geometry.attributes.position;
      verts += pos.count;
      for (let i = 0; i < pos.count; i++) {
        expect(Number.isFinite(pos.getX(i))
          && Number.isFinite(pos.getY(i))
          && Number.isFinite(pos.getZ(i)), '几何含 NaN').toBe(true);
      }
      const fam = m.material?.userData?.kitFamily;
      expect(fam, '自建材质（必须走 kit 族）').toBeTruthy();
      families.add(fam);
      for (const axis of ['x', 'y', 'z']) {
        expect(Number.isFinite(m.position[axis])
          && Number.isFinite(m.scale[axis])).toBe(true);
      }
    }
    expect(verts).toBeLessThanOrEqual(VERT_MAX);
    expect(families.size).toBeLessThanOrEqual(FAMILY_MAX);
  });

  it('包围盒：贴地类落地（min.y 近 0）；声明 footprint 者实际占地不超声明（keepout 安全）', () => {
    const bbox = exactBounds(built);
    expect(Number.isFinite(bbox.min.x)).toBe(true); // 空组/退化几何在此暴露
    if (GROUNDED.has(def.place)) {
      const mounts = Array.isArray(def.mount) ? def.mount : [def.mount ?? 'floor'];
      if (mounts.includes('ceiling') && !mounts.includes('floor')) {
        // 纯顶挂件：原点=天花板锚点，身体自锚点垂挂向下（max.y 近 0）
        expect(bbox.max.y).toBeLessThanOrEqual(0.6);
        expect(bbox.min.y).toBeLessThan(0);
      } else {
        expect(bbox.min.y).toBeGreaterThanOrEqual(-0.6);
        expect(bbox.max.y).toBeGreaterThan(0);
      }
    }
    // smallWall 宿主顶面 = topY（柱顶摆放准入的机器可读事实，容差 0.5）
    if (def.place === 'smallWall' && typeof def.topY === 'number') {
      expect(Math.abs(bbox.max.y - def.topY), `顶面 ${bbox.max.y.toFixed(2)} ≠ 声明 topY ${def.topY}`)
        .toBeLessThanOrEqual(0.5);
    }
    if (def.footprint) {
      const ex = bbox.max.x - bbox.min.x, ez = bbox.max.z - bbox.min.z;
      expect(ex).toBeLessThanOrEqual(def.footprint.x * 1.2 + 0.4);
      expect(ez).toBeLessThanOrEqual(def.footprint.z * 1.2 + 0.4);
      // 下界：声明 footprint 与实际差 5 倍以上 = 抄错档位
      expect(ex).toBeGreaterThanOrEqual(def.footprint.x * 0.2);
      expect(ez).toBeGreaterThanOrEqual(def.footprint.z * 0.2);
    }
  });

  it('静态扫描：无裸 hex、无自建材质、import 只许 three/kit、禁 import.meta.glob', () => {
    expect(src.match(/0x[0-9a-fA-F]+/), '裸 hex（只许 P.* / shade）').toBeNull();
    expect(src.match(/#[0-9a-fA-F]{3,8}\b/), '裸 hex 字符串').toBeNull();
    expect(src.match(/new\s+THREE\.(MeshStandardMaterial|MeshBasicMaterial|MeshPhysicalMaterial)/),
      '自建材质').toBeNull();
    expect(src.includes('import.meta.glob')).toBe(false);
    for (const line of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const dep = line[1];
      expect(dep === 'three' || dep.startsWith('../kit/'),
        `非法依赖 "${dep}"（只许 three 与 kit）`).toBeTruthy();
    }
  });

  it('变体稳定：同种子两次 build 顶点一致（确定性），换参数仍然合法', () => {
    const again = def.build({ rng: createRng(20260828) });
    const sig = o => {
      const arr = [];
      o.traverse(m => {
        if (!m.isMesh) return;
        const p = m.geometry.attributes.position;
        arr.push(p.count, +m.position.x.toFixed(3), +m.position.z.toFixed(3));
      });
      return arr.join(',');
    };
    expect(sig(again)).toBe(sig(built));
    const variant = def.build({ rng: createRng(1), ...(def.id === 'bottleRack' ? { bottles: 3, fallen: 0 } : {}) });
    expect(variant).toBeInstanceOf(THREE.Group);
  });
});
