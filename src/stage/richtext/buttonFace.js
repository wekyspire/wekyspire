// 按钮牌面烘焙：扁平矩形底 + 淡蓝描边 + 白字（用户定 2026-09-12 的 UI 风格：
// **白字淡蓝按钮、扁平化**——不要纵向渐变自体发光、不要金色描边大字）。
// 与 bakeCardFace 同契约：返回 { texture, hitRegions, width, height }，
// width/height 为排版局部坐标（10px/wu 约定，与牌面一致），texture 内部 scale 倍分辨率。
// 仅浏览器可用（需真实 canvas）；单测由 BattleStage 回退到注入的 bakeLabel。

import * as THREE from 'three';

// 三态主题（全扁平，无渐变）：enabled 深底白字淡蓝边 / active（悬停·激活）淡蓝底白字 /
// disabled 深灰。金色只留给**金钱相关内容**（金额文本），按钮一律走这套冷色。
const THEMES = {
  enabled: { fill: 'rgba(16, 22, 34, 0.92)', border: '#3f5f8c', text: '#e8eefb', sub: '#9fb4d0' },
  active: { fill: 'rgba(52, 84, 126, 0.95)', border: '#8fb6dd', text: '#ffffff', sub: '#dce8f6' },
  disabled: { fill: 'rgba(20, 22, 28, 0.85)', border: '#39414f', text: '#6f7789', sub: '#5d6474' },
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
  const r = Math.min(5, height / 6);   // 按钮保留小圆角（"除按钮外不滥用圆角"）
  roundRect(ctx, 2, 2, width - 4, height - 4, r);
  ctx.fillStyle = theme.fill;          // 扁平平涂（无渐变 = 无自体发光）
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = theme.border;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const paint = (text, x, y, fontPx, fallbackColor) => {
    ctx.font = `bold ${fontPx}px sans-serif`;
    // 主标签走 labelStyle（白字黑边）；副标签沿用主题色，只补一层黑描边
    ctx.lineJoin = 'round';
    ctx.lineWidth = labelStyle?.strokeWidth ?? Math.max(2, fontPx * 0.16);
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
