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
// 素材：`assets/items/<key>.*`（退化到 `assets/props/<key>.*`，再退化到遗物立绘
// `assets/relics/<key>.*`——遗物特写的 key 就是遗物名）；**都没有就用色块**
// （tint 色块 + 描边 + 名称首字），所以内容侧没图也能先用起来。
//
// **可跳过奖励**（用户定 2026-09-12）：`show({ …, skippable: true })` 时界面下方多一个
// 「跳过」按钮——"可跳过"的东西是**还没到手**的产出（老虎机奖项、买到即开的卡包…），
// 点跳过 = 放弃它；点别处 = 收下。两个出口分别回调 `onSkip` / `onDismiss`（同一次 show
// 内有效，show 时传入；缺省只有"点任意处关闭"的旧语义）。本组件只负责"把出口摆出来"，
// 放弃/收下的游戏语义由调用方（Shell 编排器）决定。
//
// 层次约定：全屏遮罩走 `OVERLAY_Z`（**高于"继续前进"这类常驻按钮**，与 CardScrollPickerObject
// 同级）——压不住常驻按钮的话，按钮会画在半透明遮罩之上、看起来还能点（用户 2026-09-13 报）；
// 输入走 Picker（自己登记全屏 dismiss 热区 + 跳过按钮热区），宿主只需把指针事件转发进来。
//
// 纯 Stage 层：不读 Core/Bridge；数据由调用方以纯对象传入（名称/描述/作用/素材 key/tint）。

import * as THREE from 'three';
import { additiveLight } from '../post/passes.js';
import { WORLD_HEIGHT, UI_CAMERA_LOOK_AT_Y } from '../StageManager.js';
import { OVERLAY_Z } from './PanelObject.js';
import { bakeBoldText, bakeAutoLine } from './textBakers.js';
import { sharedPropArtCache } from '../art/propArt.js';
import { sharedRelicArtCache } from '../art/relicArt.js';

const HALF_UI_W = ((WORLD_HEIGHT * 16) / 9) / 2;
const UI_TOP = UI_CAMERA_LOOK_AT_Y + WORLD_HEIGHT / 2;
const Z = { BACKDROP: OVERLAY_Z, RAYS: OVERLAY_Z + 2, ITEM: OVERLAY_Z + 4, TEXT: OVERLAY_Z + 5, BUTTON: OVERLAY_Z + 6 };
const DISMISS_ID = 'showcase:dismiss';
const SKIP_ID = 'showcase:skip';

// 时序（秒）：淡入（含弹跳）→ 停住 → 淡出
const T_IN = 0.62;
const T_OUT = 0.34;
// 物品图（世界单位）：整幅特写的主体
const ART = { size: 34, y: UI_CAMERA_LOOK_AT_Y + 6.5 };
const TEXT = {
  titleY: UI_CAMERA_LOOK_AT_Y - 14, descY: UI_CAMERA_LOOK_AT_Y - 19.5,
  effectY: UI_CAMERA_LOOK_AT_Y - 25.5, flavorY: UI_CAMERA_LOOK_AT_Y - 31,
};

/** 非线性的"弹出"缓动：过冲再回位（用户要的弹跳感）。k 越大过冲越明显。 */
function easeOutBack(t, k = 1.7) {
  const u = t - 1;
  return 1 + (k + 1) * u * u * u + k * u * u;
}

/**
 * 占位美术（没有素材时的程序化贴图）：
 *   'gold' → **金币堆**（三摞金币 + 散落两枚，用户要的"金币堆"观感；事件/老虎机/吞噬的金币
 *            获得演出都走它——有真素材 `assets/items/gold.*` 时会被自动顶替）
 *   其它 key → null（退回 tint 色块）
 * headless（无 document）返回 null。
 */
function bakePlaceholderArt(key) {
  if (key !== 'gold' || typeof document === 'undefined') return null;
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');
  const coin = (x, y, r) => {
    // 币身（圆柱侧面）+ 币面 + 高光
    ctx.fillStyle = '#b8862a';
    ctx.beginPath(); ctx.ellipse(x, y + r * 0.5, r, r * 0.62, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e8b53c';
    ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.62, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#8a6118'; ctx.lineWidth = r * 0.14;
    ctx.beginPath(); ctx.ellipse(x, y, r * 0.66, r * 0.4, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,246,214,0.55)';
    ctx.beginPath(); ctx.ellipse(x - r * 0.3, y - r * 0.2, r * 0.3, r * 0.16, -0.4, 0, Math.PI * 2); ctx.fill();
  };
  // 后排两摞
  for (const [bx, n] of [[S * 0.34, 3], [S * 0.66, 4]]) {
    for (let i = 0; i < n; i++) coin(bx, S * 0.62 - i * 16, 44);
  }
  // 前排两枚散币
  coin(S * 0.26, S * 0.76, 40);
  coin(S * 0.75, S * 0.78, 38);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 放射光束贴图（程序化烘焙：中心亮、向外的锥形光条 + 柔和衰减）。 */function bakeGodRays(size = 512, spokes = 18) {
  // node/headless 无 canvas：返回 null，调用方跳过光束层（特写其余部分照常）
  if (typeof document === 'undefined') return null;
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

/**
 * 托底暗晕贴图（程序化烘焙：中心暗、向边缘柔和化开到全透明）。
 *
 * 为什么需要它（用户 2026-09-13 报「获得演出里图像 alpha=0 的区域仍然把 godlight 盖住了，
 * 很诡异」）：托底板原先是一块 **0.85 不透明度的深色方板**，尺寸比物品图还大一圈，且画在
 * 加色 godlight **之前**（z 更大）——物品图四周的透明区域于是露出的不是光束，而是一块硬边
 * 深色方块，正正好把放射光挡掉。改成**径向柔和暗晕**后：边缘全透明（光束照常透出），只有
 * 物品正后方留一块渐隐的暗底（保住"浅色物品压在亮光上"时的可读性）。
 */
function bakeSoftVignette(size = 256) {
  if (typeof document === 'undefined') return null;   // node/headless：调用方退回纯色板
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = size / 2;
  ctx.translate(c, c);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, c);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.7)');
  g.addColorStop(0.62, 'rgba(255,255,255,0.28)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, c, 0, Math.PI * 2); ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class ItemShowcaseObject extends THREE.Group {
  /**
   * @param {object} options
   *   onDismiss(): 退出回调（宿主据此清焦点/继续流程）
   *   bakeLine: 可选的外部文本烘焙（缺省用内置的 bakeAutoLine）
   *   art: 可选的外部取图函数 (key) => THREE.Texture|null（缺省查 道具图/遗物图 两张表）
   */
  constructor({ onDismiss = null, art = null } = {}) {
    super();
    this.name = 'itemShowcase';
    this.visible = false;
    this._onDismiss = onDismiss;
    // 缺省取图：道具图（items/props）→ 遗物立绘（relics）——遗物特写的 key 就是遗物名，
    // 所以两个舞台的宿主都不必为遗物另传 art 函数。
    this._artOf = art ?? ((key) => sharedPropArtCache.getTexture(key) ?? sharedRelicArtCache.getTexture(key));
    this._picker = null;
    this._phase = 'idle';   // idle | in | hold | out
    this._t = 0;
    this._raysTex = null;
    this._baked = [];       // 本件烘出来的纹理（换内容时释放）
    this._onDismissShow = null;  // 本次 show 的出口回调（点击任意处 = 收下/关闭）
    this._autoDismissMs = 0;     // 本次 show 的自动收下时长（0 = 等点击）
    this._onSkipShow = null;     // 本次 show 的「跳过」出口（放弃产出）
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
      additiveLight(new THREE.MeshBasicMaterial({
        map: this._raysTex, transparent: true, opacity: 0, depthWrite: false,
      })),
    );
    rays.position.set(0, ART.y, Z.RAYS);
    rays.visible = !!this._raysTex;   // headless：无光束贴图就不画这一层
    this._rays = rays;
    this.add(rays);

    // ③ 物品图（含托底暗晕：素材是透明底时也要有"嵌在光里"的边界）
    // 托底 = **径向柔和暗晕**（不是硬边方板）：边缘全透明让 godlight 透出来，只在物品正后方
    // 渐隐地压一层暗底（用户 2026-09-13 报「alpha=0 区域把 godlight 盖住」的正是这块方板）。
    this._vignetteTex = bakeSoftVignette();
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(ART.size + 1.6, ART.size + 1.6),
      // depthWrite: false —— 物品图与托底**共面**时必须让它输给图（否则 depthTest LESS 会把图剔掉，
      // 症状就是"光有了、字有了，物品图不见了"）
      new THREE.MeshBasicMaterial({
        color: 0x0b1220, map: this._vignetteTex ?? null,
        transparent: true, opacity: 0, depthWrite: false,
      }),
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

    // ④ 文本四行（名称 / 斜体描述 / 作用 / 斜体铭文——flavor 行是遗物设计稿里的
    //    斜体文本（RELICS.md `_..._`，2026-09-21 用户定：获得演出下方额外一行斜体），
    //    非遗物特写不传即隐藏）
    this._lines = [];
    for (const [key, spec] of Object.entries({
      title: { y: TEXT.titleY, fontPx: 34, italic: false, tint: '#fdf6e3' },
      desc: { y: TEXT.descY, fontPx: 20, italic: true, tint: '#d8e4f2' },
      effect: { y: TEXT.effectY, fontPx: 22, italic: false, tint: '#ffe6ad' },
      flavor: { y: TEXT.flavorY, fontPx: 19, italic: true, tint: '#c3cee0' },
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

    // ⑤ 「跳过」按钮（skippable 才显形；文字一次性烘死，开关只切 visible）
    const skipPlate = new THREE.Mesh(
      new THREE.PlaneGeometry(17, 6.2),
      new THREE.MeshBasicMaterial({ color: 0x1a2236, transparent: true, opacity: 0.85 }),
    );
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95 }),
    );
    if (typeof document !== 'undefined') {
      const out = bakeBoldText('跳过 ▸', { fontPx: 20, tint: '#e6ecff' });
      this._baked.push(out.texture);
      label.material.map = out.texture;
      label.scale.set(out.width * 0.1, out.height * 0.1, 1);
    }
    label.position.z = 0.06;
    this._skipBtn = new THREE.Group();
    this._skipBtn.position.set(0, TEXT.effectY - 7.5, Z.BUTTON);
    this._skipBtn.add(skipPlate, label);
    this._skipBtn.visible = false;
    this.add(this._skipBtn);
  }

  /** 换一行文本：烘焙 → 贴到对应行（宽度/高度按烘焙像素换算世界单位）。 */
  _setLine(slot, text) {
    const mesh = this._lines.find((m) => m.userData.slot === slot);
    if (!mesh) return;
    const spec = mesh.userData.spec;
    if (!text) { mesh.visible = false; return; }
    mesh.visible = true;
    if (typeof document === 'undefined') return;       // node：不烘（视觉门在浏览器）
    // auto 烘焙：纯文本行与旧观感一致（粗体 + 深描边；desc 行保留斜体），
    // 含 markup 的行（遗物 effect 行常引 /card{}）走富文本，不把 markup 原样印出来
    const { texture, width, height } = bakeAutoLine(text, {
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
   *   flavor: 斜体铭文（最下方一行；遗物 = 设计稿 RELICS.md 里的斜体文本，可空 → 隐藏）
   *   artKey: 素材 key（assets/items|props，可空 → 色块代替）
   *   tint:   色块/托底色（可空 → 金）
   *   skippable: true = 下方给出「跳过」按钮（放弃这件产出）
   *   autoDismissMs: >0 时停住这一时长后**自动收下**（售货机购买：出完货即自动收货，
   *                  不给一套"点击收货"的 UI，用户定 2026-09-13）；缺省 0 = 等点击
   *   onDismiss / onSkip: 两个出口的回调（点任意处 / 点跳过；仅本次 show 有效）
   */
  show(item = {}) {
    // ⚠ 千万别往 Object3D 上塞 `pivot`：three 的 `updateMatrix()` 会把 `this.pivot`
    // 当作**变换枢轴**参与矩阵合成（非 Vector3 会让平移整列变 NaN → 物件凭空消失，
    // 症状是"光效和文字都在、物品图不见了"）。这条坑 2026-09-11 踩过一次。
    this._phase = 'in';
    this._t = 0;
    this.visible = true;
    this._autoDismissMs = Math.max(0, Number(item.autoDismissMs) || 0);
    this._onDismissShow = item.onDismiss ?? null;
    this._onSkipShow = item.onSkip ?? null;
    if (this._skipBtn) this._skipBtn.visible = !!item.skippable;
    this._setLine('title', item.title ?? '');
    this._setLine('desc', item.desc ?? '');
    this._setLine('effect', item.effect ?? '');
    this._setLine('flavor', item.flavor ?? '');
    // 物品图：有素材用素材；没有就用程序化占位（金币堆）/ tint 色块（"没有就拿色块代替"）
    let tex = item.artKey ? this._artOf(item.artKey) : null;
    if (!tex && item.artKey) tex = this._placeholderOf(item.artKey);
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

  /** 程序化占位美术（按 key 缓存复用；无占位则 null → 退回 tint 色块）。 */
  _placeholderOf(key) {
    if (!this._placeholders) this._placeholders = new Map();
    if (!this._placeholders.has(key)) this._placeholders.set(key, bakePlaceholderArt(key));
    return this._placeholders.get(key);
  }

  /** 点击任意处 / 程序化关闭：进入快速淡出。reason 决定收尾回调（'dismiss' | 'skip'）。 */
  dismiss(reason = 'dismiss') {
    if (this._phase === 'idle' || this._phase === 'out') return false;
    this._phase = 'out';
    this._t = 0;
    this._closeReason = reason;
    return true;
  }

  _setOpacity(k) {
    this._back.material.opacity = 0.78 * k;
    // 托底暗晕：峰值压到 0.72（原硬方板是 0.85）——配合径向贴图，物品四周的透明区完全透光
    this._plate.material.opacity = (this._vignetteTex ? 0.72 : 0.5) * k;
    this._art.material.opacity = k;
    this._rays.material.opacity = 0.85 * k;
    for (const m of this._lines) m.material.opacity = k;
    if (this._skipBtn) {
      for (const m of this._skipBtn.children) m.material.opacity = (m === this._skipBtn.children[0] ? 0.85 : 0.95) * k;
    }
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
      // 自动收下（售货机购买）：停够时长即走"点任意处收下"那条出口，玩家不用动手
      if (this._autoDismissMs > 0 && this._t * 1000 >= this._autoDismissMs) this.dismiss('dismiss');
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
        const reason = this._closeReason ?? 'dismiss';
        this._closeReason = null;
        const cb = reason === 'skip' ? this._onSkipShow : this._onDismissShow;
        this._onDismissShow = null;
        this._onSkipShow = null;
        cb?.();
        this._onDismiss?.();   // 构造期给的可选统一回调（缺省无动作）
      }
    }
    return true;
  }

  attachPicker(picker) {
    this._picker = picker ?? null;
    if (!picker) return;
    // 全屏热区：点击任意处退出（与 CardScrollPickerObject 同一套 Picker 通道）
    picker.addPickable(DISMISS_ID, this._back, { kind: 'button', space: 'ui' });
    // 「跳过」按钮热区（不可见时 Picker 的 visible 守卫使其不可命中）
    if (this._skipBtn) picker.addPickable(SKIP_ID, this._skipBtn, { kind: 'button', space: 'ui' });
  }

  /** 指针抬起命中（宿主转发）：命中跳过键 = 放弃；命中遮罩 = 点击任意处。 */
  onClick(hit) {
    if (!this.busy) return false;
    if (hit?.id === SKIP_ID) return this.dismiss('skip');
    if (hit?.id !== DISMISS_ID) return false;
    return this.dismiss('dismiss');
  }

  dispose() {
    for (const m of this._lines) m.material.map?.dispose?.();
    this._baked.forEach((t) => t.dispose?.());
    for (const t of (this._placeholders?.values() ?? [])) t?.dispose?.();
    this._placeholders?.clear();
    this._raysTex?.dispose?.();
    this._vignetteTex?.dispose?.();   // 自烘的托底暗晕（同样不进共享缓存）
    // ⚠ 不 dispose this._art.material.map：物品/遗物图取自 sharedPropArtCache /
    // sharedRelicArtCache（进程级共享纹理），舞台拆掉时释放会把下次特写打成黑块。
    this.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  }
}
