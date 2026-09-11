// 房型配方层 · 程序化砌墙（CATALOG L2 的墙身层）：bay 分段 + 尖拱开洞 + 砖面细节。
// 纯 kit 图元（顶点色管线），与道具同一 mergeStatic 合批口径；
// 立面装饰（wallStructure/wallDecor 道具挂墙）由 composeRoom 的 L2 摆放器在墙身之上进行。
//
// 几何约束继承 STAGE_DESIGN 三铁律 + dungeon3D 调试实录：
//   墙厚 12（> 2 个 shadow texel，防 PCF 漏光）、墙顶 +460（遮蔽越顶亮楔，体积光不糊）、
//   左墙 z∈[-115,125]（堵月光侧漏）。窗洞为矩形洞 + 尖拱石框视觉收尖（dungeon3D 手法）。

import * as THREE from 'three';
import { P, K, shade, createRng, materialOf, paint } from '../kit/index.js';
import { FLOOR_Y } from '../dungeon3D.js';
import { generateWallSkin, buildWallSkin, SKIN_TOP, SKIN_CAVITY } from './wallSkin.js';

export const WALL_TH = 12;                 // 墙厚铁律
export const WALL_TOP_Y = FLOOR_Y + 460;   // 墙顶铁律：高出画
export const LEFT_WALL_X = -95;            // 左墙（月光墙）中心 x
export const BACK_WALL_Z = -80;            // 背墙（敌人身后）内侧面 z
export const FLOOR_X0 = LEFT_WALL_X + WALL_TH / 2; // -89：地板左缘 = 左墙内侧面
export const FLOOR_X1 = 140;               // 地板右缘（伸出画外）
export const FLOOR_Z0 = BACK_WALL_Z;       // 地板远端 = 背墙
export const FLOOR_Z1 = 105;               // 地板近端（伸出画面底缘）
export const WALL_Z0 = -115;               // 左墙 z 覆盖铁律
export const WALL_Z1 = 125;

// 尖拱轮廓（哥特窗/门）：底部矩形 + 两侧二次曲线收尖。原点在底部中心（复制自 dungeon3D
// 的私有实现——老场景不回迁，此处为配方层独立拷贝）。
function pointedArch(w, h) {
  const springY = h * 0.55;
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(-w / 2, springY);
  s.quadraticCurveTo(-w / 2, h * 0.92, 0, h);
  s.quadraticCurveTo(w / 2, h * 0.92, w / 2, springY);
  s.lineTo(w / 2, 0);
  s.closePath();
  return s;
}

// 尖拱石框（环）：矩形洞视觉收尖。ShapeGeometry 走 paint + 族单例（可合并）。
function archFrame(w, h, color) {
  const shape = pointedArch(w + 3.2, h + 3.2);
  shape.holes.push(new THREE.Path(pointedArch(w - 0.6, h - 0.4).getPoints(16)));
  return new THREE.Mesh(paint(new THREE.ShapeGeometry(shape), color), materialOf('stone'));
}

// 矩形轮廓（体素墙洞口口径：洞是矩形，门洞视觉件必须同形——尖拱配矩形洞会露馅，用户定 2026-09）。
function rectShape(w, h) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(-w / 2, h);
  s.lineTo(w / 2, h);
  s.lineTo(w / 2, 0);
  s.closePath();
  return s;
}

// 矩形石框（环）：与 archFrame 同边距口径。
function rectFrame(w, h, color) {
  const shape = rectShape(w + 3.2, h + 3.2);
  shape.holes.push(new THREE.Path(rectShape(w - 0.6, h - 0.4).getPoints(4)));
  return new THREE.Mesh(paint(new THREE.ShapeGeometry(shape), color), materialOf('stone'));
}

// 矩形黑洞（门洞纵深）：unlit 暗槽色片。
function rectVoid(w, h, color = P.night) {
  return new THREE.Mesh(paint(new THREE.ShapeGeometry(rectShape(w, h)), color), materialOf('unlit'));
}

/**
 * 沿墙分段砌实体段（洞口之间填空）。axis='x'：墙沿 x 走（背墙），fixed=z；
 * axis='z'：墙沿 z 走（左墙），fixed=x。segs=[{u0,u1,y0,y1}]（u=沿墙坐标）。
 * cavity（可选）= 皮肤暗腔 {u0,u1}：皮肤带 [FLOOR_Y, FLOOR_Y+SKIN_TOP] 且 u 在腔区间内
 * **不砌任何实体**（用户定 2026-09：视野带内墙面 100% 纯体素，体素墙不要大长方体）——
 * 该区间由皮肤体素柱 + 暗腔背板构成（背板兼任挡光，柱间缝透的光打在背板上不漏）；
 * 视野外（带上方/腔外）保持全墙厚简单大盒挡光（墙厚铁律不动）。
 */
function wallSegments(group, axis, fixed, segs, { th = WALL_TH, cavity = null } = {}) {
  for (const s of segs) {
    const parts = [];
    if (cavity) {
      const by0 = Math.max(s.y0, FLOOR_Y); const by1 = Math.min(s.y1, FLOOR_Y + SKIN_TOP);
      if (by1 > by0) {
        if (s.y0 < by0) parts.push({ ...s, y1: by0 });
        const cu0 = Math.max(s.u0, cavity.u0); const cu1 = Math.min(s.u1, cavity.u1);
        if (cu0 > s.u0) parts.push({ u0: s.u0, u1: cu0, y0: by0, y1: by1 });
        // 腔区间带内：不砌（纯体素墙）
        if (cu1 < s.u1) parts.push({ u0: cu1, u1: s.u1, y0: by0, y1: by1 });
        if (s.y1 > by1) parts.push({ ...s, y0: by1 });
      } else parts.push({ ...s });
    } else parts.push({ ...s });
    for (const p of parts) {
      const pd = p.u1 - p.u0; const ph = p.y1 - p.y0;
      if (pd <= 0 || ph <= 0) continue;
      const size = axis === 'x' ? [pd, ph, th] : [th, ph, pd];
      const box = K.box({ color: P.wall, size });
      const u = (p.u0 + p.u1) / 2;
      K.put(box, axis === 'x' ? u : fixed, p.y0 + ph / 2, axis === 'x' ? fixed : u);
      group.add(box);
    }
  }
}

// 把洞口列表（沿墙 u 区间 + 窗台/拱顶高度）切成实体墙段。
function segmentsAroundOpenings(u0, u1, y0, yTop, openings) {
  const segs = [];
  const sorted = [...openings].sort((a, b) => a.u0 - b.u0);
  let cursor = u0;
  let baseTop = yTop; // 底带高度取最低窗台
  for (const o of sorted) baseTop = Math.min(baseTop, y0 + o.sill);
  segs.push({ u0, u1, y0, y1: baseTop });
  for (const o of sorted) {
    const sillY = y0 + o.sill;
    const topY = y0 + o.top;
    if (o.u0 > cursor) {
      // 洞口左侧墙体：底带以上全高
      if (baseTop < yTop) segs.push({ u0: cursor, u1: o.u0, y0: baseTop, y1: yTop });
    }
    // 洞口正上方墙体
    if (topY < yTop) segs.push({ u0: o.u0, u1: o.u1, y0: topY, y1: yTop });
    // 洞口下带（比全局底带更低的窗台）
    if (sillY > baseTop) segs.push({ u0: o.u0, u1: o.u1, y0: baseTop, y1: sillY });
    cursor = o.u1;
  }
  if (cursor < u1 && baseTop < yTop) segs.push({ u0: cursor, u1, y0: baseTop, y1: yTop });
  return segs;
}

// 砖面补丁：一片逐砖抖动的错缝砖（dungeon3D 手法，顶点色路径重建）。
function brickPatch(rng, axis, fixed, x0, y0, cols, rows) {
  const g = new THREE.Group();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (rng() < 0.14) continue; // 缺砖
      const b = K.box({ color: P.brick, size: [5.4, 2.4, 1.5] });
      const u = x0 + c * 6 + (r % 2) * 2.5 + (rng() - 0.5) * 0.6;
      const y = y0 + r * 3 + (rng() - 0.5) * 0.5;
      if (axis === 'x') K.put(b, u, y, fixed);
      else K.put(b, fixed, y, u);
      g.add(b);
    }
  }
  return g;
}

// ---- 墙面大起伏处方（用户反馈：三面光板 + 小挂件太无趣）----
// 扶壁肋（沿墙每 20~28 一根全高肋，rng 断残）+ 双腰线檐口（洞口处分段避让）：
// 纯 kit 图元程序化生成，与墙身同批合批（每墙十几个 box，零负担），
// 保证无论立面道具 roll 如何，墙面自带纵向节奏与凸出阴影。
// 返回肋体沿墙占用区间，composeRoom 立面摆放器据此避让（不在肋上挂饰）。
function wallRelief(rng, axis, face, u0, u1, openings) {
  const group = new THREE.Group();
  const ribs = [];
  const dim = (along, h, deep) => (axis === 'x' ? [along, h, deep] : [deep, h, along]);
  const place = (obj, u, y, off) => {
    if (axis === 'x') K.put(obj, u, y, face + off);
    else K.put(obj, face + off, y, u);
    group.add(obj);
  };
  // 双腰线：主腰线 + 高檐口（凸出递增），洞口横切处分段
  const bandSegs = [];
  for (const [bandY, bandH, protrude, tone] of [[34, 2.2, 2.4, -0.06], [56, 2.8, 3.2, 0.02]]) {
    const segs = segmentsAroundOpenings(u0, u1, FLOOR_Y + bandY, FLOOR_Y + bandY + bandH,
      openings.map(o => ({ u0: o.u0 - 0.8, u1: o.u1 + 0.8, sill: bandY + 0.2, top: bandY + bandH - 0.2 })));
    for (const s of segs) {
      const len = s.u1 - s.u0;
      const h = s.y1 - s.y0;
      if (len <= 2 || h <= 0.5) continue;
      place(K.box({ color: shade(P.stone, tone), size: dim(len, h, protrude) }),
        (s.u0 + s.u1) / 2, (s.y0 + s.y1) / 2, protrude / 2);
      bandSegs.push({ u0: s.u0, u1: s.u1, y0: s.y0 - FLOOR_Y, y1: s.y1 - FLOOR_Y });
    }
  }
  // 墙裙：贴地横带（压暗、出挑），把墙面从地板里"锚"出来，也给墙根道具一道靠背线
  {
    // 只避让真正与墙裙带（0..5.5）相交的开口（门洞全交→完全绕开；高窗不交→连续通过）
    // 【病灶实录】曾把开口伪造成 {sill:0.3,top:4.8} 再硬摆满高 5.5：分段被无视，门洞被墙裙封死
    const bandY0 = FLOOR_Y; const bandY1 = FLOOR_Y + 5.5;
    const relevant = openings
      .filter(o => FLOOR_Y + o.sill < bandY1 && FLOOR_Y + o.top > bandY0)
      .map(o => ({ u0: o.u0 - 0.8, u1: o.u1 + 0.8, sill: o.sill, top: o.top }));
    const segs = segmentsAroundOpenings(u0, u1, bandY0, bandY1, relevant);
    for (const s of segs) {
      const len = s.u1 - s.u0;
      const h = s.y1 - s.y0;
      if (len <= 2 || h <= 0.2) continue;
      place(K.box({ color: shade(P.wall, -0.14), size: dim(len, h, 3.2) }),
        (s.u0 + s.u1) / 2, (s.y0 + s.y1) / 2, 1.6);
      bandSegs.push({ u0: s.u0, u1: s.u1, y0: s.y0 - FLOOR_Y, y1: s.y1 - FLOOR_Y });
    }
  }
  // 扶壁肋：粗墩（宽 4~6.5 / 深 3.5~5.5 / 高 28~72 大幅断残），间距 24~38 不规则——
  // 读作"残破哥特扶壁"而非等距装饰条。基座出挑压暗、肋身微亮抓光、压顶收亮。
  let u = u0 + 12 + rng() * 12;
  while (u < u1 - 10) {
    const w = 4.2 + rng() * 2.3;
    const clash = openings.some(o => u - w / 2 - 1.2 < o.u1 && u + w / 2 + 1.2 > o.u0);
    if (!clash) {
      const h = 28 + rng() * 44;
      const d = 3.5 + rng() * 2.0;
      place(K.box({ color: shade(P.stone, -0.14), size: dim(w + 1.6, 4, d + 1.6) }), u, FLOOR_Y + 2, (d + 1.6) / 2);
      const shaft = K.box({ color: shade(P.stone, 0.02), size: dim(w, h, d) });
      K.jitter(shaft, rng, { rot: 0.006 });
      place(shaft, u, FLOOR_Y + 4 + h / 2, d / 2);
      place(K.box({ color: shade(P.stone, 0.06), size: dim(w + 1.1, 2, d + 1.1) }), u, FLOOR_Y + 4 + h + 1, (d + 1.1) / 2);
      ribs.push({ u0: u - w / 2 - 0.8, u1: u + w / 2 + 0.8 });
    }
    u += 24 + rng() * 14;
  }
  return { group, ribs, bandSegs };
}

/**
 * 左墙（月光墙，x=-95，沿 z 走向，内侧面朝 +x）。
 * @param windows [{z0,z1,sill,top}] sill/top 为地板相对高度（如 dungeon3D winA/winB）
 * @param skinCfg 配方 wallSkin 段（null = 关皮肤层）
 * @param wallTh  墙厚（默认 12 铁律；隔层等配方可减薄——内侧面不动，外侧面收）
 * @returns {group, windowRects, relief, skin} skin={holes,floorRects,depthAt}（洞 rect 已并入切墙）
 */
export function buildLeftWall(rng, { windows = [], brickChance = 0.4, skinCfg = null, wallTh = WALL_TH } = {}) {
  const group = new THREE.Group();
  group.name = 'wall:left';
  const openings = windows.map(w => ({ u0: w.z0, u1: w.z1, ...w }));
  const innerX = LEFT_WALL_X + WALL_TH / 2;
  const fixedC = innerX - wallTh / 2; // 内侧面恒定 -89，厚度减薄向外收
  // 大起伏：扶壁肋 + 双腰线（内侧面 x=-89，肋体朝 +x 凸出；窗洞避让）
  const relief = wallRelief(rng, 'z', innerX, WALL_Z0 + 6, WALL_Z1 - 8, openings);
  group.add(relief.group);
  // 皮肤层（PCG：bay 类别 + 破损；透穿洞并入切墙 opening，墙后天空直接可见/漏月光）
  let skin = null;
  const skinOpenings = [...openings];
  const skinU = { u0: WALL_Z0 + 6, u1: WALL_Z1 - 8 };
  if (skinCfg) {
    skin = generateWallSkin(rng, skinCfg, {
      ...skinU, side: 'left',
      openings, ribs: relief.ribs, bandSegs: relief.bandSegs,
    });
    for (const h of skin.holes) skinOpenings.push({ u0: h.u0, u1: h.u1, sill: h.y0, top: h.y1 });
    group.add(buildWallSkin(skin, 'z', innerX));
  }
  const segs = segmentsAroundOpenings(WALL_Z0, WALL_Z1, FLOOR_Y, WALL_TOP_Y, skinOpenings);
  wallSegments(group, 'z', fixedC, segs, { th: wallTh, cavity: skinCfg ? skinU : null });
  const windowRects = [];
  for (const w of windows) {
    const zc = (w.z0 + w.z1) / 2;
    const width = w.z1 - w.z0;
    const sillY = FLOOR_Y + w.sill;
    const h = w.top - w.sill;
    // 尖拱石框 + 窗台（面朝 +x）
    const frame = archFrame(width, h, P.stone);
    frame.rotation.y = Math.PI / 2;
    frame.position.set(innerX + 0.4, sillY - 1.4, zc);
    group.add(frame);
    group.add(K.put(K.box({ color: P.stone, size: [3.5, 2, width + 4.5] }), innerX + 0.8, sillY - 1, zc));
    windowRects.push({ z0: w.z0, z1: w.z1, sill: w.sill, top: w.top });
  }

  // 砖面补丁：相机最可见墙，1~2 片（确定性）
  if (rng() < brickChance) {
    const z0 = -70 + rng() * 60;
    group.add(brickPatch(createRng(rng() * 1e9), 'z', innerX + 0.2, z0, FLOOR_Y + 26 + rng() * 18, 4 + Math.floor(rng() * 3), 3));
  }
  if (rng() < brickChance * 0.6) {
    group.add(brickPatch(createRng(rng() * 1e9), 'z', innerX + 0.2, 20 + rng() * 40, FLOOR_Y + 8 + rng() * 10, 3, 2));
  }
  return { group, windowRects, relief: relief.ribs, skin };
}

/**
 * 背墙（素墙，z=-80，沿 x 走向，内侧面朝 +z，x 从 -93 到 140——左端止于左墙内侧面，
 * 绝不探过左墙挡住窗洞夜空）。门洞为真洞（黑 + 石框 + 踏步），窄缝窗为假 recessed。
 * @param door {x,w,h} | null 尖拱门洞（消耗若干 bay）
 * @param slits [{x,y}] 窄缝窗（贴墙暗槽 + 铁栅，不开洞）
 * @param skinCfg 配方 wallSkin 段（null = 关皮肤层）
 */
export function buildBackWall(rng, { door = null, slits = [], brickChance = 0.5, skinCfg = null, wallTh = WALL_TH } = {}) {
  const group = new THREE.Group();
  group.name = 'wall:back';
  const x0 = FLOOR_X0 - 4; // -93：伸进左墙 4，封住两墙交角
  const fixedC = BACK_WALL_Z - wallTh / 2; // 内侧面恒定 -80，厚度减薄向外收
  const openings = door ? [{ u0: door.x - door.w / 2, u1: door.x + door.w / 2, sill: 0, top: door.h }] : [];
  // 大起伏：扶壁肋 + 双腰线（内侧面 z=-80，肋体朝 +z 凸出；门洞避让）
  const relief = wallRelief(rng, 'x', BACK_WALL_Z, x0 + 4, FLOOR_X1 - 4, openings);
  group.add(relief.group);
  // 皮肤层（背墙洞低频且偏右上半墙；窄缝窗作附加避让）
  let skin = null;
  const skinOpenings = [...openings];
  const skinU = { u0: x0 + 4, u1: FLOOR_X1 - 4 };
  if (skinCfg) {
    skin = generateWallSkin(rng, skinCfg, {
      ...skinU, side: 'back', openings,
      avoid: slits.map(s => ({ u0: s.x - 3, u1: s.x + 3, y0: s.y - 7.5, y1: s.y + 7 })),
      ribs: relief.ribs, bandSegs: relief.bandSegs,
    });
    for (const h of skin.holes) skinOpenings.push({ u0: h.u0, u1: h.u1, sill: h.y0, top: h.y1 });
    group.add(buildWallSkin(skin, 'x', BACK_WALL_Z));
  }
  const segs = segmentsAroundOpenings(x0, FLOOR_X1, FLOOR_Y, WALL_TOP_Y, skinOpenings);
  wallSegments(group, 'x', fixedC, segs, { th: wallTh, cavity: skinCfg ? skinU : null });

  if (door) {
    // 方形门洞（体素墙洞口是矩形，门视觉件同形——用户定 2026-09）
    const doorVoid = rectVoid(door.w, door.h);
    doorVoid.position.set(door.x, FLOOR_Y, BACK_WALL_Z + 0.4);
    group.add(doorVoid);
    const frame = rectFrame(door.w, door.h, P.stone);
    frame.position.set(door.x, FLOOR_Y - 1.4, BACK_WALL_Z + 0.9);
    group.add(frame);
    // 门内踏步：三级台阶向下没入黑暗（纵深感）
    for (let i = 0; i < 3; i++) {
      group.add(K.put(
        K.box({ color: shade(P.night, 0.1 + i * 0.07), size: [door.w - 2 - i * 1.6, 1.1, 2.2], family: 'unlit' }),
        door.x, FLOOR_Y - 0.4 - i * 1.2, BACK_WALL_Z + 1.2 + i * 1.8,
      ));
    }
  }

  for (const s of slits) {
    group.add(K.put(K.box({ color: P.night, size: [3.6, 13, 1], family: 'unlit' }), s.x, FLOOR_Y + s.y, BACK_WALL_Z + 0.5));
    for (let i = -1; i <= 1; i++) {
      group.add(K.put(K.box({ color: P.iron, size: [0.7, 13, 0.8], family: 'metal' }), s.x + i * 1.1, FLOOR_Y + s.y, BACK_WALL_Z + 1));
    }
    group.add(K.put(K.box({ color: P.stone, size: [5.5, 1.6, 2.5] }), s.x, FLOOR_Y + s.y - 7.2, BACK_WALL_Z + 1.2));
  }

  if (rng() < brickChance) {
    group.add(brickPatch(createRng(rng() * 1e9), 'x', BACK_WALL_Z + 0.9, -60 + rng() * 90, FLOOR_Y + 28 + rng() * 14, 5, 3));
  }
  return { group, door, relief: relief.ribs, skin };
}
