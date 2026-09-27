// 卡牌本体特效（C0 牌面着色层）——WebGPU 迁移 TSL 版（2026-09-27，原 onBeforeCompile 字符串补丁重写）。
// 范式与 unitBodyFx.js 同源（W3 立，细则见该文件头注）：uniform = TSL uniform() 节点
// （`.value` 推值口径不变，CardFxLayer/CardObject 调用点零改动）；着色链 = TSL Fn 组合；
// colorNode 全量接管 diffuse（base = materialColor）；牌面纹理经
// _setBakedFace 异步落地 → 落地后 rec.rebind() 建链。
// ⚠ TSL 的 materialColor 已含 map（MaterialNode.COLOR = color × map）——
// 再乘一次 texture(map) = tex²，中调被平方压暗（2026-09-27 战斗画面偏暗根因，
// 实测板面 0.251²=0.063 与 FB 读数逐位吻合）；GLSL 版补丁作用于 map 之后无此坑。
// 效果语义与 GLSL 版逐式一致（视觉零回归）：
//   uBurn      0..1  焚毁吞蚀（离场演出）：自底向上噪声火线 + 炭化预热 + 逐格 discard；
//                    uBurn=0 时前沿线在牌面下方界外，天然无效果
//   uSeed            焚毁噪声种子（每张卡咬边形状不同，点燃时写入）
//   uDim       0..1  禁用态：去饱和 + 压暗 + 微冷
//   uHighlight 0..1  高亮态：提亮 + 微暖 + 极轻呼吸（uTime 驱动）
//   uTime            秒计时（CardFxLayer 的层内统一钟推进）
// 纪律：
//   · 只动 rgb，不碰 alpha——命中热区/透明度语义零影响；
//   · HDR 约定：焚毁火线峰 ~2.05 过 uiScene bloom 阈 1.45（既有视觉，刻意保留）；
//     状态档（dim/highlight）全部压阈下——状态是读数不是演出；
//   · 合成顺序固定：状态档 → 焚毁（焚毁最大，盖过一切状态）。
import {
  Fn, If, Discard, uniform, uv, materialColor,
  vec2, vec3, vec4, mix, sin, dot, floor, fract, oneMinus,
} from 'three/tsl';

const PATCH_KEY = '_cardBodyFx';

const cbfHash = Fn(([p]) =>
  fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453123)));

const cbfNoise = Fn(([p]) => {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(f.mul(-2.0).add(3.0));
  return mix(
    mix(cbfHash(i), cbfHash(i.add(vec2(1.0, 0.0))), u.x),
    mix(cbfHash(i.add(vec2(0.0, 1.0))), cbfHash(i.add(vec2(1.0, 1.0))), u.x),
    u.y);
});

// 状态档（C0 下段）：禁用压暗 / 高亮提暖
const cbfShade = Fn(([base, uDim, uHighlight, uTime]) => {
  const c = base.toVar();
  If(uDim.greaterThan(0.001), () => {
    const g = dot(c, vec3(0.299, 0.587, 0.114));
    c.assign(mix(c, vec3(g), uDim.mul(0.62)).mul(mix(1.0, 0.66, uDim)));
    c.assign(mix(c, c.mul(vec3(0.92, 0.97, 1.08)), uDim));
  });
  If(uHighlight.greaterThan(0.001), () => {
    const breath = sin(uTime.mul(2.4)).mul(0.5).add(0.5);
    c.mulAssign(uHighlight.mul(breath.mul(0.05).add(0.10)).add(1.0));
    c.assign(mix(c, c.mul(vec3(1.06, 1.03, 0.90)), uHighlight));
  });
  return c;
});

/**
 * 给牌面材质挂 C0 特效（幂等：已挂过直接取原记录）。
 * @returns {{ uBurn, uSeed, uDim, uHighlight, uTime, rebind: () => void }}
 */
export function attachCardBodyFx(material) {
  if (material.userData[PATCH_KEY]) return material.userData[PATCH_KEY];
  const rec = {
    uBurn: uniform(0),
    uSeed: uniform(0),
    uDim: uniform(0),
    uHighlight: uniform(0),
    uTime: uniform(0),
    // 牌面纹理落地（_setBakedFace 换脸）后调：重建 colorNode 链
    // （同构图命中 program 缓存，变换换脸只换纹理绑定不重编译）
    rebind: () => {
      if (!material.map) { material.colorNode = null; return; }
      // ⚠ TSL 纪律：If/Discard 必须在 Fn 栈内——整条合成包进一个 Fn 再调用
      material.colorNode = Fn(() => {
        // materialColor 已含 map（见文件头注⚠）——不许再乘 texture(material.map)
        const base = materialColor;
        const fxUv = uv();
        const c = cbfShade(base.rgb, rec.uDim, rec.uHighlight, rec.uTime).toVar();
        // 焚毁（C0 上段，离场演出）：双频值噪声咬边火线，自底向上吞蚀
        If(rec.uBurn.greaterThan(0.001), () => {
          const n = cbfNoise(fxUv.mul(vec2(5.0, 8.0)).add(vec2(rec.uSeed, rec.uSeed.mul(0.7)))).mul(0.6)
            .add(cbfNoise(fxUv.mul(vec2(11.0, 17.0)).sub(rec.uSeed)).mul(0.4));
          const line = rec.uBurn.mul(1.45).sub(0.2);              // 前沿自底向上推进（两端留噪声余量）
          const d = fxUv.y.sub(line).add(n.sub(0.5).mul(0.45));   // 距前沿的有符号距离
          If(d.lessThan(-0.05), () => {
            Discard();                                            // 已燃尽区域
          }).ElseIf(d.lessThan(0.02), () => {
            // 火线辉光带（深橙→亮黄，HDR 过阈）
            const g = oneMinus(d.add(0.05).div(0.07));
            const ember = mix(vec3(0.55, 0.12, 0.01), vec3(1.0, 0.88, 0.42), g.mul(g));
            c.assign(mix(c.mul(0.3), ember.mul(g.mul(0.9).add(1.15)), g));
          }).ElseIf(d.lessThan(0.16), () => {
            // 前沿上方炭化预热（焦黑泛红）
            const c1 = oneMinus(d.sub(0.02).div(0.14));
            c.assign(mix(c, c.mul(vec3(0.4, 0.26, 0.2)).add(vec3(0.09, 0.015, 0.0)), c1.mul(0.85)));
          });
        });
        return vec4(c, base.a);
      })();
      material.needsUpdate = true;
    },
  };
  material.userData[PATCH_KEY] = rec;
  if (material.map) rec.rebind();
  return rec;
}

/** 取已挂的记录（未挂 → null）。 */
export function cardBodyFxOf(material) { return material.userData[PATCH_KEY] ?? null; }
