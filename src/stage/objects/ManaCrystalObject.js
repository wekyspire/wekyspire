// ManaCrystalObject：魏启水晶徽章（概念图语言：单颗水晶图标 + 大号浅蓝对角数字）。
// 满晶（mana_crystal_full.png）/空晶（mana_crystal_empty.png）两态贴图切换，
// 数字用手写感分式烘焙（上字符/斜线/下字符呈对角阶梯，白字烘焙+材质 tint 上色）；
// 美术图晚到可 setCrystalImages 补挂；node 单测退化为程序化菱形色块与注入 baker。
//
// 悬浮交互态（setHoverCost 驱动，BattleStage 按悬浮卡 mana 开销调用）：
//   highlight    消耗可负担 → 图标/数字亮「淡蓝×洋红」呼吸 glow + 双色升腾粒子；
//   insufficient 消耗不满足 → 数值 tint 渐变为暗红（覆盖 highlight，特效熄灭）；
//   normal       无悬浮/零开销 → 特效淡出、数值回到浅蓝主题色。
// 状态切换经 HighlightFX 包络与颜色 lerp 天然淡入淡出。
//
// 结构：Group
//   ├─ fx:      高亮特效（呼吸 glow + 升腾粒子，见 highlightFX.js；node 下为空组）
//   ├─ crystal: 水晶图标 plane（贴图裁到字形包围盒，保持纵横比；满/空按 current>0 切换）
//   └─ num:     数字 plane（bakeFraction 白字烘焙 + tint；面片高度独立指定，不随 ppw 约定）

import * as THREE from 'three';
import { HighlightFX, ScalePop } from './highlightFX.js';

const NUM_TINT = '#8ecdf5';    // 概念图浅蓝数字（常态/高亮主题色）
const INSUFFICIENT_TINT = '#b8383f'; // 不足态暗红（覆盖高亮）

// 水晶贴图的字形包围盒（alpha 实测：两态完全一致，画布四周有大量透明边距）
const GLYPH_BOX = Object.freeze({ x0: 0.249, y0: 0.091, w: 0.489, h: 0.791 });
const GLYPH_ASPECT = GLYPH_BOX.w / GLYPH_BOX.h;

// 魏启高亮配色（概念图灵御能量）：glow = 淡蓝与洋红的中间调，粒子双色交替升腾
const FX_GLOW = 0xb5a7f2;
const FX_PARTICLES = ['#8ecdf5', '#df8ce8'];

export class ManaCrystalObject extends THREE.Group {
  /**
   * @param {object} options
   *   bakeLabel: (text) => { texture, width, height }   node 兜底数字烘焙
   *   crystalHeight: 水晶图标高度（世界单位）
   *   numHeight:     数字面片高度（世界单位）
   *   fullImage/emptyImage: 满晶/空晶美术图（缺省程序化占位；晚到可 setCrystalImages 补挂）
   */
  constructor({ bakeLabel = null, crystalHeight = 5.2, numHeight = 3.4, fullImage = null, emptyImage = null } = {}) {
    super();
    this._bakeLabel = bakeLabel || defaultBake;
    this._crystalHeight = crystalHeight;
    this._numHeight = numHeight;

    // 特效件先行入组（摆位在 _layout 里随图标/数字跟手）
    this._fxCrystal = new HighlightFX({
      glowColor: FX_GLOW, glowSize: crystalHeight * 1.7,
      particleColors: FX_PARTICLES, particleSize: crystalHeight * 0.13,
      spread: crystalHeight * 0.7, rise: crystalHeight * 0.85,
    });
    this._fxNum = new HighlightFX({
      glowColor: FX_GLOW, glowSize: numHeight * 1.5,
      particleColors: FX_PARTICLES, particleSize: numHeight * 0.2,
      spread: numHeight * 0.6, rise: numHeight * 0.9, count: 6,
    });
    this.add(this._fxCrystal.group, this._fxNum.group);

    this._crystalMaterial = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    this._crystal = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this._crystalMaterial);
    this._crystal.name = 'crystal';
    this._crystal.position.z = 0.1;
    this.add(this._crystal);
    // 纵横比：美术图到位后按图像重设；占位用 0.62（细长风筝形）
    this._aspect = 0.62;

    this._numMaterial = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    this._num = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this._numMaterial);
    this._num.name = 'num';
    this._num.position.z = 0.2;
    this.add(this._num);
    // 数值 tint：白字烘焙 × 材质色（常态浅蓝；不足态 lerp 到暗红）
    this._numColor = new THREE.Color(NUM_TINT);
    this._numColorTarget = new THREE.Color(NUM_TINT);
    this._numMaterial.color.copy(this._numColor);

    this._images = { full: fullImage, empty: emptyImage };
    this._applyCrystalTexture();
    this._layout();

    this._current = 0;
    this._max = 0;
    this._sig = null;
    this._mode = 'normal'; // 'normal' | 'highlight' | 'insufficient'
    this._time = 0;
    this._pop = new ScalePop(); // 数值变动弹跳（含最大值变更）
  }

  /** 满晶/空晶美术图补挂（UnitArtCache onLoad 回调路径）。 */
  setCrystalImages({ full = null, empty = null } = {}) {
    if (full) this._images.full = full;
    if (empty) this._images.empty = empty;
    this._applyCrystalTexture();
  }

  // 水晶贴图：current>0 用满晶，否则空晶。美术图按字形包围盒裁切（repeat/offset），
  // 图标 plane 的纵横比 = 字形真实比例（透明边距不占排版空间）；无美术图时程序化占位
  _applyCrystalTexture() {
    const img = this._current > 0 ? this._images.full : this._images.empty;
    const old = this._crystalMaterial.map;
    if (img?.width) {
      this._crystalMaterial.map = asTexture(img);
      this._crystalMaterial.color.set(0xffffff);
      // 裁到字形包围盒：repeat/offset 只取 alpha 密集区
      this._crystalMaterial.map.repeat.set(GLYPH_BOX.w, GLYPH_BOX.h);
      this._crystalMaterial.map.offset.set(GLYPH_BOX.x0, 1 - GLYPH_BOX.y0 - GLYPH_BOX.h); // flipY 下顶对齐换算
      this._crystalMaterial.map.needsUpdate = true;
      this._aspect = GLYPH_ASPECT;
    } else if (typeof document !== 'undefined') {
      this._crystalMaterial.map = bakeCrystalPlaceholder(this._current > 0);
      this._crystalMaterial.color.set(0xffffff);
      this._aspect = GLYPH_ASPECT; // 占位绘制即风筝形全幅，比例一致
    } else {
      this._crystalMaterial.map = null;
      // node 退化：满=蓝紫水晶色，空=暗轮廓蓝
      this._crystalMaterial.color.set(this._current > 0 ? 0x8f7fe8 : 0x3a5f8a);
      this._aspect = GLYPH_ASPECT;
    }
    this._crystalMaterial.needsUpdate = true;
    old?.dispose?.();
    this._layout();
  }

  // 图标/数字排布：水晶左、数字紧贴其右（概念图紧凑排版），整体左缘锚定 Group 原点；
  // 特效组分别锚到图标/数字中心，glow 与升腾粒子随排布跟手
  _layout() {
    const cw = this._crystalHeight * this._aspect;
    this._crystal.scale.set(1, 1, 1);
    this._crystal.geometry.dispose();
    this._crystal.geometry = new THREE.PlaneGeometry(cw, this._crystalHeight);
    this._crystal.position.set(cw / 2, 0, 0.1);
    const numW = this._num.geometry.parameters.width;
    const numX = cw + 0.55 + numW / 2;
    this._num.position.set(numX, 0, 0.2);
    this._fxCrystal.group.position.set(cw / 2, 0, -0.1);
    this._fxNum.group.position.set(numX, 0, 0.5);
  }

  /** 数值更新：签名变化才重烘数字与切贴图。 */
  setValue(current, max) {
    this._current = current;
    this._max = max;
    const sig = `${current}/${max}`;
    if (sig === this._sig) return false;
    this._sig = sig;
    this._applyCrystalTexture();
    // 概念图大号对角分式（白字烘焙，颜色走材质 tint——不足态可平滑转暗红）；
    // node 走注入 baker 兜底
    const baked = typeof document !== 'undefined'
      ? bakeFraction(String(current), String(max), { color: '#ffffff' })
      : this._bakeLabel(sig);
    const old = this._numMaterial.map;
    this._numMaterial.map = baked.texture;
    this._numMaterial.needsUpdate = true;
    old?.dispose?.();
    // 数字面片高度独立指定，宽度按烘焙纵横比推算
    const nw = this._numHeight * (baked.width / baked.height);
    this._num.geometry.dispose();
    this._num.geometry = new THREE.PlaneGeometry(nw, this._numHeight);
    this._layout();
    this._pop.trigger(); // 数值变动（含最大值变更）→ 弹跳脉冲起跳
    return true;
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
    this._numColorTarget.set(mode === 'insufficient' ? INSUFFICIENT_TINT : NUM_TINT);
    return true;
  }

  get current() { return this._current; }
  get max() { return this._max; }
  get mode() { return this._mode; }

  /** 帧推进：特效包络 + 数值 tint 渐变 + 变动弹跳脉冲。 */
  update(dt) {
    this._time += dt;
    const level = this._mode === 'highlight' ? 1 : 0; // insufficient 覆盖高亮：特效熄灭
    this._fxCrystal.update(dt, level);
    this._fxNum.update(dt, level);
    this._numColor.lerp(this._numColorTarget, Math.min(1, dt * 8));
    this._numMaterial.color.copy(this._numColor);
    this._pop.step(this._num, dt);
  }

  dispose() {
    this._fxCrystal.dispose();
    this._fxNum.dispose();
    this._crystal.geometry.dispose();
    this._crystalMaterial.map?.dispose?.();
    this._crystalMaterial.dispose();
    this._num.geometry.dispose();
    this._numMaterial.map?.dispose?.();
    this._numMaterial.dispose();
  }
}

function asTexture(source) {
  if (source instanceof THREE.Texture) return source;
  const texture = new THREE.Texture(source);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

// 程序化占位水晶（美术图未就绪时）：风筝形，满=填充+高光，空=描边空心
function bakeCrystalPlaceholder(full) {
  const S = 2;
  const size = 128 * S;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const W = size;
  const cx = W / 2;
  ctx.lineWidth = W * 0.09;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, W * 0.05);
  ctx.lineTo(W * 0.88, W * 0.42);
  ctx.lineTo(cx, W * 0.95);
  ctx.lineTo(W * 0.12, W * 0.42);
  ctx.closePath();
  if (full) {
    const grad = ctx.createLinearGradient(0, 0, W, W);
    grad.addColorStop(0, '#9fd8ff');
    grad.addColorStop(0.5, '#6f8fe8');
    grad.addColorStop(1, '#8f6fd8');
    ctx.fillStyle = grad;
    ctx.fill();
  }
  ctx.strokeStyle = full ? 'rgba(120, 200, 255, 0.95)' : 'rgba(110, 180, 240, 0.9)';
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function defaultBake() {
  const texture = new THREE.Texture({ width: 1, height: 1 });
  texture.needsUpdate = true;
  return { texture, width: 1, height: 1 };
}

// 手写感对角分式烘焙（资源徽章数字共用）：上字符居左上、下字符居右下、
// 一条陡斜线自左下贯穿至右上（概念图的"3/3"排布，非行内斜杠）。
// 字符以 color（缺省白）烘焙——调用方可用材质 tint 换主题色（不足态暗红）。
// 返回逻辑像素尺寸（调用方按 ppw/numHeight 换算面片）。
export function bakeFraction(topText = '', botText = '', { color = '#ffffff', bold = true } = {}) {
  const P = 10;   // 全局 px/wu 约定
  const F = 34;   // 字号 px
  const S = 3;    // 超采样
  const W = F * 2.05;
  const H = F * 2.35;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(W * S);
  canvas.height = Math.ceil(H * S);
  const ctx = canvas.getContext('2d');
  ctx.scale(S, S);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // 贯穿斜线（先画，压在字符下层）
  ctx.strokeStyle = color;
  ctx.lineWidth = F * 0.14;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(W * 0.24, H * 0.88);
  ctx.lineTo(W * 0.78, H * 0.10);
  ctx.stroke();
  // 对角阶梯的两个数字
  ctx.font = `${bold ? 'bold ' : ''}${F}px sans-serif`;
  ctx.fillStyle = color;
  ctx.fillText(topText, W * 0.32, H * 0.30);
  ctx.fillText(botText, W * 0.68, H * 0.72);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { texture, width: W, height: H };
}
