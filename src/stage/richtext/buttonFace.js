// 按钮牌面烘焙：扁平矩形底 + 灰描边 + 白字（的 UI 风格：
// **黑白主题：黑底白字灰描边、扁平化**——不要纵向渐变自体发光、不要金色描边大字）。
// 与 bakeCardFace 同契约：返回 { texture, hitRegions, width, height }，
// width/height 为排版局部坐标（10px/wu 约定，与牌面一致），texture 内部 scale 倍分辨率。
// 仅浏览器可用（需真实 canvas）；单测由 BattleStage 回退到注入的 bakeLabel。

import * as THREE from 'three';
import { UI_FONT } from './uiFont.js';

// 三态主题（全扁平，无渐变）：enabled 黑底白字灰边 / active（悬停·激活）亮灰底白字 /
// disabled 深灰。金色只留给**金钱相关内容**（金额文本），按钮一律走这套无彩色。
const THEMES = {
  enabled: { fill: 'rgba(20, 20, 20, 0.92)', border: '#8a8a8a', text: '#f2f2f2', sub: '#a8a8a8' },
  active: { fill: 'rgba(66, 66, 66, 0.95)', border: '#e0e0e0', text: '#ffffff', sub: '#dedede' },
  disabled: { fill: 'rgba(20, 20, 20, 0.85)', border: '#4a4a4a', text: '#737373', sub: '#616161' },
};

/**
 * @param {object} data  { label, sublabel = null, enabled = true, active = false }
 * @param {object} options  { width = 150, height = 60, scale = 2, labelStyle }（局部坐标 10px/wu）
 *   labelStyle: { color, stroke, strokeWidth } —— 覆盖主题文字色（休息房操纵条要"白字黑边"，
 *   场景底子颜色杂，主题色没有黑描边时对比不够）
 */
export function bakeButtonFace(data, { width = 150, height = 60, scale = 2, labelStyle = null } = {}) {
  const { label, sublabel = null, enabled = true, active = false } = data;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  const theme = !enabled ? THEMES.disabled : (active ? THEMES.active : THEMES.enabled);
  // UI 语言（quest_prompts/UI_LANGUAGE.md）：方角 + 厚描边（踏实，不纤弱）
  roundRect(ctx, 3, 3, width - 6, height - 6, 0);
  ctx.fillStyle = theme.fill;          // 扁平平涂（无渐变 = 无自体发光）
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = theme.border;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const paint = (text, x, y, fontPx, fallbackColor) => {
    ctx.font = `${fontPx}px ${UI_FONT}`;
    // 主标签走 labelStyle（白字黑边）；副标签沿用主题色，只补一层黑描边
    ctx.lineJoin = 'round';
    ctx.lineWidth = labelStyle?.strokeWidth ?? Math.max(1.2, fontPx * 0.07); // 发丝级（与粗体互斥，见 textBakers 头注）
    ctx.strokeStyle = labelStyle?.stroke ?? 'rgba(0,0,0,0.85)';
    ctx.fillStyle = labelStyle ? (labelStyle.color ?? '#ffffff') : fallbackColor;
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
  };
  if (sublabel != null) {
    paint(label, width / 2, height * 0.34, Math.round(height * 0.34), theme.text);
    paint(sublabel, width / 2, height * 0.74, Math.round(height * 0.24), theme.sub);
  } else {
    paint(label, width / 2, height / 2 + 1, Math.round(height * 0.4), theme.text);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearMipmapLinearFilter; // 与 renderRichTextBlock 同约定
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  return { texture, hitRegions: [], width, height };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
