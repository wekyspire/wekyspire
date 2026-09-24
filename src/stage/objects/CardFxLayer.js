// CardFxLayer：卡面特效层 —— 牌面上方叠加特效的统一管理者（CardObject 组合子）。
// 全部时间驱动（update(dt) 自算时间线），不依赖 gsap/tween 注入，也没有外部寄生状态
// （旧版脉冲 tween 挂 overlay.userData 的做法已废）。未来的卡面叠加特效一律在此扩层，
// 不回 CardObject 散装实现。
// z 分层（牌面 z=0；焚毁着色器挂牌面本体、余烬 z=1.2，均在 CardObject 侧不属本层）：
//   veil  薄纱  z=0.35 —— 冷却进度指示：**高度 = 剩余冷却比例**的暗淡薄纱（用户定
//         2026-09-13：完全灰暗=刚开始冷、一半灰暗=冷了一半；法线混合压暗，不做发光）
//   chip  水印  z=0.40 —— 冷却剩余拍数水印数字（低透明度平面白字，不描边不发光）
//   doom  将弃  z=0.36（暗化盖纱）+ 0.5（描边框）—— P9 尾弃预告：红色呼吸描边（用户定
//         2026-09-13，Three 层实现——重要视效，后续动画扩展都在本层）
//   lock  锁定  z=0.44（四角瞄准括号）—— 无人战体「解除威胁」：琥珀色慢呼吸，回合末
//         仍在手则焚毁（与 doom 的红框急促截止感区分：锁定是持续「被瞄准」态）
//   pulse 闪光 z=0.45 —— 一次性加色脉冲（冷却推进/威力提升/衰败反向）
//   edge  流光 z=0.6  —— 咏唱激活：呼吸 rimlight + 沿边绕行的脉动光点，单面片
//         自定义 shader 一次画完（光点融入 rimlight；HDR 输出 >1 radiance 喂 bloom）
// 三张平面各自惰性创建；焚毁接管牌面前调 clearTransient() 熄灭全部叠加。

import * as THREE from 'three';

const VEIL_STYLE = {
  cooling: { color: 0x0d1420, base: 0.5 },   // 冷却中：暗青灰薄纱（法线混合压暗牌面）
  decayed: { color: 0x2c0f14, base: 0.55 },  // 衰败过（冷却被反向推深）：暗红薄纱
};
const VEIL_BREATH = 0.05;  // 呼吸幅度
const VEIL_PERIOD = 2.2;   // 呼吸周期（秒）
const VEIL_LERP = 7;       // 薄纱高度收敛速率（/s——拍数推进时高度平滑过渡的动画）
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

// 咏唱边缘流光 shader：呼吸 rimlight（圆角矩形 SDF 内收外溢双边带）+
// 3 颗沿边巡游的彗星光点（头部高斯光晕 + 沿 rim 的渐熄拖尾，亮度并入 rimlight）。
// 加色混合、alpha 恒 1，rgb 直接输出 HDR（峰值 >1 radiance）交给 bloom。
const EDGE_GLOW_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const EDGE_GLOW_FRAG = /* glsl */`
varying vec2 vUv;
uniform float uTime;
uniform float uFade;
uniform vec2 uCard;
uniform vec2 uPlane;
uniform vec3 uColor;

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

// 矩形周长参数路径（t∈[0,1)，顶边左→右起顺时针）
vec2 edgePath(float t, vec2 hf) {
  float w = hf.x * 2.0, h = hf.y * 2.0;
  float d = fract(t) * 2.0 * (w + h);
  if (d < w) return vec2(d - hf.x, hf.y);
  d -= w;
  if (d < h) return vec2(hf.x, hf.y - d);
  d -= h;
  if (d < w) return vec2(hf.x - d, -hf.y);
  d -= w;
  return vec2(-hf.x, d - hf.y);
}

// 片元的最近边周长参数（拖尾亮带用；角部按主导轴近似，视觉连续即可）
float edgeParam(vec2 p, vec2 hf) {
  float w = hf.x * 2.0, h = hf.y * 2.0;
  float dx = hf.x - abs(p.x), dy = hf.y - abs(p.y);
  float s;
  if (dx < dy) s = p.x > 0.0 ? w + (hf.y - p.y) : 2.0 * w + h + (p.y + hf.y);
  else         s = p.y > 0.0 ? p.x + hf.x : w + h + (hf.x - p.x);
  return s / (2.0 * (w + h));
}

void main() {
  vec2 p = (vUv - 0.5) * uPlane;
  vec2 hf = uCard * 0.5;
  float d = sdRoundBox(p, hf, 1.5);

  // 呼吸 rimlight：内收外溢不对称边带，3.2s 慢呼吸（明灭约 3:1）
  float breath = 0.55 + 0.45 * sin(uTime * 1.9635);
  float rim = d < 0.0 ? exp(d * 1.6) : exp(-d * 0.85);

  // 绕行光点：3 颗彗星 ~4.5s 一圈，各自快速脉动；拖尾只亮在 rim 附近 → 融入 rimlight
  float s = edgeParam(p, hf);
  float rimProx = exp(-abs(d) * 0.9);
  float head = 0.0, trail = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float ti = fract(uTime * 0.22 + fi * 0.333333);
    float pulse = 0.62 + 0.38 * sin(uTime * 11.0 + fi * 2.4);
    vec2 dv = p - edgePath(ti, hf);
    head += exp(-dot(dv, dv) * 1.1) * pulse;
    trail += exp(-fract(s - ti + 1.0) * 11.0) * pulse * 0.7;
  }

  // 能量配比：rim 呼吸 ~0.16..0.54（压 bloom 阈下，保持牌面可读、暖金不发白），
  // 拖尾峰值 ~0.85，光点头峰值 ~1.9（唯一稳过 bloom 阈的主光源）
  float energy = rim * (0.16 + 0.38 * breath) + trail * rimProx * 0.85 + head * 1.9;
  gl_FragColor = vec4(uColor * energy * uFade, 1.0);
}
`;

export class CardFxLayer extends THREE.Group {
  constructor({ width = 20, height = 27 } = {}) {
    super();
    this.name = 'fx';
    this._w = width;
    this._h = height;
    this._t = 0;             // 层内统一时钟（盖纱呼吸相位共用）
    this._veil = null;       // 冷却薄纱平面（1×1 几何，按剩余比例缩放）
    this._veilMode = null;   // null | 'cooling' | 'decayed'
    this._veilFrac = 0;      // 当前展示的剩余比例（update 里向目标收敛 = 薄纱动画）
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
      const mat = new THREE.MeshBasicMaterial({
        transparent: true, opacity: PULSE_OPACITY,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
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

  /** 冷却薄纱：null 关闭 | 'cooling' 冷却中 | 'decayed' 衰败过（冷却超基准）。
   *  remaining = 剩余拍数（水印数字，>0 才显示）；fraction = 剩余冷却比例 0..1
   * （薄纱高度：1=刚入冷全灰、0.5=冷了一半——高度变化在 update 里平滑收敛）。幂等。 */
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
      const mat = new THREE.MeshBasicMaterial({
        transparent: true, blending: THREE.NormalBlending, depthWrite: false,
      });
      this._veil = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      this._veil.position.z = 0.35;
      this._veilFrac = 0; // 从 0 长出来 = 入冷时薄纱自上而下罩下的动画
      this.add(this._veil);
    }
    this._veil.material.color.set(VEIL_STYLE[mode].color);
    this._veil.visible = true;
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
      this._edgeUniforms = {
        uTime: { value: this._t },
        uFade: { value: 0 },
        uCard: { value: new THREE.Vector2(this._w, this._h) },
        uPlane: { value: new THREE.Vector2(pw, ph) },
        uColor: { value: new THREE.Color(1.0, 0.9, 0.62) }, // 咏唱暖金
      };
      const mat = new THREE.ShaderMaterial({
        uniforms: this._edgeUniforms,
        vertexShader: EDGE_GLOW_VERT,
        fragmentShader: EDGE_GLOW_FRAG,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      this._edgeGlow = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), mat);
      this._edgeGlow.position.z = 0.6;
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
        new THREE.MeshBasicMaterial({
          color: DOOM_COLOR, transparent: true, opacity: 0.8,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }),
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
        new THREE.MeshBasicMaterial({
          color: LOCK_COLOR, transparent: true, opacity: 0.85,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }),
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

  /** 帧驱动：脉冲进度回程 / 盖纱呼吸 / 流光 shader 时钟与淡入。 */
  update(dt) {
    this._t += dt;
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
      // 薄纱高度收敛动画：入冷时从牌顶罩下、每推进一拍向下退一截、回充后退尽隐藏
      const k = 1 - Math.exp(-VEIL_LERP * dt);
      this._veilFrac += (this._veilFracTarget - this._veilFrac) * k;
      if (Math.abs(this._veilFracTarget - this._veilFrac) < 1e-3) this._veilFrac = this._veilFracTarget;
      if (!this._veilMode && this._veilFrac <= 0) {
        this._veil.visible = false;
      } else if (this._veil.visible) {
        const f = this._veilFrac;
        this._veil.scale.set(this._w, Math.max(1e-4, this._h * f), 1);
        this._veil.position.y = this._h / 2 - (this._h * f) / 2; // 顶边锚定牌顶
        const st = VEIL_STYLE[this._veilMode] ?? VEIL_STYLE.cooling;
        this._veil.material.opacity = st.base
          + VEIL_BREATH * (0.5 + 0.5 * Math.sin((this._t / VEIL_PERIOD) * Math.PI * 2));
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
