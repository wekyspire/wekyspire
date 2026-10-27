// Boss 剧本：腐败之源（corruptSource，11 层 Boss 池·召唤干扰流）。
// 一只 Boss 的全部自定义演出聚合在本文件（内容归属原则，同 pyro.js）。
//
// 主题：**地面就是它的身体**。它不走动、不扑击，所有动作都从土里长出来：
//   · 根——根须疾走（地下的东西在跑）、根刺破土（打击）、根苞裂开（召唤）；
//   · 眼——立绘左上方那只琥珀独眼，全剧唯一暖色；每次施法它先亮；
//   · 腐——腐息（贴地滚动的腐雾 → 缠身抽丝）、孢子雾常驻。
//
// 色彩纪律：**腐败是暗、湿、钝的**。亮绿是辐射/生机的语言，全库禁用；主体色 =
// 近黑腐土 + 暗湿木 + 灰褐湿边 + 少量霉白/菌黄（立绘树皮与苔痕同源）。
// 形状纪律：一切团块化——根瘤、菌斑、湿渍、球状鼓包；不画「发光线条」。
//
// 世界空间纪律：大件一律真深度测试（depthTest:true，只做加法光不写深度），
// 地面件贴地 0.1~0.2，被单位/墙体正确遮挡。禁止 depthTest:false 的大面片。
//
// 拍表：
//   酝酿（首拍不动作）：独眼睁开 → 根网从桩脚铺满地面 → 孢子雾漫起（常驻开场）
//   召唤：桩体一压 → 分叉根须沿地底疾走到新芽位 → 到来处结瘤 → 根苞破土
//   腐息（虚弱+脆弱）：吸气（菌丝汇向桩顶）→ 贴地腐雾团滚到玩家脚边 → 缠身 + 反向抽丝
//   回血：桩脚脉冲 → 菌丝连到每个友军脚下 → 根苞 + 养分上涌
//   力量：根网收缩蓄力（前摇）→ 每个友军脚下根刺爆起（力量注入）
//   3×3：三道根须错峰疾走 → 命中拍逐记根刺破土 + 腐液抽痕
//   受击（它挨打）：木屑崩落 + 树汁 + 菌网一缩 + 独眼一眨
//   死亡：眼熄 → 根网回收 → 树体灰塌（孢子一次性释放）
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Fn, uniform, uv as uvOf, mix, attribute, positionLocal,
  vec2, vec3, vec4, float, sin, exp, smoothstep, oneMinus, abs, clamp, floor, fract,
  length, max,
} from 'three/tsl';
import { duelPose } from '../../camera.js';
import { slotTransform } from '../../../scenes/index.js';
import { screenFlash, lampPulse } from '../../spells/blocks.js';
import { registerEnemyHitBeat, registerEnemyNoLunge } from '../../spells/enemyHitFx.js';
import { registerEnemyAct } from '../enemyAct.js';
import { registerBossStateFx, registerBossHurtFx } from '../../bossStateFx.js';
import { makeSporeVeins } from '../../sporeVeins.js';
import { registerEnemyDeathBeat } from '../../enemyLifeFx.js';
import { unitH, drainVeins } from '../enemies/fxPieces.js';
import { isAttackKind, isBuffKind, isDebuffKind } from '../../../../core/intentKinds.js';
import { DEFAULT_MAX_ENEMIES } from '../../../../core/state/battleState.js';

const rand = (a, b) => a + Math.random() * (b - a);

// 腐沼色板（加法光用法：数值即「加进来的亮度」，峰值压在 bloom 阈下）
// deep 近黑腐土 / soil 暗湿土 / wood 湿木 / wet 灰褐湿边 / pale 霉白 / lich 菌黄 / bruise 坏血
const PAL = {
  deep: [0.045, 0.038, 0.030],
  soil: [0.105, 0.090, 0.066],
  wood: [0.200, 0.168, 0.120],
  wet: [0.365, 0.335, 0.262],
  pale: [0.450, 0.420, 0.334],
  lich: [0.300, 0.315, 0.202],
  bruise: [0.165, 0.105, 0.112],
};
const pal = () => ({
  deep: vec3(...PAL.deep),
  soil: vec3(...PAL.soil),
  wood: vec3(...PAL.wood),
  wet: vec3(...PAL.wet),
  pale: vec3(...PAL.pale),
  lich: vec3(...PAL.lich),
  bruise: vec3(...PAL.bruise),
});

// 粒子色（对象池 Color）
const PX = {
  soil: 0x40352a,
  damp: 0x54483a,
  spore: 0x827a63,
  sap: 0x6b5c3e,
  rot: 0x37301f,
};

// 普通混合面片（暗部实体：湿渍/雾体/缠身腐块）。深度测试同样打开。
function murkQuad({ shade, width, height, name, order = 24 }) {
  const geo = new THREE.PlaneGeometry(width, height);
  const mat = new MeshBasicNodeMaterial({
    transparent: true, depthWrite: false, depthTest: true, fog: false,
  });
  mat.colorNode = shade;
  const quad = new THREE.Mesh(geo, mat);
  quad.name = name;
  quad.renderOrder = order;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    quad.parent?.remove(quad);
    geo.dispose();
    mat.dispose();
  };
  return { quad, release };
}

// 给单位打一拍染色并按时归还（flash 不自愈——不归还会一直染着）。
async function tintPulse(ctx, unit, hex, ms = 340) {
  if (!unit?.flash) return;
  unit.flash(hex);
  await ctx.wait(ms);
  unit.restoreColor?.();
}

// ---------------------------------------------------------------------------
// 贴图（模块级缓存）
// ---------------------------------------------------------------------------

// 独眼琥珀光：暖色是腐沼里唯一的暖光——焦点全靠它
let _eyeTex = null;
function eyeTexture() {
  if (_eyeTex) return _eyeTex;
  if (typeof document === 'undefined') return null;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  let grad = g.createRadialGradient(64, 64, 1, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,246,206,1)');
  grad.addColorStop(0.16, 'rgba(255,206,96,0.92)');
  grad.addColorStop(0.42, 'rgba(206,138,32,0.38)');
  grad.addColorStop(1, 'rgba(120,72,12,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  // 横向视线光斑（眼睛在「看」）
  g.globalCompositeOperation = 'lighter';
  grad = g.createLinearGradient(6, 64, 122, 64);
  grad.addColorStop(0, 'rgba(255,186,64,0)');
  grad.addColorStop(0.5, 'rgba(255,236,176,0.55)');
  grad.addColorStop(1, 'rgba(255,186,64,0)');
  g.fillStyle = grad;
  g.fillRect(6, 60, 116, 8);
  _eyeTex = new THREE.CanvasTexture(c);
  _eyeTex.colorSpace = THREE.SRGBColorSpace;
  return _eyeTex;
}

// 木屑（它挨打时崩下来的碎块）：带湿棱的暗朽木薄片
let _splinterTex = null;
function splinterTexture() {
  if (_splinterTex) return _splinterTex;
  if (typeof document === 'undefined') return null;
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.beginPath();
  g.moveTo(10, 26); g.lineTo(50, 10); g.lineTo(58, 30); g.lineTo(20, 52); g.closePath();
  const grad = g.createLinearGradient(12, 48, 54, 12);
  grad.addColorStop(0, 'rgba(32,26,18,0.95)');
  grad.addColorStop(0.62, 'rgba(78,64,44,0.95)');
  grad.addColorStop(1, 'rgba(132,112,80,1)');
  g.fillStyle = grad;
  g.fill();
  g.strokeStyle = 'rgba(178,158,118,0.7)';
  g.lineWidth = 2.4;
  g.beginPath(); g.moveTo(14, 28); g.lineTo(52, 14); g.stroke();
  _splinterTex = new THREE.CanvasTexture(c);
  _splinterTex.colorSpace = THREE.SRGBColorSpace;
  return _splinterTex;
}

// ---------------------------------------------------------------------------
// 地根网（常驻件 + 酝酿铺开）
// ---------------------------------------------------------------------------

// 9 条不对称主根的参数（构造期落常量）。len/amp 都以 UV 半幅为 1：
// len 0.40 ≈ quad 边长的 0.20，铺满后恰好收在边缘熄灭带以内，不会被画布边切。
const FIELD_ROOTS = (() => {
  const rnd = (i, k) => {
    const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };
  const out = [];
  for (let i = 0; i < 12; i++) {
    out.push({
      k: i,
      ang: (i / 12) * Math.PI * 2 + (rnd(i, 1) - 0.5) * 0.34,
      len: 0.24 + rnd(i, 2) * 0.14,
      w: 0.95 + rnd(i, 3) * 0.75,
      amp: 1.5 + rnd(i, 4) * 1.5,
      freq: 1.2 + rnd(i, 5) * 1.5,
      ph: rnd(i, 6) * 6.283,
      delay: 0.02 + rnd(i, 7) * 0.16,
      dur: 0.30 + rnd(i, 8) * 0.26,
      gain: 0.72 + rnd(i, 9) * 0.42,
      k1: 0.24 + rnd(i, 10) * 0.16,
      k2: 0.50 + rnd(i, 11) * 0.22,
    });
  }
  return out;
})();

// 地根网：平躺 quad，9 条根系从中心向四周爬。每条根 = 端点锚定双频 S 弯
// （世界单位振幅）+ 不规则粗细（低频鼓包 = 根瘤）+ 单侧湿亮边 + 稀疏霉斑；
// 根锋是一个球状根瘤（不是行进亮点）。uS = (生长进度, 施法脉冲, 亮度, 时间)。
function makeRootFieldShade() {
  return Fn(([vUv, uS, uCfg]) => {
    const C = pal();
    const p = vec2(vUv.x.sub(float(0.5)), vUv.y.sub(float(0.5))).toVar();
    const size = uCfg.x, seed = uCfg.y;
    const prog = uS.x, pulse = uS.y, level = uS.z, tm = uS.w;
    const hash2 = (ix, iy) => fract(
      sin(ix.mul(float(127.1)).add(iy.mul(float(311.7))).add(seed.mul(float(0.713))))
        .mul(float(43758.545)));
    const vn2 = (qx, qy) => {
      const ix = floor(qx), iy = floor(qy);
      const fx = fract(qx), fy = fract(qy);
      const wx = fx.mul(fx).mul(float(3.0).sub(fx.mul(float(2.0))));
      const wy = fy.mul(fy).mul(float(3.0).sub(fy.mul(float(2.0))));
      const a = hash2(ix, iy), b = hash2(ix.add(float(1.0)), iy);
      const c = hash2(ix, iy.add(float(1.0))), d = hash2(ix.add(float(1.0)), iy.add(float(1.0)));
      const top = a.add(b.sub(a).mul(wx));
      const bot = c.add(d.sub(c).mul(wx));
      return top.add(bot.sub(top).mul(wy));
    };
    let coreAcc = float(0.0), hiAcc = float(0.0), lichAcc = float(0.0);
    for (const R of FIELD_ROOTS) {
      const ca = Math.cos(R.ang), sa = Math.sin(R.ang);
      const along = p.x.mul(float(ca)).add(p.y.mul(float(sa))).toVar();
      const latW = p.x.mul(float(-sa)).add(p.y.mul(float(ca))).mul(size).toVar();
      const lenP = float(R.len);
      const s = clamp(along.div(lenP), float(0.0), float(1.0)).toVar();
      const front = smoothstep(float(R.delay), float(R.delay + R.dur), prog).toVar();
      const head = front.mul(lenP).toVar();
      const behind = oneMinus(smoothstep(head.sub(float(0.010)), head.add(float(0.002)), along)).toVar();
      const ahead = smoothstep(float(-0.006), float(0.008), along).toVar();
      const env = sin(s.mul(float(Math.PI))).mul(s).toVar();
      const wob = sin(s.mul(float(R.freq * Math.PI)).add(float(R.ph)).add(seed))
        .mul(float(R.amp)).mul(env)
        .add(sin(s.mul(float(R.freq * 2.3 * Math.PI)).add(float(R.ph * 1.7 + 1.1)))
          .mul(float(R.amp * 0.32)).mul(env))
        .toVar();
      const d = latW.sub(wob).toVar();
      const knot = (s0) => {
        const ds = s.sub(float(s0));
        return exp(ds.mul(ds).mul(float(-240.0)));
      };
      const lumps = sin(s.mul(float(7.5)).add(float(R.ph * 2.1)).add(seed)).mul(float(0.36))
        .add(sin(s.mul(float(16.0)).add(float(R.ph))).mul(float(0.18)))
        .add(knot(R.k1).mul(float(0.80)))
        .add(knot(R.k2).mul(float(0.55)))
        .add(float(1.0))
        .toVar();
      const w = float(R.w).mul(float(1.0).sub(s.mul(float(0.58)))).mul(lumps).add(float(0.30)).toVar();
      const q = d.div(w).toVar();
      const core = exp(q.mul(q).mul(float(-1.55))).toVar();
      const qr = q.sub(float(0.62));
      const rim = exp(qr.mul(qr).mul(float(-12.0))).toVar();
      const qs = q.add(float(0.56));
      const sheen = exp(qs.mul(qs).mul(float(-20.0))).toVar();
      const halo = exp(q.mul(q).mul(float(-0.16))).toVar();
      // 霉斑：世界尺度的散点，长在根体上（阈值化，不成毯）
      const cell = hash2(floor(along.mul(size).mul(float(0.85))).add(float(R.k * 13.0)), floor(latW.mul(0.85)));
      const mould = smoothstep(float(0.86), float(0.94), cell).toVar();
      // 根锋根瘤：球状鼓包 + 湿边（不是亮点）
      const tipD = along.sub(head);
      const tip = exp(tipD.mul(tipD).div(float(0.00035)).mul(float(-1.0))).mul(front).toVar();
      const on = behind.mul(ahead).mul(float(R.gain));
      coreAcc = coreAcc.add(core.mul(on));
      hiAcc = hiAcc.add(rim.add(sheen.mul(float(0.55))).mul(on));
      lichAcc = lichAcc.add(mould.mul(core).mul(on));
    }
    const breath = sin(tm.mul(float(0.9)).add(seed)).mul(float(0.09)).add(float(0.91));
    const edge = oneMinus(smoothstep(float(0.44), float(0.50), length(p)));
    const gain = level.mul(breath).mul(float(1.0).add(pulse.mul(float(0.35))));
    // 普通混合：根体压暗地面（暗湿泥），湿边/霉斑给浅色高光——不是发光线
    const mask = clamp(coreAcc.mul(float(0.92)).add(hiAcc.mul(float(0.30))), float(0.0), float(1.0))
      .mul(gain).mul(edge);
    const hi = clamp(hiAcc.mul(float(0.85)).add(lichAcc.mul(float(0.65))), float(0.0), float(1.0));
    const rgb = mix(C.deep.mul(float(0.70)), C.wet.mul(float(0.95)), hi)
      .add(C.lich.mul(lichAcc.mul(float(0.26))))
      .toVar();
    return vec4(rgb, mask.mul(float(0.95)));
  });
}

// 根网下的湿渍层（普通混合 = 真压暗）：一大片不规则腐土，让根「长在脏东西上」。
// uS 与根网共用（进度/脉冲/亮度/时间）。
function makeFieldStainShade() {
  return Fn(([vUv, uS, uSeed]) => {
    const p = vec2(vUv.x.sub(float(0.5)), vUv.y.sub(float(0.5))).mul(float(2.0)).toVar();
    const r = length(p).toVar();
    const hash2 = (ix, iy) => fract(
      sin(ix.mul(float(127.1)).add(iy.mul(float(311.7))).add(uSeed.mul(float(0.531))))
        .mul(float(43758.545)));
    const vn2 = (qx, qy) => {
      const ix = floor(qx), iy = floor(qy);
      const fx = fract(qx), fy = fract(qy);
      const wx = fx.mul(fx).mul(float(3.0).sub(fx.mul(float(2.0))));
      const wy = fy.mul(fy).mul(float(3.0).sub(fy.mul(float(2.0))));
      const a = hash2(ix, iy), b = hash2(ix.add(float(1.0)), iy);
      const c = hash2(ix, iy.add(float(1.0))), d = hash2(ix.add(float(1.0)), iy.add(float(1.0)));
      const top = a.add(b.sub(a).mul(wx));
      const bot = c.add(d.sub(c).mul(wx));
      return top.add(bot.sub(top).mul(wy));
    };
    const n = vn2(p.x.mul(float(2.6)).add(uSeed), p.y.mul(float(2.6)).sub(uSeed.mul(float(1.7)))).toVar();
    const n2 = vn2(p.x.mul(float(6.2)).sub(uSeed.mul(float(0.8))), p.y.mul(float(6.2)).add(uSeed)).toVar();
    const blot = smoothstep(float(0.30), float(0.72), n.mul(float(0.68)).add(n2.mul(float(0.32)))).toVar();
    const core = oneMinus(smoothstep(float(0.30), float(0.92), r.add(n.sub(float(0.5)).mul(float(0.30))))).toVar();
    const grow = smoothstep(float(0.02), float(0.30), uS.x);
    const alpha = blot.mul(core).mul(grow).mul(uS.z).mul(float(0.55)).toVar();
    return vec4(vec3(0.028, 0.024, 0.018), alpha);
  });
}

/** 地根网（跟随单位，读档/换位自动贴脚；dispose 幂等）。 */
export function createRootField(unit, deps, { size, level = 0.90, onDispose = null }) {
  const uS = uniform(new THREE.Vector4(0, 0, level, Math.random() * 10));
  const uSeed = uniform(Math.random() * 6.28 + 0.01);
  const uCfg = uniform(new THREE.Vector4(size, uSeed.value, 0, 0));
  const roots = murkQuad({
    shade: makeRootFieldShade()(uvOf(), uS, uCfg),
    width: size, height: size, name: 'spellFx:corruptRootField', order: 4,
  });
  const stain = murkQuad({
    shade: makeFieldStainShade()(uvOf(), uS, uSeed),
    width: size, height: size, name: 'spellFx:corruptRootStain', order: 3,
  });
  for (const q of [roots.quad, stain.quad]) {
    q.rotation.x = -Math.PI / 2;
  }
  const st = { cur: 0, target: 0, pulse: 0, time: 0 };
  let disposed = false;
  const place = () => {
    const y = unit.position.y + 0.11;
    roots.quad.position.set(unit.position.x, y, unit.position.z);
    stain.quad.position.set(unit.position.x, y - 0.05, unit.position.z);
  };
  place();
  deps.scene.add(stain.quad);
  deps.scene.add(roots.quad);
  const untick = unit.addTick((dt) => {
    st.time += dt;
    st.pulse = Math.max(0, st.pulse - dt * 1.4);
    st.cur += (st.target - st.cur) * (1 - Math.exp(-dt * 2.4));
    uS.value.set(st.cur, st.pulse, level, st.time);
    place();
    for (const m of unit._corruptMists ?? []) {
      m.em.setPosition?.(unit.position.x + m.dx, unit.position.y + m.dy);
    }
  });
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    untick();
    roots.release();
    stain.release();
  };
  const h = {
    quad: roots.quad,
    setTarget(v) { st.target = v; },
    pulse(k = 1) { st.pulse = Math.max(st.pulse, k); },
    levelNow() { return st.cur; },
    dispose,
  };
  onDispose?.(dispose);
  return h;
}

// ---------------------------------------------------------------------------
// 根刺（破土打击件）
// ---------------------------------------------------------------------------

// 竖直 billboard，底部贴地：三根融合的根系破土（中柱高、两侧短），
// 不规则粗细 + 根瘤鼓包 + 湿边；尖端只有一点湿亮，不发光。uS = (进度, 亮度, 倾斜, -)。
function makeRootSpikeShade() {
  return Fn(([vUv, uS, uSeed]) => {
    const C = pal();
    const prog = uS.x, level = uS.y, lean = uS.z;
    const px = vUv.x.sub(float(0.5)).toVar();
    const y = vUv.y.toVar();
    const rise = smoothstep(float(0.0), float(0.26), prog);
    const back = smoothstep(float(0.64), float(1.0), prog);
    const k = rise.mul(oneMinus(back)).toVar();
    const column = (x0, hTop, w0, ph, delay) => {
      const top = k.mul(float(hTop)).toVar();
      const cx = float(x0).add(lean.mul(y.mul(y)).mul(float(0.22)))
        .add(sin(y.mul(float(9.0)).add(uSeed).add(float(ph))).mul(y.mul(float(0.012)))).toVar();
      const grown = smoothstep(float(delay), float(delay + 0.26), prog).toVar();
      const oy = clamp(float(1.0).sub(y.div(float(hTop))), float(0.0), float(1.0)).toVar();
      const lumps = sin(y.mul(float(26.0)).add(float(ph)).add(uSeed)).mul(float(0.18))
        .add(exp(y.sub(float(hTop * 0.32)).mul(y.sub(float(hTop * 0.32))).mul(float(-180.0))).mul(float(0.55)))
        .add(exp(y.sub(float(hTop * 0.56)).mul(y.sub(float(hTop * 0.56))).mul(float(-220.0))).mul(float(0.42)))
        .add(float(1.0))
        .toVar();
      const hw = oy.mul(oy).add(oy).mul(float(0.5)).mul(float(w0)).mul(lumps).add(float(0.012)).toVar();
      const d = px.sub(cx).div(hw).toVar();
      const inside = oneMinus(smoothstep(float(0.72), float(1.02), abs(d))).toVar();
      const cap = oneMinus(smoothstep(top.sub(float(0.006)), top.add(float(0.004)), y)).toVar();
      const qr = abs(d).sub(float(0.70));
      const rim = exp(qr.mul(qr).mul(float(-60.0))).toVar();
      const qe = abs(d).sub(float(0.94));
      const edgeRim = exp(qe.mul(qe).mul(float(-110.0))).toVar();
      const bark = sin(y.mul(float(34.0)).add(sin(px.mul(float(15.0)).add(uSeed)).mul(float(2.2))))
        .mul(float(0.5)).add(float(0.5)).toVar();
      const tipD = y.sub(top);
      const tip = exp(tipD.mul(tipD).mul(float(-2600.0))).mul(k).toVar();
      const base = exp(y.mul(float(-20.0))).toVar();
      const hi = clamp(rim.mul(float(0.55)).add(edgeRim.mul(float(0.90)))
        .add(tip.mul(float(0.50))).add(base.mul(float(0.18))).add(bark.mul(float(0.08))),
        float(0.0), float(1.0)).toVar();
      const a = inside.mul(cap).mul(grown).toVar();
      return { a, hi };
    };
    const c1 = column(0.00, 0.80, 0.480, 0.0, 0.00);
    const c2 = column(-0.250, 0.58, 0.350, 1.7, 0.03);
    const c3 = column(0.260, 0.50, 0.300, 3.4, 0.06);
    const aSum = c1.a.add(c2.a).add(c3.a).toVar();
    const hiSum = c1.hi.mul(c1.a).add(c2.hi.mul(c2.a)).add(c3.hi.mul(c3.a))
      .div(max(aSum, float(0.001))).toVar();
    // 基部土块：破土时先鼓出一团（根从土里顶出来的接触体）
    const moundX = px.div(float(0.20));
    const moundY = y.div(float(0.075));
    const mound = exp(moundX.mul(moundX).add(moundY.mul(moundY)).mul(float(-1.4))).mul(rise).toVar();
    const moundRim = exp(moundX.mul(moundX).add(moundY.mul(moundY)).mul(float(-4.5))).mul(rise).toVar();
    const aAll = clamp(aSum.mul(float(0.95)).add(mound.mul(float(0.88))), float(0.0), float(1.0)).toVar();
    const hiAll = clamp(hiSum.mul(float(0.82)).add(moundRim.mul(float(0.55))), float(0.0), float(1.0)).toVar();
    const rgb = mix(C.deep.mul(float(0.75)), C.wet.mul(float(0.90)), clamp(hiAll.mul(float(0.80)), float(0.0), float(1.0))).toVar();
    const edge = oneMinus(smoothstep(float(0.46), float(0.50), abs(px)))
      .mul(oneMinus(smoothstep(float(0.95), float(1.0), y)));
    return vec4(rgb, aAll.mul(k).mul(level).mul(edge));
  });
}

export async function corruptRootSpike(ctx, deps, {
  at, h = 16, w = 6, ms = 460, lean = 0,
}) {
  if (!at) return;
  const uS = uniform(new THREE.Vector4(0, 1, lean, 0));
  const uSeed = uniform(Math.random() * 6.28 + 0.01);
  const { quad, release } = murkQuad({
    shade: makeRootSpikeShade()(uvOf(), uS, uSeed),
    width: w, height: h, name: 'spellFx:corruptSpike', order: 30,
  });
  quad.position.set(at.x, (at.y ?? 0) + h * 0.5, (at.z ?? 0) + 1.4);
  deps.scene.add(quad);
  ctx.onKill(() => release());
  const st = { t: 0 };
  await ctx.tweenRaw(st, { t: 1 }, {
    durationMs: ms, ease: 'none',
    onUpdate: () => { uS.value.x = st.t; },
    onComplete: () => release(),
  });
}

// ---------------------------------------------------------------------------
// 根苞（召唤芽位破土）
// ---------------------------------------------------------------------------

// 竖直 billboard：三团土块鼓起（swell）→ 中线撕裂（open）→ 潮湿裂口 + 霉白孢子
// 上涌 → 淡出（召唤物自裂口升起）。无亮绿喷柱。uS = (进度, 亮度, -, -)。
function makeRootBudShade() {
  return Fn(([vUv, uS, uSeed]) => {
    const C = pal();
    const prog = uS.x, level = uS.y;
    const px = vUv.x.sub(float(0.5)).toVar();
    const y = vUv.y.toVar();
    const swell = smoothstep(float(0.0), float(0.26), prog);
    const open = smoothstep(float(0.26), float(0.56), prog);
    const fade = oneMinus(smoothstep(float(0.82), float(1.0), prog));
    const hash2 = (ix, iy) => fract(
      sin(ix.mul(float(127.1)).add(iy.mul(float(311.7))).add(uSeed.mul(float(0.417))))
        .mul(float(43758.545)));
    const vn2 = (qx, qy) => {
      const ix = floor(qx), iy = floor(qy);
      const fx = fract(qx), fy = fract(qy);
      const wx = fx.mul(fx).mul(float(3.0).sub(fx.mul(float(2.0))));
      const wy = fy.mul(fy).mul(float(3.0).sub(fy.mul(float(2.0))));
      const a = hash2(ix, iy), b = hash2(ix.add(float(1.0)), iy);
      const c = hash2(ix, iy.add(float(1.0))), d = hash2(ix.add(float(1.0)), iy.add(float(1.0)));
      const top = a.add(b.sub(a).mul(wx));
      const bot = c.add(d.sub(c).mul(wx));
      return top.add(bot.sub(top).mul(wy));
    };
    // 三个错位球状土块叠成丘（鼓胀量由 swell 驱动）
    const lobe = (cx, cy, rx, ry) => {
      const nx = px.sub(cx).div(rx);
      const ny = y.sub(cy).div(ry);
      return exp(nx.mul(nx).add(ny.mul(ny)).mul(float(-1.7)));
    };
    const l1 = lobe(float(0.0), float(0.05).add(swell.mul(float(0.10))),
      float(0.26).add(swell.mul(float(0.04))), float(0.14).add(swell.mul(float(0.22))));
    const l2 = lobe(float(-0.17), float(0.03).add(swell.mul(float(0.06))),
      float(0.17), float(0.11).add(swell.mul(float(0.14)))).mul(float(0.92));
    const l3 = lobe(float(0.18), float(0.04).add(swell.mul(float(0.07))),
      float(0.16), float(0.12).add(swell.mul(float(0.16)))).mul(float(0.90));
    const mound = max(max(l1, l2), l3).toVar();
    // 轮廓线：等值线高光（普通混合下暗土丘靠它读出形体）
    const shellD = mound.sub(float(0.24)).div(float(0.11));
    const shell = exp(shellD.mul(shellD).mul(float(-1.0))).toVar();
    const gRain = vn2(px.mul(float(13.0)), y.mul(float(9.0)).add(uSeed)).toVar();
    // 裂口：竖直中缝 + 湿润内壁 + 霉白唇
    const seamW = float(0.006).add(open.mul(float(0.035))).toVar();
    const seam = exp(px.mul(px).div(seamW.mul(seamW)).mul(float(-1.0)))
      .mul(smoothstep(float(0.02), float(0.40), y))
      .mul(oneMinus(smoothstep(float(0.52), float(0.86), y))).toVar();
    const lipL = px.add(seamW.mul(float(1.35)));
    const lipR = px.sub(seamW.mul(float(1.35)));
    const lip = exp(lipL.mul(lipL).mul(float(-3400.0)))
      .add(exp(lipR.mul(lipR).mul(float(-3400.0))))
      .mul(open).toVar();
    // 孢子：裂口上方的一团霉白尘（不是绿柱）
    const puffDx = px.div(float(0.10));
    const puffDy = y.sub(float(0.52)).div(float(0.20));
    const puff = exp(puffDx.mul(puffDx).add(puffDy.mul(puffDy)).mul(float(-1.0)))
      .mul(smoothstep(float(0.40), float(0.60), prog))
      .mul(oneMinus(smoothstep(float(0.62), float(0.92), prog))).toVar();
    // 普通混合：暗土体 + 极窄湿边 + 裂口内壁（孢子尘只做暗浊，不做白光）
    const hi = clamp(gRain.mul(float(0.18)).add(shell.mul(float(0.60)))
      .add(lip.mul(float(0.50))).add(puff.mul(float(0.18))),
      float(0.0), float(1.0)).toVar();
    const rgb = mix(C.deep.mul(float(0.90)), C.soil.mul(float(1.55)), clamp(hi.mul(float(0.80)), float(0.0), float(1.0)))
      .add(C.wet.mul(shell.mul(float(0.42))))          // 轮廓湿边：暗土丘靠它读出形体
      .add(C.pale.mul(lip.mul(float(0.34))))            // 裂口唇线（窄、霉白，不铺面）
      .add(C.bruise.mul(seam.mul(float(0.45))))
      .toVar();
    const alpha = clamp(mound.mul(float(0.95)).add(shell.mul(float(0.28))).add(lip.mul(float(0.20))),
      float(0.0), float(1.0)).mul(fade).mul(level).toVar();
    const edge = oneMinus(smoothstep(float(0.46), float(0.50), abs(px)))
      .mul(oneMinus(smoothstep(float(0.95), float(1.0), y)));
    return vec4(rgb, alpha.mul(edge));
  });
}

export async function corruptRootBud(ctx, deps, { at, h = 13, w = 11, ms = 460, zOff = 1.3 }) {
  if (!at) return;
  const uS = uniform(new THREE.Vector4(0, 1, 0, 0));
  const uSeed = uniform(Math.random() * 6.28 + 0.01);
  const { quad, release } = murkQuad({
    shade: makeRootBudShade()(uvOf(), uS, uSeed),
    width: w, height: h, name: 'spellFx:corruptBud', order: 30,
  });
  const baseY = (at.y ?? 0) + h * 0.5;
  quad.position.set(at.x, baseY, (at.z ?? 0) + zOff);
  deps.scene.add(quad);
  ctx.onKill(() => release());
  const st = { t: 0 };
  await ctx.tweenRaw(st, { t: 1 }, {
    durationMs: ms, ease: 'none',
    onUpdate: () => {
      uS.value.x = st.t;
      // 破土的「顶」：前 45% 把根苞从土里抬出来
      quad.position.y = baseY + h * 0.14 * Math.min(1, st.t / 0.45);
    },
    onComplete: () => release(),
  });
}

// ---------------------------------------------------------------------------
// 根须疾走（3D 藤蔓）：世界空间真几何
// ---------------------------------------------------------------------------
// 贴地的花纹面片无论画多细都会读成「地上的线条」——根是立体的。改为沿路径扫掠的
// 低面数根体：中心线水平蜿蜒、竖直起伏（一段没入土里、一段隆起露头），截面随根瘤
// 鼓胀，主干上分叉出细根。生长 = 顶点沿路径向根锋收拢（aT 对头进度，根锋收成尖）。
// 顶点烘焙成世界坐标（mesh 恒等变换）：真深度测试，不覆盖其它单位。

const groundPlacement = (from, to) => {
  const dx = to.x - from.x, dz = (to.z ?? 0) - (from.z ?? 0);
  const d = Math.hypot(dx, dz) || 1;
  return { ux: dx / d, uz: dz / d, dist: d };
};

// 沿地面向量的贴地 quad 落位：**跟随两端地板高差倾斜**（玩家区与敌排区常有一档
// 高差；平铺在起点高度的面片走到另一端会埋进地板——纵深正确但读不到）。
// 局部 X = 三维路径方向，局部 Y = 水平侧向，局部 Z = 面法线（近竖直）。
function placeGroundQuad(quad, from, to, len, lift = 0.16) {
  const dx = to.x - from.x, dz = (to.z ?? 0) - (from.z ?? 0);
  const dy = (to.y ?? 0) - (from.y ?? 0);
  const d = Math.hypot(dx, dz) || 1;
  const ux = dx / d, uz = dz / d;
  const lx = new THREE.Vector3(ux, dy / Math.max(d, 0.001), uz).normalize();
  const ly = new THREE.Vector3(uz, 0, -ux).normalize();
  const lz = new THREE.Vector3().crossVectors(lx, ly).normalize();
  const m = new THREE.Matrix4().makeBasis(lx, ly, lz);
  quad.quaternion.setFromRotationMatrix(m);
  const mid = new THREE.Vector3(from.x, from.y ?? 0, from.z ?? 0)
    .addScaledVector(lx, len * 0.5);
  quad.position.set(mid.x, mid.y + lift, mid.z);
}

const VINE_RINGS = 26;
const VINE_SIDES = 8;

const smooth01 = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 扫掠管：rings = [{x,y,z,r,twist}]，frameOf(i) = 该环截面的水平基（单位向量）。
// 顶点 = 中心 + 水平基·cos·r + 竖直·sin·r。生长属性按 tOf(i) 落。
function pushVineTube(out, rings, sides, frameOf, tOf, delay, dur, seed, twist) {
  const { pos, rad, aT, aUp, aFlute, aDelay, aDur, aSeed, idx } = out;
  const base = pos.length / 3;
  for (let i = 0; i < rings.length; i++) {
    const R = rings[i];
    const F = frameOf(i);
    const tw = twist + R.twist;
    for (let k = 0; k < sides; k++) {
      const ang = (k / sides) * Math.PI * 2 + tw;
      // 截面纵向棱（树根的棱脊）：正圆管读成蠕虫，带棱才读得出木质
      const flute = 1 + 0.30 * Math.cos(ang * 3 + tw * 3.1) + 0.12 * Math.cos(ang * 5 + tw);
      const ox = Math.cos(ang) * R.r * 1.06 * flute;
      const oy = Math.sin(ang) * R.r * 1.12 * flute;
      const rx = F.fx * ox, rz = F.fz * ox;
      pos.push(R.x + rx, R.y + oy, R.z + rz);
      rad.push(rx, oy, rz);
      aUp.push(Math.sin(ang));
      aFlute.push(flute);
      aT.push(tOf(i));
      aDelay.push(delay);
      aDur.push(dur);
      aSeed.push(seed);
    }
  }
  for (let i = 0; i < rings.length - 1; i++) {
    for (let k = 0; k < sides; k++) {
      const a = base + i * sides + k;
      const b = base + i * sides + ((k + 1) % sides);
      const c = base + (i + 1) * sides + k;
      const d = base + (i + 1) * sides + ((k + 1) % sides);
      idx.push(a, b, c, b, d, c);
    }
  }
}

function buildVineGeometry(from, to, seed, { tendrils = 5, spread = 1 } = {}) {
  const rng = mulberry32(Math.floor(seed * 1000000) + 17);
  const rnd = (a, b) => a + rng() * (b - a);
  const dx = to.x - from.x, dz = (to.z ?? 0) - (from.z ?? 0);
  const dist = Math.hypot(dx, dz) || 1;
  const ux = dx / dist, uz = dz / dist;
  const lx = uz, lz = -ux;                    // 水平侧向
  const dy = (to.y ?? 0) - (from.y ?? 0);
  const y0 = from.y ?? 0;
  const out = { pos: [], rad: [], aT: [], aUp: [], aFlute: [], aDelay: [], aDur: [], aSeed: [], idx: [] };
  const N = Math.max(2, tendrils);
  let arrive = 0;
  for (let n = 0; n < N; n++) {
    const mid = N === 1 ? 0 : (n / (N - 1)) * 2 - 1;
    const off0 = mid * rnd(3.8, 6.2) * spread + rnd(-1.2, 1.2) * spread;
    const off1 = off0 * rnd(-0.16, 0.16) + rnd(-1.2, 1.2) * spread;
    const r0 = rnd(0.92, 1.55) * spread * (1 - Math.abs(mid) * 0.18);
    const amp1 = rnd(2.8, 5.2), f1 = rnd(0.75, 1.35), ph1 = rnd(0, 6.283);
    const amp2 = rnd(1.0, 2.3), f2 = rnd(2.0, 3.2), ph2 = rnd(0, 6.283);
    const hump1 = rnd(1.6, 3.6), c1 = rnd(0.16, 0.40), w1 = rnd(0.09, 0.17);
    const hump2 = rnd(0.8, 2.2), c2 = rnd(0.55, 0.86), w2 = rnd(0.07, 0.14);
    const k1 = rnd(0.20, 0.44), k2 = rnd(0.52, 0.80);
    const dipH = rnd(1.0, 2.2), dc = rnd(0.18, 0.78), dw = rnd(0.045, 0.10);
    const delay = n === 2 ? 0 : rnd(0.0, 0.07);
    const dur = n === 2 ? 0.62 : rnd(0.55, 0.72);
    const sd = rnd(0, 6.283);
    arrive = Math.max(arrive, delay + dur);
    const rings = [];
    for (let i = 0; i <= VINE_RINGS; i++) {
      const s = i / VINE_RINGS;
      const env = Math.pow(Math.sin(Math.PI * s), 0.85);
      const lat = off0 + (off1 - off0) * s
        + (amp1 * Math.sin(s * Math.PI * f1 + ph1)
          + amp2 * Math.sin(s * Math.PI * f2 + ph2)) * env;
      const knot = 1 + 0.55 * Math.exp(-Math.pow((s - k1) / 0.055, 2))
        + 0.38 * Math.exp(-Math.pow((s - k2) / 0.065, 2));
      const r = r0 * (1 - 0.34 * s) * knot
        * (1 + 0.14 * Math.sin(s * 23 + ph1))
        * (1 - 0.50 * smooth01(0.9, 1, s))
        * (1 + 0.55 * Math.exp(-Math.pow((s - 0.985) / 0.05, 2)));
      const hump = (hump1 * Math.exp(-Math.pow((s - c1) / w1, 2))
        + hump2 * Math.exp(-Math.pow((s - c2) / w2, 2)))
        * smooth01(0.0, 0.10, s) * (1 - 0.45 * smooth01(0.9, 1, s));
      // 下潜段：中心线沉到地板下，这段被地板遮住——根是「时隐时现」的
      const dip = dipH * Math.exp(-Math.pow((s - dc) / dw, 2))
        * smooth01(0.06, 0.14, s) * (1 - smooth01(0.86, 0.94, s));
      rings.push({
        x: from.x + ux * dist * s + lx * lat,
        y: y0 + dy * s + 0.05 + hump - dip,
        z: (from.z ?? 0) + uz * dist * s + lz * lat,
        r, twist: s * 0.55 + sd,
      });
    }
    pushVineTube(out, rings, VINE_SIDES, () => ({ fx: lx, fz: lz }),
      (i) => i / VINE_RINGS, delay, dur, sd, 0);
    // 分叉细根：主干走过分叉点后向上外翻抽出（须状根尖）
    for (let b = 0; b < 2; b++) {
      const s0 = rnd(0.26, 0.74);
      const R0 = rings[Math.min(VINE_RINGS - 1, Math.round(s0 * VINE_RINGS))];
      const sign = rng() < 0.5 ? -1 : 1;
      const blen = rnd(2.8, 5.6), brise = rnd(1.6, 3.4);
      const br0 = R0.r * rnd(0.30, 0.44);
      const bRings = [];
      for (let j = 0; j <= 5; j++) {
        const u = j / 5;
        bRings.push({
          x: R0.x + lx * sign * blen * u + ux * blen * 0.3 * u * u,
          y: R0.y + brise * Math.sin(u * Math.PI * 0.62) + u * u * 0.4,
          z: R0.z + lz * sign * blen * u + uz * blen * 0.2 * u * u,
          r: br0 * (1 - 0.82 * u) + 0.05,
          twist: u * 2.2,
        });
      }
      const bt1 = Math.min(0.99, s0 + 0.055);
      pushVineTube(out, bRings, 6, () => ({ fx: lx, fz: lz }),
        (j) => s0 + (bt1 - s0) * (j / 5), delay, dur, sd + 1.7, 0);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(out.pos), 3));
  geo.setAttribute('aRadial', new THREE.BufferAttribute(new Float32Array(out.rad), 3));
  geo.setAttribute('aT', new THREE.BufferAttribute(new Float32Array(out.aT), 1));
  geo.setAttribute('aUp', new THREE.BufferAttribute(new Float32Array(out.aUp), 1));
  geo.setAttribute('aFlute', new THREE.BufferAttribute(new Float32Array(out.aFlute), 1));
  geo.setAttribute('aDelay', new THREE.BufferAttribute(new Float32Array(out.aDelay), 1));
  geo.setAttribute('aDur', new THREE.BufferAttribute(new Float32Array(out.aDur), 1));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(out.aSeed), 1));
  geo.setIndex(out.idx);
  geo.computeBoundingSphere();
  return { geo, arriveU: Math.min(0.95, arrive) };
}

// 生长（顶点）：未到头的顶点向中心线收拢成锥尖；到达后 uKnot 在根锋处鼓一记结瘤。
function makeVineGrowth(uProg, uKnot) {
  return Fn(() => {
    const t = attribute('aT', 'float').toVar();
    const delay = attribute('aDelay', 'float').toVar();
    const dur = attribute('aDur', 'float').toVar();
    const radial = attribute('aRadial', 'vec3').toVar();
    const head = clamp(uProg.sub(delay).div(dur), float(0.0), float(1.0)).toVar();
    const vis = oneMinus(smoothstep(head.sub(float(0.035)), head.add(float(0.001)), t)).toVar();
    const kd = t.sub(float(0.985));
    const knot = uKnot.mul(exp(kd.mul(kd).div(float(0.0016)).mul(float(-1.0)))).toVar();
    const scale = vis.mul(float(1.0).add(knot.mul(float(0.6))));
    return positionLocal.add(radial.mul(scale.sub(float(1.0))));
  })();
}

// 根体着色（无光照材质）：顶面受光/底面吃暗读出体积；脊顶一条湿棱、稀疏霉斑、
// 纵向干裂纹；根锋一小段湿亮（刚破土的断口）。
function makeVineShade(uProg) {
  return Fn(() => {
    const C = pal();
    const t = attribute('aT', 'float').toVar();
    const up = attribute('aUp', 'float').mul(float(0.5)).add(float(0.5)).toVar();
    const sd = attribute('aSeed', 'float').toVar();
    const delay = attribute('aDelay', 'float').toVar();
    const dur = attribute('aDur', 'float').toVar();
    const head = clamp(uProg.sub(delay).div(dur), float(0.0), float(1.0)).toVar();
    const hash2 = (ix, iy) => fract(
      sin(ix.mul(float(127.1)).add(iy.mul(float(311.7))).add(sd)).mul(float(43758.545)));
    const vn2 = (qx, qy) => {
      const ix = floor(qx), iy = floor(qy);
      const fx = fract(qx), fy = fract(qy);
      const wx = fx.mul(fx).mul(float(3.0).sub(fx.mul(float(2.0))));
      const wy = fy.mul(fy).mul(float(3.0).sub(fy.mul(float(2.0))));
      const a = hash2(ix, iy), b = hash2(ix.add(float(1.0)), iy);
      const c = hash2(ix, iy.add(float(1.0))), d = hash2(ix.add(float(1.0)), iy.add(float(1.0)));
      const top = a.add(b.sub(a).mul(wx));
      const bot = c.add(d.sub(c).mul(wx));
      return top.add(bot.sub(top).mul(wy));
    };
    const flute = attribute('aFlute', 'float').toVar();
    // 暗湿木质：顶面只抬到 soil 的中间调；棱脊明暗（flute）给体积，湿棱极窄
    const lit = smoothstep(float(0.0), float(1.0), up).toVar();
    let rgb = mix(C.deep.mul(float(0.95)), C.soil.mul(float(0.80)), lit)
      .add(C.wood.mul(smoothstep(float(0.82), float(1.0), up).mul(float(0.22))))
      .toVar();
    const sheen = smoothstep(float(0.95), float(1.0), up).mul(float(0.22));
    rgb = rgb.add(C.wet.mul(sheen));
    // 棱脊：脊背抬亮、棱谷吃暗——「带棱的根」与「圆管」的分界
    const ridge = smoothstep(float(0.72), float(1.24), flute).toVar();
    rgb = rgb.mul(ridge.mul(float(0.22)).add(float(0.80)));
    // 霉斑：低频大块菌斑（只做脏，不做亮）
    const patch = smoothstep(float(0.62), float(0.84),
      vn2(t.mul(float(6.0)).add(sd), up.mul(float(3.0)))).toVar();
    rgb = rgb.add(C.lich.mul(patch.mul(float(0.14))));
    // 树皮裂纹：横向干裂压暗（黑缝，不是亮线）
    const crack = smoothstep(float(0.72), float(0.94),
      sin(t.mul(float(88.0)).add(sin(up.mul(float(8.0)).add(sd)).mul(float(2.5))).add(sd))
        .mul(float(0.5)).add(float(0.5))).toVar();
    rgb = rgb.mul(crack.mul(float(0.30)).oneMinus());
    rgb = rgb.mul(smoothstep(float(0.0), float(0.10), t).mul(float(0.35)).add(float(0.65)));
    // 逐根明度差（有的根几乎全黑）——一束根不能是同一个颜色
    const tone = fract(sd.mul(float(1.73))).mul(float(0.34)).add(float(0.66));
    rgb = rgb.mul(tone);
    // 根锋：刚破土的断口只湿亮一小段（不是发光）
    const gd = t.sub(head).toVar();
    const glint = exp(gd.mul(gd).div(float(0.00025)).mul(float(-1.0))).mul(float(0.40));
    rgb = rgb.add(C.pale.mul(glint));
    return vec4(rgb, float(1.0));
  })();
}

// 沿路径疾走的藤蔓组。返回 arriveU（主根爬到目标时的 uProg）。
export function corruptVineRun(ctx, deps, { from, to, ms = 320, tendrils = 5, spread = 1 }) {
  const { geo, arriveU } = buildVineGeometry(from, to, Math.random(), { tendrils, spread });
  const uProg = uniform(0.0);
  const uKnot = uniform(0.0);
  const mat = new MeshBasicNodeMaterial({
    side: THREE.DoubleSide, depthWrite: true, depthTest: true, fog: false,
  });
  mat.colorNode = makeVineShade(uProg);
  mat.positionNode = makeVineGrowth(uProg, uKnot);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'spellFx:corruptVineRun';
  mesh.renderOrder = 6;
  deps.scene.add(mesh);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    mesh.parent?.remove(mesh);
    geo.dispose();
    mat.dispose();
  };
  ctx.onKill(release);
  const promise = (async () => {
    const st = { t: 0 };
    await ctx.tweenRaw(st, { t: 1 }, {
      durationMs: ms, ease: 'power1.inOut',
      onUpdate: () => { uProg.value = st.t; },
    });
    // 到达结瘤：根锋处鼓一记再随根体退场
    const kt = { k: 0 };
    await ctx.tweenRaw(kt, { k: 1 }, {
      durationMs: 150, ease: 'power2.out',
      onUpdate: () => { uKnot.value = kt.k; },
    });
    await ctx.wait(140);
    release();
  })();
  return { promise, arriveU };
}

// 破土根笼（召唤芽位）：土丘 + 六条向内收拢的根爪，3D 体积件（真深度）。
// 破土顺序：土丘先鼓起 → 根爪抽出 → 根苞（quad）从中心裂开。
function buildRootCageGeometry(w, h, seed) {
  const rng = mulberry32(Math.floor(seed * 1000000) + 31);
  const rnd = (a, b) => a + rng() * (b - a);
  const out = { pos: [], rad: [], aT: [], aUp: [], aFlute: [], aDelay: [], aDur: [], aSeed: [], idx: [] };
  const MR = 6, MS = 12;
  const mw = w * 0.38, mh = h * 0.20, md = w * 0.26;
  const mBase = out.pos.length / 3;
  for (let i = 0; i <= MR; i++) {
    const v = i / MR;
    const phi = v * Math.PI * 0.5;
    const rr = Math.sin(phi), yy = Math.cos(phi);
    for (let k = 0; k < MS; k++) {
      const th = (k / MS) * Math.PI * 2;
      const lump = 0.78 + 0.26 * (0.5 + 0.5 * Math.sin(th * 3 + seed * 5.1))
        * (0.6 + 0.4 * v) + 0.06 * Math.sin(th * 7 + seed * 2.3);
      const x = Math.cos(th) * rr * mw * lump;
      const z = Math.sin(th) * rr * md * lump;
      const y = yy * mh * (0.85 + 0.3 * (0.5 + 0.5 * Math.sin(th * 5 + seed)));
      out.pos.push(x, y, z);
      out.rad.push(x, y, z);
      out.aUp.push(Math.min(1, Math.max(0, yy)));
      out.aFlute.push(1.0);
      out.aT.push(0.06 + 0.30 * v);
      out.aDelay.push(0.0);
      out.aDur.push(0.42);
      out.aSeed.push(seed + i * 0.37);
    }
  }
  for (let i = 0; i < MR; i++) {
    for (let k = 0; k < MS; k++) {
      const a = mBase + i * MS + k;
      const b = mBase + i * MS + ((k + 1) % MS);
      const c = mBase + (i + 1) * MS + k;
      const d = mBase + (i + 1) * MS + ((k + 1) % MS);
      out.idx.push(a, b, c, b, d, c);
    }
  }
  const CLAWS = 6;
  for (let c = 0; c < CLAWS; c++) {
    const ang = (c / CLAWS) * Math.PI * 2 + rnd(-0.22, 0.22);
    const R0 = w * rnd(0.40, 0.52);
    const sign = rng() < 0.5 ? -1 : 1;
    const cH = h * rnd(0.30, 0.42);
    const cr = w * rnd(0.075, 0.105);
    const rings = [];
    for (let j = 0; j <= 5; j++) {
      const u = j / 5;
      const rad = R0 * (1 - 0.26 * u) + w * 0.04 * Math.sin(u * Math.PI * 0.7);
      const a = ang + sign * 0.6 * u * u;
      rings.push({
        x: Math.cos(a) * rad,
        y: 0.1 + cH * Math.sin(u * Math.PI * 0.5),
        z: Math.sin(a) * rad * 0.72,
        r: cr * (1 - 0.84 * u) + 0.05,
        fx: Math.cos(a), fz: Math.sin(a),
        twist: u * 1.6,
      });
    }
    const delay = 0.04 + rng() * 0.16;
    pushVineTube(out, rings, 6, (j) => ({ fx: rings[j].fx, fz: rings[j].fz }),
      (j) => 0.08 + 0.62 * (j / 5), delay, 0.52, seed + c * 1.3, 0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(out.pos), 3));
  geo.setAttribute('aRadial', new THREE.BufferAttribute(new Float32Array(out.rad), 3));
  geo.setAttribute('aT', new THREE.BufferAttribute(new Float32Array(out.aT), 1));
  geo.setAttribute('aUp', new THREE.BufferAttribute(new Float32Array(out.aUp), 1));
  geo.setAttribute('aFlute', new THREE.BufferAttribute(new Float32Array(out.aFlute), 1));
  geo.setAttribute('aDelay', new THREE.BufferAttribute(new Float32Array(out.aDelay), 1));
  geo.setAttribute('aDur', new THREE.BufferAttribute(new Float32Array(out.aDur), 1));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(out.aSeed), 1));
  geo.setIndex(out.idx);
  geo.computeBoundingSphere();
  return geo;
}

// 破土一拍：3D 根笼（土丘 + 根爪）+ 根苞裂口（quad）分层起演。
export function corruptRootEmergence(ctx, deps, { at, h = 13, w = 11, ms = 560 }) {
  if (!at) return { promise: Promise.resolve() };
  const geo = buildRootCageGeometry(w, h, Math.random());
  const uProg = uniform(0.0);
  const uKnot = uniform(0.0);
  const mat = new MeshBasicNodeMaterial({
    side: THREE.DoubleSide, depthWrite: true, depthTest: true, fog: false,
  });
  mat.colorNode = makeVineShade(uProg);
  mat.positionNode = makeVineGrowth(uProg, uKnot);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'spellFx:corruptRootCage';
  mesh.renderOrder = 6;
  mesh.position.set(at.x, (at.y ?? 0) + 0.05, (at.z ?? 0) + 1.3);
  deps.scene.add(mesh);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    mesh.parent?.remove(mesh);
    geo.dispose();
    mat.dispose();
  };
  ctx.onKill(release);
  const promise = (async () => {
    const st = { t: 0 };
    const grow = ctx.tweenRaw(st, { t: 1 }, {
      durationMs: ms, ease: 'power2.out',
      onUpdate: () => { uProg.value = st.t; },
    });
    // 土丘先鼓起，根苞在土层里稍后顶开
    await ctx.wait(90);
    // 裂口一拍：腐土外翻 + 霉白孢子从缝里挤出（与根苞的 open 段同刻）
    ctx.spawn(async (c) => {
      await c.wait(Math.round(ms * 0.52));
      deps.particles?.spawn(at.x, (at.y ?? 0) + h * 0.24, {
        color: PX.soil, count: 10, speed: 5.5, vy: 3.4, size: 1.8, ttl: 0.9,
        gravity: -9, z: (at.z ?? 0) + 2.0,
      });
      deps.particles?.spawn(at.x, (at.y ?? 0) + h * 0.30, {
        color: PX.spore, count: 9, speed: 2.6, vy: 2.4, size: 1.5, ttl: 1.4,
        gravity: 0.6, z: (at.z ?? 0) + 2.2,
      });
    });
    const budAt = { x: at.x, y: (at.y ?? 0) + h * 0.19, z: at.z };
    const bud = ctx.spawn((c) => corruptRootBud(c, deps, {
      // billboard 排在土丘前方：土丘是实体（写深度），排在丘心会被丘体遮死
      at: budAt, h: h * 1.02, w: w * 1.04, ms: Math.round(ms * 0.76), zOff: 1.3 + w * 0.30,
    }));
    await grow;
    await ctx.wait(40);
    release();
    await bud.promise;
  })();
  return { promise };
}
// ---------------------------------------------------------------------------
// 腐息（尘烟云队）
// ---------------------------------------------------------------------------

// 地面浸湿层（普通混合）：只做「地面被打湿变暗」的底，四边重度羽化。
// 云体轮廓交给粒子（大量软团自然形成碎裂边界），不靠面片切边。
function makeMiasmaStainShade() {
  return Fn(([vUv, uProg, uLevel, uCfg]) => {
    const X = vUv.x.mul(uCfg.x).toVar();
    const Y = vUv.y.sub(float(0.5)).mul(uCfg.y).toVar();
    const target = uCfg.z, seed = uCfg.w;
    const front = uProg.div(float(0.72)).mul(target.add(float(2.0))).sub(float(2.0)).toVar();
    const fw = front
      .add(sin(Y.mul(float(0.42)).add(seed)).mul(float(3.0)))
      .add(sin(Y.mul(float(0.95)).add(seed.mul(float(2.1)))).mul(float(1.6))).toVar();
    const hash2 = (ix, iy) => fract(
      sin(ix.mul(float(127.1)).add(iy.mul(float(311.7))).add(seed.mul(float(0.531))))
        .mul(float(43758.545)));
    const vn2 = (qx, qy) => {
      const ix = floor(qx), iy = floor(qy);
      const fx = fract(qx), fy = fract(qy);
      const wx = fx.mul(fx).mul(float(3.0).sub(fx.mul(float(2.0))));
      const wy = fy.mul(fy).mul(float(3.0).sub(fy.mul(float(2.0))));
      const a = hash2(ix, iy), b = hash2(ix.add(float(1.0)), iy);
      const c = hash2(ix, iy.add(float(1.0))), d = hash2(ix.add(float(1.0)), iy.add(float(1.0)));
      const top = a.add(b.sub(a).mul(wx));
      const bot = c.add(d.sub(c).mul(wx));
      return top.add(bot.sub(top).mul(wy));
    };
    const n1 = vn2(X.mul(float(0.22)).sub(uProg.mul(float(1.1))).add(seed),
      Y.mul(float(0.18)).add(seed.mul(float(1.3)))).toVar();
    const n2 = vn2(X.mul(float(0.58)).sub(uProg.mul(float(2.2))).add(seed.mul(float(2.7))),
      Y.mul(float(0.48)).add(seed)).toVar();
    const dens = smoothstep(float(0.34), float(0.66),
      n1.mul(float(0.65)).add(n2.mul(float(0.35)))).toVar();
    // 前/尾/侧三向重度羽化（暗斑边界不许出现直边）
    const behind = oneMinus(smoothstep(fw.sub(float(6.0)), fw.add(float(2.5)), X)).toVar();
    const tail = smoothstep(float(-6.0), float(2.0), X).toVar();
    const lat = oneMinus(smoothstep(float(0.20), float(0.48), abs(vUv.y.sub(float(0.5))))).toVar();
    const fade = smoothstep(float(0.0), float(0.10), uProg)
      .mul(oneMinus(smoothstep(float(0.92), float(1.0), uProg))).toVar();
    const alpha = dens.mul(behind).mul(tail).mul(lat).mul(uLevel).mul(float(0.42)).mul(fade).toVar();
    const rgb = mix(vec3(0.020, 0.018, 0.014), vec3(0.042, 0.035, 0.027),
      smoothstep(float(0.35), float(0.8), n1)).toVar();
    return vec4(rgb, alpha);
  });
}

// 腐息弹道 = 沿着真实地面向量推进的**尘烟云队**（GPU 粒子）：
//   锋线两处发射点 + 尾段两处（横向错位、速率/尺寸各异）→ 走过的路径被软团填满，
//   前缘由大量团块的交叠自然形成参差轮廓；抵达时再补一记土尘爆发。
//   地面只留一层重度羽化的湿渍（暗斑），不画任何带直边的云带面片。
export function corruptMiasma(ctx, deps, { from, to, ms = 820, width = null }) {
  const { ux, uz, dist } = groundPlacement(from, to);
  const len = dist + 10;
  const w = width ?? Math.min(36, Math.max(26, dist * 0.36));
  const uProg = uniform(0.0);
  const uLevel = uniform(1.0);
  const uCfg = uniform(new THREE.Vector4(len, w, dist, Math.random() * 6.28 + 0.01));
  const stain = murkQuad({
    shade: makeMiasmaStainShade()(uvOf(), uProg, uLevel, uCfg),
    width: len, height: w, name: 'spellFx:corruptMiasmaStain', order: 3,
  });
  placeGroundQuad(stain.quad, from, to, len, 0.08);
  deps.scene.add(stain.quad);

  const px = -uz, pz = ux;
  // 云队 = 沿路径固定间距的 7 处「喷团点」+ 2 个随锋线移动的前沿发射点。
  // 喷团点在前锋经过时短促喷发（0.24s 高率），团粒长寿命滞留——路径被一团团
  // 腐云依次填满，轮廓由团块交叠自然形成，不做任何带直边的云带面片。
  const CLOUDS = [
    { t: 0.10, side: -4.0, size: 42, color: 0x7d7562, alpha: 0.11 },
    { t: 0.23, side: 5.5, size: 36, color: 0x6e6754, alpha: 0.11 },
    { t: 0.37, side: -7.5, size: 48, color: 0x655e4c, alpha: 0.10 },
    { t: 0.51, side: 3.0, size: 40, color: 0x746c58, alpha: 0.11 },
    { t: 0.65, side: 8.5, size: 52, color: 0x5c5646, alpha: 0.10 },
    { t: 0.79, side: -5.0, size: 44, color: 0x6a6350, alpha: 0.10 },
    { t: 0.92, side: 2.0, size: 38, color: 0x615a49, alpha: 0.10 },
  ];
  const clouds = CLOUDS.map((c) => {
    const d = c.t * dist;
    const x = from.x + ux * d + px * c.side;
    const z = (from.z ?? 0) + uz * d + pz * c.side;
    return {
      ...c, fired: -1,
      em: deps.particles?.spawnEmitter?.(x, (from.y ?? 0) + 2.6, {
        rate: 0, radius: 5.0, zJitter: 5.5, color: c.color, speed: 2.6,
        ttl: 2.2, size: c.size, gravity: -0.5, vby: 1.0,
        softness: 1.35, alpha: c.alpha, z,
      }),
    };
  });
  // 前沿两点：跟着推进头移动，给锋线补毛边
  const PRONGS = [
    { side: -5.0, lag: 0.0, rate: 40, size: 40, color: 0x746c58, alpha: 0.06 },
    { side: 6.0, lag: 2.0, rate: 34, size: 34, color: 0x615a49, alpha: 0.06 },
    { side: 0.5, lag: 4.0, rate: 12, size: 2.4, color: 0x8a8268, alpha: 0.4 },
  ];
  const prongs = PRONGS.map((f) => ({
    ...f,
    em: deps.particles?.spawnEmitter?.(from.x, (from.y ?? 0) + 2.4, {
      rate: f.rate, radius: 6.5, zJitter: 6.0, color: f.color, speed: 3.2,
      ttl: f.size > 8 ? 1.6 : 1.4, size: f.size, gravity: -0.5, vby: 1.1,
      softness: f.size > 8 ? 1.8 : 1.4, alpha: f.alpha, z: from.z ?? 0,
    }),
  }));
  let stopped = false;
  const stopAll = () => {
    if (stopped) return;
    stopped = true;
    for (const c of clouds) c.em?.stop?.();
    for (const f of prongs) f.em?.stop?.();
    stain.release();
  };
  ctx.onKill(stopAll);
  let burst = false;
  const promise = (async () => {
    const st = { t: 0 };
    await ctx.tweenRaw(st, { t: 1 }, {
      durationMs: ms, ease: 'power1.inOut',
      onUpdate: () => {
        uProg.value = st.t;
        // 锋线世界位置与 shader 同式（uProg/0.72 × (dist+2) - 2）
        const frontD = Math.min(dist, (st.t / 0.72) * (dist + 2) - 2);
        const now = performance.now();
        for (const c of clouds) {
          const at = c.t * dist;
          if (c.fired < 0 && frontD >= at - 2) {
            c.fired = now;
            if (c.em) c.em.rate = 150;
          }
          if (c.fired >= 0 && now - c.fired > 260 && c.em) c.em.rate = 0;
        }
        for (const f of prongs) {
          const d = Math.max(0, frontD - f.lag);
          const x = from.x + ux * d + px * f.side;
          const z = (from.z ?? 0) + uz * d + pz * f.side;
          f.em?.setPosition?.(x, (from.y ?? 0) + 2.4, z);
          if (f.em && frontD >= dist - 0.5) f.em.rate = 0;   // 抵达后锋线不再推进
        }
        if (!burst && st.t >= 0.72) {
          burst = true;
          // 抵达一记：土尘上涌 + 几颗霉白孢子（云队自身的余粒继续消散）
          deps.particles?.spawn(to.x, (to.y ?? 0) + 2.2, {
            color: 0x4c4638, count: 7, speed: 7, vy: 2.0, size: 14,
            ttl: 1.25, gravity: -1.5, z: to.z ?? 0,
          });
          deps.particles?.spawn(to.x, (to.y ?? 0) + 3.4, {
            color: 0x8a8268, count: 9, speed: 2.8, vy: 2.6, size: 1.8,
            ttl: 1.5, gravity: 0.4, z: to.z ?? 0,
          });
        }
      },
    });
    stopAll();
  })();
  return { promise, arriveU: 0.72 };
}

// ---------------------------------------------------------------------------
// 缠身腐块（腐息抵达拍，玩家身上）
// ---------------------------------------------------------------------------

// 竖直面片（普通混合）：几团暗腐块扒在胸口 + 霉白湿边 + 下沿几缕缠须。
function makeClingShade() {
  return Fn(([vUv, uProg, uSeed]) => {
    const p = vec2(vUv.x.sub(float(0.5)), vUv.y.sub(float(0.5))).toVar();
    const hash2 = (ix, iy) => fract(
      sin(ix.mul(float(127.1)).add(iy.mul(float(311.7))).add(uSeed.mul(float(0.417))))
        .mul(float(43758.545)));
    const vn2 = (qx, qy) => {
      const ix = floor(qx), iy = floor(qy);
      const fx = fract(qx), fy = fract(qy);
      const wx = fx.mul(fx).mul(float(3.0).sub(fx.mul(float(2.0))));
      const wy = fy.mul(fy).mul(float(3.0).sub(fy.mul(float(2.0))));
      const a = hash2(ix, iy), b = hash2(ix.add(float(1.0)), iy);
      const c = hash2(ix, iy.add(float(1.0))), d = hash2(ix.add(float(1.0)), iy.add(float(1.0)));
      const top = a.add(b.sub(a).mul(wx));
      const bot = c.add(d.sub(c).mul(wx));
      return top.add(bot.sub(top).mul(wy));
    };
    const blob = (cx, cy, rx, ry, ph) => {
      const nx = p.x.sub(float(cx)).div(float(rx));
      const ny = p.y.sub(float(cy)).div(float(ry));
      const n = vn2(p.x.mul(float(9.0)).add(float(ph)), p.y.mul(float(9.0)).sub(float(ph))).toVar();
      return exp(nx.mul(nx).add(ny.mul(ny)).mul(float(-1.8)))
        .mul(smoothstep(float(0.30), float(0.62), n.mul(float(0.5)).add(float(0.36))));
    };
    const mass = blob(-0.12, 0.10, 0.20, 0.16, 0.4)
      .add(blob(0.10, -0.04, 0.16, 0.14, 2.1))
      .add(blob(0.02, 0.19, 0.14, 0.11, 4.3))
      .toVar();
    const r = length(vec2(p.x, p.y.mul(float(0.92)))).toVar();
    const mask = mass.mul(oneMinus(smoothstep(float(0.33), float(0.47), r))).toVar();
    // 下沿缠须：三条随 x 摆动的细弧
    const arc = (ph, off) => {
      const yy = p.y.sub(float(-0.16).add(p.x.mul(float(0.55))).add(sin(p.x.mul(float(7.0)).add(float(ph))).mul(float(0.05))));
      return exp(yy.mul(yy).div(float(0.0012)).mul(float(-1.0))).mul(float(off));
    };
    const tendrils = arc(0.6, 0.9).add(arc(2.4, 0.7)).add(arc(4.6, 0.6)).toVar();
    const wet = smoothstep(float(0.58), float(0.82), vn2(p.x.mul(float(6.0)).add(uSeed), p.y.mul(float(6.0)).sub(uSeed))).toVar();
    const rgb = mix(vec3(0.040, 0.034, 0.026), vec3(0.135, 0.120, 0.090), mask).toVar();
    const alpha = mask.mul(float(0.66))
      .add(tendrils.mul(float(0.30)))
      .add(wet.mul(mask).mul(float(0.18)))
      .toVar();
    const fade = smoothstep(float(0.0), float(0.12), uProg)
      .mul(oneMinus(smoothstep(float(0.60), float(1.0), uProg)));
    const edge = oneMinus(smoothstep(float(0.44), float(0.50), length(p)));
    return vec4(rgb.mul(fade).mul(edge), alpha.mul(fade).mul(edge));
  });
}

export async function corruptCling(ctx, deps, { at, size = 13, ms = 560 }) {
  if (!at) return;
  const uProg = uniform(0.0);
  const uSeed = uniform(Math.random() * 6.28 + 0.01);
  const { quad, release } = murkQuad({
    shade: makeClingShade()(uvOf(), uProg, uSeed),
    width: size, height: size * 1.15, name: 'spellFx:corruptCling', order: 28,
  });
  quad.position.set(at.x, at.y, (at.z ?? 0) + 1.8);
  deps.scene.add(quad);
  ctx.onKill(() => release());
  const st = { t: 0 };
  await ctx.tweenRaw(st, { t: 1 }, {
    durationMs: ms, ease: 'power1.out',
    onUpdate: () => { uProg.value = st.t; },
    onComplete: () => release(),
  });
}

// ---------------------------------------------------------------------------
// 菌丝连（回血养分 / 腐息抽丝）
// ---------------------------------------------------------------------------

// 贴地细根：不规则粗细 + 球状节点，脉冲亮珠沿生长方向跑。uS = (生长, 脉冲位置, 亮度, -)。
function makeSapLinkShade() {
  return Fn(([vUv, uS, uCfg]) => {
    const C = pal();
    const X = vUv.x.mul(uCfg.x).toVar();
    const Y = vUv.y.sub(float(0.5)).mul(uCfg.y).toVar();
    const target = uCfg.z, seed = uCfg.w;
    const s = clamp(X.div(target), float(0.0), float(1.0)).toVar();
    const env = sin(s.mul(float(Math.PI))).toVar();
    const wob = sin(X.mul(float(0.32)).add(seed)).mul(float(0.55)).mul(env)
      .add(sin(X.mul(float(0.90)).add(seed.mul(float(1.9)))).mul(float(0.16)).mul(env)).toVar();
    const d = Y.sub(wob).toVar();
    const lumps = sin(X.mul(float(2.2)).add(seed)).mul(float(0.22))
      .add(exp(X.sub(target.mul(float(0.38))).mul(X.sub(target.mul(float(0.38)))).mul(float(-0.6))).mul(float(0.35)))
      .add(float(1.0));
    const w = env.mul(float(0.40)).add(float(0.16)).mul(lumps).toVar();
    const q = d.div(w).toVar();
    const core = exp(q.mul(q).mul(float(-1.3))).toVar();
    const qr = q.sub(float(0.55));
    const rim = exp(qr.mul(qr).mul(float(-9.0))).toVar();
    const front = uS.x.mul(target).toVar();
    const grow = oneMinus(smoothstep(front.sub(float(0.6)), front.add(float(0.05)), X)).toVar();
    const pulsePos = uS.y.mul(target).toVar();
    const pulseD = X.sub(pulsePos);
    const pulse = exp(pulseD.mul(pulseD).mul(float(-0.55))).toVar();
    const ends = smoothstep(float(0.0), float(0.9), X)
      .mul(oneMinus(smoothstep(target.sub(float(0.9)), target, X))).toVar();
    // 普通混合：暗根 + 湿边 + 沿根跑的养分亮珠
    const hi = clamp(rim.mul(float(0.95)).add(pulse.mul(float(0.80))), float(0.0), float(1.0)).toVar();
    const rgb = mix(C.deep.mul(float(0.72)), C.wet, hi).toVar();
    const alpha = clamp(core.mul(float(0.95)).add(rim.mul(float(0.30))), float(0.0), float(1.0))
      .mul(grow).mul(ends).mul(uS.z).toVar();
    return vec4(rgb, alpha);
  });
}

export function corruptSapLink(ctx, deps, { from, to, ms = 460, width = 5 }) {
  const { ux, uz, dist } = groundPlacement(from, to);
  const len = dist + 2;
  const uS = uniform(new THREE.Vector4(0, 0, 1, 0));
  const uCfg = uniform(new THREE.Vector4(len, width, dist, Math.random() * 6.28 + 0.01));
  const { quad, release } = murkQuad({
    shade: makeSapLinkShade()(uvOf(), uS, uCfg),
    width: len, height: width, name: 'spellFx:corruptSapLink', order: 4,
  });
  placeGroundQuad(quad, from, to, len, 0.18);
  deps.scene.add(quad);
  ctx.onKill(() => release());
  const promise = (async () => {
    const st = { t: 0 };
    await ctx.tweenRaw(st, { t: 1 }, {
      durationMs: ms, ease: 'power1.inOut',
      onUpdate: () => {
        uS.value.x = st.t;
        uS.value.y = st.t;
      },
    });
    release();
  })();
  return { promise };
}

// ---------------------------------------------------------------------------
// 腐液抽痕（命中拍）
// ---------------------------------------------------------------------------

// 竖直 billboard：两道异角度的细抽痕交错（暗腐液 + 霉白湿脊 + 黑斑）；书写式显形。
function makeLashScarShade() {
  return Fn(([vUv, uProg, uSeed]) => {
    const C = pal();
    const p = vUv.sub(vec2(0.5)).toVar();
    const fade = smoothstep(float(0.0), float(0.10), uProg)
      .mul(oneMinus(smoothstep(float(0.50), float(1.0), uProg))).toVar();
    const wipe = smoothstep(float(-0.55), float(-0.55).add(uProg.mul(float(1.25))), p.x).toVar();
    const serr = sin(p.x.mul(float(85.0)).add(uSeed)).mul(float(0.18)).add(float(0.90)).toVar();
    const d1 = p.y.sub(p.x.mul(float(0.44)).add(float(0.05)))
      .sub(sin(p.x.mul(float(9.0)).add(uSeed)).mul(float(0.014))).mul(serr).toVar();
    const d2 = p.y.sub(p.x.mul(float(0.30)).sub(float(0.12)))
      .sub(sin(p.x.mul(float(7.0)).add(uSeed.mul(float(1.7)))).mul(float(0.010))).toVar();
    const core = exp(d1.mul(d1).mul(float(-3200.0)))
      .add(exp(d2.mul(d2).mul(float(-3200.0))).mul(float(0.75))).toVar();
    const halo = exp(d1.mul(d1).mul(float(-140.0)))
      .add(exp(d2.mul(d2).mul(float(-140.0))).mul(float(0.70))).toVar();
    const speckHash = fract(
      sin(floor(p.x.mul(float(9.0))).mul(float(127.1))
        .add(floor(p.y.mul(float(9.0))).mul(float(311.7)))
        .add(uSeed)).mul(float(43758.5)));
    const speck = smoothstep(float(0.95), float(0.99), speckHash).toVar();
    // 普通混合：暗腐液伤痕 + 霉白湿脊
    const hi = clamp(core.mul(float(0.85)).add(speck.mul(float(0.55))), float(0.0), float(1.0)).toVar();
    const rgb = mix(C.bruise.mul(float(0.85)), C.pale, hi).toVar();
    const alpha = clamp(core.mul(float(0.95)).add(halo.mul(float(0.22))), float(0.0), float(1.0))
      .mul(fade).mul(wipe).toVar();
    const edge = oneMinus(smoothstep(float(0.46), float(0.50), abs(p.x)))
      .mul(oneMinus(smoothstep(float(0.46), float(0.50), abs(p.y))));
    return vec4(rgb, alpha.mul(edge));
  });
}

export async function corruptLashScar(ctx, deps, { at, dir = 1, scale = 1, ms = 400 }) {
  if (!at) return;
  const uProg = uniform(0.0);
  const uSeed = uniform(Math.random() * 6.28 + 0.01);
  const w = 12.5 * scale, h = 8.6 * scale;
  const { quad, release } = murkQuad({
    shade: makeLashScarShade()(uvOf(), uProg, uSeed),
    width: w, height: h, name: 'spellFx:corruptLash', order: 32,
  });
  quad.rotation.z = -0.22 * dir;
  quad.position.set(at.x, at.y, (at.z ?? 0) + 2.0);
  deps.scene.add(quad);
  ctx.onKill(() => release());
  const st = { t: 0 };
  await ctx.tweenRaw(st, { t: 1 }, {
    durationMs: ms, ease: 'power1.out',
    onUpdate: () => { uProg.value = st.t; },
    onComplete: () => release(),
  });
}

// ---------------------------------------------------------------------------
// 常驻件：独眼
// ---------------------------------------------------------------------------

/** 独眼（琥珀光斑，挂立牌局部坐标——随姿态/倾倒；tick 自愈跟随立绘宽度）。 */
export function ensureEye(unit, onDispose = null) {
  if (unit._corruptEye) return unit._corruptEye;
  const tex = eyeTexture();
  if (!tex) return null;
  const mat = new THREE.SpriteMaterial({
    map: tex, color: 0xffffff, transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.AdditiveBlending, opacity: 0, fog: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.name = 'corruptEye';
  sprite.renderOrder = 40;
  unit.standee.add(sprite);
  const st = { level: 0, target: 0, flare: 0, blink: 0, t: Math.random() * 10 };
  let disposed = false;
  const tick = (dt) => {
    st.t += dt;
    st.level += (st.target - st.level) * (1 - Math.exp(-dt * 2.8));
    st.flare = Math.max(0, st.flare - dt * 1.9);
    st.blink = Math.max(0, st.blink - dt * 2.6);
    const H = unit._standeeHeight ?? 22;
    const srcW = unit.body?.geometry?.parameters?.width ?? H * 0.72;
    const s = Math.max(0.2, unit._baseScale ?? 1);
    // 立绘（919x509）独眼在图像 x 0.2895 / 距顶 0.1493——立牌局部坐标
    sprite.position.set(srcW * (0.2895 - 0.5), H * (1 - 0.1493), 0.75);
    const base = 0.58 + 0.09 * Math.sin(st.t * 1.55);
    const k = st.level * (base + st.flare * 0.85) * (1 - 0.88 * st.blink);
    mat.opacity = Math.max(0, Math.min(1, k));
    const sc = (5.4 + st.flare * 3.6) / s;
    sprite.scale.set(sc, sc * 0.78, 1);
    sprite.visible = mat.opacity > 0.02 && !unit._dead;
  };
  const untick = unit.addTick(tick);
  const h = {
    sprite,
    setLevel(v) { st.target = v; },
    flare(k = 1) { st.flare = Math.max(st.flare, k); },
    blink(k = 1) { st.blink = Math.max(st.blink, k); },
    dim() { st.target = 0; },
    dispose() {
      if (disposed) return;
      disposed = true;
      untick();
      sprite.parent?.remove(sprite);
      mat.dispose();
      if (unit._corruptEye === h) unit._corruptEye = null;
    },
  };
  unit._corruptEye = h;
  onDispose?.(() => h.dispose());
  return h;
}

// ---------------------------------------------------------------------------
// 小队查询 / 召唤位预测
// ---------------------------------------------------------------------------

const feetOf = (v) => ({
  x: v.position.x, y: v.position.y, z: v.position.z ?? 0,
});

function enemyViews(deps) {
  return (deps.cast?.query?.('unit:') ?? [])
    .map((e) => e.handle)
    .filter((v) => v && v.side === 'enemy');
}

// 召唤数按 core 同口径推算：补到 3 友军，且活体不越过 maxEnemies（DEFAULT_MAX_ENEMIES）。
// 尸体仍占投影槽位（不参与上限），故 ally/总数都按活体算，槽位预测另用全量 views。
function summonCount(deps, unit) {
  const views = enemyViews(deps);
  const aliveAllies = views.filter((v) => v !== unit && !v._dead).length;
  const aliveTotal = views.filter((v) => !v._dead).length;
  return Math.max(1, Math.min(3 - aliveAllies, DEFAULT_MAX_ENEMIES - aliveTotal));
}

// 敌排槽位预测（固定槽位制）：活体占用之外的最低空槽取前 n 个——与 core
// UnitSpawnInstruction 的分配（lowestFreeEnemySlot）同口径，根须爬向的新芽位
// 就是新单位随后立起的位置。occ 用视图 _slot（place 落位时记录）。
function predictSummonSlots(deps, unit, n) {
  const def = deps.sceneDef;
  if (!def?.slots?.enemies?.length) return [];
  const occ = new Set(
    enemyViews(deps).filter((v) => !v._dead).map((v) => v._slot).filter((s) => s != null));
  const out = [];
  for (let s = 0; s < def.slots.enemies.length && out.length < n; s++) {
    if (occ.has(s)) continue;
    const tr = slotTransform(def, 'enemy', s);
    out.push({ x: tr.x, y: unit.position.y + 0.04, z: tr.z });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 酝酿开场
// ---------------------------------------------------------------------------

async function corruptBrew({
  ctx, args, cast, particles, shake, vignette, camera, onStageDispose, runScript, unitById, scene,
}) {
  const unit = unitById?.(args?.unit);
  if (!unit) return;
  const H = unitH(unit);
  const deps = { scene, cast, particles, shake, camera };
  const disposeHook = onStageDispose ?? ((fn) => ctx.onKill(fn));

  // 机位：轻推半档（静中孕育，也有人看着）
  const base = camera?.basePose;
  const pose = base ? duelPose(base, { fovScale: 0.94, elScale: 0.6 }) : null;
  camera?.pushOverride?.('corruptBrew', {
    poses: pose ? { corruptBrew: pose } : {},
    onEnter: (dir) => { if (pose) dir.flyTo('corruptBrew', { durationMs: 800, ease: 'power2.out' }); },
  });

  // 独眼 + 地根网（两者都挂舞台寿命）
  const eye = ensureEye(unit, disposeHook);
  eye?.setLevel(1);
  eye?.blink(1);
  const field = createRootField(unit, deps, { size: H * 2.2, level: 0.95, onDispose: disposeHook });
  unit._corruptField = field;
  field.setTarget(1);
  field.pulse(0.5);
  unit._corruptEye = eye;

  // 腐土点光（从舞台光池借 light:fx0；暗琥珀，不是绿光）
  const glow = cast.get('light:fx0');
  if (glow) {
    glow.color.setRGB(0.40, 0.36, 0.24);
    glow.distance = H * 4.2;
    glow.position.set(0, H * 0.4, H * 0.2);
    unit.add(glow);
    unit._corruptLight = glow;
    disposeHook(() => { glow.intensity = 0; unit.remove(glow); });
    ctx.tweenRaw(glow, { intensity: 320 }, { durationMs: 1700, ease: 'power2.out' });
  }

  // 呼吸两拍：桩体鼓胀 + 根脉冲 + 暗色内部代谢闪
  const PULSES = [0.30, 0.66];
  const hit = PULSES.map(() => false);
  await ctx.custom(unit.uniqueID, {
    durationMs: 1600, ease: 'none',
    onUpdate: (t) => {
      const b = 0.020 * Math.sin(t * Math.PI * 2)
        + 0.028 * Math.max(0, Math.sin(t * Math.PI * 2 - 0.55));
      unit.setPose({ squash: 1 + b, widen: 1 + b * 0.65 });
      PULSES.forEach((at, i) => {
        if (hit[i] || t < at) return;
        hit[i] = true;
        void tintPulse(ctx, unit, 0x2e2a1e, 280);
        field.pulse(0.7);
        eye?.flare(0.5);
      });
    },
  });
  unit.resetPose?.();

  // 雾起：三处低速腐雾（错峰）+ 腐沼光照（压暗偏熄火）
  shake.impulse?.(0.22);
  vignette?.pulse?.(0.45);
  const MISTS = [
    { dx: 0, dy: H * 0.35, r: H * 0.55, rate: 2.4 },
    { dx: -H * 0.95, dy: H * 0.12, r: H * 0.5, rate: 1.5 },
    { dx: H * 0.9, dy: H * 0.1, r: H * 0.5, rate: 1.5 },
  ];
  const mists = [];
  for (const m of MISTS) {
    const em = particles.spawnEmitter(unit.position.x + m.dx, unit.position.y + m.dy, {
      rate: m.rate, radius: m.r, color: PX.spore, speed: 1.1, ttl: 3.6, size: 1.25,
      gravity: 0.8, vby: 1.0, zJitter: H * 0.35, z: unit.position.z,
    });
    if (!em) continue;
    mists.push({ em, dx: m.dx, dy: m.dy });
    disposeHook(() => em.stop());
  }
  unit._corruptMists = mists;

  // 冠部滴落：低速率、有重力的腐液滴珠
  const drip = (runScript ?? ((body) => ctx.spawn(body)))(async (c) => {
    for (;;) {
      await c.wait(1500 + Math.random() * 1800);
      if (!unit.parent || unit._dead) break;
      particles.spawn(
        unit.position.x + (Math.random() - 0.5) * H * 0.5,
        unit.position.y + H * 0.9,
        {
          color: PX.sap, count: 2, speed: 1.0, vy: -2, size: 0.9,
          ttl: 0.7, gravity: -16, z: unit.position.z + 1,
        },
      );
    }
  });
  unit._corruptDrip = drip;
  disposeHook(() => drip.kill?.());

  const mood = cast.get('light:mood');
  if (mood) {
    ctx.tweenRaw(mood, { dim: mood.dim * 0.88 }, { durationMs: 1800 });
    ctx.tweenRaw(mood, { fireGain: mood.fireGain * 0.82 }, { durationMs: 1800 });
  }
  await ctx.wait(800);
  await camera?.flyHome?.({ durationMs: 720, ease: 'power2.inOut' });
  camera?.popOverride?.('corruptBrew');
}

// ---------------------------------------------------------------------------
// 起手拍
// ---------------------------------------------------------------------------

// 召唤：桩体一压 → 分叉藤蔓从桩脚爬向每个新芽位 → 土丘鼓起 + 根爪抽出 → 根苞裂开
// （随后 ANIM_UNIT_SPAWN 立起）。
async function actSummon({ ctx, deps, unit }) {
  const H = unitH(unit);
  const feet = feetOf(unit);
  const field = unit._corruptField;
  unit._corruptEye?.flare(1.1);
  field?.pulse(1.1);
  const n = summonCount(deps, unit);
  const slots = predictSummonSlots(deps, unit, n);
  ctx.onKill(() => unit.resetPose?.());
  const squash = ctx.custom(unit.uniqueID, {
    durationMs: 170, ease: 'power2.out',
    onUpdate: (t) => unit.setPose({ squash: 1 - 0.07 * t, widen: 1 + 0.06 * t }),
  });
  const targets = slots.length
    ? slots
    : [{ x: unit.position.x + H * 0.6, y: unit.position.y, z: unit.position.z }];
  const runners = targets.map((slot) => corruptVineRun(ctx, deps, { from: feet, to: slot, ms: 320 }).promise);
  await squash;
  await Promise.all(runners);
  for (const slot of targets) {
    deps.particles?.spawn(slot.x, slot.y + 0.5, {
      color: PX.soil, count: 9, speed: 8, size: 1.5, ttl: 0.75, gravity: -12, z: slot.z + 0.6,
    });
    deps.particles?.spawn(slot.x, slot.y + 1.4, {
      color: PX.damp, count: 6, speed: 3.2, vy: 2.2, size: 1.6, ttl: 0.9, gravity: -4, z: slot.z + 1.0,
    });
    deps.particles?.spawn(slot.x, slot.y + 0.8, {
      color: PX.spore, count: 6, speed: 2.0, vy: 2.6, size: 1.0, ttl: 1.2, gravity: 1.0, z: slot.z + 0.8,
    });
  }
  deps.shake?.impulse?.(0.35);
  const buds = targets.map((slot) => ctx.spawn(async (c) => {
    await corruptRootEmergence(c, deps, { at: slot, h: H * 0.78, w: H * 0.60, ms: 600 }).promise;
  }));
  await Promise.all(buds.map((b) => b.promise));
  unit.resetPose?.();
}

// 攻击：桩体一压前倾 → 三道 3D 藤蔓错峰疾走（命中拍逐记根刺破土）
async function actVolley({ ctx, deps, unit, player }) {
  const feet = feetOf(unit);
  unit._corruptEye?.flare(1.5);
  unit._corruptField?.pulse(1.0);
  ctx.onKill(() => unit.resetPose?.());
  await ctx.custom(unit.uniqueID, {
    durationMs: 230, ease: 'power2.in',
    onUpdate: (t) => unit.setPose({ lean: 0.10 * t, squash: 1 - 0.05 * t }),
  });
  if (!player) {
    unit.resetPose?.();
    return;
  }
  const pf = feetOf(player);
  const dx = pf.x - feet.x, dz = pf.z - feet.z;
  const dist = Math.hypot(dx, dz) || 1;
  const nx = -dz / dist, nz = dx / dist;
  const OFFS = [-5.2, 0, 5.2];
  const jobs = [];
  for (let i = 0; i < 3; i++) {
    const to = { x: pf.x + nx * OFFS[i], y: pf.y, z: pf.z + nz * OFFS[i] };
    jobs.push(corruptVineRun(ctx, deps, {
      from: feet, to, ms: 240 + i * 60, tendrils: 3, spread: 0.62,
    }).promise);
    await ctx.wait(60);
  }
  await Promise.all(jobs);
  deps.shake?.impulse?.(0.55);
  deps.particles?.spawn(pf.x, pf.y + 0.5, {
    color: PX.soil, count: 9, speed: 8, size: 1.3, ttl: 0.65, gravity: -14, z: pf.z,
  });
  unit.resetPose?.();
}

// 腐息：吸气（菌丝汇向桩顶）→ 贴地腐雾团滚到玩家脚边 → 缠身 + 反向抽丝。
// 雾体抵达（arriveU）时才放行效果节拍——虚弱/脆弱图标与玩家身上的腐块同刻。
async function actExhale({ ctx, deps, unit, player, releaseBeat }) {
  const H = unitH(unit);
  const feet = feetOf(unit);
  const crown = {
    x: unit.position.x,
    y: unit.position.y + H * 0.92,
    z: unit.position.z,
  };
  unit._corruptEye?.flare(1.2);
  ctx.onKill(() => unit.resetPose?.());
  const inhale = ctx.custom(unit.uniqueID, {
    durationMs: 360, ease: 'power2.inOut',
    onUpdate: (t) => unit.setPose({ squash: 1 - 0.05 * t, widen: 1 - 0.04 * t, lean: -0.03 * t }),
  });
  const drain = drainVeins(ctx, deps, {
    at: crown, color: [0.46, 0.43, 0.30], size: H * 0.9, ms: 420, focusPeak: 1.0,
  });
  await Promise.all([inhale, drain]);
  if (!player) {
    unit.resetPose?.();
    return;
  }
  const pf = feetOf(player);
  const MS = 820;
  const wave = corruptMiasma(ctx, deps, { from: feet, to: pf, ms: MS });
  const exhale = ctx.custom(unit.uniqueID, {
    durationMs: 420, ease: 'power2.out',
    onUpdate: (t) => unit.setPose({
      squash: 1 + 0.05 * Math.sin(Math.PI * t),
      widen: 1 + 0.08 * Math.sin(Math.PI * t),
    }),
  });
  await exhale;
  // 云队抵达（arriveU）才放行效果节拍：虚弱/脆弱图标与玩家身上的腐块同刻起；
  // 余粒继续在身后消散，与缠身/抽丝并行收尾。
  await ctx.wait(Math.round(MS * wave.arriveU));
  releaseBeat?.();
  const s = Math.max(0.75, player._baseScale ?? 1);
  const chest = {
    x: player.position.x,
    y: player.position.y + unitH(player) * 0.52,
    z: player.position.z,
  };
  const cling = ctx.spawn((c) => corruptCling(c, deps, { at: chest, size: 13 * s, ms: 560 }));
  const siphon = ctx.spawn((c) => corruptSapLink(c, deps, { from: pf, to: feet, ms: 480 }));
  const tint = ctx.spawn((c) => tintPulse(c, player, 0x6d6852, 360));
  deps.vignette?.pulse?.(0.45);
  await Promise.all([cling.promise, siphon.promise, tint, wave.promise]);
  unit.resetPose?.();
}

// 回血：桩脚脉冲 → 菌丝连到每个友军脚下 → 根苞 + 养分上涌。
async function actHeal({ ctx, deps, unit }) {
  const H = unitH(unit);
  const feet = feetOf(unit);
  unit._corruptEye?.flare(1.0);
  unit._corruptField?.pulse(1.0);
  unit._fxLayer?.get('bossVeins')?.pulse?.(1.0);
  deps.particles?.spawn(unit.position.x, unit.position.y + H * 0.85, {
    color: PX.spore, count: 8, speed: 2.2, vy: -2.5, size: 1.0, ttl: 1.1, gravity: -7, z: unit.position.z + 1,
  });
  const allies = enemyViews(deps).filter((v) => v !== unit && !v._dead);
  if (!allies.length) {
    await ctx.wait(300);
    return;
  }
  const links = allies.map((a) => corruptSapLink(ctx, deps, { from: feet, to: feetOf(a), ms: 460 }));
  await ctx.wait(330);
  const blooms = allies.map((a) => ctx.spawn((c) => corruptRootBud(c, deps, {
    at: feetOf(a), h: unitH(a) * 0.5, w: unitH(a) * 0.42, ms: 420,
  })));
  const tints = [];
  for (const a of allies) {
    tints.push(ctx.spawn((c) => tintPulse(c, a, 0x8a7f5e, 340)));
    deps.particles?.spawn(a.position.x, a.position.y + 0.6, {
      color: PX.spore, count: 5, speed: 2.0, vy: 4, size: 0.9, ttl: 1.0, gravity: 1.2, z: a.position.z + 0.6,
    });
  }
  await Promise.all([
    ...links.map((l) => l.promise),
    ...blooms.map((b) => b.promise),
    ...tints,
  ]);
}

// 力量：根网收缩蓄力（前摇）→ 每个友军脚下根刺爆起（力量注入）。
// 前摇 = 独眼收光 + 桩体吸气 + 根网回缩；爆发一记不靠扩散波纹（那太抢戏）。
async function actStrength({ ctx, deps, unit }) {
  const H = unitH(unit);
  const feet = feetOf(unit);
  const field = unit._corruptField;
  const allies = enemyViews(deps).filter((v) => v !== unit && !v._dead);
  ctx.onKill(() => unit.resetPose?.());
  // 前摇：收光、吸气、根网回缩
  unit._corruptEye?.setLevel(0.15);
  field?.setTarget(0.22);
  unit._fxLayer?.get('bossVeins')?.setLevel?.(0.4);
  deps.particles?.spawn(unit.position.x, unit.position.y + H * 0.92, {
    color: PX.rot, count: 8, speed: 2.5, vy: -3.5, size: 1.1, ttl: 0.7, gravity: -9, z: unit.position.z + 1,
  });
  await ctx.custom(unit.uniqueID, {
    durationMs: 500, ease: 'power2.inOut',
    onUpdate: (t) => unit.setPose({ squash: 1 + 0.07 * t, widen: 1 - 0.05 * t }),
  });
  await ctx.wait(90);
  // 爆发：根网外涌 + 友军脚下根刺
  unit._corruptEye?.setLevel(1);
  unit._corruptEye?.flare(1.8);
  field?.setTarget(1);
  field?.pulse(1.4);
  unit._fxLayer?.get('bossVeins')?.setLevel?.(0.75);
  unit._fxLayer?.get('bossVeins')?.pulse?.(1.2);
  deps.shake?.impulse?.(0.55);
  unit.setPose({ lean: -0.045, widen: 1.05 });
  const spikes = allies.map((a) => ctx.spawn((c) => corruptRootSpike(c, deps, {
    at: feetOf(a),
    h: unitH(a) * 0.82,
    w: unitH(a) * 0.40,
    ms: 460,
    lean: (Math.random() < 0.5 ? -1 : 1) * 0.08,
  })));
  const tints = [];
  for (const a of allies) {
    a.setPose?.({ lean: -0.04 });
    tints.push(ctx.spawn((c) => tintPulse(c, a, 0x8a7f5e, 380)));
  }
  await Promise.all([...spikes.map((s) => s.promise), ...tints]);
  for (const a of allies) a.resetPose?.();
  await ctx.wait(160);
  unit.resetPose?.();
}

// 未知/防御拍：根网一颤 + 独眼一闪（不占戏的轻量版）
async function actIdle({ ctx, unit }) {
  unit._corruptEye?.flare(0.8);
  unit._corruptField?.pulse(0.5);
  await ctx.wait(200);
}

async function corruptAct({ ctx, deps, unit, player, kinds, args, releaseBeat }) {
  const tag = args?.fx ?? null;
  if (tag === 'summon' || (!tag && kinds.includes('summon'))) return actSummon({ ctx, deps, unit });
  if (tag === 'strength') return actStrength({ ctx, deps, unit });
  if (tag === 'heal') return actHeal({ ctx, deps, unit });
  if (tag === 'debuff' || (!tag && kinds.some(isDebuffKind))) {
    return actExhale({ ctx, deps, unit, player, releaseBeat });
  }
  if (kinds.some(isAttackKind)) return actVolley({ ctx, deps, unit, player });
  if (tag === 'attack') return actVolley({ ctx, deps, unit, player });
  if (kinds.some(isBuffKind) || kinds.includes('heal')) {
    // 无内容标记的兜底：有 ≥3 友军 = 力量，否则按回血
    const allies = enemyViews(deps).filter((v) => v !== unit && !v._dead);
    if (allies.length >= 3) return actStrength({ ctx, deps, unit });
    return actHeal({ ctx, deps, unit });
  }
  return actIdle({ ctx, unit });
}

// ---------------------------------------------------------------------------
// 命中拍（Boss 的攻击落在玩家身上）
// ---------------------------------------------------------------------------

// 根刺破土 + 腐液抽痕 + 泥屑（量级随 tier；连击三拍逐记）。
async function corruptHitBeat(ctx, deps, args) {
  const unit = args.unit;
  if (!unit) return;
  const H = unitH(unit);
  const tier = args.fx?.tier ?? 'normal';
  const k = tier === 'heavy' ? 1.45 : tier === 'rapid' ? 0.86 : 1.0;
  const feet = feetOf(unit);
  const chest = {
    x: unit.position.x,
    y: unit.position.y + H * 0.52,
    z: unit.position.z,
  };
  const dir = Math.sign(feet.x - (args.fromX ?? feet.x + 10)) || 1;
  const spike = ctx.spawn((c) => corruptRootSpike(c, deps, {
    at: { x: feet.x + (Math.random() - 0.5) * 1.6, y: feet.y, z: feet.z },
    h: H * 0.78 * k,
    w: H * 0.40 * k,
    ms: 380 + (tier === 'heavy' ? 120 : 0),
    lean: -dir * 0.10,
  }));
  const scar = corruptLashScar(ctx, deps, { at: chest, dir, scale: k, ms: tier === 'heavy' ? 560 : 380 });
  deps.particles?.spawn(chest.x, chest.y, {
    color: PX.sap, count: Math.round(5 * k) + 2, speed: 8 * k,
    size: 0.9, ttl: 0.5, gravity: -20, z: chest.z + 1,
  });
  deps.particles?.spawn(feet.x, feet.y + 0.5, {
    color: PX.soil, count: 7, speed: 7, size: 1.2, ttl: 0.6, gravity: -14, z: feet.z,
  });
  lampPulse(ctx, deps, {
    name: 'light:fx1', at: chest, color: [0.52, 0.46, 0.32],
    peak: tier === 'heavy' ? 620 : 360, attackMs: 60, decayMs: 260,
  });
  if (tier === 'heavy') {
    deps.shake?.impulse?.(1.1);
    await screenFlash(ctx, deps, { intensity: 0.10, ms: 180, color: 0xd8cdb2 });
  }
  await Promise.all([spike.promise, scar]);
}

// ---------------------------------------------------------------------------
// 死亡（树体灰塌，根网回收）
// ---------------------------------------------------------------------------

function corruptDeath(stage, unit, payload, finish) {
  unit.hideIntention();
  unit.hideStatus();
  const H = unitH(unit);
  const eye = unit._corruptEye;
  const field = unit._corruptField;
  eye?.flare(1.4);
  eye?.dim();
  field?.setTarget(0);
  for (const m of unit._corruptMists ?? []) m.em?.stop?.();
  unit._corruptDrip?.kill?.();
  if (unit._corruptLight) unit._corruptLight.intensity = 0;
  const bodyMat = unit.body.material;
  bodyMat.transparent = true;
  bodyMat.needsUpdate = true;
  const fromColor = bodyMat.color.clone();
  const ashColor = new THREE.Color(0x4a4a42);
  const px = unit.position.x, py = unit.position.y, pz = unit.position.z;
  // 孢子一次性释放（腐朽本体坍缩时把孢子全喷出来——死亡不是消失，是散播）
  stage.particles?.spawn(px, py + H * 0.5, {
    color: PX.spore, count: 24, speed: 8, ttl: 1.7, size: 1.2, gravity: 2.0, z: pz + 1,
  });
  stage.particles?.spawn(px, py + H * 0.2, {
    color: PX.rot, count: 16, speed: 5.5, ttl: 1.3, size: 1.7, gravity: -2, z: pz + 1,
  });
  // 眼熄一拍：先亮到顶再塌
  stage.animator.animateCustom(unit.uniqueID, {
    durationMs: 240, ease: 'power2.in',
    onUpdate: (t) => unit.setPose({ squash: 1 + 0.03 * t, widen: 1 + 0.05 * t }),
  });
  stage.animator.animateCustom(unit.uniqueID, {
    durationMs: 900, ease: 'power2.in', delayMs: 240,
    onUpdate: (t) => {
      unit.setPose({
        squash: 1.03 - 0.55 * t,
        widen: 1.05 + 0.25 * t,
      });
      bodyMat.color.copy(fromColor).lerp(ashColor, Math.min(1, t * 1.15));
      bodyMat.opacity = 1 - Math.max(0, (t - 0.55) / 0.45);
    },
    onComplete: () => {
      unit.body.castShadow = false;
      unit.visible = false;
      unit._corruptEye?.dispose?.();
      unit._corruptField?.dispose?.();
      finish();
    },
  });
  return undefined;
}

// ---------------------------------------------------------------------------
// 注册
// ---------------------------------------------------------------------------

export function registerCorruptSourceScripts(register) {
  register('bosses/corruptBrew', corruptBrew);
  registerEnemyHitBeat('corruptSource', corruptHitBeat);
  registerEnemyAct('corruptSource', corruptAct);
  registerEnemyDeathBeat('corruptSource', corruptDeath);
  // 扎根植物：不突进——攻击的身体语言是地下根须 + 命中拍根刺，不是挪步扑人
  registerEnemyNoLunge('corruptSource');
  // 常驻菌络导演（bossStateFx）：菌体活着 = 菌网常亮（代谢行波 + 孢囊呼吸）
  registerBossStateFx('corruptSource', (obj, unitProj) => {
    if (unitProj.isDead) return;
    obj._fxLayer?.overlay('bossVeins', 2, (l) => makeSporeVeins(l));
    obj._fxLayer?.setLevel('bossVeins', 0.55);
  });
  // 受击补充：木屑崩落 + 树汁/孢子 + 菌网一缩 + 独眼一眨
  registerBossHurtFx('corruptSource', (ctx, deps, { unit, dealt }) => {
    const H = unitH(unit);
    const s = unit._baseScale ?? 1;
    unit._corruptEye?.blink(1);
    unit._corruptField?.pulse(0.3);
    unit._fxLayer?.get('bossVeins')?.pulse?.(0.4);
    const px = unit.position.x;
    const py = unit.position.y + H * rand(0.35, 0.7);
    const pz = unit.position.z;
    deps.particles?.spawn(px, py, {
      color: PX.spore, count: Math.min(5 + Math.round(dealt / 4), 13),
      speed: 5, size: 0.85, ttl: 0.9, gravity: 1.4, z: pz + 1,
    });
    deps.particles?.spawn(px, py, {
      color: PX.sap, count: 4, speed: 8, size: 1.1, ttl: 0.6, gravity: -14, z: pz + 1,
    });
    // 木屑：带湿棱的薄片旋转着崩出去
    const tex = splinterTexture();
    if (tex) {
      const n = Math.min(5, 2 + Math.round(dealt / 8));
      for (let i = 0; i < n; i++) {
        const side = Math.random() < 0.5 ? -1 : 1;
        const rec = deps.particles?.spawnSprite?.(px + (Math.random() - 0.5) * H * 0.4, py, {
          texture: tex,
          width: 2.2 * s * rand(0.7, 1.2),
          height: 1.5 * s * rand(0.7, 1.2),
          z: pz + 2,
          vx: side * rand(6, 14),
          vy: rand(7, 15),
          gravity: -30,
          drag: 0.4,
          ttl: rand(0.7, 1.1),
          scalePop: 0.2,
        });
        if (rec) rec.sprite.material.rotation = Math.random() * Math.PI * 2;
      }
    }
  });
}
