// propKit 材质族（WORKFLOW §2.2）：按表面属性分族的共享材质 + 顶点色。
// 六族 stone/wood/metal/glass/frost/cloth + unlit（火焰/暗槽等不吃光的发色体）。
// 族单例 M.* 一律 vertexColors + flatShading——颜色画进顶点（primitives 统一烘焙），
// 同族静态道具可合并为一个 draw call（merge.js）。**族单例是进程级共享物，禁 dispose**。
// 材质族即预算口径：单件资产 ≤ 3 族（契约测试按 userData.kitFamily 计数）。

import * as THREE from 'three';

export const FAMILIES = ['stone', 'wood', 'metal', 'glass', 'frost', 'cloth', 'unlit'];

const DEFS = {
  stone: { kind: 'std', roughness: 0.95 },
  wood: { kind: 'std', roughness: 0.85 },
  metal: { kind: 'std', roughness: 0.6, metalness: 0.4 },
  glass: { kind: 'std', roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.62 },
  // 磨砂玻璃（frost）：**大面积近景透明面**专用。glass 族的低粗糙度是给远景小件（药瓶/
  // 水洼/窗格）的，用在玩家 zoom-in 正对的大块柜门上会把灯池照成一片白斑（眩光/脏污感，
  // 用户 2026-09-13 报「售货机玻璃反光太干扰视觉」）。这里 roughness 拉满、metalness 归零
  // = 只留柔和透光渐变、几乎不反高光；透明口径与 glass 族一致。
  frost: { kind: 'std', roughness: 0.95, metalness: 0, transparent: true, opacity: 0.62 },
  cloth: { kind: 'std', roughness: 1, side: THREE.DoubleSide },
  unlit: { kind: 'basic', fog: false },
};

function makeMaterial(name) {
  const d = DEFS[name];
  const m = d.kind === 'std'
    ? new THREE.MeshStandardMaterial({ roughness: d.roughness, flatShading: true, vertexColors: true })
    : new THREE.MeshBasicMaterial({ fog: !!d.fog && d.fog, vertexColors: true });
  if (d.metalness !== undefined) m.metalness = d.metalness;
  if (d.transparent) { m.transparent = true; m.opacity = d.opacity; }
  if (d.side !== undefined) m.side = d.side;
  m.userData.kitFamily = name;
  return m;
}

// 族单例（vertexColors 路径：道具/合并用）
export const M = Object.freeze(Object.fromEntries(FAMILIES.map(f => [f, makeMaterial(f)])));

/** 取族单例（未知族抛错）。 */
export function materialOf(family) {
  const m = M[family];
  if (!m) throw new Error(`materials: 未知材质族 "${family}"（可选：${FAMILIES.join('/')}）`);
  return m;
}

/**
 * 旧场景收敛工厂：从族参数派生一个**带颜色**的独立材质（vertexColors 关闭）。
 * 供尚未走顶点色管线的存量场景（dungeon3D 等）把散装 MeshStandardMaterial 迁进族内——
 * 族参数（roughness/metalness/DoubleSide/fog）归 kit 单一来源，颜色留在调用方。
 * 返回克隆（随场景释放，与族单例无关）。
 */
export function familyMaterial(family, { color, opacity } = {}) {
  const base = materialOf(family);
  const m = base.clone();
  m.vertexColors = false;
  if (color !== undefined) m.color.set(color);
  if (opacity !== undefined) { m.transparent = true; m.opacity = opacity; }
  m.userData.kitFamily = family;
  m.userData.kitLegacyClone = true;
  return m;
}
