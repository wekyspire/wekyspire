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
// WebGPU 迁移（2026-09-27，原裸 GLSL 内嵌 shader 重写为 TSL）：范式与 fx/unitBodyFx.js
// 同源——uniform = TSL uniform() 节点（tween onUpdate 推 `.value` 口径不变）；着色链 =
// TSL Fn 组合（本式纯算式无控制流，不必进 If）；双纹理采样 texture(map, uv())；
// 材质改 MeshBasicNodeMaterial，colorNode 全量接管输出（vec4 的 a 通道即片元透明度）。
import * as THREE from 'three';
import gsap from 'gsap';
import {
  Fn, uniform, texture, uv,
  vec2, vec3, vec4, mix, abs, max, exp, floor, fract, sin, dot, smoothstep, oneMinus,
} from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';

const vhash = Fn(([p]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)));
const vnoise = Fn(([p]) => {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(f.mul(-2.0).add(3.0));
  return mix(
    mix(vhash(i), vhash(i.add(vec2(1.0, 0.0))), u.x),
    mix(vhash(i.add(vec2(0.0, 1.0))), vhash(i.add(vec2(1.0, 1.0))), u.x),
    u.y);
});
const fbm = Fn(([p]) =>
  vnoise(p).mul(0.6).add(vnoise(p.mul(2.17).add(vec2(5.3, 8.1))).mul(0.4)));

// charReveal：双纹理 wipe（原 FRAG_CHAR_REVEAL 逐式平移）。uProg 0→1 从上往下；
// n 噪声扰动前锋线（犬牙交错的烧蚀感）。oldC/newC = 采样好的 vec4（调用点传入）。
const crShade = Fn(([oldC, newC, uProg, uTime]) => {
  const y = oneMinus(uv().y);                                     // 从上往下 0→1
  const n = fbm(uv().mul(vec2(7.0, 10.0)).add(vec2(0.0, uTime.mul(-1.6))));
  const frontChar = uProg.mul(1.35);                              // 焦化锋（快，在前）
  const frontShow = uProg.mul(1.35).sub(0.22);                    // 显形锋（滞后，火线刃口）
  const dChar = frontChar.sub(y).add(n.sub(0.5).mul(0.07));       // >0 = 已过焦化锋
  const dShow = frontShow.sub(y).add(n.sub(0.5).mul(0.05));       // >0 = 已过显形锋
  const isChar = smoothstep(0.0, 0.02, dChar);
  const isNew = smoothstep(0.0, 0.025, dShow);
  // 焦化区：旧图压黑成炭 + 噪声斑驳（未烧透前还残留一点旧图影子）
  const charC = oldC.rgb.mul(n.mul(0.10).add(0.10)).add(vec3(0.012, 0.010, 0.008));
  // 燃烧尾迹：显形锋刃口的 HDR 火线（uiScene bloom 拾取）
  const fireLine = exp(abs(dShow).mul(-80.0));
  const fire = vec3(2.7, 1.05, 0.22).mul(fireLine).mul(n.mul(0.45).add(0.55));
  // 焦化锋前缘暗红预告线（即将烧到）
  const scorch = exp(abs(dChar).mul(-55.0)).mul(oneMinus(isChar));
  // 新脸区：贴锋一段在白光中浮现（白光强度随距离指数衰减）——白光推到 HDR 2.6+
  // （bloom 阈 1.45 以上），white-in 区自然起晕（用户 2026-09-27：前沿要吃到辉光）
  const whiteK = exp(max(frontShow.sub(y), 0.0).mul(-6.0));
  const newShown = newC.rgb.add(vec3(2.6, 2.7, 3.0).mul(whiteK).mul(whiteK));
  // 合成：旧脸(带焦化预告线) → 焦化区(+火线) → 新脸(+白光)
  const c = mix(oldC.rgb.add(vec3(0.5, 0.1, 0.02).mul(scorch)), charC.add(fire), isChar).toVar();
  c.assign(mix(c, newShown, isNew));
  // 白热刃口：骑在显形锋线上的一条高 HDR 白（峰值 ~5.6，远超 bloom 阈）——
  // 推进前沿的发光特效不做贴图不做粒子，就输出白热色让 bloom 自然晕开；
  // 噪声调制造犬牙交错的闪烁刃口（与前锋扰动同源）
  const edgeW = exp(abs(dShow).mul(-30.0)).mul(n.mul(0.30).add(0.70));
  c.addAssign(vec3(5.4, 5.6, 6.2).mul(edgeW));
  const a = mix(oldC.a, newC.a, isNew); // 圆角/透明随脸走（焦化段沿用旧脸 alpha）
  return vec4(c, a);
});

/** 默认模式：焦化 → 燃烧尾迹 → 白光新脸。返回演出时长（ms，供节拍链留白）。 */
function charReveal(view, cardData, { bakeFace, onDone }) {
  const oldTex = view.faceMesh.material.map;      // 借用旧脸（所有权仍在牌面）
  const bakedNew = bakeFace(cardData);            // 预烘焙新脸（落幕一刻才换）
  const uProg = uniform(0);
  const uTime = uniform(0);
  const mat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  // colorNode 全量接管输出（vec4.a = 片元透明度）；双纹理在调用点采样进 Fn
  mat.colorNode = crShade(
    texture(oldTex, uv()), texture(bakedNew.texture, uv()), uProg, uTime);
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
      uProg.value = state.prog;
      uTime.value = (performance.now() - t0) / 1000;
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
