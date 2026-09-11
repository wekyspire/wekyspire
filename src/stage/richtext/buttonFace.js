// 战斗内按钮牌面烘焙：圆角矩形底（纵向渐变）+ 描边 + 主/副标签文本。
// 与 bakeCardFace 同契约：返回 { texture, hitRegions, width, height }，
// width/height 为排版局部坐标（10px/wu 约定，与牌面一致），texture 内部 scale 倍分辨率。
// 仅浏览器可用（需真实 canvas）；单测由 BattleStage 回退到注入的 bakeLabel。

import * as THREE from 'three';

// 三态主题：enabled 蓝钢金边 / active（换卡模式激活等）翠绿高亮 / disabled 深灰
const THEMES = {
  enabled: { top: '#41598a', bottom: '#2b3d63', border: '#d8b25c', text: '#f5ead0', sub: '#e8c96a' },
  active: { top: '#527a4d', bottom: '#37543a', border: '#ffe9a0', text: '#f8f2d8', sub: '#ffe9a0' },
  disabled: { top: '#3a3a40', bottom: '#2b2b31', border: '#55555e', text: '#8a8a90', sub: '#75757c' },
};

/**
 * @param {object} data  { label, sublabel = null, enabled = true, active = false }
 * @param {object} options  { width = 150, height = 60, scale = 2 }（局部坐标 10px/wu）
 */
export function bakeButtonFace(data, { width = 150, height = 60, scale = 2 } = {}) {
  const { label, sublabel = null, enabled = true, active = false } = data;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  const theme = !enabled ? THEMES.disabled : (active ? THEMES.active : THEMES.enabled);
  const r = Math.min(12, height / 4);
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, theme.top);
  grad.addColorStop(1, theme.bottom);
  roundRect(ctx, 2, 2, width - 4, height - 4, r);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = theme.border;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (sublabel != null) {
    ctx.font = `bold ${Math.round(height * 0.34)}px sans-serif`;
    ctx.fillStyle = theme.text;
    ctx.fillText(label, width / 2, height * 0.34);
    ctx.font = `${Math.round(height * 0.24)}px sans-serif`;
    ctx.fillStyle = theme.sub;
    ctx.fillText(sublabel, width / 2, height * 0.74);
  } else {
    ctx.font = `bold ${Math.round(height * 0.4)}px sans-serif`;
    ctx.fillStyle = theme.text;
    ctx.fillText(label, width / 2, height / 2 + 1);
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
