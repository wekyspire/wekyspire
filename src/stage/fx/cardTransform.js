// 卡牌变换演出（多模式骨架，2026-09-26 用户设计）：
// 变换 = 旧脸 → 新脸的过渡。**双脸难题**的解法：预烘焙新脸纹理 + 叠层 shader
// 双纹理按 wipe 前锋分区同屏渲染，落幕一刻才 `applyBakedFace` 换脸——
// 叠层全程盖在牌面上（z=3，压过 veil/edge 一切特效层），底层脸不动，零切换跳变。
// 模式注册表 CARD_TRANSFORM_MODES：新模式 = 加一个函数 + 调用点传 mode。
//   charReveal（默认，用户稿）：从上到下 ① 旧脸焦化变黑 → ② 焦化锋后拖燃烧尾迹
//     （HDR 火线吃 uiScene bloom）→ ③ 烧过区在白光中显出新脸。双前锋结构：
//     焦化锋在前（快），显形锋滞后 0.22——火线即显形锋的刃口。
//   pulse（旧版留档）：瞬时换脸 + 金色迸发 + 放缩（调用方自行补放缩/粒子）。
// 生命周期纪律：演出挂在 view._transformCancel 上——视图销毁/二次变换时先掐死在途
//  tween（含预烘焙新纹理销毁），不泄漏不悬空；落幕正常换脸后纹理所有权移交牌面。
import * as THREE from 'three';
import gsap from 'gsap';

const VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// charReveal：双纹理 wipe。uProg 0→1 从上往下；n 噪声扰动前锋线（犬牙交错的烧蚀感）。
const FRAG_CHAR_REVEAL = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tOld;
uniform sampler2D tNew;
uniform float uProg;
uniform float uTime;
float vhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(vhash(i), vhash(i + vec2(1.0, 0.0)), u.x),
             mix(vhash(i + vec2(0.0, 1.0)), vhash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) { return vnoise(p) * 0.6 + vnoise(p * 2.17 + vec2(5.3, 8.1)) * 0.4; }
void main() {
  vec4 oldC = texture2D(tOld, vUv);
  vec4 newC = texture2D(tNew, vUv);
  float y = 1.0 - vUv.y;                                     // 从上往下 0→1
  float n = fbm(vUv * vec2(7.0, 10.0) + vec2(0.0, -uTime * 1.6));
  float frontChar = uProg * 1.35;                            // 焦化锋（快，在前）
  float frontShow = uProg * 1.35 - 0.22;                     // 显形锋（滞后，火线刃口）
  float dChar = frontChar - y + (n - 0.5) * 0.07;            // >0 = 已过焦化锋
  float dShow = frontShow - y + (n - 0.5) * 0.05;            // >0 = 已过显形锋
  float isChar = smoothstep(0.0, 0.02, dChar);
  float isNew = smoothstep(0.0, 0.025, dShow);
  // 焦化区：旧图压黑成炭 + 噪声斑驳（未烧透前还残留一点旧图影子）
  vec3 charC = oldC.rgb * (0.10 + 0.10 * n) + vec3(0.012, 0.010, 0.008);
  // 燃烧尾迹：显形锋刃口的 HDR 火线（uiScene bloom 拾取）
  float fireLine = exp(-abs(dShow) * 80.0);
  vec3 fire = vec3(2.7, 1.05, 0.22) * fireLine * (0.55 + 0.45 * n);
  // 焦化锋前缘暗红预告线（即将烧到）
  float scorch = exp(-abs(dChar) * 55.0) * (1.0 - isChar);
  // 新脸区：贴锋一段在白光中浮现（白光强度随距离指数衰减）
  float whiteK = exp(-max(0.0, (frontShow - y)) * 7.0);
  vec3 newShown = newC.rgb + vec3(1.5, 1.5, 1.6) * whiteK * whiteK;
  // 合成：旧脸(带焦化预告线) → 焦化区(+火线) → 新脸(+白光)
  vec3 c = mix(oldC.rgb + vec3(0.5, 0.1, 0.02) * scorch, charC + fire, isChar);
  c = mix(c, newShown, isNew);
  float a = mix(oldC.a, newC.a, isNew); // 圆角/透明随脸走（焦化段沿用旧脸 alpha）
  gl_FragColor = vec4(c, a);
}`;

/** 默认模式：焦化 → 燃烧尾迹 → 白光新脸。返回演出时长（ms，供节拍链留白）。 */
function charReveal(view, cardData, { bakeFace, onDone }) {
  const oldTex = view.faceMesh.material.map;      // 借用旧脸（所有权仍在牌面）
  const bakedNew = bakeFace(cardData);            // 预烘焙新脸（落幕一刻才换）
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      tOld: { value: oldTex },
      tNew: { value: bakedNew.texture },
      uProg: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG_CHAR_REVEAL,
    transparent: true,
    depthWrite: false,
  });
  const geo = new THREE.PlaneGeometry(view.cardWidth, view.cardHeight);
  const overlay = new THREE.Mesh(geo, mat);
  overlay.name = 'transformOverlay';
  overlay.position.z = 3; // 压过牌面一切特效层（veil 0.35~edge 0.6，见 CardFxLayer 约定）
  view.add(overlay);

  const DUR = 0.82; // 秒——双前锋跑完 + 白光收束
  const state = { prog: 0 };
  const t0 = performance.now();
  let tween = null;
  const cleanup = (applyFace) => {
    tween?.kill();
    view.remove(overlay);
    geo.dispose();
    mat.dispose();
    if (view._transformCancel === cancel) view._transformCancel = null;
    if (applyFace) {
      view.applyBakedFace(cardData, bakedNew); // 落幕换脸：纹理所有权移交牌面
    } else {
      bakedNew.texture.dispose(); // 中止：预烘焙纹理无人接盘，就地销
    }
  };
  const cancel = () => cleanup(false);
  view._transformCancel?.(); // 在途旧演出掐死（二次变换不叠层）
  view._transformCancel = cancel;
  tween = gsap.to(state, {
    prog: 1, duration: DUR, ease: 'power1.inOut',
    onUpdate: () => {
      mat.uniforms.uProg.value = state.prog;
      mat.uniforms.uTime.value = (performance.now() - t0) / 1000;
    },
    onComplete: () => { cleanup(true); onDone?.(); },
  });
  return DUR * 1000;
}

/** 旧版留档：瞬时换脸（放缩/金光由调用方自理）。 */
function pulse(view, cardData, { onDone }) {
  view.setCard(cardData);
  onDone?.();
  return 0;
}

/** 变换模式注册表：日后新模式 = 这里加一行 + 调用点传 mode。 */
export const CARD_TRANSFORM_MODES = {
  charReveal,
  pulse,
};

/**
 * 播卡牌变换演出。
 * @param {CardObject} view 卡牌视图（叠层挂为它的小孩，跟随位移/缩放/弹簧）
 * @param {object} cardData 新卡数据（落幕一刻经 applyBakedFace 成对替换纹理+hit map）
 * @param {object} opts { mode='charReveal', bakeFace, onDone }
 * @returns 演出时长 ms
 */
export function playCardTransform(view, cardData, { mode = 'charReveal', bakeFace, onDone } = {}) {
  const impl = CARD_TRANSFORM_MODES[mode] ?? charReveal;
  return impl(view, cardData, { bakeFace, onDone });
}
