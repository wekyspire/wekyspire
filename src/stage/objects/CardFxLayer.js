// CardFxLayer：卡牌特效统一宿主 —— 牌面叠加特效的统一管理者（CardObject 组合子）。
// 对位单位侧 UnitFxLayer（VFX 结构大更新 Phase 3，2026-09-27 收口为固定 C0–C3 层级）。
// 全部时间驱动（update(dt) 自算时间线），不依赖 gsap/tween 注入，也没有外部寄生状态。
// 固定层级（C = Card；z 为牌面局部纵深，牌面 z=0）：
//   C0 牌面 shader —— face 材质补丁（fx/cardBodyFx.js，构造即挂常驻）：uBurn 焚毁
//        吞蚀（离场演出）/ uDim 禁用压暗 / uHighlight 高亮提暖；记录 = this.body
//   C1 压暗层 z 0.35~0.36 —— veil 冷却膜（shader 霜冻/腐蚀）+ doom 暗化盖纱：
//        法线混合压暗牌面（「这张牌暂时不可用/要离开」的沉下去感）
//   C2 标记层 z 0.40~0.50 —— chip 冷却拍数水印（0.40）、lock 锁定四角括号（0.44）、
//        doom 将弃描框（0.50）：表意件，低透明度/描边，不发光
//   C3 发光层 z 0.40~3.0 —— pulse 一次性加色脉冲（0.45）、edge 咏唱流光（0.40，
//        低于手牌扇相邻卡 z 间隔 0.5：邻牌盖得住光环；HDR 直出 >1.45 阈喂 bloom）、
//        transform 变换叠层（3.0，fx/cardTransform.js
//        自管生命周期）；HDR 约定：内容色 ≤1，发光件乘算过阈
// 三张平面各自惰性创建；焚毁接管牌面前调 clearTransient() 熄灭全部叠加。

import * as THREE from 'three';
import { additiveLight } from '../post/passes.js';
import { attachCardBodyFx } from '../fx/cardBodyFx.js';
import {
  Fn, If, Discard, Loop, uniform, uv, select,
  vec2, vec3, vec4, float, mix, clamp, abs, max, min, pow, floor, fract,
  sin, dot, length, exp, step, smoothstep, oneMinus,
} from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu'; // WebGPU 迁移：veil/edgeGlow 的 colorNode 必须挂 Node 材质

const VEIL_LERP = 7;       // 覆盖高度收敛速率（/s——拍数推进时前沿平滑爬行的动画）
const PULSE_OPACITY = 0.55;
// 冷却拍数水印：牌面中央低透明度平面白字（用户定 2026-09-13：平面型水印，
// 驳回大号发光 counter 与色块徽章两版）
const CHIP_LAYOUT = { w: 12, h: 12, y: 1.2, z: 0.4, opacity: 0.26 };
// 将弃描边：警示红 + 急促呼吸（1.2s——逼近的截止感）；暗化盖纱让牌面"沉"下去
const DOOM_COLOR = 0xd84848;
const DOOM_PERIOD = 1.2;
// 锁定括号：警戒琥珀 + 慢呼吸（2.4s——「已被瞄准」的持续状态感，与将弃的急促截止区分）
const LOCK_COLOR = 0xe8a23c;
const LOCK_PERIOD = 2.4;
// 咏唱流光面片：牌面外扩边距（给 rim 外溢与光晕留空间）、点亮淡入速率
const EDGE_MARGIN = 5;
const EDGE_FADE_IN = 3.5;

// ---- WebGPU 迁移（2026-09-27）：veil / edgeGlow 两件内嵌 shader 平移成 TSL ----
// 范式与 fx/unitBodyFx.js 同源：uniform = TSL uniform() 节点（`{ uX: { value } }` 推值
// 口径不变，update 推流点零改动）；着色链 = TSL Fn 组合；材质改 MeshBasicNodeMaterial，
// colorNode 全量接管输出（vec4 的 a 通道即片元透明度——veil 写 alpha、edgeGlow 恒 1）。
// 纪律：If/Discard/Loop 必须待在 Fn 栈内；WGSL smoothstep 反向边一律改正向 + oneMinus。

// 圆角矩形 SDF（veil 圆角裁剪 / edgeGlow rimlight 共用基元）
const sdRoundBox = Fn(([p, b, r]) => {
  const q = abs(p).sub(b).add(r);
  return length(max(q, vec2(0.0))).add(min(max(q.x, q.y), 0.0)).sub(r);
});

// 咏唱边缘流光（原 EDGE_GLOW_FRAG 逐式平移）：呼吸 rimlight（圆角矩形 SDF 内收外溢
// 双边带）+ 3 颗沿边巡游的彗星光点（头部高斯光晕 + 沿 rim 的渐熄拖尾，亮度并入
// rimlight）。加色混合、alpha 恒 1，rgb 直接输出 HDR（峰值 >1 radiance）交给 bloom。
const vHash = Fn(([p]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)));

// 矩形周长参数路径（t∈[0,1)，顶边左→右起顺时针）——GLSL 早退链改 If/Else 嵌套
const edgePath = Fn(([t, hf]) => {
  const w = hf.x.mul(2.0), h = hf.y.mul(2.0);
  const d = fract(t).mul(2.0).mul(w.add(h)).toVar();
  const out = vec2(0.0).toVar();
  If(d.lessThan(w), () => {
    out.assign(vec2(d.sub(hf.x), hf.y));
  }).Else(() => {
    d.subAssign(w);
    If(d.lessThan(h), () => {
      out.assign(vec2(hf.x, hf.y.sub(d)));
    }).Else(() => {
      d.subAssign(h);
      If(d.lessThan(w), () => {
        out.assign(vec2(hf.x.sub(d), hf.y.mul(-1.0)));
      }).Else(() => {
        d.subAssign(w);
        out.assign(vec2(hf.x.mul(-1.0), d.sub(hf.y)));
      });
    });
  });
  return out;
});

// 片元的最近边周长参数（拖尾亮带用；角部按主导轴近似，视觉连续即可）
const edgeParam = Fn(([p, hf]) => {
  const w = hf.x.mul(2.0), h = hf.y.mul(2.0);
  const dx = hf.x.sub(abs(p.x)), dy = hf.y.sub(abs(p.y));
  const s = float(0).toVar();
  If(dx.lessThan(dy), () => {
    s.assign(select(p.x.greaterThan(0.0),
      w.add(hf.y.sub(p.y)), w.mul(2.0).add(h).add(p.y.add(hf.y))));
  }).Else(() => {
    s.assign(select(p.y.greaterThan(0.0),
      p.x.add(hf.x), w.add(h).add(hf.x.sub(p.x))));
  });
  return s.div(w.add(h).mul(2.0));
});

const edgeShade = Fn(([vUv, uTime, uFade, uCard, uPlane, uColor]) => {
  const p = vUv.sub(0.5).mul(uPlane);
  const hf = uCard.mul(0.5);
  const d = sdRoundBox(p, hf, 1.5);

  // 呼吸 rimlight：内收外溢不对称边带，3.2s 慢呼吸（明灭约 3:1）
  const breath = float(0.55).add(sin(uTime.mul(1.9635)).mul(0.45));
  const rim = select(d.lessThan(0.0), exp(d.mul(1.6)), exp(d.mul(-0.85)));

  // 绕行光点：3 颗彗星 ~4.5s 一圈，各自快速脉动；拖尾只亮在 rim 附近 → 融入 rimlight
  const s = edgeParam(p, hf);
  const rimProx = exp(abs(d).mul(-0.9));
  const head = float(0).toVar();
  const trail = float(0).toVar();
  Loop(3, ({ i }) => {
    const fi = float(i);
    const ti = fract(uTime.mul(0.22).add(fi.mul(0.333333)));
    const pulse = float(0.62).add(sin(uTime.mul(11.0).add(fi.mul(2.4))).mul(0.38));
    const dv = p.sub(edgePath(ti, hf));
    head.addAssign(exp(dot(dv, dv).mul(-1.1)).mul(pulse));
    trail.addAssign(exp(fract(s.sub(ti).add(1.0)).mul(-11.0)).mul(pulse).mul(0.7));
  });

  // 能量配比：rim 呼吸 ~0.16..0.54（压 bloom 阈下，保持牌面可读、暖金不发白），
  // 拖尾峰值 ~0.85，光点头峰值 ~1.9（唯一稳过 bloom 阈的主光源）
  const energy = rim.mul(breath.mul(0.38).add(0.16))
    .add(trail.mul(rimProx).mul(0.85))
    .add(head.mul(1.9));
  // 面片边缘衰减窗（2026-09-22 断层修复）：rim 的 exp 外溢渐熄但永不严格到 0，
  // 面片边界处残余 ~0.01 能量被硬截断 → 淡淡色彩断层。在外扩带的外半段把能量
  // 平滑压到恰 0（margin = 牌面到面片边的外扩距离；d 在边中点恰 = margin，角部更大，
  // 面片边界处窗恒为 0）。光点头在卡边（d≈0）不受窗影响。
  const margin = uPlane.x.sub(uCard.x).mul(0.5);
  const edgeFade = oneMinus(smoothstep(margin.mul(0.45), margin.mul(0.95), d));
  return vec4(uColor.mul(energy).mul(uFade).mul(edgeFade), 1.0);
});

// 冷却薄纱（原 VEIL_FRAG 逐式平移；2026-09-27 用户定「别弄纯色块覆盖」）：
// 覆盖区 = 顶部 uFrac 高。
//   冷却中（uMode 0）：霜冻膜——霜蓝斑驳 + 竖向冷凝垂纹 + 霜晶闪点（缓闪）+ 冰蓝前沿线；
//   衰败过（uMode 1，冷却被反向推深）：腐蚀膜——暗红血管纹理搏动 + 犬牙侵蚀前沿 + 余烬闪点（急闪）。
// 前沿线位置噪声扰动（冷却细波 / 衰败犬牙），高度变化经 JS 侧 uFrac 收敛驱动（前沿爬行动画）。
// 亮度纪律：指示性特效不抢戏——前沿线峰 ~1.3 压 bloom 阈下；法线混合（要压暗牌面，非发光件）。
const vNoise = Fn(([p]) => {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(f.mul(-2.0).add(3.0));
  return mix(
    mix(vHash(i), vHash(i.add(vec2(1.0, 0.0))), u.x),
    mix(vHash(i.add(vec2(0.0, 1.0))), vHash(i.add(vec2(1.0, 1.0))), u.x),
    u.y);
});
const vFbm = Fn(([p]) =>
  vNoise(p).mul(0.55)
    .add(vNoise(p.mul(2.13).add(vec2(4.7, 9.2))).mul(0.28))
    .add(vNoise(p.mul(4.31).add(vec2(9.4, 2.6))).mul(0.17)));

const veilShade = Fn(([vUv, uTime, uFrac, uMode, uCard]) => {
  // 圆角裁剪（与牌面轮廓一致——薄纱不再顶出方形角）
  const p = vUv.sub(0.5).mul(uCard);
  const corner = oneMinus(smoothstep(-0.25, 0.0, sdRoundBox(p, uCard.mul(0.5), 1.5)));

  const y = vUv.y; // 0 底 1 顶
  // 前沿线（冷却细波 / 衰败犬牙，随时间缓移）
  const jag = mix(0.010, 0.030, uMode);
  const wob = vFbm(vec2(
    vUv.x.mul(mix(14.0, 9.0, uMode)),
    uTime.mul(mix(0.35, 1.1, uMode)),
  )).sub(0.5).mul(2.0).mul(jag);
  const front = oneMinus(uFrac).add(wob);
  const d = y.sub(front); // >0 = 覆盖区内
  const a = smoothstep(0.0, 0.010, d).mul(corner);
  If(a.lessThanEqual(0.002), () => { Discard(); }); // 覆盖区外整片裁掉

  // 覆盖区底纹：冷却 = 斑驳 + 冷凝垂纹；衰败 = 血管状搏动（ridged noise）
  const mottle = vFbm(vUv.mul(vec2(5.0, 7.5)).add(vec2(0.0, uTime.mul(-0.03))));
  const streak = vFbm(vec2(vUv.x.mul(26.0), vUv.y.mul(3.0).add(uTime.mul(0.05))));
  const vein = oneMinus(abs(vFbm(vUv.mul(vec2(7.0, 10.0))
    .add(vec2(uTime.mul(0.06), uTime.mul(-0.10)))).mul(2.0).sub(1.0)))
    .pow(3.0)
    .mul(sin(uTime.mul(5.2)).mul(0.4).add(0.6));
  const texK = mix(mottle.mul(0.7).add(streak.mul(0.3)), vein, uMode);

  // 深度渐变：离前沿越远（越靠顶）越沉——进度读感（刚入冷整片深、将回充只剩顶上一圈深）
  const deep = clamp(d.div(max(uFrac, 0.05)), 0.0, 1.0);
  const tintA = mix(vec3(0.075, 0.125, 0.200), vec3(0.260, 0.055, 0.075), uMode); // 前沿侧
  const tintB = mix(vec3(0.045, 0.075, 0.130), vec3(0.160, 0.035, 0.050), uMode); // 顶部沉色
  const col = mix(tintA, tintB, deep).mul(texK.mul(0.5).add(0.75)).toVar();

  // 闪点：cell 内随机抖动破格点阵（冷却 = 霜晶慢闪 / 衰败 = 余烬急闪）
  const cellUv = vUv.mul(vec2(26.0, 34.0));
  const cid = floor(cellUv);
  const hsh = vHash(cid);
  const cp = fract(cellUv).sub(vec2(vHash(cid.add(7.3)), vHash(cid.add(3.1))).mul(0.5).add(0.25));
  const tw = sin(uTime.mul(mix(2.0, 5.5, uMode)).add(hsh.mul(39.0))).mul(0.5).add(0.5);
  // WGSL 正向边改写：GLSL smoothstep(0.10, 0.0, x) ≡ 1 - smoothstep(0.0, 0.10, x)
  const spark = oneMinus(smoothstep(0.0, 0.10, length(cp)))
    .mul(step(0.62, hsh)).mul(tw).mul(tw);
  const sparkCol = mix(vec3(0.55, 0.80, 1.15), vec3(1.00, 0.30, 0.14), uMode);
  col.addAssign(sparkCol.mul(spark).mul(0.9));

  // 前沿线：细亮核 + 宽晕（压 bloom 阈下；衰败线搏动）
  const pulse = mix(1.0, sin(uTime.mul(5.236)).mul(0.28).add(0.72), uMode);
  const lineCore = exp(abs(d).mul(mix(110.0, 70.0, uMode)).mul(-1.0));
  const lineGlow = exp(abs(d).mul(mix(26.0, 16.0, uMode)).mul(-1.0)).mul(0.35);
  const lineCol = mix(vec3(0.75, 0.95, 1.30), vec3(1.25, 0.42, 0.20), uMode);
  col.addAssign(lineCol.mul(lineCore.mul(1.15).add(lineGlow)).mul(pulse));

  let alpha = a.mul(texK.mul(0.20).add(0.46).add(deep.mul(0.16)));
  alpha = max(alpha, a.mul(lineCore.mul(0.85).add(lineGlow)).mul(pulse)); // 前沿线读得清
  return vec4(col, min(alpha, 0.92));
});

export class CardFxLayer extends THREE.Group {
  constructor({ width = 20, height = 27, faceMaterial = null } = {}) {
    super();
    this.name = 'fx';
    this._w = width;
    this._h = height;
    // C0：牌面本体补丁记录（faceMaterial 由 CardObject 传入；幂等 attach，无材质=占位场景）
    this.body = faceMaterial ? attachCardBodyFx(faceMaterial) : null;
    this._dim = 0; this._dimT = 0;         // 禁用压暗（当前值/目标值——update 收敛）
    this._hl = 0; this._hlT = 0;           // 高亮提暖（同上）
    this._t = 0;             // 层内统一时钟（盖纱呼吸相位共用，也喂 C0 的 uTime）
    this._veil = null;       // 冷却薄纱平面（全牌面几何，覆盖高度走 shader uFrac）
    this._veilUniforms = null;
    this._veilMode = null;   // null | 'cooling' | 'decayed'
    this._veilFrac = 0;      // 当前展示的剩余比例（update 里向目标收敛 = 前沿爬行动画）
    this._veilFracTarget = 0;
    this._chip = null;       // 冷却拍数水印（随薄纱显示）
    this._chipN = null;      // 水印当前数字（重烘判据）
    this._doom = null;       // 将弃特效组（暗化盖纱 + 四边描框，惰性创建）
    this._lock = null;       // 锁定特效组（四角瞄准括号，惰性创建）
    this._pulse = null;      // 脉冲平面
    this._pulseTl = null;    // { elapsed, duration, scale } | null
    this._edgeGlow = null;   // 咏唱流光面片（自定义 shader，惰性创建）
    this._edgeUniforms = null; // 面片 uniforms 句柄（update 推进 uTime/uFade）
  }

  /** 一次性加色闪光（冷却推进/衰败反向/威力提升）。重触发即重置时间线（新脉冲顶掉旧脉冲）。 */
  pulse({ color = 0xffffff, durationMs = 220, scale = 1.2 } = {}) {
    if (!this._pulse) {
      // 加法光不占地（uiScene RT 合成约定，passes.js 铁律②）
      const mat = additiveLight(new THREE.MeshBasicMaterial({
        transparent: true, opacity: PULSE_OPACITY, depthWrite: false,
      }));
      this._pulse = new THREE.Mesh(new THREE.PlaneGeometry(this._w * 1.06, this._h * 1.06), mat);
      this._pulse.position.z = 0.45;
      this._pulse.visible = false;
      this.add(this._pulse);
    }
    this._pulse.material.color.set(color);
    this._pulseTl = { elapsed: 0, duration: Math.max(0.001, durationMs / 1000), scale };
    this._pulse.scale.set(scale, scale, 1);
    this._pulse.visible = true;
  }

  get pulseColor() { return this._pulse?.material.color.getHex() ?? null; }
  get pulseVisible() { return !!this._pulse?.visible; }

  /**
   * C0 牌面状态档：normal | disabled（去饱和压暗）| highlighted（提暖呼吸）。
   * 只设目标值——update 里向目标 lerp 收敛（切换带一拍过渡，不瞬跳）。幂等。
   * 调用口径与旧材质颜色占位版一致（CardObject.setVisualState 门面转发）。
   */
  setVisualState(state) {
    this._dimT = state === 'disabled' ? 1 : 0;
    this._hlT = state === 'highlighted' ? 1 : 0;
  }

  /** 冷却薄纱：null 关闭 | 'cooling' 冷却中 | 'decayed' 衰败过（冷却超基准）。
   *  remaining = 剩余拍数（水印数字，>0 才显示）；fraction = 剩余冷却比例 0..1
   * （覆盖高度：1=刚入冷整片罩住、0.5=冷了一半——前沿爬行在 update 里平滑收敛）。幂等。 */
  setCooling(mode, remaining = 0, fraction = 0) {
    const n = mode && remaining > 0 ? remaining : null;
    const f = mode ? Math.min(1, Math.max(0, fraction)) : 0;
    if (mode === this._veilMode && n === this._chipN && f === this._veilFracTarget) return;
    this._veilMode = mode;
    this._veilFracTarget = f;
    if (!mode) {
      // 收起也走收敛动画（薄纱向上退尽后隐藏），不瞬切
      if (this._chip) this._chip.visible = false;
      this._chipN = null;
      return;
    }
    if (!this._veil) {
      // TSL uniform() 节点——对外仍是 `{ uX: { value } }` 推值口径（update 推流点零改动）
      this._veilUniforms = {
        uTime: uniform(0),
        uFrac: uniform(0),
        uMode: uniform(0),
        uCard: uniform(new THREE.Vector2(this._w, this._h)),
      };
      const mat = new MeshBasicNodeMaterial({
        transparent: true, blending: THREE.NormalBlending, depthWrite: false,
      });
      // colorNode 全量接管输出：vec4 的 a 通道即片元透明度（原 shader 写 alpha 的语义
      // 由 colorNode.a 表达）；If/Discard 已在 veilShade Fn 栈内
      mat.colorNode = veilShade(
        uv(), this._veilUniforms.uTime, this._veilUniforms.uFrac,
        this._veilUniforms.uMode, this._veilUniforms.uCard);
      this._veil = new THREE.Mesh(new THREE.PlaneGeometry(this._w, this._h), mat);
      this._veil.position.z = 0.35;
      this._veilFrac = 0; // 从 0 长出来 = 入冷时霜膜自牌顶罩下的动画
      this.add(this._veil);
    }
    if (this._veil) {
      this._veilUniforms.uMode.value = mode === 'decayed' ? 1 : 0;
      this._veil.visible = true;
    }
    this._setChip(n);
  }

  /** 拍数水印建/改/收（内部）：n=null 收起；否则烘低透明度平面白字数字。 */
  _setChip(n) {
    if (n === this._chipN) return;
    this._chipN = n;
    if (n === null) {
      if (this._chip) this._chip.visible = false;
      return;
    }
    if (!this._chip) {
      const mat = new THREE.MeshBasicMaterial({
        transparent: true, opacity: CHIP_LAYOUT.opacity, depthWrite: false,
      });
      this._chip = new THREE.Mesh(
        new THREE.PlaneGeometry(CHIP_LAYOUT.w, CHIP_LAYOUT.h), mat);
      this._chip.position.set(0, CHIP_LAYOUT.y, CHIP_LAYOUT.z);
      this.add(this._chip);
    }
    const old = this._chip.material.map;
    this._chip.material.map = bakeChipTexture(n);
    this._chip.material.needsUpdate = true;
    old?.dispose?.();
    this._chip.visible = true;
  }

  get coolingMode() { return this._veilMode; }

  /** 咏唱激活边缘流光开关（幂等）：呼吸 rimlight + 绕行脉动光点，单面片自定义
   *  shader（HDR 输出喂 bloom）。点亮有短淡入；时间推进在 update(dt)。 */
  setEdgeGlow(on) {
    if (on === !!this._edgeGlow) return;
    if (on) {
      const pw = this._w + EDGE_MARGIN * 2, ph = this._h + EDGE_MARGIN * 2;
      // TSL uniform() 节点——update 推流点（uTime/uFade `.value`）零改动
      this._edgeUniforms = {
        uTime: uniform(this._t),
        uFade: uniform(0),
        uCard: uniform(new THREE.Vector2(this._w, this._h)),
        uPlane: uniform(new THREE.Vector2(pw, ph)),
        uColor: uniform(new THREE.Color(1.0, 0.9, 0.62)), // 咏唱暖金
      };
      const mat = additiveLight(new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
      }));
      // colorNode 全量接管输出：rgb 直接 HDR（过 bloom 阈刻意保留），alpha 恒 1
      mat.colorNode = edgeShade(
        uv(), this._edgeUniforms.uTime, this._edgeUniforms.uFade,
        this._edgeUniforms.uCard, this._edgeUniforms.uPlane, this._edgeUniforms.uColor);
      this._edgeGlow = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), mat);
      // z=0.4：低于手牌扇相邻卡间隔（静息 z=10+n·0.5）——透明队列按中心深度排序，
      // 凸出 0.6 的旧值让光环排在右侧邻牌（+0.5）之后绘制 = 永远挡住邻牌（2026-09-22
      // 用户报修）。0.4 < 0.5 → 邻牌盖住本卡时连同光环外溢一起盖住。同时高于牌面
      // 内层件（veil 0.35），rim 内收带仍可读。
      this._edgeGlow.position.z = 0.4;
      this.add(this._edgeGlow);
    } else {
      this.remove(this._edgeGlow);
      this._edgeGlow.geometry.dispose();
      this._edgeGlow.material.dispose();
      this._edgeGlow = null;
      this._edgeUniforms = null;
    }
  }

  get hasEdgeGlow() { return !!this._edgeGlow; }

  /** 「将弃」标记（P9 尾弃预告）：红色呼吸描边框 + 暗化盖纱。幂等。呼吸推进在 update(dt)。 */
  setDoomed(on) {
    if (on === !!this._doom) return;
    if (!on) {
      this.remove(this._doom);
      this._doom.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
      this._doom = null;
      return;
    }
    const g = new THREE.Group();
    g.name = 'doom';
    // 暗化盖纱（普通混合压暗牌面——"这张牌要离开了"的沉下去感；加色系特效压不住它）
    const shade = new THREE.Mesh(
      new THREE.PlaneGeometry(this._w, this._h),
      new THREE.MeshBasicMaterial({ color: 0x1a0808, transparent: true, opacity: 0.3, depthWrite: false }),
    );
    shade.position.z = 0.36;
    shade.name = 'shade';
    g.add(shade);
    // 四边描框（呼吸主件）：比牌面外扩 0.6，框条粗 1.1
    const w = this._w + 1.2, h = this._h + 1.2, t = 1.1;
    const mkBar = (bw, bh, x, y) => {
      const bar = new THREE.Mesh(
        new THREE.PlaneGeometry(bw, bh),
        additiveLight(new THREE.MeshBasicMaterial({
          color: DOOM_COLOR, transparent: true, opacity: 0.8, depthWrite: false,
        })),
      );
      bar.position.set(x, y, 0.5);
      bar.name = 'bar';
      g.add(bar);
    };
    mkBar(w + t, t, 0, h / 2);           // 顶
    mkBar(w + t, t, 0, -h / 2);          // 底
    mkBar(t, h + t, -w / 2, 0);          // 左
    mkBar(t, h + t, w / 2, 0);           // 右
    this._doom = g;
    this.add(g);
  }

  get hasDoomMark() { return !!this._doom; }

  /** 「锁定」标记（无人战体「解除威胁」）：警戒琥珀色四角括号 + 慢呼吸——
   *  区别于将弃的红色整框（锁定是「被瞄准」，将弃是「要离开」）。幂等；呼吸在 update(dt)。 */
  setLocked(on) {
    if (on === !!this._lock) return;
    if (!on) {
      this.remove(this._lock);
      this._lock.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
      this._lock = null;
      return;
    }
    const g = new THREE.Group();
    g.name = 'lock';
    // 四角 L 形括号（瞄准框）：每角两根短条，牌面外扩 1.0，条粗 0.9，臂长 5
    const inset = 1.0, t = 0.9, arm = 5;
    const w = this._w / 2 + inset, h = this._h / 2 + inset;
    const mkArm = (bw, bh, x, y) => {
      const bar = new THREE.Mesh(
        new THREE.PlaneGeometry(bw, bh),
        additiveLight(new THREE.MeshBasicMaterial({
          color: LOCK_COLOR, transparent: true, opacity: 0.85, depthWrite: false,
        })),
      );
      bar.position.set(x, y, 0.44);
      bar.name = 'arm';
      g.add(bar);
    };
    // 四角：右上/右下/左下/左上，每角横臂 + 竖臂
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      mkArm(arm, t, sx * (w - arm / 2), sy * h);          // 横臂（沿牌边向内）
      mkArm(t, arm, sx * w, sy * (h - arm / 2));          // 竖臂（沿牌边向内）
    }
    this._lock = g;
    this.add(g);
  }

  get hasLockMark() { return !!this._lock; }

  /** 焚毁等接管牌面前：熄灭全部叠加特效（不销毁资源——卡随后整体 dispose）。 */
  clearTransient() {
    this.setEdgeGlow(false);
    this.setCooling(null);
    this.setDoomed(false);
    this.setLocked(false);
    if (this._pulse) this._pulse.visible = false;
    this._pulseTl = null;
  }

  /** 帧驱动：C0 状态收敛与钟 / 脉冲进度回程 / 盖纱呼吸 / 流光 shader 时钟与淡入。 */
  update(dt) {
    this._t += dt;
    if (this.body) {
      // C0：钟常驻推进（高亮呼吸用）；dim/highlight 向目标收敛（~10/s——状态切换有过渡）
      this.body.uTime.value = this._t;
      const k = 1 - Math.exp(-10 * dt);
      this._dim += (this._dimT - this._dim) * k;
      this._hl += (this._hlT - this._hl) * k;
      if (Math.abs(this._dimT - this._dim) < 1e-3) this._dim = this._dimT;
      if (Math.abs(this._hlT - this._hl) < 1e-3) this._hl = this._hlT;
      this.body.uDim.value = this._dim;
      this.body.uHighlight.value = this._hl;
    }
    if (this._pulse?.visible && this._pulseTl) {
      this._pulseTl.elapsed += dt;
      const k = Math.min(this._pulseTl.elapsed / this._pulseTl.duration, 1);
      const s = this._pulseTl.scale + (1 - this._pulseTl.scale) * k; // scale→1 回程
      this._pulse.scale.set(s, s, 1);
      if (k >= 1) {
        this._pulse.visible = false;
        this._pulseTl = null;
      }
    }
    if (this._veil) {
      // 覆盖高度收敛动画：入冷时从牌顶罩下、每推进一拍前沿向上退一截、回充后退尽隐藏
      const k = 1 - Math.exp(-VEIL_LERP * dt);
      this._veilFrac += (this._veilFracTarget - this._veilFrac) * k;
      if (Math.abs(this._veilFracTarget - this._veilFrac) < 1e-3) this._veilFrac = this._veilFracTarget;
      if (!this._veilMode && this._veilFrac <= 0) {
        this._veil.visible = false;
      } else if (this._veil.visible) {
        this._veilUniforms.uFrac.value = this._veilFrac;
        this._veilUniforms.uTime.value = this._t; // 呼吸/闪烁/纹理漂移全在 shader 内
      }
    }
    if (this._doom) {
      // 将弃呼吸：描边框 0.45~0.95 急促明暗（逼近的截止感），暗化盖纱同相反相轻颤
      const k = 0.5 + 0.5 * Math.sin((this._t / DOOM_PERIOD) * Math.PI * 2);
      for (const o of this._doom.children) {
        o.material.opacity = o.name === 'bar' ? 0.45 + 0.5 * k : 0.22 + 0.12 * (1 - k);
      }
    }
    if (this._lock) {
      // 锁定呼吸：四角括号 0.45~0.95 慢明暗（持续瞄准态，无截止感）
      const k = 0.5 + 0.5 * Math.sin((this._t / LOCK_PERIOD) * Math.PI * 2);
      for (const o of this._lock.children) {
        o.material.opacity = 0.45 + 0.5 * k;
      }
    }
    if (this._edgeGlow) {
      this._edgeUniforms.uTime.value = this._t;
      const f = this._edgeUniforms.uFade;
      f.value = Math.min(1, f.value + dt * EDGE_FADE_IN); // 点亮淡入
    }
  }

  dispose() {
    this.clearTransient();
    // C0 归零防御：补丁记录挂在材质 userData 上，材质随后由 CardObject 销毁——
    // 归零防的是「材质先死、补丁引用被别处摸到」的悬空读出
    if (this.body) {
      this.body.uBurn.value = 0;
      this.body.uDim.value = 0;
      this.body.uHighlight.value = 0;
    }
    if (this._pulse) {
      this.remove(this._pulse);
      this._pulse.geometry.dispose();
      this._pulse.material.dispose();
      this._pulse = null;
    }
    if (this._veil) {
      this.remove(this._veil);
      this._veil.geometry.dispose();
      this._veil.material.dispose();
      this._veil = null;
    }
    if (this._chip) {
      this.remove(this._chip);
      this._chip.geometry.dispose();
      this._chip.material.map?.dispose?.();
      this._chip.material.dispose();
      this._chip = null;
    }
  }
}

// 拍数水印烘焙：平面白字（透明度由材质统一压到 CHIP_LAYOUT.opacity），不描边不发光；
// node 无 document 走占位
function bakeChipTexture(n) {
  if (typeof document === 'undefined') {
    const texture = new THREE.Texture();
    texture.needsUpdate = true;
    return texture;
  }
  const size = 144; // 正方形画布，数字居中
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const g = canvas.getContext('2d');
  const text = String(n);
  const fontPx = text.length >= 2 ? 66 : 88;
  g.font = `bold ${fontPx}px "Segoe UI", "Microsoft YaHei", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#eef3fd';
  g.fillText(text, size / 2, size / 2 + 3);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
