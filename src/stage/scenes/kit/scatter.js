// propKit 种子化撒布（WORKFLOW §2.4）：确定性 rng + keepout 拒绝采样。
// 同一种子恒定产出同一布局（回放/测试可复现）；道具永远不许进战场/站位——
// keepout（battleLine 走廊 + 全部 slots）由房型配方层组装后经 avoid 传入，scatter 硬拒。

/**
 * 确定性 rng（mulberry32）：种子可为 number 或 string（字符串按 FNV-1a 哈希）。
 * scenes 层不 import core，种子工具就地实现。
 */
export function createRng(seed) {
  let a;
  if (typeof seed === 'string') {
    a = 0x811c9dc5;
    for (let i = 0; i < seed.length; i++) {
      a ^= seed.charCodeAt(i);
      a = Math.imul(a, 0x01000193) >>> 0;
    }
  } else {
    a = seed >>> 0;
  }
  if (a === 0) a = 0x9e3779b9;
  return function rng() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const inRect = (x, z, r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

/**
 * 撒点：在 area 内拒绝采样 count 个点，逐点校验 keepout（avoid 矩形）与点间距。
 * 宁缺毋滥——采样失败（超出 tries）就少放，绝不挤进红线。
 * @returns {{x:number, z:number, rot:number, scale:number}[]} 实际点数 ≤ count
 */
export function scatter(rng, {
  count,
  area,
  avoid = [],
  spacing = 0,
  scaleRange = [0.85, 1.15],
  tries = 24,
}) {
  const pts = [];
  for (let n = 0; n < count; n++) {
    let ok = false;
    for (let t = 0; t < tries && !ok; t++) {
      const x = area.x0 + rng() * (area.x1 - area.x0);
      const z = area.z0 + rng() * (area.z1 - area.z0);
      if (avoid.some(r => inRect(x, z, r))) continue;
      if (spacing > 0 && pts.some(p => Math.hypot(p.x - x, p.z - z) < spacing)) continue;
      pts.push({
        x, z,
        rot: rng() * Math.PI * 2,
        scale: scaleRange[0] + rng() * (scaleRange[1] - scaleRange[0]),
      });
      ok = true;
    }
  }
  return pts;
}
