// ZoneFrameObject：拖放/点选交互的**区域高亮框**（uiScene 件）——四角 L 形角码 + 细边线。
// transition：show = 角码从角外滑入（back-out 收尾）+ 边线淡入；hide = 快淡出；
// setActive = 呼吸脉冲（拖悬目标态）；flash = 落定确认闪。方角（UI 语言），颜色运行时可调。
// 几何按 rect 低频重建；动画全走 gsap 推标量，无逐帧 update 负担。
import * as THREE from 'three';
import gsap from 'gsap';

// uiScene ≈7.3px/wu：角码臂长按框尺寸自适应（夹取 1.2~2.4wu ≈ 9~18px），
// 边线 0.14wu ≈ 1px——常量按 wu 写死会在屏上退化成亚像素细线 + 不可见角点
const EDGE_T = 0.14;         // 边线粗
const ARM_MIN = 1.2, ARM_MAX = 2.4, ARM_RATIO = 0.28;   // 角码臂长 = min(框宽,框高)×比例
const MARGIN = 0.5;          // 框外扩（框与内容留白）
const Z = 55;                // 压过面板/窄条、低于拖拽 ghost（60）
// 四角：顺序 TL/BL/BR/TR；角码烘焙 = TL 基准（臂朝 +x/-y），其余按 90° 步进旋转
const CORNERS = [[-1, 1], [-1, -1], [1, -1], [1, 1]];

// 单位 L 角码（平面中心 = 内角点，臂朝 +x/-y，臂尖渐隐；共享烘焙）
let _bracketTex = null;
function bracketTexture() {
  if (_bracketTex || typeof document === 'undefined') return _bracketTex;
  const W = 64, T = 10, C = W / 2;
  const c = document.createElement('canvas');
  c.width = c.height = W;
  const g = c.getContext('2d');
  // canvas +x/+y(下) = 平面 +x/-y（flipY）——canvas 里臂朝右/下画即平面 +x/-y
  const fadeR = g.createLinearGradient(C, 0, W, 0);
  fadeR.addColorStop(0, '#ffffff'); fadeR.addColorStop(1, 'rgba(255,255,255,0.25)');
  g.fillStyle = fadeR;
  g.fillRect(C, C - T / 2, C, T);                 // 横臂（向右）
  const fadeD = g.createLinearGradient(0, C, 0, W);
  fadeD.addColorStop(0, '#ffffff'); fadeD.addColorStop(1, 'rgba(255,255,255,0.25)');
  g.fillStyle = fadeD;
  g.fillRect(C - T / 2, C, T, C);                 // 竖臂（向下）
  g.fillStyle = '#ffffff';
  g.fillRect(C - T / 2, C - T / 2, T, T);         // 内角块
  _bracketTex = new THREE.CanvasTexture(c);
  _bracketTex.colorSpace = THREE.SRGBColorSpace;
  return _bracketTex;
}

export class ZoneFrameObject extends THREE.Group {
  constructor() {
    super();
    this.name = 'zoneFrame';
    // 动画标量：a=显隐包络 b=呼吸 f=落定闪（gsap 推值，_apply 合成到材质）
    this._anim = { a: 0, b: 1, f: 0 };
    this._breatheTl = null;
    this._autoHide = null;   // flashThenHide 的在途延时收起（show/hide 接管即杀）
    this._rect = null;
    this._w = 1; this._h = 1;
    this._arm = ARM_MIN;   // 角码臂长（setRect 按框尺寸自适应）
    this._edgeMat = new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false,
    });
    this._edges = [];
    for (let i = 0; i < 4; i++) {
      const e = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this._edgeMat);
      this._edges.push(e);
      this.add(e);
    }
    this._brackets = [];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),   // 单位平面，setRect 按臂长缩放
        new THREE.MeshBasicMaterial({
          transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false,
        }),
      );
      m.material.map = bracketTexture();
      m.material.needsUpdate = true;
      m.rotation.z = i * Math.PI / 2;   // TL 基准按 90° 步进 → BL/BR/TR
      m.userData.k = 0;
      this._brackets.push(m);
      this.add(m);
    }
    this.visible = false;
  }

  /** 摆位：uiScene 世界矩形 {x0,y0,x1,y1}（低频调用——几何随尺寸重摆）。 */
  setRect(rect, margin = MARGIN) {
    this._rect = rect;
    this._w = (rect.x1 - rect.x0) + margin * 2;
    this._h = (rect.y1 - rect.y0) + margin * 2;
    this.position.set((rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2, Z);
    const w = this._w, h = this._h;
    const [t, r, b, l] = this._edges;
    t.scale.set(w, EDGE_T, 1); t.position.set(0, h / 2, 0);
    b.scale.set(w, EDGE_T, 1); b.position.set(0, -h / 2, 0);
    l.scale.set(EDGE_T, h, 1); l.position.set(-w / 2, 0, 0);
    r.scale.set(EDGE_T, h, 1); r.position.set(w / 2, 0, 0);
    this._arm = Math.min(ARM_MAX, Math.max(ARM_MIN, Math.min(w, h) * ARM_RATIO));
    for (const m of this._brackets) m.scale.set(this._arm, this._arm, 1);
    this._brackets.forEach((m) => this._placeBracket(m, m.userData.k ?? 0));
  }

  /** 角码摆位：k=0 静止在角点，k=1 外滑出（show 过渡的起点）。 */
  _placeBracket(m, k) {
    const i = this._brackets.indexOf(m);
    const [sx, sy] = CORNERS[i];
    const w = this._w / 2, h = this._h / 2, arm = this._arm;
    // 平面中心 = 角点 + 臂向（基准 TL = (+半臂,-半臂)，旋转 i×90° 后取整）
    const rot = [[1, -1], [1, 1], [-1, 1], [-1, -1]][i];   // 各角臂中心方向（cos/sin 90° 步进）
    const bx = sx * w + rot[0] * arm / 2;
    const by = sy * h + rot[1] * arm / 2;
    m.userData.k = k;
    m.position.set(bx + sx * k * 0.5, by + sy * k * 0.5, 0.01);
  }

  _apply() {
    const { a, b, f } = this._anim;
    this._edgeMat.opacity = Math.min(1, (0.55 * a + 0.45 * f) * (0.7 + 0.3 * b));
    for (const m of this._brackets) m.material.opacity = Math.min(1, (a + 0.6 * f) * b);
  }

  /** 显示（可带色：不放行语义红等）。角码滑入 + 边线淡入。 */
  show({ color = 0xcfe0f4 } = {}) {
    if (!this._rect) return;
    this._autoHide?.kill();   // 上一次的落定闪自动收起若还在途，本次显示接管
    this._autoHide = null;
    this.visible = true;
    this.setColor(color);
    gsap.killTweensOf(this._anim);
    this._anim.f = 0;
    gsap.to(this._anim, { a: 1, duration: 0.16, ease: 'power1.out', onUpdate: () => this._apply() });
    for (const m of this._brackets) {
      gsap.killTweensOf(m.userData);
      this._placeBracket(m, 1);
      gsap.to(m.userData, {
        k: 0, duration: 0.26, ease: 'back.out(2.2)',
        onUpdate: () => this._placeBracket(m, m.userData.k),
      });
    }
  }

  hide() {
    this._autoHide?.kill();
    this._autoHide = null;
    this.setActive(false);
    gsap.killTweensOf(this._anim);
    gsap.to(this._anim, {
      a: 0, duration: 0.15, ease: 'power1.in',
      onUpdate: () => this._apply(),
      onComplete: () => { this.visible = false; },
    });
  }

  /** 拖悬目标态：呼吸脉冲。 */
  setActive(on) {
    if (on) {
      if (this._breatheTl) return;
      this._breatheTl = gsap.to(this._anim, {
        b: 0.55, duration: 0.62, ease: 'sine.inOut', yoyo: true, repeat: -1,
        onUpdate: () => this._apply(),
      });
    } else {
      this._breatheTl?.kill();
      this._breatheTl = null;
      gsap.to(this._anim, { b: 1, duration: 0.12, onUpdate: () => this._apply() });
    }
  }

  /** 落定确认闪。 */
  flash() {
    gsap.fromTo(this._anim, { f: 1 }, {
      f: 0, duration: 0.4, ease: 'power2.out', overwrite: 'auto',
      onUpdate: () => this._apply(),
    });
  }

  /** 落定确认闪 + 延时自动收起（自动收起可被后续 show/hide 打断——快速连续操作不互杀）。 */
  flashThenHide(delay = 0.35) {
    this.flash();
    this._autoHide?.kill();
    this._autoHide = gsap.delayedCall(delay, () => { this._autoHide = null; this.hide(); });
  }

  setColor(color) {
    this._edgeMat.color.set(color);
    for (const m of this._brackets) m.material.color.set(color);
  }

  dispose() {
    this._autoHide?.kill();
    this._autoHide = null;
    this._breatheTl?.kill();
    gsap.killTweensOf(this._anim);
    for (const m of this._brackets) { gsap.killTweensOf(m.userData); m.material.dispose(); m.geometry.dispose(); }
    for (const e of this._edges) e.geometry.dispose();
    this._edgeMat.dispose();
    this.removeFromParent();
  }
}
