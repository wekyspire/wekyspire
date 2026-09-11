// CardFxLayer：卡面特效层 —— 牌面上方叠加特效的统一管理者（CardObject 组合子）。
// 全部时间驱动（update(dt) 自算时间线），不依赖 gsap/tween 注入，也没有外部寄生状态
// （旧版脉冲 tween 挂 overlay.userData 的做法已废）。未来的卡面叠加特效一律在此扩层，
// 不回 CardObject 散装实现。
// z 分层（牌面 z=0；焚毁着色器挂牌面本体、余烬 z=1.2，均在 CardObject 侧不属本层）：
//   veil  盖纱  z=0.35 —— 持久状态指示（冷却中/衰败），低透明呼吸
//   pulse 闪光 z=0.45 —— 一次性加色脉冲（冷却推进/威力提升/衰败反向）
//   edge  流光 z=0.6  —— 咏唱激活的绕边小光点
// 三张平面各自惰性创建；焚毁接管牌面前调 clearTransient() 熄灭全部叠加。

import * as THREE from 'three';

const VEIL_STYLE = {
  cooling: { color: 0x4a8ed8, base: 0.08 },  // 冷却中：冷青蓝呼吸
  decayed: { color: 0xc87070, base: 0.13 },  // 衰败过（冷却被反向推深）：暗红，与 named 术语「衰败」同色
};
const VEIL_BREATH = 0.06; // 呼吸幅度
const VEIL_PERIOD = 2.2;  // 呼吸周期（秒）
const PULSE_OPACITY = 0.55;

export class CardFxLayer extends THREE.Group {
  constructor({ width = 20, height = 27 } = {}) {
    super();
    this.name = 'fx';
    this._w = width;
    this._h = height;
    this._t = 0;             // 层内统一时钟（盖纱呼吸相位共用）
    this._veil = null;       // 持久盖纱平面
    this._veilMode = null;   // null | 'cooling' | 'decayed'
    this._pulse = null;      // 脉冲平面
    this._pulseTl = null;    // { elapsed, duration, scale } | null
    this._edgeDot = null;    // 咏唱流光点
    this._edgeT = 0;
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

  /** 持久冷却盖纱：null 关闭 | 'cooling' 冷却中 | 'decayed' 衰败过（冷却超基准）。幂等。 */
  setCooling(mode) {
    if (mode === this._veilMode) return;
    this._veilMode = mode;
    if (!mode) {
      if (this._veil) this._veil.visible = false;
      return;
    }
    if (!this._veil) {
      const mat = new THREE.MeshBasicMaterial({
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      this._veil = new THREE.Mesh(new THREE.PlaneGeometry(this._w, this._h), mat);
      this._veil.position.z = 0.35;
      this.add(this._veil);
    }
    this._veil.material.color.set(VEIL_STYLE[mode].color);
    this._veil.visible = true;
  }

  get coolingMode() { return this._veilMode; }

  /** 咏唱激活边缘流光开关（幂等）。轨道推进在 update(dt)。 */
  setEdgeGlow(on) {
    if (on === !!this._edgeDot) return;
    if (on) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffe9a0, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      this._edgeDot = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), mat);
      this._edgeDot.position.z = 0.6;
      this._edgeT = 0;
      this.add(this._edgeDot);
    } else {
      this.remove(this._edgeDot);
      this._edgeDot.geometry.dispose();
      this._edgeDot.material.dispose();
      this._edgeDot = null;
    }
  }

  get hasEdgeGlow() { return !!this._edgeDot; }
  get edgeDot() { return this._edgeDot; } // 测试/调试窥视

  /** 焚毁等接管牌面前：熄灭全部叠加特效（不销毁资源——卡随后整体 dispose）。 */
  clearTransient() {
    this.setEdgeGlow(false);
    this.setCooling(null);
    if (this._pulse) this._pulse.visible = false;
    this._pulseTl = null;
  }

  /** 帧驱动：脉冲进度回程 / 盖纱呼吸 / 流光轨道。 */
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
    if (this._veil?.visible) {
      const st = VEIL_STYLE[this._veilMode];
      this._veil.material.opacity = st.base
        + VEIL_BREATH * (0.5 + 0.5 * Math.sin((this._t / VEIL_PERIOD) * Math.PI * 2));
    }
    if (this._edgeDot) {
      this._edgeT = (this._edgeT + dt * 0.35) % 1; // ≈2.9s 一圈
      const p = perimeterPoint(this._edgeT, this._w + 1.6, this._h + 1.6);
      this._edgeDot.position.x = p.x;
      this._edgeDot.position.y = p.y;
      const pulse = 0.75 + 0.25 * Math.sin(this._edgeT * Math.PI * 8);
      this._edgeDot.scale.set(pulse, pulse, 1);
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
  }
}

// 矩形周长参数路径（t∈[0,1)，顶边左→右起顺时针），w/h 为路径全宽/全高
function perimeterPoint(t, w, h) {
  const per = 2 * (w + h);
  let d = t * per;
  if (d < w) return { x: -w / 2 + d, y: h / 2 };   // 顶边 左→右
  d -= w;
  if (d < h) return { x: w / 2, y: h / 2 - d };    // 右边 上→下
  d -= h;
  if (d < w) return { x: w / 2 - d, y: -h / 2 };   // 底边 右→左
  d -= w;
  return { x: -w / 2, y: -h / 2 + d };             // 左边 下→上
}
