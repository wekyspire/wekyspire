// 六边形能量硬化装甲（hexShield，L2 壳件，MEFM-1 签名件）：
// 「这台机器的防御不是铁板，是一层蜂窝力场」——剪影内铺六边形网格，格缝发光；
// 慢速脉冲波斜向扫过（力场在循环自检）；受击 = 命中点扩散的涟漪把沿途格缝点亮；
// 转阶段碎裂 = 每格按自身 hash 延迟脱落、向外飞散消隐。
// 口径：buildColor 走 bossStateFx 的 makeShellPiece 基座（剪影纪律/自愈重绑/level
// 缓动全在基座）；enter 扫掠自下而上（front 与 level 耦合，同 stasisShell 约定）。
// TSL 纪律：颜色烘常量 vec3（不走 Color uniform）；逐帧标量才用 float uniform；
// 多引中间量一律 .toVar()；节点与 JS 数不许直接混算（一律 .mul()/.add()）。
import * as THREE from 'three';
import { Fn, uniform, uv, vec2, vec3, vec4, abs, dot, exp, fract, sin, floor, select, clamp, max, step, smoothstep, oneMinus } from 'three/tsl';
import { makeShellPiece, shellMask } from './bossStateFx.js';
import { ubfHash, ubfNoise } from './unitBodyFx.js';

const DENS = 7.0; // 纵向格数
const H_R = vec2(1.0, 1.7320508); // 平铺周期（pointy-top 近似）

// 蜂窝度量：gv = 格内局部坐标；d ∈ [0, 0.5]，0.5 = 格界（pointy-top：竖直边 |x|=0.5，
// 斜边 dot(|p|,(0.5,0.866))=0.5——方向写反会渲染成三角/菱形格，验收已栽）
const hexDist = Fn(([gv]) =>
  max(abs(gv.x), dot(vec2(abs(gv.x), abs(gv.y)), vec2(0.5, 0.8660254))));

// 平铺取最近格心：返回 vec4(gv.xy, cellId.xy)
const hexTile = Fn(([p]) => {
  const a = p.sub(floor(p.div(H_R)).mul(H_R)).sub(H_R.mul(0.5)).toVar();
  const pOff = p.sub(H_R.mul(0.5)).toVar();
  const b = pOff.sub(floor(pOff.div(H_R)).mul(H_R)).sub(H_R.mul(0.5)).toVar();
  const gv = select(dot(a, a).lessThan(dot(b, b)), a, b).toVar();
  return vec4(gv, p.sub(gv));
});

/**
 * MEFM 装甲着色链。u = 基座 uniforms + { uAspect, uHitPos, uHitT, uShatter }。
 * 色板：钢青主色 + 近白热核（涟漪/enter 前锋段推 HDR 起晕）。
 */
function buildHexColor(t, u) {
  return Fn(() => {
    const vUv = uv();
    const { sa, rim } = shellMask(t, u);
    const gridScale = vec2(u.uAspect.mul(DENS), DENS);
    const p = vUv.mul(gridScale).toVar();

    // —— 蜂窝格（未位移）：cellId 供 per-cell hash ——
    const tile = hexTile(p).toVar();
    const cellId = vec2(tile.z, tile.w).toVar();
    const cellRnd = ubfHash(cellId).toVar();

    // —— 碎裂位移：每格按 hash 延迟启动、向外+下坠飞散；图案在位移后的坐标重评 ——
    const sProg = clamp(u.uShatter.sub(cellRnd.mul(0.4)).div(0.55), 0.0, 1.0).toVar();
    const cellC = cellId.div(gridScale); // 格心回 uv 空间
    const outDir = vec2(
      cellC.x.sub(0.5).add(cellRnd.sub(0.5).mul(0.6)),
      cellC.y.sub(0.42).add(fract(cellRnd.mul(7.31)).sub(0.5).mul(0.6)),
    ).toVar();
    const disp = outDir.mul(sProg.mul(0.4)).add(vec2(0.0, sProg.mul(sProg).mul(-0.3)));
    const tile2 = hexTile(p.sub(disp.mul(gridScale))).toVar();
    const d = hexDist(vec2(tile2.x, tile2.y)).toVar();
    const edge = smoothstep(0.415, 0.49, d).toVar(); // 格缝带（窄：缝线发光，不是格面发光）
    const cellFade = oneMinus(smoothstep(0.3, 0.85, sProg)).toVar(); // 脱落淡出

    // —— 常驻：格缝微光 + 斜扫自检脉冲 + 呼吸 ——
    // 低频滚动噪声门：idle 只许缓慢漂移的稀疏斑块显形（力场大部分区域待机熄灭）；
    // 受击涟漪/enter 前锋不走这扇门——受击脉冲到达处格缝才充能发亮
    const sweep = sin(vUv.x.mul(u.uAspect).add(vUv.y).mul(4.2).sub(u.uTime.mul(0.7))).mul(0.5).add(0.5);
    const sweepBoost = smoothstep(0.72, 1.0, sweep).mul(0.5);
    const breathe = sin(u.uTime.mul(1.15)).mul(0.12).add(0.88);
    const nIdle = ubfNoise(vUv.mul(vec2(u.uAspect, 1.0)).mul(2.6)
      .add(vec2(u.uTime.mul(0.06), u.uTime.mul(-0.045)))).toVar();
    const idleGate = smoothstep(0.55, 0.75, nIdle).toVar();
    const baseGlow = edge.mul(breathe.mul(0.55).add(sweepBoost)).mul(idleGate).toVar();
    const fillIdle = idleGate.mul(0.05).toVar(); // 格面极淡填充（同门控；厚过缝线就糊成发光棋盘）
    const rimGate = rim.mul(idleGate.mul(0.85).add(0.08)).toVar(); // 收束线留一丝底线读剪影

    // —— 受击涟漪：命中点环形波前爆亮 + 全网格短促一颤 ——
    const age = u.uTime.sub(u.uHitT);
    const dist = vUv.sub(u.uHitPos).mul(vec2(u.uAspect, 1.0)).length();
    const ringD = dist.sub(age.mul(1.7)).mul(7.0);
    const wave = exp(ringD.mul(ringD).mul(-1.0)).mul(exp(age.mul(-2.6))).mul(step(0.0, age)).toVar();
    const flinch = exp(age.mul(-5.0)).mul(step(0.0, age)).mul(0.55).toVar();

    // —— enter 扫掠（结晶前锋同构）：front 以下生效，前锋挂亮线 ——
    const front = u.uLevel.mul(1.15).toVar();
    const swept = oneMinus(smoothstep(front.sub(0.18), front.add(0.03), vUv.y));
    const frontLine = oneMinus(smoothstep(0.0, 0.05, abs(vUv.y.sub(front))))
      .mul(oneMinus(step(1.14, front)));

    // —— 合成 ——（缝线是能量主体：高饱和青 + 微过阈，灰白 = 没电）
    const EDGE_COL = vec3(0.25, 0.85, 1.2);
    const HOT_COL = vec3(1.15, 1.6, 1.85);
    const glow = baseGlow.add(wave.mul(edge.add(0.25))).add(flinch.mul(edge)).toVar();
    const c = EDGE_COL.mul(glow.mul(1.4))
      .add(EDGE_COL.mul(fillIdle))
      .add(HOT_COL.mul(wave.mul(edge).mul(1.6)))
      .add(HOT_COL.mul(frontLine.mul(1.5)))
      .add(EDGE_COL.mul(rimGate.mul(0.9)));
    const alphaBody = max(sa, rim.mul(0.9));
    const alpha = u.uLevel.mul(clamp(
      glow.mul(0.8).add(fillIdle).add(rimGate.mul(0.5)).add(wave.mul(0.5)).add(frontLine),
      0.0, 1.0).mul(alphaBody)).mul(swept).mul(cellFade).toVar();
    return vec4(c.mul(alphaBody), alpha);
  })();
}

/**
 * 在宿主层建六边形能量装甲。
 * @param {UnitFxLayer} layer
 * @param {object} [o]
 * @param {number} [o.aspect] 立牌宽高比（涟漪正圆校正；缺省 0.62）
 * @returns 句柄 + { impact(nx,ny), shatter() }（headless → null）
 */
export function makeHexShield(layer, { aspect = 0.62 } = {}) {
  let shattering = false;
  const h = makeShellPiece(layer, {
    name: 'hexShield',
    z: 0.84,
    makeUniforms: (u) => {
      u.uAspect = uniform(aspect);
      u.uHitPos = uniform(new THREE.Vector2(0.5, 0.55));
      u.uHitT = uniform(-100); // 上次受击时刻（共享 uTime 钟；-100 = 从未受击）
      u.uShatter = uniform(0);
    },
    buildColor: buildHexColor,
    onTick: (dt, hh) => {
      // 碎裂自推进：~0.9s 走完；走完后把 level 目标归零（收尸靠基座缓动+隐藏）
      if (!shattering) return;
      hh.u.uShatter.value += dt / 0.9;
      if (hh.u.uShatter.value >= 1.25) hh.setLevel(0);
    },
  });
  if (!h) return null;
  /** 受击涟漪：nx/ny = 命中点的立绘归一坐标（0..1）。 */
  h.impact = (nx = 0.5, ny = 0.55) => {
    h.u.uHitPos.value.set(Math.max(0, Math.min(1, nx)), Math.max(0, Math.min(1, ny)));
    h.u.uHitT.value = h.u.uTime.value;
  };
  /** 转阶段碎裂：一次性（不可逆；重复调用不重启）。 */
  h.shatter = () => { shattering = true; };
  return h;
}
