// ApCoinObject：行动点金币徽章（概念图语言：金色粗边圆徽 + 居中 current/max 白字）。
// 取代骑士面板的 AP 圆点排：逐点消耗语义由数字变化表达。
//
// 悬浮交互态（setHoverCost 驱动，BattleStage 按悬浮卡 AP 开销调用）：
//   highlight    消耗可负担 → 币面/数字亮「黄白」呼吸 glow + 金白双色升腾粒子；
//   insufficient 消耗不满足 → 数值 tint 渐变为暗红（覆盖 highlight，特效熄灭）；
//   normal       无悬浮/零开销 → 特效淡出、数值回到白色主题。
// 状态切换经 HighlightFX 包络与颜色 lerp 天然淡入淡出。
//
// 结构：Group
//   ├─ fx:   高亮特效（呼吸 glow + 升腾粒子，见 highlightFX.js；node 下为空组）
//   ├─ coin: 金币面 plane（浏览器程序化烘焙：不规则毛边金饼 + 内暗环 + 高光弧；
//   │        美术图到位后换贴图即可。node 单测退化为纯金币色圆）
//   └─ num:  数字 plane（bakeFraction 白字烘焙 + tint，签名不变不重烘）

import * as THREE from 'three';
import { HighlightFX, ScalePop } from './highlightFX.js';
import { bakeFraction } from './ManaCrystalObject.js';

const GOLD = 0xf0c040;
const INSUFFICIENT_TINT = '#b8383f'; // 不足态暗红（覆盖高亮）
// AP 高亮配色（概念图行动能量）：glow 金白，粒子金/白双色交替升腾
const FX_GLOW = 0xffe9a8;
const FX_PARTICLES = ['#ffd75e', '#fff6d8'];

export class ApCoinObject extends THREE.Group {
  /**
   * @param {object} options
   *   bakeLabel: (text) => { texture, width, height }   数字烘焙（缺省 1x1 占位）
   *   radius:    金币半径（世界单位）
   *   faceImage: 币面美术图（HTMLImageElement，缺省程序化烘焙金饼；晚到可 setFace 补挂）
   */
  constructor({ bakeLabel = null, radius = 2.3, faceImage = null, numHeight = null } = {}) {
    super();
    this._bakeLabel = bakeLabel || defaultBake;
    this._radius = radius;
    this._numHeight = numHeight;

    // 特效件先行入组（摆位在构造尾按币面定，覆盖数字区域一并发光）
    this._fx = new HighlightFX({
      glowColor: FX_GLOW, glowSize: radius * 3.4,
      particleColors: FX_PARTICLES, particleSize: radius * 0.22,
      spread: radius * 1.5, rise: radius * 2.4,
    });
    this._fx.group.position.set(0, 0, 0.5);
    this.add(this._fx.group);

    const baked = faceImage || (typeof document !== 'undefined' ? bakeCoinFace(radius * 10) : null);
    this._coinMaterial = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    // 方面片贴图：美术毛边透明alphas保留（CircleGeometry 会硬裁掉笔刷边缘）
    this._coin = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), this._coinMaterial);
    this._coin.name = 'coin';
    if (baked) {
      this._coinMaterial.map = asTexture(baked);
      this._coinMaterial.color.set(0xffffff); // map 模式下 color 只作 tint（脉动增亮）
    } else {
      this._coinMaterial.color.set(GOLD); // node 退化：纯金币色圆
      this._coinMaterial.opacity = 0.95;
    }
    this._coinMaterial.needsUpdate = true;
    this.add(this._coin);

    this._numMaterial = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    this._num = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this._numMaterial);
    this._num.name = 'num';
    this._num.position.z = 0.6;
    this.add(this._num);
    // 数值 tint：白字烘焙 × 材质色（常态白；不足态 lerp 到暗红）
    this._numColor = new THREE.Color(0xffffff);
    this._numColorTarget = new THREE.Color(0xffffff);
    this._numMaterial.color.copy(this._numColor);

    this._current = 0;
    this._max = 0;
    this._sig = null;
    this._mode = 'normal'; // 'normal' | 'highlight' | 'insufficient'
    this._time = 0;
    this._pop = new ScalePop(); // 数值变动弹跳（含最大值变更）
  }

  /** 数值更新：签名变化才重烘数字。 */
  setValue(current, max) {
    this._current = current;
    this._max = max;
    const sig = `${current}/${max}`;
    if (sig === this._sig) return false;
    this._sig = sig;
    // 概念图对角分式（白字烘焙 + tint）；node 走注入 baker 兜底
    const baked = typeof document !== 'undefined'
      ? bakeFraction(String(current), String(max), { color: '#ffffff', bold: true })
      : this._bakeLabel(sig);
    const old = this._numMaterial.map;
    this._numMaterial.map = baked.texture;
    this._numMaterial.needsUpdate = true;
    old?.dispose?.();
    this._num.geometry.dispose();
    if (this._numHeight != null) {
      // 按数字面片高度等比定宽（概念图：分式贯穿大半枚币面）
      const nw = this._numHeight * (baked.width / baked.height);
      this._num.geometry = new THREE.PlaneGeometry(nw, this._numHeight);
    } else {
      this._num.geometry = new THREE.PlaneGeometry(baked.width / 10, baked.height / 10);
    }
    this._pop.trigger(); // 数值变动（含最大值变更）→ 弹跳脉冲起跳
    return true;
  }

  /** 晚到的币面美术图补挂（缓存 onLoad 回调路径）。 */
  setFace(image) {
    if (!image?.width) return;
    const old = this._coinMaterial.map;
    this._coinMaterial.map = asTexture(image);
    this._coinMaterial.opacity = 1;
    this._coinMaterial.needsUpdate = true;
    old?.dispose?.();
  }

  /**
   * 悬浮开销交互态：cost=0 → normal；cost>available → insufficient（暗红，覆盖高亮）；
   * 否则 highlight（呼吸 glow + 双色粒子）。同态幂等。
   */
  setHoverCost(cost, available) {
    const mode = (cost | 0) <= 0 ? 'normal'
      : (cost | 0) > (available | 0) ? 'insufficient' : 'highlight';
    if (mode === this._mode) return false;
    this._mode = mode;
    this._numColorTarget.set(mode === 'insufficient' ? INSUFFICIENT_TINT : 0xffffff);
    return true;
  }

  get current() { return this._current; }
  get max() { return this._max; }
  get mode() { return this._mode; }

  /** 帧推进：特效包络 + 数值 tint 渐变 + 变动弹跳脉冲。 */
  update(dt) {
    this._time += dt;
    const level = this._mode === 'highlight' ? 1 : 0; // insufficient 覆盖高亮：特效熄灭
    this._fx.update(dt, level);
    this._numColor.lerp(this._numColorTarget, Math.min(1, dt * 8));
    this._numMaterial.color.copy(this._numColor);
    this._pop.step(this._num, dt);
  }

  dispose() {
    this._fx.dispose();
    this._coin.geometry.dispose();
    this._coinMaterial.map?.dispose?.();
    this._coinMaterial.dispose();
    this._num.geometry.dispose();
    this._numMaterial.map?.dispose?.();
    this._numMaterial.dispose();
  }
}

// 图像 → sRGB 纹理（美术图/程序化画布共用）
function asTexture(source) {
  if (source instanceof THREE.Texture) return source;
  const texture = new THREE.Texture(source);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

// 金币面烘焙：不规则毛边圆饼（半径低幅抖动多边形）+ 内暗环 + 左上高光弧。
// 美术资源到位后整体换贴图，此绘制即占位符。
function bakeCoinFace(radiusPx) {
  const S = 2;
  const size = Math.ceil(radiusPx * 2 * S);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;
  const R = radiusPx * S * 0.96;

  // 毛边金饼：48 边形 + 半径抖动（手绘粗边感）
  ctx.beginPath();
  const N = 48;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const jitter = 1 + 0.035 * Math.sin(a * 7 + 1.7) + 0.02 * Math.sin(a * 13 + 0.4);
    const x = cx + Math.cos(a) * R * jitter;
    const y = cy + Math.sin(a) * R * jitter;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  const grad = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.1, cx, cy, R);
  grad.addColorStop(0, '#ffd75e');
  grad.addColorStop(0.55, '#f0b93a');
  grad.addColorStop(1, '#c8952a');
  ctx.fillStyle = grad;
  ctx.fill();

  // 内暗环（币缘厚重感）
  ctx.strokeStyle = 'rgba(140, 96, 20, 0.55)';
  ctx.lineWidth = radiusPx * S * 0.1;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.82, 0, Math.PI * 2);
  ctx.stroke();

  // 左上高光弧
  ctx.strokeStyle = 'rgba(255, 244, 200, 0.8)';
  ctx.lineWidth = radiusPx * S * 0.08;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.7, Math.PI * 1.05, Math.PI * 1.55);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function defaultBake() {
  const texture = new THREE.Texture({ width: 1, height: 1 });
  texture.needsUpdate = true;
  return { texture, width: 1, height: 1 };
}
