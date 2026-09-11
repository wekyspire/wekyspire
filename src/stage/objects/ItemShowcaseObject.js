// ItemShowcaseObject：**获得物特写**（通用组件，用户定 2026-09-11）。
// 用途：拿到遗物 / 药水 / 奖励之类的东西时，在塔楼层播一次"这个物品到手了"的特写——
// 玩家才有获得感（否则奖励只是面板上多一行字）。
//
// 形态（用户定的分镜）：
//   ① 背景压暗 → 物品图在屏幕中央 **fade in + 非线性放大（带弹跳：过冲再回位）**；
//   ② 背后**上帝光**渐显（放射光束，缓慢旋转）；
//   ③ 停住 hold，下方依次浮出文本：名称（粗体）/ 斜体描述 / 具体作用；
//   ④ **点击屏幕任意处**退出：物品缩小并淡出、文字消失（快速）。
//
// 素材：`assets/items/<key>.*`（退化到 `assets/props/<key>.*`）；**没有素材就用色块**
// （tint 色块 + 描边 + 名称首字），所以内容侧没图也能先用起来。
//
// 层次约定：全屏遮罩 = 面板层之上（PANEL_ABOVE_Z），与 CardScrollPickerObject 同级；
// 输入走 Picker（自己登记全屏 dismiss 热区），宿主只需把指针事件转发进来。
//
// 纯 Stage 层：不读 Core/Bridge；数据由调用方以纯对象传入（名称/描述/作用/素材 key/tint）。

import * as THREE from 'three';
import { WORLD_HEIGHT, UI_CAMERA_LOOK_AT_Y } from '../StageManager.js';
import { PANEL_ABOVE_Z } from './PanelObject.js';
import { bakeBoldText } from './textBakers.js';
import { sharedPropArtCache } from '../art/propArt.js';

const HALF_UI_W = ((WORLD_HEIGHT * 16) / 9) / 2;
const UI_TOP = UI_CAMERA_LOOK_AT_Y + WORLD_HEIGHT / 2;
const Z = { BACKDROP: PANEL_ABOVE_Z, RAYS: PANEL_ABOVE_Z + 2, ITEM: PANEL_ABOVE_Z + 4, TEXT: PANEL_ABOVE_Z + 5 };
const DISMISS_ID = 'showcase:dismiss';

// 时序（秒）：淡入（含弹跳）→ 停住 → 淡出
const T_IN = 0.62;
const T_OUT = 0.34;
// 物品图（世界单位）：整幅特写的主体
const ART = { size: 34, y: UI_CAMERA_LOOK_AT_Y + 6.5 };
const TEXT = { titleY: UI_CAMERA_LOOK_AT_Y - 14, descY: UI_CAMERA_LOOK_AT_Y - 19.5, effectY: UI_CAMERA_LOOK_AT_Y - 25.5 };

/** 非线性的"弹出"缓动：过冲再回位（用户要的弹跳感）。k 越大过冲越明显。 */
function easeOutBack(t, k = 1.7) {
  const u = t - 1;
  return 1 + (k + 1) * u * u * u + k * u * u;
}

/** 放射光束贴图（程序化烘焙：中心亮、向外的锥形光条 + 柔和衰减）。 */
function bakeGodRays(size = 512, spokes = 18) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = size / 2;
  ctx.translate(c, c);
  // 中心辉光
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, c);
  glow.addColorStop(0, 'rgba(255,246,214,0.95)');
  glow.addColorStop(0.18, 'rgba(255,238,190,0.42)');
  glow.addColorStop(0.55, 'rgba(255,228,170,0.12)');
  glow.addColorStop(1, 'rgba(255,220,160,0)');
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(0, 0, c, 0, Math.PI * 2); ctx.fill();
  // 锥形光条（宽度/长度各带确定性抖动，读作"光从云缝里下来"）
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2 + (i % 3) * 0.06;
    const w = 0.035 + ((i * 37) % 11) / 11 * 0.05;     // 角宽
    const len = 0.62 + ((i * 53) % 13) / 13 * 0.38;    // 长度系数
    const g = ctx.createLinearGradient(0, 0, Math.cos(a) * c * len, Math.sin(a) * c * len);
    g.addColorStop(0, 'rgba(255,244,206,0.5)');
    g.addColorStop(0.5, 'rgba(255,236,186,0.16)');
    g.addColorStop(1, 'rgba(255,230,170,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a - w) * c, Math.sin(a - w) * c);
    ctx.lineTo(Math.cos(a + w) * c, Math.sin(a + w) * c);
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class ItemShowcaseObject extends THREE.Group {
  /**
   * @param {object} options
   *   onDismiss(): 退出回调（宿主据此清焦点/继续流程）
   *   bakeLine: 可选的外部文本烘焙（缺省用内置的 bakeBoldText）
   *   art: 可选的外部取图函数 (key) => THREE.Texture|null（缺省查 item/prop 素材表）
   */
  constructor({ onDismiss = null, art = null } = {}) {
    super();
    this.name = 'itemShowcase';
    this.visible = false;
    this._onDismiss = onDismiss;
    this._artOf = art ?? ((key) => sharedPropArtCache.getTexture(key));
    this._picker = null;
    this._phase = 'idle';   // idle | in | hold | out
    this._t = 0;
    this._raysTex = null;
    this._baked = [];       // 本件烘出来的纹理（换内容时释放）
    this._build();
  }

  get busy() { return this._phase !== 'idle'; }

  _build() {
    // ① 全屏遮罩（点击任意处退出的热区；也负责把塔楼层压暗）
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(HALF_UI_W * 2, WORLD_HEIGHT * 2),
      new THREE.MeshBasicMaterial({ color: 0x05070c, transparent: true, opacity: 0 }),
    );
    back.position.set(0, UI_CAMERA_LOOK_AT_Y, Z.BACKDROP);
    this._back = back;
    this.add(back);

    // ② 上帝光（放射光束，加色叠加）
    this._raysTex = bakeGodRays();
    const rays = new THREE.Mesh(
      new THREE.PlaneGeometry(ART.size * 2.6, ART.size * 2.6),
      new THREE.MeshBasicMaterial({
        map: this._raysTex, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    rays.position.set(0, ART.y, Z.RAYS);
    this._rays = rays;
    this.add(rays);

    // ③ 物品图（含托底描边框：素材是透明底时也要有"嵌在光里"的边界）
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(ART.size + 1.6, ART.size + 1.6),
      // depthWrite: false —— 物品图与托底**共面**时必须让它输给图（否则 depthTest LESS 会把图剔掉，
      // 症状就是"光有了、字有了，物品图不见了"）
      new THREE.MeshBasicMaterial({ color: 0x0b1220, transparent: true, opacity: 0, depthWrite: false }),
    );
    const art = new THREE.Mesh(
      new THREE.PlaneGeometry(ART.size, ART.size),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    art.position.z = 0.08;      // 明确压过托底（同 z 共面会被深度测试剔掉）
    this._plate = plate;
    this._art = art;
    this._item = new THREE.Group();
    this._item.position.set(0, ART.y, Z.ITEM);
    this._item.add(plate, art);
    this.add(this._item);

    // ④ 文本三行（名称 / 斜体描述 / 作用）
    this._lines = [];
    for (const [key, spec] of Object.entries({
      title: { y: TEXT.titleY, fontPx: 34, italic: false, tint: '#fdf6e3' },
      desc: { y: TEXT.descY, fontPx: 20, italic: true, tint: '#d8e4f2' },
      effect: { y: TEXT.effectY, fontPx: 22, italic: false, tint: '#ffe6ad' },
    })) {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
      );
      mesh.position.set(0, spec.y, Z.TEXT);
      mesh.userData.spec = spec;
      mesh.userData.slot = key;
      this.add(mesh);
      this._lines.push(mesh);
    }
  }

  /** 换一行文本：烘焙 → 贴到对应行（宽度/高度按烘焙像素换算世界单位）。 */
  _setLine(slot, text) {
    const mesh = this._lines.find((m) => m.userData.slot === slot);
    if (!mesh) return;
    const spec = mesh.userData.spec;
    if (!text) { mesh.visible = false; return; }
    mesh.visible = true;
    if (typeof document === 'undefined') return;       // node：不烘（视觉门在浏览器）
    const { texture, width, height } = bakeBoldText(text, {
      fontPx: spec.fontPx, tint: spec.tint, italic: spec.italic,
    });
    this._baked.push(texture);
    const old = mesh.material.map;
    if (old) old.dispose();
    mesh.material.map = texture;
    mesh.material.needsUpdate = true;
    // 逻辑像素 ≈ 0.1 世界单位（与 textBakers 的 10px/wu 约定一致）
    mesh.scale.set(width * 0.1, height * 0.1, 1);
  }

  /**
   * 播放一次特写。
   * @param {object} item
   *   title:  名称（粗体，必填）
   *   desc:   斜体描述（可为空）
   *   effect: 具体作用（药水=喝下后的效果；金币之类=名称+效果）
   *   artKey: 素材 key（assets/items|props，可空 → 色块代替）
   *   tint:   色块/托底色（可空 → 金）
   */
  show(item = {}) {
    // ⚠ 千万别往 Object3D 上塞 `pivot`：three 的 `updateMatrix()` 会把 `this.pivot`
    // 当作**变换枢轴**参与矩阵合成（非 Vector3 会让平移整列变 NaN → 物件凭空消失，
    // 症状是"光效和文字都在、物品图不见了"）。这条坑 2026-09-11 踩过一次。
    this._phase = 'in';
    this._t = 0;
    this.visible = true;
    this._setLine('title', item.title ?? '');
    this._setLine('desc', item.desc ?? '');
    this._setLine('effect', item.effect ?? '');
    // 物品图：有素材用素材，没有就用 tint 色块（"没有就拿色块代替"）
    const tex = item.artKey ? this._artOf(item.artKey) : null;
    const tint = new THREE.Color(item.tint ?? 0xffe6ad);
    if (tex) {
      this._art.material.map = tex;
      this._art.material.color.set(0xffffff);
      this._art.visible = true;
    } else {
      this._art.material.map = null;
      this._art.material.color.copy(tint);
      this._art.visible = true;
    }
    this._art.material.needsUpdate = true;
    this._plate.material.color.set(0x0b1220);
    this._rays.material.color.set(0xfff0c8);
    this._setOpacity(0);
    this._applyTransform(0);
    return true;
  }

  /** 点击任意处 / 程序化关闭：进入快速淡出。 */
  dismiss() {
    if (this._phase === 'idle' || this._phase === 'out') return false;
    this._phase = 'out';
    this._t = 0;
    return true;
  }

  _setOpacity(k) {
    this._back.material.opacity = 0.78 * k;
    this._plate.material.opacity = 0.85 * k;
    this._art.material.opacity = k;
    this._rays.material.opacity = 0.85 * k;
    for (const m of this._lines) m.material.opacity = k;
  }

  _applyTransform(k) {
    // 物品：弹出缩放（过冲）+ 轻微下沉；**文字不跟着缩放**（字被拉扁会很难看）
    this._item.scale.setScalar(k);
    this._item.position.y = ART.y + (1 - k) * 4;
  }

  /** 帧驱动：返回是否仍在播（宿主可据此吞掉输入）。 */
  update(dt) {
    if (this._phase === 'idle') return false;
    this._t += dt;
    if (this._phase === 'in') {
      const t = Math.min(1, this._t / T_IN);
      const e = easeOutBack(t, 1.7);                  // 非线性 + 过冲（弹跳）
      this._item.scale.setScalar(0.55 + (1.06 - 0.55) * e);
      this._item.position.y = ART.y + (1 - t) * 5;
      this._rays.scale.setScalar(0.7 + 0.3 * e);
      this._rays.rotation.z += dt * 0.12;
      this._setOpacity(Math.min(1, t * 1.6));
      if (t >= 1) { this._phase = 'hold'; this._t = 0; }
    } else if (this._phase === 'hold') {
      // 停住：物品极缓呼吸 + 光束慢转（保持"活着"但不抢戏）
      this._item.scale.setScalar(1.06 + Math.sin(this._t * 1.6) * 0.012);
      this._item.position.y = ART.y + Math.sin(this._t * 1.1) * 0.35;
      this._rays.rotation.z += dt * 0.08;
      this._rays.material.opacity = 0.78 + Math.sin(this._t * 1.9) * 0.08;
    } else if (this._phase === 'out') {
      const t = Math.min(1, this._t / T_OUT);
      const e = 1 - Math.pow(1 - t, 2);               // 快速收束
      this._item.scale.setScalar(1.06 - 0.34 * e);    // 缩小
      this._item.position.y = ART.y - 2 * e;
      this._rays.scale.setScalar(1 - 0.25 * e);
      this._setOpacity(1 - e);                        // 淡化（文字一起消失）
      if (t >= 1) {
        this._phase = 'idle';
        this.visible = false;
        this._onDismiss?.();
      }
    }
    return true;
  }

  attachPicker(picker) {
    this._picker = picker ?? null;
    if (!picker) return;
    // 全屏热区：点击任意处退出（与 CardScrollPickerObject 同一套 Picker 通道）
    picker.addPickable(DISMISS_ID, this._back, { kind: 'button', space: 'ui' });
  }

  /** 指针抬起命中（宿主转发）：命中遮罩 = 点击任意处。 */
  onClick(hit) {
    if (!this.busy) return false;
    if (hit?.id !== DISMISS_ID) return false;
    return this.dismiss();
  }

  dispose() {
    for (const m of this._lines) m.material.map?.dispose?.();
    this._baked.forEach((t) => t.dispose?.());
    this._raysTex?.dispose?.();
    this._art.material.map?.dispose?.();
    this.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  }
}
