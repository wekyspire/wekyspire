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
//   pulse 闪光 z=0.45 —— 一次性加色脉冲（冷却推进/威力提升/衰败反向）
//   edge  流光 z=0.6  —— 咏唱激活的绕边小光点
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

  /** 焚毁等接管牌面前：熄灭全部叠加特效（不销毁资源——卡随后整体 dispose）。 */
  clearTransient() {
    this.setEdgeGlow(false);
    this.setCooling(null);
    this.setDoomed(false);
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
