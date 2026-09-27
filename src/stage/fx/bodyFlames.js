// 环身舔舐火（L1 贴体层，burn 主题件，VFX 结构大更新 Phase 2 第四版，2026-09-26）：
// 簇式火舌方案废弃——散布的独立小火 quad 读作「角色下方那三坨火焰」（用户验收原话，
// 廉价感来源 = 火与身体是分离的贴片）。本版让火**长在身体上**：
//   · 共享本体几何 + 采样同一张立绘 alpha（stasisShell 同源手法）——
//     火焰噪声以剪影为掩膜：体内底旺上弱（贴肉燃烧）+ 剪影外沿一圈舔火
//     （多环 alpha 邻域采样出「外溢带」，火窜出轮廓、头顶上方也有火）；
//   · **挂 _standee 不挂 billboard 分组**（2026-09-26 系统性修正，用户验收：
//     「播放动画时底部火焰没有跟随」）——姿态通道（squash/widen/lean/呼吸）打在
//     _standee 上，采样本体剪影的件必须与本体同一变换空间；每帧拷贝 bodyMesh 位置；
//   · 前后两层（后层 z −0.30 被本体剪影遮挡、透明区透出 → 火绕到身后，环绕感）；
//   · level 除了总强度还抬火舌高度（rise 指数随 level 放平——低层只烧腿，高层没过头顶）；
//   · uCalm（火焰亲和）：滚动减速、摇曳收敛——可控的火（与 L0 同源）。
// HDR 纪律：芯部白黄峰值过世界 bloom 阈 1.45（火是发光体），暗部压回阈下。
// 总控一个标量 setLevel(0..1)；uTime 共用 L0 的钟（同源同帧）；dispose 由宿主层统一调。
import * as THREE from 'three';

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
uniform vec2 uTexel;
uniform float uLevel;
uniform float uTime;
uniform float uSeed;
uniform float uCalm;
uniform vec3 uTheme;
float vhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(vhash(i), vhash(i + vec2(1.0, 0.0)), u.x),
             mix(vhash(i + vec2(0.0, 1.0)), vhash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  return vnoise(p) * 0.55 + vnoise(p * 2.31 + vec2(7.7, 3.1)) * 0.30
       + vnoise(p * 4.70 + vec2(13.1, 9.2)) * 0.15;
}
// 剪影 alpha 平滑版（羽化阈值化，与 stasisShell 同口径）
float solid(vec2 uv) { return smoothstep(0.3, 0.65, texture2D(tBody, uv).a); }
void main() {
  float inside = solid(vUv);
  // 外溢带：两圈 8 向邻域取 max——本点透明但近邻实体 = 剪影外沿舔火区；
  // 第二圈更远更弱，火舌得以窜出轮廓（头顶上方也出火）
  vec2 e1 = uTexel * 2.5;
  vec2 e2 = uTexel * 5.0;
  float ring1 = 0.0, ring2 = 0.0;
  ring1 = max(ring1, solid(vUv + vec2(e1.x, 0.0)));  ring1 = max(ring1, solid(vUv - vec2(e1.x, 0.0)));
  ring1 = max(ring1, solid(vUv + vec2(0.0, e1.y)));  ring1 = max(ring1, solid(vUv - vec2(0.0, e1.y)));
  ring1 = max(ring1, solid(vUv + e1));               ring1 = max(ring1, solid(vUv - e1));
  ring1 = max(ring1, solid(vUv + vec2(e1.x, -e1.y))); ring1 = max(ring1, solid(vUv + vec2(-e1.x, e1.y)));
  ring2 = max(ring2, solid(vUv + vec2(e2.x, 0.0)));  ring2 = max(ring2, solid(vUv - vec2(e2.x, 0.0)));
  ring2 = max(ring2, solid(vUv + vec2(0.0, e2.y)));  ring2 = max(ring2, solid(vUv - vec2(0.0, e2.y)));
  ring2 = max(ring2, solid(vUv + e2));               ring2 = max(ring2, solid(vUv - e2));
  ring2 = max(ring2, solid(vUv + vec2(e2.x, -e2.y))); ring2 = max(ring2, solid(vUv + vec2(-e2.x, e2.y)));
  float spill = (1.0 - inside) * max(ring1, ring2 * 0.55);
  // 火形噪声：向上卷（火向上窜）+ 域扭曲出舌形
  float t = uTime * 2.1 * (1.0 - uCalm * 0.3) + uSeed * 23.0;
  vec2 p = vec2(vUv.x * 3.4 + uSeed, vUv.y * 2.6 - t);
  float warp = fbm(p * 1.6 + vec2(0.0, -t * 0.5));
  float n = fbm(p + vec2(warp * 0.9 - 0.45, 0.0));
  // 火势：底旺顶弱，火舌高度随 level 抬升（低层只烧腿，高层没过头顶）
  float rise = pow(1.0 - vUv.y, mix(2.6, 1.1, uLevel));
  float flick = 0.85 + 0.15 * sin(t * 3.7 + n * 12.0) * (1.0 - uCalm * 0.5);
  float flame = rise * (0.20 + 1.45 * n) * flick;
  // 合成：体内贴肉火（弱，托底）+ 外溢舔火（强，主体）
  float f = flame * (inside * 0.55 + spill * 1.35);
  f = smoothstep(0.10, 0.68, f) * uLevel * uHasBody;
  if (f < 0.004) discard;
  // 色 ramp：尖暗红 → 中橙 → 芯白黄（HDR 过阈真发光）；主题色掺两成半保持体系色
  vec3 c = mix(vec3(1.7, 0.35, 0.06), vec3(2.7, 1.8, 0.8),
               smoothstep(0.35, 0.95, f * (1.0 - vUv.y * 0.45)));
  c = mix(vec3(0.8, 0.13, 0.02), c, smoothstep(0.02, 0.45, f));
  c = mix(c, uTheme * 2.2, 0.25);
  gl_FragColor = vec4(c, f);
}`;

/**
 * 在宿主单位的 _standee 上建环身舔舐火（前后两层；随姿态通道变形——采样本体剪影的件
 * 必须与本体同一变换空间，挂 billboard 分组会在位移动画时脱锚）。
 * @param {UnitFxLayer} layer 单位特效宿主（unitFxLayer.js）
 * @returns {{ group, setLevel(0..1), dispose } | null}（headless 无画布 → null）
 */
export function makeBodyFlames(layer, { color = 0xff8a3a } = {}) {
  if (typeof document === 'undefined') return null;
  const unit = layer.unit;
  const bodyMesh = unit._body;
  const group = new THREE.Group();
  group.name = 'bodyFlamesGroup';
  const sheets = [];
  for (const cfg of [{ z: 0.35, seed: 0.0, k: 1.0, ro: 1 }, { z: -0.30, seed: 3.7, k: 0.8, ro: 0 }]) {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        tBody: { value: bodyMesh.material.map ?? null },
        uHasBody: { value: bodyMesh.material.map ? 1 : 0 },
        uTexel: { value: new THREE.Vector2(1 / 256, 1 / 256) }, // map 就位即按真尺寸重设
        uLevel: { value: 0 },
        uTime: { value: 0 },
        uSeed: { value: cfg.seed },
        uCalm: layer.body.uCalm, // 共享实例：火焰亲和同帧生效（与 L0 同源）
        uTheme: { value: new THREE.Color(color) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      fog: false,
    });
    // 几何与本体共享（随 setArt 自愈重绑）——全尺寸 1:1，uv 与立绘像素一一对应
    const mesh = new THREE.Mesh(bodyMesh.geometry, mat);
    mesh.name = 'bodyFlameSheet';
    mesh.renderOrder = cfg.ro;
    group.add(mesh);
    sheets.push({ mesh, mat, k: cfg.k, z: cfg.z });
  }
  unit._standee.add(group); // 挂 standee：随姿态通道前倾/压扁（与 stasisShell 同一条铁律）
  const syncMap = () => {
    const map = bodyMesh.material.map;
    if (map?.image) {
      for (const s of sheets) {
        s.mat.uniforms.tBody.value = map;
        s.mat.uniforms.uHasBody.value = 1;
        s.mat.uniforms.uTexel.value.set(1 / map.image.width, 1 / map.image.height);
      }
    }
  };
  syncMap();
  let level = 0;
  const untick = unit.addTick(() => {
    group.visible = level > 0.02 && !unit._dead; // 尸体上不放火（orbs 同律）
    const t = layer.body.uTime.value; // 共用 L0 的钟（同源同帧）
    for (const s of sheets) {
      // setArt 自愈：本体几何被原位替换（旧几何销掉）——逐帧核对重绑共享引用
      if (s.mesh.geometry !== bodyMesh.geometry) s.mesh.geometry = bodyMesh.geometry;
      // 逐帧对齐本体局部位置（本体位移动画时火不脱锚；姿态缩放/旋转由 standee 父链继承）
      s.mesh.position.set(bodyMesh.position.x, bodyMesh.position.y, s.z);
      s.mat.uniforms.uLevel.value = level * s.k;
      s.mat.uniforms.uTime.value = t;
    }
    // 立绘后到（占位色块期建的火）——map 就位即启用剪影采样
    if (!sheets[0].mat.uniforms.uHasBody.value && bodyMesh.material.map) syncMap();
  });
  const dispose = () => {
    untick();
    group.parent?.remove(group);
    for (const s of sheets) s.mat.dispose(); // 几何是本体共享引用，不销
  };
  return {
    group,
    /** 总控标量 0..1：火势（enter 渐升 / stacks 强弱 / exit 渐熄全推它）。 */
    setLevel(l) { level = Math.max(0, Math.min(1, l)); },
    dispose,
  };
}
