// 粗体数字烘焙（白字 + 深描边的手写粗体感，概念图语言）：血量 / 护盾盾值共用。
// 逻辑像素按全局 10px/世界单位 约定（width/height 即世界尺寸 ×10）；
// node 无 document 不走此路径（各控件注入 baker 兜底）。
import * as THREE from 'three';

/**
 * @param {string} text
 * @param {object} opts
 *   fontPx: 字号（逻辑像素，@10px/wu；默认 20 → 高 2.8wu）
 *   tint:   填充色；stroke: 描边色
 * @returns {{ texture, width, height }}  width/height 为逻辑像素
 */
export function bakeBoldText(text, { fontPx = 20, tint = '#ffffff', stroke = 'rgba(5, 7, 12, 0.85)' } = {}) {
  const S = 4; // 超采样（1080p 下面片近 60px 高，S=3 已接近 1:1，提到 4 留足余量）
  const meas = document.createElement('canvas').getContext('2d');
  meas.font = `bold ${fontPx * S}px sans-serif`;
  const tw = Math.ceil(meas.measureText(text).width / S) + 6;
  const th = Math.ceil(fontPx * 1.4);
  const canvas = document.createElement('canvas');
  canvas.width = tw * S;
  canvas.height = th * S;
  const ctx = canvas.getContext('2d');
  ctx.scale(S, S);
  ctx.font = `bold ${fontPx}px sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(3, fontPx * 0.2);
  ctx.strokeStyle = stroke;
  ctx.strokeText(text, 3, th / 2);
  ctx.fillStyle = tint;
  ctx.fillText(text, 3, th / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { texture, width: tw, height: th };
}
