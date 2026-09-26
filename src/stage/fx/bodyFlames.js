// 贴体火幕（L1 贴体层，burn 主题件，VFX 结构大更新 Phase 2 重做，2026-09-26）：
// 一块贴体 quad 上跑片元噪声火焰——域扭曲 fbm 向上卷出火舌，底部亮芯、顶部撕裂消散。
// 为什么不用 sprite 焰苗：orbs.js 那套 flameTexture 是为燃焰术士的环绕火球专门调的形，
// 贴体放大后读成「两盏红灯笼」（用户验收原话「很丑，别用燃焰术士的特效」）——
// 贴体火要有连续的火幕感，只能靠 shader 噪声火，多张焰苗贴片拼不出来。
// HDR 纪律：芯部白黄峰值 ~2.7 过世界 bloom 阈 1.45（火是发光体），顶部暗红压回阈下；
// 本体（L0）压阈下，发光的活全在这层，分工防糊白。
// 总控一个标量 setLevel(0..1)（enter 渐升 / stacks 强弱 / exit 渐熄全推它）；
// uTime 共用 L0 的钟（同源同帧）；dispose 由宿主层统一调。
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
uniform float uLevel;
uniform float uTime;
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
void main() {
  // 火域：x 体宽、y 底→顶；噪声向上卷（火向上窜），域扭曲让火舌左右摇摆
  vec2 p = vUv * vec2(3.0, 2.0) + vec2(0.0, -uTime * 2.2);
  float warp = fbm(p * 1.6 + vec2(0.0, -uTime * 1.1));
  float n = fbm(p + vec2(warp * 0.9 - 0.45, 0.0));
  // 火形：底旺顶撕裂、两侧收拢（椭圆掩膜）
  float body = 1.0 - vUv.y;
  float side = 1.0 - abs(vUv.x - 0.5) * 2.0;
  float flame = body * body * (0.45 + 1.15 * n) * smoothstep(0.05, 0.5, side);
  flame = smoothstep(0.16, 0.75, flame) * uLevel;
  if (flame < 0.004) discard;
  // 色 ramp：顶暗红 → 中橙 → 底芯白黄（HDR 过阈真发光）；主题色掺三成保持体系色
  vec3 c = mix(vec3(1.7, 0.35, 0.06), vec3(2.7, 1.8, 0.8),
               smoothstep(0.35, 0.95, flame * (1.0 - vUv.y * 0.55)));
  c = mix(vec3(0.85, 0.14, 0.02), c, smoothstep(0.02, 0.45, flame));
  c = mix(c, uTheme * 2.2, 0.3);
  gl_FragColor = vec4(c, flame);
}`;

/**
 * 在宿主层的 L1 分组里建贴体火幕。
 * @param {UnitFxLayer} layer 单位特效宿主（unitFxLayer.js）
 * @returns {{ group, setLevel(0..1), dispose } | null}（headless 无画布 → null）
 */
export function makeBodyFlames(layer, { color = 0xff8a3a } = {}) {
  if (typeof document === 'undefined') return null;
  const unit = layer.unit;
  const H = unit._standeeHeight ?? 22;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uLevel: { value: 0 },
      uTime: { value: 0 },
      uTheme: { value: new THREE.Color(color) },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    fog: false,
  });
  // 火幕几何与本体共享（随 setArt 自愈重绑）——缩放定形：宽 1.3 倍**溢出剪影两侧**
  // （火舌要在背景上可见，躲在立绘后面等于没火——腐苔球那种近圆体型本体比 H 还宽，
  // 按 H 定宽必被挡死），高 0.78 罩下半身，底边贴脚底
  const mesh = new THREE.Mesh(unit._body.geometry, mat);
  mesh.name = 'bodyFlames';
  mesh.scale.set(1.3, 0.78, 1);
  mesh.position.set(0, H * 0.39, 0.55); // L1 z 槽位（见 unitFxLayer 约定）
  const group = new THREE.Group();
  group.name = 'bodyFlamesGroup';
  group.add(mesh);
  layer.groups[1].add(group);
  let level = 0;
  const untick = unit.addTick(() => {
    group.visible = level > 0.02 && !unit._dead; // 尸体上不放火（orbs 同律）
    // setArt 自愈：本体几何被原位替换（旧几何销掉）——逐帧核对重绑共享引用
    if (mesh.geometry !== unit._body.geometry) mesh.geometry = unit._body.geometry;
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
    /** 总控标量 0..1：火幕强度（enter 渐升 / stacks 强弱 / exit 渐熄全推它）。 */
    setLevel(l) { level = Math.max(0, Math.min(1, l)); },
    dispose,
  };
}
