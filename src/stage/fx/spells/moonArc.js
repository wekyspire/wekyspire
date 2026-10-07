// 弯月大刀光（劈系列全局刀光，2026-10-07 用户定）：场景内 3D 的巨大弯月圆弧，
// 一面实（外弧白热刃口）一面虚（内弧冷蓝残迹），从左往右出现-消失——
// 单程双段 sweep（reveal 前缘扫过显现，erase 后沿同向扫过收没）暗示大剑横劈。
// 几何 = 自烘弧带（**水平面**——垂直 y 的横劈平面，弧躺在敌阵上空、凸向远处；
// uv.x 弧向左→右、uv.y 径向内→外——角度/半径全烘进顶点，shader 只读 uv，零
// atan/length）；depthTest 开着插进敌阵被立牌切割——「场景里的物件」而非贴屏面片。
// 运动全在 shader 的单一 uSweep 标量（0→2：[0,1] reveal、[1,2] erase），几何静态。
// TSL 纪律：颜色烘常量 vec3、项式平铺 add、smoothstep 正向（反边一律 oneMinus 包裹）。
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { Fn, uniform, uv, float, vec3, vec4, clamp, smoothstep, oneMinus, sin } from 'three/tsl';
import { additiveLight } from '../../post/passes.js';
import { setBloomWriter } from '../bloomOffset.js';
import { SPELL_DEBUG } from './blocks.js';

const MOON_RENDER_ORDER = 50;   // 施术面片层级（与 blocks 的 FX_RENDER_ORDER 同值）
const ARC_SEG = 96;             // 弧向细分
const ARC_LEN = 1.8;            // 弧长（rad，~103°——弧度再削换弦长（2026-10-07 用户定：够长够着所有敌人为先）

/** 弯月弧带几何：thetaStart 端在右、逆时针到左；uv.x 直接烘成左→右 0→1 */
function moonArcGeometry(innerR, outerR) {
  const t0 = Math.PI / 2 - ARC_LEN / 2;
  const pos = [], uvs = [], idx = [];
  for (let i = 0; i <= ARC_SEG; i++) {
    const u = i / ARC_SEG;                       // 0 = 左端 → 1 = 右端
    const ang = (t0 + ARC_LEN) - u * ARC_LEN;    // 左端 = 角度大端
    const cx = Math.cos(ang), sy = Math.sin(ang);
    pos.push(cx * innerR, sy * innerR, 0, cx * outerR, sy * outerR, 0);
    uvs.push(u, 0, u, 1);
    if (i < ARC_SEG) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  return geo;
}

/** 弯月构建（施术协程与 warm 预热共用）：mesh + uSweep 句柄 + 幂等 release。 */
export function buildMoonMesh({
  spanW = 56, color = [0.45, 0.60, 1.0], hot = [3.6, 3.9, 4.8], name = 'spellFx:moonArc',
} = {}) {
  // R 由弦宽反推：x 两端 = 弧心 ± spanW/2（spanW 是弦全宽口径——x 探出由调用方
  // 锚定战场，杜绝穿墙）；纵深随 θ=2.2 自带 R×0.55 的弧深
  const R = (spanW / 2) / Math.sin(ARC_LEN / 2);
  const geo = moonArcGeometry(R * 0.62, R);
  geo.computeBoundingSphere();   // 手烘几何必须显式算球（视锥剔除/透明排序都读它）
  const uSweep = uniform(0.0);

  const shade = Fn(() => {
    const uLR = uv().x.toVar();   // 左→右 0→1（几何已烘好方向）
    const v = uv().y.toVar();     // 0 = 内弧（虚影侧）→ 1 = 外弧（实刃侧）

    // —— sweep 可见窗（uSweep∈[0,2]：前缘 uSweep 已过的显现，后沿 uSweep-1 未过的保留）——
    // 前缘锐利（0.06 窄边），后沿拖弥散（0.30 宽边——虚的另一半语义）
    const frontEdge = oneMinus(smoothstep(uSweep.sub(0.06), uSweep, uLR));
    const backEdge = smoothstep(uSweep.sub(1.30), uSweep.sub(1.0), uLR);
    const vis = frontEdge.mul(backEdge).toVar();

    // —— 月牙形：径向厚度随弧位调制——两端薄如线、中间最厚（弯月两头尖的本体），
    // v 归一到局部厚度 vN（内弧 0 → 外弧 1；端点处只剩贴外弧的细亮线）
    const thick = float(0.42).mul(float(0.22).add(float(0.78).mul(sin(uLR.mul(3.14159265)))));
    const vN = clamp(v.sub(oneMinus(thick)).div(thick), 0.0, 1.0).toVar();

    // —— 一面虚一面实：内弧冷蓝薄残迹，外弧白热实刃（刃口亮线 HDR 推 bloom）——
    const body = float(0.30).add(float(0.70).mul(smoothstep(0.35, 0.90, vN)));
    const edge = smoothstep(0.62, 0.97, vN).mul(smoothstep(0.30, 0.75, vis));   // 亮带加宽：bloom 拾取像素多 → 晕能量大
    // 弦向刃口流动：亮线沿弧微移（刀锋掠过的读感，sin 慢漂）
    const edgeK = float(0.75).add(float(0.25).mul(sin(uLR.mul(9.0).sub(uSweep.mul(4.0)))));

    const base = vec3(color[0], color[1], color[2]).mul(body).mul(vis);
    const blade = vec3(hot[0], hot[1], hot[2]).mul(edge).mul(edgeK);
    const rgb = base.add(blade);
    return vec4(rgb, 1.0);
  })();

  const mat = additiveLight(new MeshBasicNodeMaterial({
    transparent: true, depthWrite: false, depthTest: true,
    side: THREE.DoubleSide,   // 弧带手烘绕向不定（内外圈三角朝向互反）——发光面片双面
  }));
  mat.colorNode = SPELL_DEBUG === 'const' ? vec4(1.0, 0.15, 0.05, 1.0) : shade;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  mesh.renderOrder = MOON_RENDER_ORDER;
  mesh.rotation.set(-Math.PI / 2 + 0.07, 0.1, 0);   // 水平横劈面（垂直 y），凸面朝远处、开口朝相机（大剑压向敌阵的来向）
  setBloomWriter(mesh, true);

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    mesh.parent?.remove(mesh);
    geo.dispose();
    mat.dispose();
  };
  return { mesh, uSweep, release };
}

/** warm 预热变体（同色字面量 = 同程序；返回 { quad } 契合 warmSpellQuad 形态） */
export const moonWarmQuad = (p) => () => ({
  quad: buildMoonMesh({
    color: p.sweepColor ?? [0.55, 0.68, 0.95],
    hot: p.moonHot ?? [1.5, 1.62, 1.9],
    name: 'warm:moon',
  }).mesh,
});

/**
 * 弯月横劈块（与 blocks.js 同约：async 协程）。
 * at = 敌阵质心（弧心落点）；spanW = **弦全宽**（x 两端 = 弧心 ± spanW/2，调用方
 * 锚定战场防穿墙）；ms = 全程时长；color/hot = 虚影基色 / 实刃热核色。
 */
export async function moonArcSweep(ctx, deps, {
  at, spanW = 56, ms = 620,
  color = [0.45, 0.60, 1.0], hot = [3.6, 3.9, 4.8],
} = {}) {
  if (!at || !deps?.scene) return;
  const { mesh, uSweep, release } = buildMoonMesh({ spanW, color, hot });
  // 凸朝远处时弧带在弧心**之后**展开——弧心（弦线）须前移一个弧深，弧顶才压回
  // 敌阵线上（否则整条弧沉到敌后 = 「从敌人身后掠过」病根）；at=unitAnchor（立牌
  // 中心），+0.5 让弧带中段穿身体
  const R = (spanW / 2) / Math.sin(ARC_LEN / 2);
  const depth = R * (1 - Math.cos(ARC_LEN / 2));
  // 弧心前移弧深 + 再向玩家 16（2026-10-07 用户定：整体再压向玩家）
  mesh.position.set(at.x, at.y + 0.5, (at.z ?? 0) + depth + 16);
  deps.scene.add(mesh);
  ctx.onKill(release);

  if (SPELL_DEBUG === 'hold') { uSweep.value = 1.0; await ctx.wait(3000); release(); return; }

  // reveal（左→右显现）→ erase（左→右收没）：uSweep 0→1→2 分两段独立计时——
  // 单条 ease 会把 erase 段压进全程尾端 ~25% 时长，快到读不出「从尾到头」方向感；
  // 两段各带 power1.in 微加速（起手稍慢蓄势、中末渐快——劈杀的加速读感）
  const st = { v: 0 };
  const push = () => { uSweep.value = st.v; };
  await ctx.tweenRaw(st, { v: 1 }, { durationMs: ms * 0.6, ease: 'power1.in', onUpdate: push });
  await ctx.tweenRaw(st, { v: 2 }, {
    durationMs: ms * 0.4, ease: 'power1.in', onUpdate: push, onComplete: release,
  });
}
