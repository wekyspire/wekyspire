// 世界空间雷电件（卡达斯签名）：真 3D 折线雷画在**面向镜头的面片**上，
// 白热内核推过 bloom 阈（1.45）出真正的电光晕，而不是在立牌表面贴一层纹样。
//
// 形体口径（fragment 主笔，几何只做四顶点定向）：
//   · 主折线 = 三频 sin（大弯 / 碎折 / 细毛）× 端点锚定包络——uTime 离散重掷
//     （jolt）让折点换相，读「电在跳」而不是「纹在飘」；
//   · 第二细股 + 中段斜向分叉（距离场短枝）——电的毛边与分叉；
//   · 截面双层：白热内核（窄、HDR）+ 蓝电晕（宽）+ 淡电帷幕；
//   · 首尾粗细包络：leaf 让中段鼓、两端收细（爪痕的柳叶形）；end 让靶端更细
//     （放电锥形）——收细在 uv 横向坐标上除包络实现，内核/电晕同步收；
//   · 生长 = uState.y（prog）沿 v 推进 + 头部亮斑（爪痕/天雷的「出手」）；
//   · 面片四顶点直写世界端点（截面 = 航线 × 视向），DoubleSide + 真深度测试
//     （在立牌后面的弧被本体挡住 = 绕体感，不是一层浮在身上的 mask）。
// 常驻雷暴（makePlasmaStorm）挂 _rig（yaw 对镜头），锚点围绕身体与地面；
// 一次性件（爪痕/迸裂/天雷/雷环）挂 scene，走 ctx 生命周期。
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Fn, uniform, uv as uvOf, vec2, vec3, vec4, float, exp, sin, atan, pow,
  smoothstep, oneMinus, abs, length, max, floor, fract,
} from 'three/tsl';
import { additiveLight } from '../post/passes.js';

// 电色（烘常量：白热核偏冷蓝 + 深蓝电晕；HDR 由乘算推过 bloom 阈）
const CORE = vec3(3.0, 3.7, 5.6);
const HALO = vec3(0.34, 0.80, 2.30);

/**
 * 折线雷着色（vec4，加色直出）。Fn 4 参纪律，参数打包：
 *   uSeed  = (相位, leaf 中段鼓胀指数, end 靶端收细量, tip 端点亮斑强度)
 *   uState = (淡出, 生长进度, 亮度, wave 波形横向幅度)
 * 色参常量 vec3 烘进节点图（Color uniform 跨会话非确定，见 TSL 坑全集）。
 */
export const boltShade = Fn(([vUv, uTime, uSeed, uState, uMisc]) => {
  const fade = uState.x;
  const prog = uState.y;
  const energy = uState.z;
  const wave = uState.w;
  const tail = uMisc.x;   // 激发窗长度（沿 v，1 = 整根；0.6~1）
  const seed = uSeed.x;
  const leafP = uSeed.y;
  const endK = uSeed.z;
  const tipK = uSeed.w;
  const p = vUv.sub(vec2(0.5));
  const v = p.y.add(float(0.5));               // 0(源)→1(靶)
  const anchor = sin(v.mul(float(Math.PI)));   // 端点锚定：弧不脱锚
  // 流动感：每段折线独立时序（电流在段间跳）+ 一道沿弧行进的电流前锋
  const band = v.mul(20.0);
  const bandNo = floor(band);
  const bandF = fract(band);
  const bandPh = bandNo.mul(2.1).add(seed.mul(3.7));
  const flickA = sin(uTime.mul(1.5).add(bandPh));
  const flickB = sin(uTime.mul(1.5).add(bandPh).add(2.1));
  const bandMix = smoothstep(0.15, 0.85, bandF);   // 段间平滑过渡（不出硬切口）
  const segFlick = flickA.mul(oneMinus(bandMix)).add(flickB.mul(bandMix)).mul(0.5).add(0.5);
  const flowGain = float(0.86).add(segFlick.mul(0.12));
  const tp = fract(uTime.mul(1.2).add(seed.mul(0.11)));
  const td = v.sub(tp);
  // 电流前锋是沿弧的**窄**亮带（mask 口径：半宽 ~3% 弧长），不是整段泛亮
  const travel = exp(td.mul(td).mul(-900.0)).mul(0.4);
  // 首尾粗细包络：leaf 中段鼓胀（叶形），end 让靶端细于源端（锥形）。
  // 着色距离除以包络 = 内核/电晕/帷幕一起收细；下限防零宽奇点。
  const leaf = pow(max(anchor, float(0.0001)), leafP);
  const env = max(leaf.mul(float(1.0).sub(v.mul(endK))), float(0.05));
  const inv = float(1.0).div(env);
  // 主折线：三频叠加。uTime 由编排离散重掷（jolt）——折点是「跳变」不是滑动
  const jit = sin(v.mul(11.7).add(uTime.mul(5.3)).add(seed))
    .mul(0.58)
    .add(sin(v.mul(26.9).add(uTime.mul(9.1)).add(seed.mul(1.7))).mul(0.27))
    .add(sin(v.mul(53.3).add(uTime.mul(15.7)).add(seed.mul(2.3))).mul(0.10));
  const off = jit.mul(anchor).mul(0.135).mul(wave);
  const dxC = p.x.sub(off).mul(inv);
  const core = exp(dxC.mul(dxC).mul(-1500.0));  // 白热核（窄）
  const halo = exp(dxC.mul(dxC).mul(-95.0));    // 蓝电晕（宽）
  const veil = exp(dxC.mul(dxC).mul(-15.0)).mul(0.10); // 淡电帷幕（体积感）
  // 第二细股（异相低强）：电的毛边。贴主折线近一点、弱一点——离远了会读成第二道爪痕
  const off2 = sin(v.mul(20.3).add(uTime.mul(13.7)).add(seed.mul(3.1)))
    .mul(anchor).mul(0.062).mul(wave);
  const dxB = p.x.sub(off2).mul(inv);
  const strand = exp(dxB.mul(dxB).mul(-3200.0)).mul(0.30);
  // 端点热斑：贴**真端点**（面片两端各外扩 6%，真端点在 uv ±0.446，不是 ±0.5——
  // 亮斑落在 ±0.5 会被边缘熄灭裁成半只、并浮在锚点外侧一截）
  const rS = length(vec2(p.x, p.y.add(float(0.446))));
  const rT = length(vec2(p.x, p.y.sub(float(0.446))));
  const tipS = exp(rS.mul(rS).mul(-420.0));
  const tipT = exp(rT.mul(rT).mul(-420.0)).mul(smoothstep(float(0.65), float(1.0), prog));
  // 激发窗：前沿之前是未激发段（不可见），后沿之后是已激发段（消隐）。
  // prog 先 0→1 画满整根，再 1→1+tail 从源端逐段退场——出现/消失都沿弧流动。
  const visHead = oneMinus(smoothstep(prog.sub(float(0.035)), prog.add(float(0.008)), v));
  const visTail = smoothstep(prog.sub(tail).sub(float(0.10)), prog.sub(tail), v);
  const vis = visHead.mul(visTail);
  const headDx = v.sub(prog);
  const head = exp(headDx.mul(headDx).mul(-1300.0))
    .mul(oneMinus(smoothstep(float(0.94), float(1.0), prog)));
  // 纵向软尾：弧线在两端**渐隐**（不是被面片边缘 mask 切平）——短弧/爪痕的
  // 头尾不会出现「一刀切」；端点亮斑单独保留（爆点/触点仍可闪）
  const ends = smoothstep(float(0.015), float(0.13), v)
    .mul(oneMinus(smoothstep(float(0.87), float(0.985), v)));
  // 边缘熄灭（面片直边不切亮缝）：y 向只压 6% 外扩余量，不碰可见端点
  const edge = oneMinus(smoothstep(float(0.40), float(0.50), abs(p.x)))
    .mul(oneMinus(smoothstep(float(0.47), float(0.50), abs(p.y))));
  const flick = sin(uTime.mul(67.0)).mul(0.11).add(0.89);
  const hot = core.mul(flowGain).add(strand.mul(0.75)).add(head.mul(0.85)).add(travel);
  const tips = tipS.mul(0.9).add(tipT.mul(1.45)).mul(tipK);
  const line = CORE.mul(hot.mul(1.9))
    .add(HALO.mul(halo.mul(flowGain).mul(0.42).add(veil)))
    .mul(ends);
  const rgb = line.add(CORE.mul(tips));
  return vec4(rgb.mul(flick).mul(energy).mul(fade).mul(vis).mul(edge), float(1.0));
});

/**
 * 建一套雷电材质与驱动 uniform（一材质可共享给多根同组弧）。
 * o.wave  = 波形横向幅度（按面片宽度归一：长弧/宽面片要给大一点才不读成直杆）
 * o.leaf  = 中段鼓胀指数（0 = 不用；爪痕 0.5 左右 = 中间粗两头细）
 * o.end   = 靶端收细量（0.3 = 靶端仅有源端 70% 粗细；首尾粗细不同的主旋钮）
 * o.tip   = 端点热斑强度（0 = 无端点光球；常驻雷暴用很小的值）
 */
export function makeBoltMaterial({ wave = 0.35, leaf = 0, end = 0.28, tip = 0.35, tail = 1 } = {}) {
  const uTime = uniform(Math.random() * 100);
  const uSeed = uniform(new THREE.Vector4(Math.random() * 6.28 + 0.01, leaf, end, tip));
  const uState = uniform(new THREE.Vector4(1, 1, 1, wave));
  const uMisc = uniform(new THREE.Vector4(tail, 0, 0, 0));
  const mat = additiveLight(new MeshBasicNodeMaterial({
    transparent: true, depthWrite: false, depthTest: true, fog: false, side: THREE.DoubleSide,
  }));
  mat.colorNode = boltShade(uvOf(), uTime, uSeed, uState, uMisc);
  return { mat, uTime, uSeed, uState, uMisc };
}

/** 写演出状态（保留 uState.w 的波形幅度，调用点不必知道第四分量约定）。 */
export function setBoltState(m, fade, prog, energy) {
  m.uState.value.set(fade, prog, energy, m.uState.value.w);
}

// 条带行数：折线折点**烘进几何**（33 行 × 2 列）。shader 里的抖动只是微颤——
// 长弧的大摆幅不能按面片宽度比例算，否则要加宽光晕容器才能抖；几何折线按
// 世界尺度走，光晕宽度与摆幅解耦。
const BOLT_SEGS = 32;
const BOLT_ROWS = BOLT_SEGS + 1;

function makeBoltGeometry() {
  const n = BOLT_ROWS;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  const idx = new Uint16Array((n - 1) * 6);
  for (let i = 0; i < n; i++) {
    const v = i / (n - 1);
    uv[i * 4 + 0] = 0; uv[i * 4 + 1] = v;
    uv[i * 4 + 2] = 1; uv[i * 4 + 3] = v;
    if (i < n - 1) {
      const a = i * 2, j = i * 6;
      idx[j] = a; idx[j + 1] = a + 1; idx[j + 2] = a + 2;
      idx[j + 3] = a + 1; idx[j + 4] = a + 3; idx[j + 5] = a + 2;
    }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}

const _bv = new THREE.Vector3();
const _bd = new THREE.Vector3();
/**
 * 单根雷条带：四顶点升级成 33 行折线（中点位移生成大折→碎折），端点直写世界
 * 坐标、截面轴 = 局部航线 × 视向（面向镜头）。
 * @returns {{dir:THREE.Vector3, lateral:THREE.Vector3, dist:number, at:(t)=>THREE.Vector3,
 *   latAt:(t)=>THREE.Vector3}} 主折线信息（分支从中心线取点用；返回向量勿改）
 */
export function setBoltQuad(mesh, from, to, width, viewDir = null, {
  amp = 0.09, taper = 0, fine = 0.12,
} = {}) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const dist = Math.hypot(dx, dy, dz) || 1;
  const ux = dx / dist, uy = dy / dist, uz = dz / dist;
  const vx = viewDir?.x ?? 0, vy = viewDir?.y ?? 0, vz = viewDir?.z ?? 1;
  // 全局横向轴：航线 × 视向（相机朝向时 ≈ 屏幕横向）
  let lx = uy * vz - uz * vy, ly = uz * vx - ux * vz, lz = ux * vy - uy * vx;
  let ll = Math.hypot(lx, ly, lz);
  if (ll < 1e-4) { lx = uy; ly = -ux; lz = 0; ll = Math.hypot(lx, ly) || 1; }
  lx /= ll; ly /= ll; lz /= ll;
  const ext = dist * 0.06;   // 轴向余量：shader 边缘熄灭/端点亮斑的补偿量
  const L = dist + ext * 2;
  const ax = from.x - ux * ext, ay = from.y - uy * ext, az = from.z - uz * ext;
  const n = BOLT_ROWS;
  const cache = mesh.userData._bolt ?? (mesh.userData._bolt = {
    pts: Array.from({ length: n }, () => new THREE.Vector3()),
    lats: Array.from({ length: n }, () => new THREE.Vector3()),
    offs: new Float32Array(n),
  });
  const { pts, lats, offs } = cache;
  const ampW = dist * amp;
  offs.fill(0);
  // 中点位移：层级越浅折得越大（大折→碎折），两端锚定不回弹
  const rec = (i0, i1, level) => {
    if (i1 - i0 < 2) return;
    const mid = (i0 + i1) >> 1;
    offs[mid] = (offs[i0] + offs[i1]) * 0.5
      + (Math.random() * 2 - 1) * ampW * Math.pow(0.58, level);
    rec(i0, mid, level + 1);
    rec(mid, i1, level + 1);
  };
  rec(0, n - 1, 0);
  for (let i = 1; i < n - 1; i++) offs[i] += (Math.random() * 0.5 - 0.25) * ampW * fine;
  const pos = mesh.geometry.attributes.position;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const p = pts[i];
    p.set(
      ax + ux * L * t + lx * offs[i],
      ay + uy * L * t + ly * offs[i],
      az + uz * L * t + lz * offs[i],
    );
    // 局部宽度轴：用前后点算局部航线，折点处截面不剪切
    const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
    _bd.copy(pts[i1]).sub(pts[i0]);
    if (_bd.lengthSq() < 1e-8) _bd.set(ux, uy, uz); else _bd.normalize();
    _bv.set(_bd.y * vz - _bd.z * vy, _bd.z * vx - _bd.x * vz, _bd.x * vy - _bd.y * vx);
    let bl = _bv.length();
    if (bl < 1e-4) _bv.set(lx, ly, lz); else _bv.divideScalar(bl);
    // 局部横向轴与全局轴保持同向：大折点处局部方向转过 90° 会让横向轴翻面，
    // 条带自交成蝴蝶结（加法叠加 = 一团白斑）。
    if (_bv.x * lx + _bv.y * ly + _bv.z * lz < 0) _bv.negate();
    lats[i].copy(_bv);
    const hw = (width * 0.5) * (1 - taper * t);
    pos.setXYZ(i * 2, p.x + lats[i].x * hw, p.y + lats[i].y * hw, p.z + lats[i].z * hw);
    pos.setXYZ(i * 2 + 1, p.x - lats[i].x * hw, p.y - lats[i].y * hw, p.z - lats[i].z * hw);
  }
  pos.needsUpdate = true;
  mesh.frustumCulled = false;   // 顶点铺到端点，原包围球会把整件裁掉
  const idxAt = (t) => Math.max(0, Math.min(n - 1, Math.round(t * (n - 1))));
  return {
    dir: new THREE.Vector3(ux, uy, uz),
    lateral: new THREE.Vector3(lx, ly, lz),
    dist,
    at: (t) => pts[idxAt(t)],
    latAt: (t) => lats[idxAt(t)],
  };
}

export function makeBoltMesh(material, name = 'spellFx:plasmaBolt') {
  const mesh = new THREE.Mesh(makeBoltGeometry(), material.mat);
  mesh.name = name;
  mesh.renderOrder = 12;   // 压过立绘（0），让位状态层（60+）/粒子
  mesh.frustumCulled = false;
  return mesh;
}

const _camPos = new THREE.Vector3();
const _camDir = new THREE.Vector3();
/** 面片朝向用视向（相机 → 中点）；无相机（headless/点播）回落 +z。 */
export function viewDirOf(camera, at) {
  if (!camera || typeof camera.getWorldPosition !== 'function') return new THREE.Vector3(0, 0, 1);
  camera.getWorldPosition(_camPos);
  camera.getWorldDirection(_camDir);
  // 用相机位置到落点，弧的横向轴才与屏幕平行；退化时用相机朝向
  const target = new THREE.Vector3(at.x, at.y, at.z ?? 0);
  const v = target.sub(_camPos);
  if (v.lengthSq() < 1e-4) return _camDir.clone().negate();
  return v.normalize();
}

/**
 * 从主折线甩出一根小分叉（独立条带：起点落在主线上、自身也带折线、按长度收细）。
 * 收回主线的真实点位由调用方按主条带 info 取——分叉是真几何，不是着色器里画的假枝。
 */
export function placeBranch(mesh, info, mainWidth, viewDir, {
  t = 0.5, lenK = 0.2, widthK = 0.38, amp = 0.16, spread = 0.85,
} = {}) {
  const p = info.at(t).clone();
  const lat = info.latAt(t);
  const sign = Math.random() < 0.5 ? -1 : 1;
  const dir = info.dir.clone().multiplyScalar(0.5).addScaledVector(lat, sign * spread);
  dir.y += (Math.random() - 0.5) * 0.3;
  if (dir.lengthSq() < 1e-6) dir.copy(lat).multiplyScalar(sign || 1);
  dir.normalize();
  const end = p.clone().addScaledVector(dir, info.dist * lenK);
  setBoltQuad(mesh, p, end, mainWidth * widthK, viewDir, { amp, taper: 1 });
  return { from: p, to: end };
}

/** 一次性雷组：同一材质下的多根弧（爪痕/迸裂/天雷），共享生长与淡出。 */
export function boltGroup(ctx, deps, bolts, {
  lifeMs = 220, reachMs = 70, energy = 1.1, name = 'spellFx:plasmaBolt', viewAt = null,
  wave = 0.35, leaf = 0, end = 0.28, tip = 0.35, tail = 1,
  amp = 0.085, branches = 0, branchLenK = [0.14, 0.28], branchWidthK = [0.3, 0.5],
} = {}) {
  const m = makeBoltMaterial({ wave, leaf, end, tip, tail });
  m.uTime._t0 = m.uTime.value;
  setBoltState(m, 1, 0, energy);
  const view = viewAt ? viewDirOf(deps.renderCamera ?? deps.camera, viewAt) : null;
  const meshes = [];
  for (const b of bolts) {
    const vdir = b.view ?? view;
    const mesh = makeBoltMesh(m, name);
    const info = setBoltQuad(mesh, b.from, b.to, b.width, vdir, { amp: b.amp ?? amp });
    deps.scene.add(mesh);
    meshes.push(mesh);
    for (let k = 0; k < branches; k++) {
      const bm = makeBoltMesh(m, `${name}:branch`);
      deps.scene.add(bm);
      meshes.push(bm);
      placeBranch(bm, info, b.width, vdir, {
        t: 0.26 + Math.random() * 0.5,
        lenK: branchLenK[0] + Math.random() * (branchLenK[1] - branchLenK[0]),
        widthK: branchWidthK[0] + Math.random() * (branchWidthK[1] - branchWidthK[0]),
      });
    }
  }
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    for (const mesh of meshes) {
      mesh.parent?.remove(mesh);
      mesh.geometry.dispose();
    }
    m.mat.dispose();
  };
  ctx.onKill(release);
  const st = { t: 0 };
  const promise = (async () => {
    try {
      await ctx.tweenRaw(st, { t: 1 }, {
        durationMs: Math.max(1, lifeMs), ease: 'linear',
        onUpdate: () => {
          // 两段式：reach 内前置扫到靶端（画出整根），随后后沿从源端退场（消隐）
          const growT = Math.min(1, st.t * (lifeMs / Math.max(1, reachMs)));
          const rest = Math.max(0.001, 1 - reachMs / lifeMs);
          const erode = Math.max(0, (st.t - reachMs / lifeMs) / rest) * tail;
          const fade = st.t > 0.72 ? 1 - (st.t - 0.72) / 0.28 : 1;
          setBoltState(m, fade, growT + erode, energy);
          // 电流前锋/段间闪烁沿时间推进（5 单位/秒，与常驻雷暴同口径）
          m.uTime.value = m.uTime._t0 + st.t * (lifeMs / 1000) * 5;
        },
      });
    } finally {
      release();
    }
  })();
  promise.catch(() => {});
  return {
    promise,
    jolt: () => { m.uTime.value += 3.7 + Math.random() * 4.1; },
    meshes,
  };
}

// ---------------------------------------------------------------------------
// 常驻雷暴（rage 层数驱动）：环身放电——每道弧短命驻留后熄灭，再换位重击
// ---------------------------------------------------------------------------
// 锚点（rig 局部，×H）：按卡达斯立绘剪影量取（图幅 1.42H 宽、左抬臂右厚躯），
// 全部落在剪影边缘/地面。**每击从池里随机取对**：跨体弧左右对穿（中段穿体被真
// 深度裁掉 = 绕身），竖弧从肩/背落到脚边地面；不在同一处常驻，方向/位置都在变。
const ANCHORS = {
  lLow: [-0.50, 0.12, 0.14], lMid: [-0.60, 0.40, 0.10], lHigh: [-0.52, 0.68, 0.06],
  rLow: [0.56, 0.12, 0.12], rMid: [0.60, 0.42, 0.08], rHigh: [0.50, 0.70, 0.04],
  topL: [-0.20, 0.86, 0.02], topR: [0.30, 0.82, 0.00],
  backL: [-0.34, 0.54, -0.20], backR: [0.28, 0.50, -0.22],
  groundL: [-0.42, 0.02, 0.16], groundR: [0.56, 0.02, 0.14], groundB: [0.16, 0.02, -0.16],
};
const ACROSS = [
  ['lLow', 'rMid'], ['lMid', 'rLow'], ['lHigh', 'rMid'], ['lMid', 'rHigh'],
  ['lLow', 'rHigh'], ['lHigh', 'rLow'], ['topL', 'rMid'], ['lMid', 'backR'],
];
const VERT = [
  ['lHigh', 'lLow'], ['rHigh', 'rLow'], ['lMid', 'groundL'], ['rMid', 'groundR'],
  ['lLow', 'groundL'], ['rLow', 'groundR'], ['backL', 'groundB'], ['backR', 'groundB'],
];
const SLOT_MAX = 6;

/**
 * 在宿主单位上建常驻雷暴（挂 _rig：跟随单位、yaw 对镜头；真深度遮挡）。
 * @param {import('./unitFxLayer.js').UnitFxLayer} layer
 * @param {{particles?: object|null}} [o] particles = 舞台粒子组合门面（肩部点缀电火花）
 * @returns {{group, setLevel, levelNow, pulse, burst, dispose}|null}（headless null）
 */
export function makePlasmaStorm(layer, { particles = null } = {}) {
  if (typeof document === 'undefined') return null;
  const unit = layer.unit;
  const rig = unit._rig;
  if (!rig) return null;
  const H = unit._standeeHeight ?? 22;
  const group = new THREE.Group();
  group.name = 'plasmaStorm';
  rig.add(group);

  const anchors = {};
  for (const [k, a] of Object.entries(ANCHORS)) {
    anchors[k] = new THREE.Vector3(a[0] * H, a[1] * H, a[2] * H);
  }
  const slots = [];
  for (let i = 0; i < SLOT_MAX; i++) {
    const m = makeBoltMaterial({
      wave: 0.3 + Math.random() * 0.2,
      leaf: 0,
      end: 0.22 + Math.random() * 0.16,
      tip: 0.10 + Math.random() * 0.12,   // 端点只留极小的接触热斑（不要光球）
      tail: 0.7,                           // 激发窗：整根不同时亮/灭
    });
    const mesh = makeBoltMesh(m, 'plasmaStormBolt');
    mesh.visible = false;
    group.add(mesh);
    // 每道主雷两根可选的细分叉（独立条带；共享槽材质，fade 与主雷同步）
    const branches = [0, 1].map(() => {
      const bm = makeBoltMesh(m, 'plasmaStormBranch');
      bm.visible = false;
      group.add(bm);
      return bm;
    });
    slots.push({
      ...m, mesh, branches, active: false, gust: false, age: 0, life: 0.2,
      next: 999, flash: 0.85, from: null, to: null,
    });
  }

  // 雷云节奏：成簇爆发（一场 2~6 道，错开 0~110ms）→ 随机间歇 0.2~1.3s。
  // 每道弧仍是短命驻留（160~300ms），但**由场次调度**，不是各槽匀速轮转。
  const st = {
    cur: 0, target: 0, pulse: 0, burstN: 0, burstT: 0, sparkCd: 0,
    gustT: 0.12, gustLeft: 0,
  };
  const tmp = new THREE.Vector3();
  const jitter = (v, hk) => v.clone().add(new THREE.Vector3(
    (Math.random() - 0.5) * H * hk,
    (Math.random() - 0.5) * H * hk * 0.6,
    (Math.random() - 0.5) * 0.6,
  ));

  // 雷云节奏：P1 均值约 4s 一场、P2 约 2s（指数分布 = 方差大，偶尔长静默）。
  const gustDelay = () => {
    const mean = (unit._bossPhase ?? 1) >= 2 ? 2.0 : 4.0;
    const d = -Math.log(1 - Math.random() * 0.985) * mean;
    return Math.min(mean * 4.5, Math.max(0.5, d));
  };

  function startGust(forceN = 0, forceMs = 0) {
    const lv = st.cur;
    const p2 = (unit._bossPhase ?? 1) >= 2;
    const maxOn = Math.min(SLOT_MAX, Math.max(
      Math.round(lv * SLOT_MAX), st.burstT > 0 ? st.burstN : 1));
    // 只从**当前可显示**的槽里抽（旧版从全 6 槽抽，低 level 常抽到被 maxOn 隐藏的槽
    // → 整场没有一道可见 = P1 读成「没有常驻雷」）
    const pool = slots.slice(0, Math.max(1, maxOn));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    const n = Math.max(1, Math.min(pool.length, forceN
      || (p2 ? 3 + ((Math.random() * 3) | 0) : 1 + ((Math.random() * 3) | 0))));
    for (const s of slots) s.gust = false;
    for (let k = 0; k < n; k++) {
      const s = pool[k];
      s.gust = true;
      s.next = Math.random() * 0.11;   // 允许两三道几乎同时（闪），不是排好队
    }
    st.gustLeft = Math.max(0.12, forceMs || (p2 ? 0.36 + Math.random() * 0.40 : 0.24 + Math.random() * 0.32));
    st.gustT = gustDelay();
  }

  function pickPair() {
    if (Math.random() < 0.56) {
      const p = ACROSS[(Math.random() * ACROSS.length) | 0];
      // 62% 让两端一前一后：中段穿体被立牌真深度裁掉，读成绕身而过
      return { a: p[0], b: p[1], w: 0.11 + Math.random() * 0.05, wrap: Math.random() < 0.62 };
    }
    const p = VERT[(Math.random() * VERT.length) | 0];
    return { a: p[0], b: p[1], w: 0.12 + Math.random() * 0.06, wrap: false };
  }

  function strike(s) {
    const pick = pickPair();
    const a = jitter(anchors[pick.a], 0.04);
    const b = jitter(anchors[pick.b], 0.04);
    if (pick.wrap) {
      const front = H * (0.14 + Math.random() * 0.08);
      const back = -H * (0.12 + Math.random() * 0.08);
      if (Math.random() < 0.5) { a.z = front; b.z = back; } else { a.z = back; b.z = front; }
    }
    // 约 45% 反向放电：首尾粗细互换，避免所有弧朝一个方向收尖
    if (Math.random() < 0.45) { s.from = b; s.to = a; } else { s.from = a; s.to = b; }
    const w = H * pick.w;
    const info = setBoltQuad(s.mesh, s.from, s.to, w, null, {
      amp: pick.wrap ? 0.13 : 0.11,   // 大折→碎折（世界尺度，不受光晕宽度限制）
    });
    // 细分叉：80% 一根 / 45% 第二根，沿主线随机选点；独立条带、自身也折
    for (let k = 0; k < s.branches.length; k++) {
      const bm = s.branches[k];
      const on = Math.random() < (k === 0 ? 0.92 : 0.62);
      bm.visible = on;
      if (on) {
        placeBranch(bm, info, w, null, {
          t: 0.22 + Math.random() * 0.56,
          lenK: 0.14 + Math.random() * 0.16,
          widthK: 0.26 + Math.random() * 0.24,
          amp: 0.2,
        });
      }
    }
    s.uTime.value += 3.7 + Math.random() * 4.1;   // 离散换相（折点跳变）
    s.uSeed.value.x = Math.random() * 6.28 + 0.01;
    s.uSeed.value.z = 0.24 + Math.random() * 0.18; // 每击收尖量微差（形态不重样）
    s.flash = 0.72 + Math.random() * 0.5;
    s.age = 0;
    s.life = 0.16 + Math.random() * 0.14;   // 一道电驻留 160~300ms，不长留原地
    s.active = true;
    s.mesh.visible = true;
    // 雷电粒子：从折线中段甩出 2~3 粒电火花（物理动机 = 电弧溅射）
    if (particles && st.sparkCd <= 0 && Math.random() < 0.5) {
      st.sparkCd = 0.16;
      const k = 0.25 + Math.random() * 0.5;
      tmp.copy(s.from).lerp(s.to, k);
      group.localToWorld(tmp);
      particles.spawn?.(tmp.x, tmp.y, {
        count: 3, color: 0xaad8ff, speed: 9, ttl: 0.26, size: 0.55, gravity: 5, z: tmp.z,
      });
    }
  }

  const hideSlot = (s) => {
    s.active = false;
    s.mesh.visible = false;
    for (const bm of s.branches) bm.visible = false;
  };

  const untick = unit.addTick((dt) => {
    const k = 1 - Math.exp(-dt * 5.5);
    st.cur += (st.target - st.cur) * k;
    if (Math.abs(st.target - st.cur) < 0.004) st.cur = st.target;
    st.pulse = Math.max(0, st.pulse - dt * 3.2);
    st.burstT = Math.max(0, st.burstT - dt);
    st.sparkCd = Math.max(0, st.sparkCd - dt);
    const lv = st.cur;
    group.visible = (lv > 0.02 || st.burstT > 0) && !unit._dead;
    if (!group.visible) {
      for (const s of slots) hideSlot(s);
      return;
    }
    const maxOn = Math.min(SLOT_MAX, Math.max(
      Math.round(lv * SLOT_MAX), st.burstT > 0 ? st.burstN : 0));
    // 场次调度：爆发窗内多道错峰闪，窗外彻底安静一段（雷云间歇）
    if (st.gustLeft > 0) {
      st.gustLeft -= dt;
      if (st.gustLeft <= 0) {
        for (const s of slots) s.gust = false;
        st.gustT = gustDelay();
      }
    } else {
      st.gustT -= dt;
      if (st.gustT <= 0) startGust();
    }
    const energy = (0.78 + lv * 0.55) * (1 + st.pulse * 1.25) * (st.burstT > 0 ? 1.15 : 1);
    unit.updateWorldMatrix?.(true, false);
    for (let i = 0; i < SLOT_MAX; i++) {
      const s = slots[i];
      if (i >= maxOn) { hideSlot(s); continue; }
      if (!s.active) {
        if (!s.gust) { hideSlot(s); continue; }
        s.next -= dt;
        if (s.next > 0) { hideSlot(s); continue; }
        strike(s);
      }
      s.age += dt;
      s.uTime.value += dt * 5;   // 电流前锋沿弧推进（与一次性件同口径）
      // 起亮 20ms / 末段 70ms 熄灭：弧出现→驻留→消失，再换个位置重击
      const fIn = Math.min(1, s.age / 0.02);
      const fOut = 1 - Math.max(0, Math.min(1, (s.age - (s.life - 0.07)) / 0.07));
      const f = Math.min(fIn, fOut);
      // 沿弧激发：0→1 画出整根，1→1.7 从源端逐段退场
      const t = s.age / s.life;
      const grow = Math.min(1, t / 0.42);
      const erode = Math.max(0, (t - 0.42) / 0.58) * 0.7;
      setBoltState(s, f, grow + erode, energy * s.flash);
      s.mesh.visible = f > 0.01;
      if (s.age >= s.life) {
        hideSlot(s);
        if (s.gust && st.gustLeft > 0) s.next = 0.01 + Math.random() * 0.06; // 场内续闪
        else { s.gust = false; s.next = 999; }                               // 场外安静
      }
    }
  });

  return {
    group,
    setLevel(l) { st.target = Math.max(0, Math.min(1, l)); },
    levelNow() { return st.cur; },
    /** 挨打/嘶吼炸亮（多次调用取 max，不叠加爆闪）。 */
    pulse(k = 1) { st.pulse = Math.min(1.4, Math.max(st.pulse, k)); },
    /** 点放：n 道齐鸣 ms 毫秒。 */
    burst(n = 3, ms = 200) {
      st.burstN = Math.max(st.burstN, n);
      st.burstT = Math.max(st.burstT, ms / 1000);
      startGust(n, ms / 1000);
    },
    dispose() {
      untick();
      group.parent?.remove(group);
      for (const s of slots) {
        s.mesh.geometry.dispose();
        for (const bm of s.branches) bm.geometry.dispose();
        s.mat.dispose();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// 一次性签名件：雷电爪痕 / 命中迸裂 / 天雷 / 雷环
// ---------------------------------------------------------------------------

/** 爪痕：数道斜向雷线**依次**划出（重击 = 更宽、更粗、更久）。
 *  at = 命中点（胸口），size = **目标立牌可见宽**（按体宽取，不按体高——窄体型
 *  上用体高会把爪痕甩到身体外面去）。 */
export function plasmaSlash(ctx, deps, {
  at, size = 20, dir = 1, strokes = 2, heavy = false,
} = {}) {
  // 面片宽度 = 电晕容器（波形/收尖都要余量），可见线宽由着色包络决定
  const width = size * (heavy ? 0.30 : 0.26);
  // 爪的走向：横向掠过 + 明显下沉，三条痕沿「垂直于挥向」错开——
  // 只沿 y 错开会读成三道平行横杠，垂直错开才是三根爪尖的间距。
  // 长度按目标体宽展开：横向略宽于躯干、纵向贯穿大半身（0.46W × 0.82W）。
  const span = size * 0.46;
  const drop = size * 0.82;
  const pl = Math.hypot(drop, 2 * span) || 1;
  const perpX = drop / pl;
  const perpY = (dir * 2 * span) / pl;
  // 依次出爪：同刻齐亮会把三道叠成一坨；错峰后「出现→驻留→消失」自然成序
  const gapMs = heavy ? 34 : 26;
  const lifeMs = heavy ? 240 : 185;
  const jobs = [];
  for (let i = 0; i < strokes; i++) {
    const off = (i - (strokes - 1) / 2) * size * 0.15;
    const sx = at.x - dir * span + perpX * off;
    const sy = at.y + drop * 0.5 + perpY * off;
    const ex = at.x + dir * span + perpX * off;
    const ey = at.y - drop * 0.5 + perpY * off;
    const w = width * (0.92 + Math.random() * 0.16);
    jobs.push(ctx.spawn(async (c) => {
      await c.wait(i * gapMs);
      // 爪尖入肉：起手端一簇电火花（物理动机 = 触点迸电）
      deps.particles?.spawn?.(sx, sy, {
        count: heavy ? 2 : 1, color: 0xaad8ff, speed: 9, ttl: 0.22, size: 0.55, gravity: 6, z: at.z + 1,
      });
      await boltGroup(c, deps, [{
        from: { x: sx, y: sy, z: at.z + 1.5 },
        to: { x: ex, y: ey, z: at.z + 1.2 },
        width: w,
      }], {
        lifeMs, reachMs: heavy ? 78 : 62, energy: heavy ? 1.08 : 0.92,
        name: 'spellFx:plasmaSlash', viewAt: at,
        wave: 0.5, leaf: 0.55, end: 0.12, tip: 0,   // 叶形：中间粗、两头收细
        amp: 0.075, branches: 1, branchLenK: [0.16, 0.30], branchWidthK: [0.26, 0.45],
      }).promise;
    }).promise);
  }
  return Promise.all(jobs);
}

/** 命中迸裂：自命中点向外炸出数道短雷（电的冲击反馈，取代钝器拳环）。 */
export function plasmaBurst(ctx, deps, {
  at, size = 20, count = 5, ms = 210, energy = 0.95,
} = {}) {
  const bolts = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.45;
    const len = size * (0.26 + Math.random() * 0.32);
    bolts.push({
      from: { x: at.x, y: at.y, z: at.z + 1.3 },
      to: {
        x: at.x + Math.cos(a) * len,
        y: at.y + Math.sin(a) * len * 0.82,
        z: at.z + 1.3 + (Math.random() - 0.5) * 2.2,
      },
      width: size * 0.13,
    });
  }
  deps.particles?.spawn?.(at.x, at.y, {
    count: count + 3, color: 0xbfe6ff, speed: 17, ttl: 0.3, size: 0.7, gravity: 0, z: at.z,
  });
  return boltGroup(ctx, deps, bolts, {
    lifeMs: ms, reachMs: 55, energy, name: 'spellFx:plasmaBurst', viewAt: at,
    wave: 0.4, leaf: 0.22, end: 0.55, tip: 0.18,   // 中心粗、梢头细
    amp: 0.10, branches: 1, branchLenK: [0.14, 0.26], branchWidthK: [0.3, 0.5],
  }).promise;
}

/** 天雷：自画面上方劈落到 at（主弧 + 两道分叉），落点迸裂 + 地面电尘。 */
export function skyBolt(ctx, deps, {
  at, height = 90, ms = 260, energy = 1.5, spread = 10,
} = {}) {
  const top = {
    x: at.x + (Math.random() - 0.5) * spread,
    y: at.y + height,
    z: at.z - 5 + Math.random() * 3,
  };
  const main = { from: top, to: { x: at.x, y: at.y + 1.2, z: at.z + 0.8 }, width: height * 0.045 };
  const bolts = [main];
  const forkStats = [
    { k: 0.52, side: -1, dy: 0.16 },
    { k: 0.68, side: 1, dy: 0.10 },
  ];
  for (const f of forkStats) {
    const f0 = {
      x: top.x + (at.x - top.x) * f.k,
      y: top.y + (at.y - top.y) * f.k,
      z: top.z + (at.z - top.z) * f.k,
    };
    bolts.push({
      from: f0,
      to: { x: f0.x + f.side * height * 0.10, y: f0.y - height * f.dy, z: f0.z + 0.6 },
      width: main.width * 0.55,
    });
  }
  deps.particles?.spawn?.(at.x, at.y + 1, {
    count: 12, color: 0xbfe6ff, speed: 15, ttl: 0.42, size: 0.75, gravity: -6, z: at.z,
  });
  return boltGroup(ctx, deps, bolts, {
    lifeMs: ms, reachMs: 45, energy, name: 'spellFx:skyBolt', viewAt: at,
    // 折线烘进几何：世界尺度的摆幅不受光晕宽度限制
    wave: 0.45, amp: 0.065, leaf: 0.10, end: 0.42, tip: 0.5,
  }).promise;
}

// 雷环（全向广播语义：转段嘶吼/威慑——横铺地面的电浪；攻击性声波不用环）
const ringShade = Fn(([vUv, uProg, uSeed]) => {
  const p = vUv.sub(vec2(0.5));
  const r = length(p).mul(2.0);
  const ang = atan(p.y, p.x);
  // 环缘角向锯齿（半径扰动）+ 放射尖刺（低频角向亮缝）
  const jag = sin(ang.mul(23.0).add(uSeed))
    .mul(0.5)
    .add(sin(ang.mul(41.0).sub(uSeed.mul(1.7))).mul(0.5))
    .mul(0.05);
  const rr = uProg.mul(0.82).add(0.10).add(jag);
  const d = r.sub(rr);
  const ring = exp(d.mul(d).mul(-2600.0));
  const halo = exp(d.mul(d).mul(-500.0)).mul(0.06);
  const spikes = pow(abs(sin(ang.mul(9.0).add(uSeed))), float(9.0))
    .mul(exp(d.mul(d).mul(-420.0))).mul(0.95);
  const fade = oneMinus(smoothstep(float(0.70), float(1.0), uProg));
  const edge = oneMinus(smoothstep(float(0.44), float(0.50), length(p)));
  const rgb = CORE.mul(ring.mul(1.10).add(spikes.mul(0.70))).add(HALO.mul(halo));
  return vec4(rgb.mul(fade).mul(edge), float(1.0));
});

/** 地面雷环：横铺地面的电浪外扩 + 环缘竖雷（3D 雷波，不是音浪贴图）。 */
export function lightningRing(ctx, deps, { at, radius = 60, ms = 620 } = {}) {
  const uProg = uniform(0.0);
  const uSeed = uniform(Math.random() * 6.28 + 0.01);
  const mat = additiveLight(new MeshBasicNodeMaterial({
    transparent: true, depthWrite: false, depthTest: true, fog: false, side: THREE.DoubleSide,
  }));
  mat.colorNode = ringShade(uvOf(), uProg, uSeed);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), mat);
  quad.name = 'spellFx:plasmaRing';
  quad.rotation.x = -Math.PI / 2;
  quad.position.set(at.x, (at.y ?? 0) + 0.06, at.z ?? 0);
  quad.renderOrder = 8;
  deps.scene.add(quad);
  // 环缘竖雷：8 个角向点向上/向外甩出短弧，与地面波同步起爆
  const bolts = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.random() * 0.3;
    const r0 = radius * (0.16 + Math.random() * 0.10);
    const r1 = radius * (0.30 + Math.random() * 0.12);
    const x0 = at.x + Math.cos(a) * r0, z0 = (at.z ?? 0) + Math.sin(a) * r0 * 0.5;
    const x1 = at.x + Math.cos(a) * r1, z1 = (at.z ?? 0) + Math.sin(a) * r1 * 0.5;
    bolts.push({
      from: { x: x0, y: (at.y ?? 0) + 0.4, z: z0 },
      to: { x: x1, y: (at.y ?? 0) + radius * (0.10 + Math.random() * 0.10), z: z1 },
      width: radius * 0.060,
    });
  }
  const arc = boltGroup(ctx, deps, bolts, {
    lifeMs: ms * 0.72, reachMs: 90, energy: 1.2, name: 'spellFx:plasmaRingBolt', viewAt: at,
    wave: 0.45, amp: 0.12, leaf: 0, end: 0.45, tip: 0.15,
  });
  deps.particles?.spawn?.(at.x, (at.y ?? 0) + 0.8, {
    count: 16, color: 0xaad8ff, speed: 22, ttl: 0.5, size: 0.7, gravity: 2, z: at.z ?? 0,
  });
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    quad.parent?.remove(quad);
    quad.geometry.dispose();
    mat.dispose();
  };
  ctx.onKill(release);
  const st = { t: 0 };
  const promise = (async () => {
    try {
      await ctx.tweenRaw(st, { t: 1 }, {
        durationMs: Math.max(1, ms), ease: 'power1.out',
        onUpdate: () => { uProg.value = st.t; },
      });
    } finally {
      release();
    }
  })();
  promise.catch(() => {});
  return Promise.all([promise, arc.promise]);
}
