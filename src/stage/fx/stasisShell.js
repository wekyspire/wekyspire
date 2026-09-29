// 凝滞壳（L2 笼罩层首个实现，stasis 主题件，VFX 结构大更新 Phase 2）：
// 「冻在壳里的单位」——壳面 quad 与本体同几何同 UV，采样同一张立绘 map（tBody），
// 并用 unitBodyFx 同一份着色函数（W4 TSL 化 = ubfShade） + **共享本体 uniform 实例**重算下层状态：
// 燃烧中的单位被凝滞，壳内影仍透橙（同源重算 = 「下层长什么样」对上层 =
// 同函数 + 同 uniform 记录，零 RT；真邻域采样的件才走懒建 per-unit 小 RT）。
// 挂 _standee（不挂 L 分组）：壳随姿态通道一起前倾/蜷缩——冻住的是「当时的姿势」。
// alpha 纪律（验收修）：壳体**只存在于立绘剪影内 + 剪影边缘一圈霜线**
// （4 邻域 alpha 梯度检测边缘）——剪影外的透明区不许结壳，否则矩形玻璃板糊脸。
// 退化分支：map 未就位（占位色块期）→ 纯冻晶薄板（uHasBody=0）；立绘后到 tick 自愈重绑。
// 总控一个标量 setLevel(0..1)；壳体哑光不过 bloom 阈（凝滞是「停」，不是发光体）。
// —— WebGPU 迁移 TSL 版（原裸 GLSL 片元重写）：
//   · 内影 = `ubfShade(body.rgb, uv(), uBurn, uPoison, uTime.mul(0.15), uCalm)`（W4 共享件
//     直接 import，时间冻慢 ×0.15 的口径在调用点保留）；壳是哑光件，只取 .rgb 不转发偏移；
//   · uBurn/uPoison/uCalm/uTime 直接引用 L0 的 uniform 节点实例（unitFxLayer.body 共享件——
//     「同函数 + 同 uniform 记录」的同源重算口径在 TSL 下就是同一批节点，零拷贝）；
//   · 无 map 时透明黑占位纹理 + uHasBody=0 → 纯冻晶薄板退化分支照常出图
//     （与旧 GLSL 空采样器 × uHasBody 等价）；立绘后到 TextureNode.value 换纹理即可；
//   · 剪影纪律逐式保留：壳只在 smoothstep(0.3,0.65) 阈值化的剪影内 + 4 邻域 alpha 极差
//     霜线（`t.sample(uv().add(vec2(texel,0)))` 偏移采样对应旧 GLSL 偏移采样）；
//   · If/Discard 待在 Fn 栈内（本件着色链无控制流，整体一个 Fn 即可）。
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Fn, uniform, texture, uv,
  vec2, vec3, vec4, mix, max, min, clamp, abs, dot, sin, step,
  smoothstep, oneMinus,
} from 'three/tsl';
import { ubfShade } from './unitBodyFx.js';

// 1x1 透明黑占位纹理：map 未就位时 TextureNode 的合法采样源（WebGPU 不许绑空纹理），
// 采样结果 = (0,0,0,0)——uHasBody=0 时走纯冻晶薄板退化分支（有图即消失）
const PLACEHOLDER = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
PLACEHOLDER.needsUpdate = true;

/**
 * 凝滞壳着色链（colorNode）。u = { uTexel, uLevel, uTime, uBurn, uPoison, uCalm, uHasBody, uTint }，
 * t = 共享本体纹理 TextureNode。公式与 GLSL 版逐式一致。
 */
function buildShellColorNode(t, u) {
  return Fn(() => {
    const vUv = uv();
    const body = t.sample(vUv).mul(u.uHasBody);
    // 内影 = 下层状态的同源重算（时间也被冻慢：uTime × 0.15——凝滞 = 时间变慢）；
    // shade 返回 vec4（rgb=色，a=bloom 偏移）——壳是哑光件，只取色不转发偏移
    const inner = ubfShade(body.rgb, vUv, u.uBurn, u.uPoison, u.uTime.mul(0.15), u.uCalm).rgb.toVar();
    const lum = dot(inner, vec3(0.299, 0.587, 0.114));
    inner.assign(vec3(lum).mul(vec3(0.52, 0.62, 0.80)).add(inner.mul(0.22))); // 去色冷移，留两成本色
    // 壳体：冻晶底色 + 极慢竖向流光（凝滞是时间变慢，不是冰的蓝）
    const shimmer = sin(u.uTime.mul(0.8).add(vUv.y.mul(7.0))).mul(0.15).add(0.85);
    const shell = u.uTint.mul(shimmer);
    // 剪影判定阈值化：近透明区（暗角/羽化边 alpha 0.2~0.4）不算剪影——不结壳
    // （验收修：直接乘 body.a 会把整张 quad 蒙成玻璃板）
    const sa = smoothstep(0.3, 0.65, body.a);
    // 剪影边缘霜线：4 邻域 alpha 极差（max-min）→ 边缘两侧各出一圈薄霜，实心区与远处为零
    const aR = u.uTexel.x.mul(1.5), aT = u.uTexel.y.mul(1.5);
    const a0 = smoothstep(0.3, 0.65, t.sample(vUv.add(vec2(aR, 0.0))).a);
    const a1 = smoothstep(0.3, 0.65, t.sample(vUv.sub(vec2(aR, 0.0))).a);
    const a2 = smoothstep(0.3, 0.65, t.sample(vUv.add(vec2(0.0, aT))).a);
    const a3 = smoothstep(0.3, 0.65, t.sample(vUv.sub(vec2(0.0, aT))).a);
    const rim = clamp(max(max(a0, a1), max(a2, a3)).sub(min(min(a0, a1), min(a2, a3))).mul(1.8), 0.0, 1.0).mul(u.uHasBody).toVar();
    // 合成：剪影内结霜影（尊重立绘 opacity），边缘霜线最亮；剪影外零壳
    const c = mix(inner, shell, 0.42).add(shell.mul(rim).mul(0.5)).toVar();
    // 结晶前锋（赋予/消除过渡演出）：front 由 level 归一驱动
    // （0.9 = recipes 的 levelOf 稳态值）——进入时冰霜自下而上扫过全身、前锋挂冰蓝
    // 亮线（结晶一闪）；退出时同一公式反向，冰霜向下消退（解冻）。
    const front = clamp(u.uLevel.div(0.9), 0.0, 1.0).mul(1.15).toVar();
    const swept = oneMinus(smoothstep(front.sub(0.18), front.add(0.03), vUv.y)); // 前锋以下已冻结
    const frontLine = oneMinus(smoothstep(0.0, 0.06, abs(vUv.y.sub(front))))
      .mul(oneMinus(step(1.14, front))); // 扫满（稳态）后亮线收掉
    const body1 = max(sa, rim); // 亮线只落在剪影/霜线处（无立绘退化期 auto 为零）
    const alpha = u.uLevel.mul(clamp(sa.mul(shimmer.mul(0.25).add(0.48)).add(rim.mul(0.55)).mul(swept), 0.0, 1.0)).toVar();
    c.addAssign(vec3(2.2, 2.9, 3.5).mul(frontLine).mul(body1)); // 前锋亮线（HDR 微过阈，交 bloom 一闪）
    alpha.assign(max(alpha, frontLine.mul(body1).mul(0.9).mul(u.uLevel)));
    // 无立绘退化：整块薄冻晶板（占位色块期兜底，有图即消失）
    alpha.assign(mix(alpha, u.uLevel.mul(0.18).mul(swept), oneMinus(u.uHasBody)));
    c.assign(mix(c, shell, oneMinus(u.uHasBody).mul(0.8)));
    return vec4(c, alpha);
  })();
}

/**
 * 在宿主层的 L2 槽位建凝滞壳（几何与本体共享引用，随 setArt 自愈重绑）。
 * @param {UnitFxLayer} layer 单位特效宿主（unitFxLayer.js）
 * @returns {{ group, setLevel(0..1), dispose } | null}（headless 无画布 → null）
 */
export function makeStasisShell(layer, { tint = 0x9fb6d8 } = {}) {
  if (typeof document === 'undefined') return null;
  const unit = layer.unit;
  const bodyMesh = unit._body;
  // 本体纹理节点：占位纹理起步，立绘就位 syncMap 换 .value 即可
  const t = texture(PLACEHOLDER);
  const u = {
    // map 就位即按真尺寸重设
    uTexel: uniform(new THREE.Vector2(1 / 256, 1 / 256)),
    uLevel: uniform(0),
    uTime: layer.body.uTime, // 共享 L0 的钟实例（同源同帧，UnitFxLayer 常驻推进）
    // 共享 uniform 实例——同源重算：本体燃烧/中毒着色在壳内影里同步呈现
    uBurn: layer.body.uBurn,
    uPoison: layer.body.uPoison,
    uCalm: layer.body.uCalm,
    uHasBody: uniform(bodyMesh.material.map ? 1 : 0),
    uTint: uniform(new THREE.Color(tint)),
  };
  const mat = new MeshBasicNodeMaterial();
  mat.colorNode = buildShellColorNode(t, u);
  mat.transparent = true;
  mat.depthWrite = false;
  mat.fog = false;
  const mesh = new THREE.Mesh(bodyMesh.geometry, mat); // 几何共享引用（不销；dispose 只摘 mesh 销材质）
  mesh.name = 'stasisShell';
  mesh.position.set(bodyMesh.position.x, bodyMesh.position.y, 0.8); // L2 z 槽位
  mesh.renderOrder = 1;                                  // 同 standee 内压过本体
  const group = new THREE.Group();
  group.name = 'stasisShellGroup';
  group.add(mesh);
  unit._standee.add(group); // 挂 standee：随姿态通道前倾/蜷缩（冻住的是当时的姿势）
  const syncMap = () => {
    const map = bodyMesh.material.map;
    if (map?.image) {
      t.value = map; // TextureNode 换纹理（swap 不重建链）
      u.uHasBody.value = 1;
      u.uTexel.value.set(1 / map.image.width, 1 / map.image.height);
    }
  };
  syncMap();
  let level = 0;
  const untick = unit.addTick(() => {
    group.visible = level > 0.02 && !unit._dead;
    // 自愈①：setArt 换几何（原位 dispose 旧几何）——壳引用会失效，逐帧核对重绑
    if (mesh.geometry !== bodyMesh.geometry) mesh.geometry = bodyMesh.geometry;
    mesh.position.set(bodyMesh.position.x, bodyMesh.position.y, 0.8);
    // 自愈②：立绘后到（占位色块期建的壳）——map 就位即启用剪影内壳
    if (!u.uHasBody.value && bodyMesh.material.map) syncMap();
    u.uLevel.value = level;
  });
  const dispose = () => {
    untick();
    group.parent?.remove(group);
    mat.dispose(); // 几何是本体共享引用，不销
  };
  return {
    group,
    setLevel(l) { level = Math.max(0, Math.min(1, l)); },
    dispose,
  };
}
