// 凝滞壳（L2 笼罩层首个实现，stasis 主题件，VFX 结构大更新 Phase 2，2026-09-26）：
// 「冻在灰蓝壳里的单位」——壳面 quad 与本体同几何同 UV，采样同一张立绘 map（tBody），
// 并用 GLSL_BODY_FX 同一份函数 + **共享本体 uniform 实例**重算下层状态：
// 燃烧中的单位被凝滞，壳内影仍透橙（同源重算 = 「下层长什么样」对上层 =
// 同函数 + 同 uniform 记录，零 RT；真邻域采样的件才走懒建 per-unit 小 RT）。
// 挂 _standee（不挂 L 分组）：壳随姿态通道一起前倾/蜷缩——冻住的是「当时的姿势」。
// 退化分支：map 未就位（占位色块期）→ uHasBody=0，纯冻晶壳；立绘后到时 tick 自愈重绑。
// 总控一个标量 setLevel(0..1)；壳体哑光不过 bloom 阈（凝滞是「停」，不是发光体）。
import * as THREE from 'three';
import { GLSL_BODY_FX } from './unitBodyFx.js';

const VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tBody;
uniform float uHasBody;
uniform float uLevel;
uniform float uTime;
uniform float uBurn;
uniform float uPoison;
uniform vec3 uTint;
${GLSL_BODY_FX}
void main() {
  vec4 body = texture2D(tBody, vUv) * uHasBody;
  // 内影 = 下层状态的同源重算（时间也被冻慢：uTime × 0.15——凝滞 = 时间变慢）
  vec3 inner = unitBodyFxShade(body.rgb, vUv, uBurn, uPoison, uTime * 0.15);
  float lum = dot(inner, vec3(0.299, 0.587, 0.114));
  inner = vec3(lum) * vec3(0.52, 0.62, 0.80) + inner * 0.22; // 去色冷移，留两成本色
  // 壳体：冻晶底色 + 极慢竖向流光（凝滞是时间变慢，不是冰的蓝）
  float shimmer = 0.85 + 0.15 * sin(uTime * 0.8 + vUv.y * 7.0);
  vec3 shell = uTint * shimmer;
  float outside = 1.0 - body.a;                 // 壳比本体略大：剪影外圈壳最实
  vec3 c = mix(inner, shell, 0.30 + 0.45 * outside);
  float alpha = uLevel * mix(0.30 + 0.40 * body.a, 0.42, outside);
  gl_FragColor = vec4(c, alpha);
}`;

/**
 * 在宿主层的 L2 槽位建凝滞壳（几何与本体共享引用，随 setArt 自愈重绑）。
 * @param {UnitFxLayer} layer 单位特效宿主（unitFxLayer.js）
 * @returns {{ group, setLevel(0..1), dispose } | null}（headless 无画布 → null）
 */
export function makeStasisShell(layer, { tint = 0x9fb6d8 } = {}) {
  if (typeof document === 'undefined') return null;
  const unit = layer.unit;
  const bodyMesh = unit._body;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      tBody: { value: bodyMesh.material.map ?? null },
      uHasBody: { value: bodyMesh.material.map ? 1 : 0 },
      uLevel: { value: 0 },
      uTime: { value: 0 },
      // 共享 uniform 实例——同源重算：本体燃烧/中毒着色在壳内影里同步呈现
      uBurn: layer.body.uBurn,
      uPoison: layer.body.uPoison,
      uTint: { value: new THREE.Color(tint) },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(bodyMesh.geometry, mat); // 几何共享引用（不销；dispose 只摘 mesh 销材质）
  mesh.name = 'stasisShell';
  mesh.scale.set(1.07, 1.05, 1);                        // 略大于本体：壳凸出剪影外缘
  mesh.position.set(bodyMesh.position.x, bodyMesh.position.y, 0.8); // L2 z 槽位
  mesh.renderOrder = 1;                                  // 同 standee 内压过本体
  const group = new THREE.Group();
  group.name = 'stasisShellGroup';
  group.add(mesh);
  unit._standee.add(group); // 挂 standee：随姿态通道前倾/蜷缩（冻住的是当时的姿势）
  let level = 0;
  const untick = unit.addTick(() => {
    group.visible = level > 0.02 && !unit._dead;
    // 自愈①：setArt 换几何（原位 dispose 旧几何）——壳引用会失效，逐帧核对重绑
    if (mesh.geometry !== bodyMesh.geometry) mesh.geometry = bodyMesh.geometry;
    mesh.position.set(bodyMesh.position.x, bodyMesh.position.y, 0.8);
    // 自愈②：立绘后到（占位色块期建的壳）——map 就位即启用内影
    if (!mat.uniforms.uHasBody.value && bodyMesh.material.map) {
      mat.uniforms.tBody.value = bodyMesh.material.map;
      mat.uniforms.uHasBody.value = 1;
    }
    mat.uniforms.uLevel.value = level;
    mat.uniforms.uTime.value = layer.body.uTime.value; // 共用 L0 的钟（同源同帧）
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
