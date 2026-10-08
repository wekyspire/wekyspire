// 卡牌本体特效（C0 牌面着色层）——WebGPU 迁移 TSL 版（原 onBeforeCompile 字符串补丁重写）。
// 范式与 unitBodyFx.js 同源（W3 立，细则见该文件头注）：uniform = TSL uniform() 节点
// （`.value` 推值口径不变，CardFxLayer/CardObject 调用点零改动）；着色链 = TSL Fn 组合；
// colorNode 全量接管 diffuse（base = materialColor）；牌面纹理经
// _setBakedFace 异步落地 → 落地后 rec.rebind() 建链。
// ⚠ TSL 的 materialColor 已含 map（MaterialNode.COLOR = color × map）——
// 再乘一次 texture(map) = tex²，中调被平方压暗（战斗画面偏暗根因，
// 实测板面 0.251²=0.063 与 FB 读数逐位吻合）；GLSL 版补丁作用于 map 之后无此坑。
// 效果语义与 GLSL 版逐式一致（视觉零回归）：
//   uBurn      0..1  焚毁吞蚀（离场演出）：自底向上噪声火线 + 炭化预热 + 逐格 discard；
//                    uBurn=0 时前沿线在牌面下方界外，天然无效果
//   uSeed            焚毁噪声种子（每张卡咬边形状不同，点燃时写入）
//   uDim       0..1  禁用态：去饱和 + 压暗 + 微冷
//   uHighlight 0..1  高亮态：提亮 + 微暖 + 极轻呼吸（uTime 驱动）
//   uCostGlow  0..1  费用徽章辉光（出牌消耗反馈）：徽章 mask 内
//                    原色 ×4——徽章数字/图标等高亮像素被拉过 bloom 阈 1.45 起晕，
//                    暗环乘完仍暗，天然「只有图案在发光」；另叠阈下加色保底可读性。
//                    （×4 的冗余是为衰减后段留的：uCostGlow≈0.5 时峰值仍过阈。）
//                    徽章位置 = rec.costBadges（CardObject._setBakedFace 按 cardFace.js
//                    的 costBadgeUvs 填，rebind 时静态烘进 mask——换脸自动跟随）
//   uReact     0..n  反应演出包络（受益/副作用发动，峰 = intensity）：JS 侧
//                    攻击→保持→衰减推进；uReactKind 选配方（CARD_REACT_MODES），
//                    uReactTime 为触发起秒（扫掠/扩散相位），uReactSeed 逐次随机。
//                    受益配方峰过 bloom 阈（「流入的能量」会起晕），副作用配方压阈下
//                    （焦蚀/瘀斑/崩裂是沉下去的读感，不发光）。
//   uTime            秒计时（CardFxLayer 的层内统一钟推进）
// 纪律：
//   · 只动 rgb，不碰 alpha——命中热区/透明度语义零影响；
//   · HDR 约定：焚毁火线峰 ~2.05 与徽章辉光 ×3.4、反应受益配方过 uiScene bloom 阈 1.45
//     （刻意保留）；状态档（dim/highlight）与副作用反应全部压阈下——状态是读数不是演出；
//   · 合成顺序固定：状态档 → 徽章辉光 → 反应 → 焚毁（焚毁最大，盖过一切状态）。
import {
  Fn, If, Discard, uniform, uv, materialColor,
  vec2, vec3, vec4, mix, sin, dot, floor, fract, oneMinus, length, smoothstep,
  min, pow, exp, abs, step, clamp,
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

// 反应配方 mode 词汇（uReactKind 取值）：体系 × 极性。体系归属 = 卡 type
// （fire/wood/air…）优先，type 'normal' 的体系卡按 series 归宗（刀/拳/格挡）。
export const CARD_REACT_MODES = {
  fire: { benefit: 1, backfire: 2 },
  blade: { benefit: 3, backfire: 4 },
  body: { benefit: 5, backfire: 6 },
  block: { benefit: 7, backfire: 8 },
  normal: { benefit: 9, backfire: 10 },
};
const SERIES_SYSTEM = { blade: 'blade', fist: 'body', block: 'block' };

/** 卡投影 + 极性 → 配方 mode（无专属配方的体系回落通用档）。 */
export function cardReactMode(cardData, kind) {
  const sys = cardData?.type && cardData.type !== 'normal'
    ? cardData.type
    : (SERIES_SYSTEM[cardData?.series] ?? 'normal');
  return CARD_REACT_MODES[sys]?.[kind] ?? CARD_REACT_MODES.normal[kind] ?? 9;
}

// ---- 反应配方（C0 中段，受益/副作用发动）--------------------------------------
// 每体系一对：benefit = 能量流入牌面（暖亮、过阈起晕）；backfire = 代价渗出
// （焦化/瘀斑/崩裂，压暗阈下）。env = 包络（0..峰值），t = 触发起秒，seed = 逐次随机。
const cbfReact = Fn(([c, fxUv, rec]) => {
  const env = rec.uReact;
  const t = rec.uReactTime;
  const seed = rec.uReactSeed;
  const o = c.toVar();
  const edgeD = min(min(fxUv.x, oneMinus(fxUv.x)), min(fxUv.y, oneMinus(fxUv.y)));

  // fire benefit：火脉自底缘涌入（上飘噪声脉 × 底部强势 mask），整体暖提
  If(rec.uReactKind.equal(1), () => {
    const n = cbfNoise(fxUv.mul(vec2(5.0, 7.0)).add(vec2(seed, seed.mul(0.7))).sub(vec2(0.0, t.mul(1.4))));
    const vein = pow(n, 3.0).mul(oneMinus(smoothstep(0.15, 0.85, fxUv.y))).mul(env);
    const fireCol = mix(vec3(1.0, 0.42, 0.08), vec3(1.0, 0.85, 0.35), env.mul(0.7));
    o.assign(mix(o, o.mul(vec3(1.25, 1.05, 0.85)), env.mul(0.5)));
    o.addAssign(fireCol.mul(vein).mul(3.2));
  });
  // fire backfire：焦黑自边缘向里爬 + 暗红裂线，压暗阈下
  If(rec.uReactKind.equal(2), () => {
    const n = cbfNoise(fxUv.mul(vec2(7.0, 9.0)).add(vec2(seed, seed)));
    const creep = oneMinus(smoothstep(0.0, 0.30, edgeD.sub(env.mul(0.22)).add(n.sub(0.5).mul(0.18))));
    const crack = pow(oneMinus(abs(n.mul(2.0).sub(1.0))), 6.0);
    o.assign(mix(o, o.mul(vec3(0.30, 0.22, 0.18)), creep.mul(env).mul(0.85)));
    o.addAssign(vec3(0.55, 0.08, 0.02).mul(crack).mul(creep).mul(env).mul(0.9));
  });
  // blade benefit：白热锤击线对角扫过 + 沿线火星散点（淬火一瞬）
  If(rec.uReactKind.equal(3), () => {
    const diag = fxUv.x.add(fxUv.y).mul(0.5);
    const pos = clamp(t.mul(3.2), 0.0, 1.0).mul(1.3).sub(0.15);
    const band = exp(abs(diag.sub(pos)).mul(-26.0));
    const sparkN = cbfHash(floor(fxUv.mul(vec2(30.0, 40.0))).add(floor(t.mul(20.0))));
    o.addAssign(vec3(0.85, 0.92, 1.05).mul(band).mul(env).mul(3.0));
    o.addAssign(vec3(1.0, 0.75, 0.35).mul(step(0.93, sparkN).mul(band)).mul(env).mul(2.2));
  });
  // blade backfire：钝蚀——去饱和 + 蚀斑压暗
  If(rec.uReactKind.equal(4), () => {
    const g = dot(o, vec3(0.299, 0.587, 0.114));
    const pit = step(0.72, cbfNoise(fxUv.mul(vec2(9.0, 12.0)).add(seed)));
    o.assign(mix(o, vec3(g), env.mul(0.5)));
    o.assign(mix(o, o.mul(vec3(0.45, 0.42, 0.40)), pit.mul(env).mul(0.7)));
  });
  // body benefit：气血径向涌波（中心偏下起，随时间外扩）
  If(rec.uReactKind.equal(5), () => {
    const r = length(fxUv.sub(vec2(0.5, 0.35)));
    const wave = exp(abs(r.sub(t.mul(0.9))).mul(-10.0));
    o.assign(mix(o, o.mul(vec3(1.3, 0.95, 0.75)), env.mul(0.45)));
    o.addAssign(vec3(1.0, 0.35, 0.15).mul(wave).mul(env).mul(2.4));
  });
  // body backfire：瘀斑渗开 + 整体沉
  If(rec.uReactKind.equal(6), () => {
    const n = cbfNoise(fxUv.mul(vec2(4.0, 5.5)).add(vec2(seed.mul(1.3), seed)));
    const blotch = smoothstep(0.45, 0.75, n);
    o.assign(mix(o, o.mul(vec3(0.55, 0.35, 0.60)), blotch.mul(env).mul(0.8)));
    o.mulAssign(oneMinus(env.mul(0.25)));
  });
  // block benefit：加固——四边金亮内收环 + 微提
  If(rec.uReactKind.equal(7), () => {
    const rim = exp(edgeD.mul(-9.0));
    o.addAssign(vec3(1.0, 0.82, 0.40).mul(rim).mul(env).mul(2.6));
    o.assign(mix(o, o.mul(vec3(1.12, 1.08, 0.95)), env.mul(0.35)));
  });
  // block backfire：崩裂——细白裂纹 + 压暗
  If(rec.uReactKind.equal(8), () => {
    const n = cbfNoise(fxUv.mul(vec2(8.0, 11.0)).add(seed));
    const crack = pow(oneMinus(abs(n.mul(2.0).sub(1.0))), 8.0);
    o.mulAssign(oneMinus(env.mul(0.30)));
    o.addAssign(vec3(0.75, 0.78, 0.85).mul(crack).mul(env).mul(1.1));
  });
  // generic benefit：柔金提亮 + 细闪点
  If(rec.uReactKind.equal(9), () => {
    o.assign(mix(o, o.mul(vec3(1.20, 1.12, 0.95)), env.mul(0.6)));
    const tw = step(0.90, cbfHash(floor(fxUv.mul(vec2(24.0, 32.0))).add(floor(t.mul(14.0)))));
    o.addAssign(vec3(1.0, 0.95, 0.75).mul(tw).mul(env).mul(1.6));
  });
  // generic backfire：灰黯沉降
  If(rec.uReactKind.equal(10), () => {
    const g = dot(o, vec3(0.299, 0.587, 0.114));
    o.assign(mix(o, vec3(g.mul(0.55)), env.mul(0.7)));
  });
  return o;
});

/**
 * 给牌面材质挂 C0 特效（幂等：已挂过直接取原记录）。
 * @returns {{ uBurn, uSeed, uDim, uHighlight, uTime, uCostGlow, uReact, uReactKind, uReactTime, uReactSeed, costBadges, rebind: () => void }}
 */
export function attachCardBodyFx(material) {
  if (material.userData[PATCH_KEY]) return material.userData[PATCH_KEY];
  const rec = {
    uBurn: uniform(0),
    uSeed: uniform(0),
    uDim: uniform(0),
    uHighlight: uniform(0),
    uTime: uniform(0),
    uCostGlow: uniform(0),
    uReact: uniform(0),
    uReactKind: uniform(0),
    uReactTime: uniform(0),
    uReactSeed: uniform(0),
    // 出席费用徽章 [{kind:'mana'|'ap', u, vTop}]（纹理 uv，v 顶起）——
    // CardObject._setBakedFace 按 cardFace.costBadgeUvs 填；rebind 烘成 mask 常量
    costBadges: [],
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
        // 费用徽章辉光（出牌消耗反馈）：徽章 mask 内原色 ×4 拉爆 HDR——高亮图案
        // 像素过 bloom 阈起晕，暗环乘完仍暗（「只有徽章图案在发光」，光晕由 bloom
        // pass 代劳）；再叠阈下同色加色保底徽章整体可读。构建期按 costBadges 静态
        // 展开（≤2 枚；空数组 = 整段无操作）。
        If(rec.uCostGlow.greaterThan(0.001), () => {
          for (const b of rec.costBadges) {
            // uv 底起 ↔ 徽章 v 顶起；像素距离（×200/270 还原等比圆）
            const dPx = fxUv.sub(vec2(b.u, 1.0 - b.vTop)).mul(vec2(200.0, 270.0));
            const m = oneMinus(smoothstep(10.5, 12.5, length(dPx)));
            const tint = b.kind === 'mana' ? vec3(0.35, 0.55, 1.0) : vec3(1.0, 0.78, 0.3);
            c.assign(mix(c, c.mul(4.0), m.mul(rec.uCostGlow)));
            c.addAssign(tint.mul(m).mul(rec.uCostGlow).mul(0.3));
          }
        });
        // 反应演出（受益/副作用发动，配方见 cbfReact；包络 JS 侧推进）
        If(rec.uReact.greaterThan(0.001), () => {
          c.assign(cbfReact(c, fxUv, rec));
        });
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
