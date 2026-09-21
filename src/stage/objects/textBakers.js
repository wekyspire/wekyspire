// 粗体数字烘焙（白字 + 深描边的手写粗体感，概念图语言）：血量 / 护盾盾值共用。
// 逻辑像素按全局 10px/世界单位 约定（width/height 即世界尺寸 ×10）；
// node 无 document 不走此路径（各控件注入 baker 兜底）。
import * as THREE from 'three';
import { renderRichTextBlock } from '../richtext/texture.js';
import { hasMarkup } from '../richtext/inline.js';

/**
 * @param {string} text
 * @param {object} opts
 *   fontPx: 字号（逻辑像素，@10px/wu；默认 20 → 高 2.8wu）
 *   tint:   填充色；stroke: 描边色；italic: 斜体（获得物特写的斜体描述用）
 * @returns {{ texture, width, height }}  width/height 为逻辑像素
 */
export function bakeBoldText(text, { fontPx = 20, tint = '#ffffff', stroke = 'rgba(5, 7, 12, 0.85)', italic = false } = {}) {
  const S = 4; // 超采样（1080p 下面片近 60px 高，S=3 已接近 1:1，提到 4 留足余量）
  const meas = document.createElement('canvas').getContext('2d');
  meas.font = `${italic ? 'italic ' : ''}bold ${fontPx * S}px sans-serif`;
  const tw = Math.ceil(meas.measureText(text).width / S) + 6;
  const th = Math.ceil(fontPx * 1.4);
  const canvas = document.createElement('canvas');
  canvas.width = tw * S;
  canvas.height = th * S;
  const ctx = canvas.getContext('2d');
  ctx.scale(S, S);
  ctx.font = `${italic ? 'italic ' : ''}bold ${fontPx}px sans-serif`;
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

/**
 * 单行**富文本**烘焙：与 bakeBoldText 同契约（逻辑像素尺寸 + 同款粗体/描边观感），
 * 但走 RichTextEngine——`/card{}` `/named{}` `/effect{}` `/red{}` 都会渲染成
 * 图标 + 特征色名称，而不是把 markup 原样印出来。面板行 / 获得特写 / 状态栏都用它。
 * node 无 document 时调用方不走此路径（沿用各自的占位烘焙）。
 * @param {object} opts fontPx / tint / strokeWidth（黑边宽度，0 = 不描边）/ bold / maxWidth / scale
 * @returns {{ texture, width, height, hitRegions }}  与 renderRichTextBlock 同契约
 *   （hitRegions 只有消费方接了 Picker 才用得上；单行烘焙的调用方一般忽略）
 */
export function bakeRichLine(text, {
  fontPx = 16, tint = '#ffffff', strokeWidth = 0, bold = true, maxWidth = 4000, scale = 3,
} = {}) {
  return renderRichTextBlock(text, {
    maxWidth,
    scale,
    style: {
      fontSize: fontPx,
      lineHeight: Math.round(fontPx * 1.4),
      color: tint,
      fontWeight: bold ? 'bold' : 'normal',
    },
    textStroke: strokeWidth > 0 ? { width: strokeWidth, color: 'rgba(5, 7, 12, 0.9)' } : null,
  });
}

/**
 * **auto 单行烘焙**：有 markup 走 bakeRichLine，没有则原样走 bakeBoldText。
 * 这是面板/特写一类的缺省烘焙——纯文本行的排版与观感与改动前**一致**
 * （无回归），只有写了 markup 的行才切换到富文本渲染。
 *
 * ⚠ 两条路径的描边参数名不同：bakeBoldText 的 `stroke` 是**颜色**（它自带宽度），
 * 富文本路径要的是**宽度** `strokeWidth`；auto 里缺省按字号推导（与 bakeBoldText
 * 内部口径 max(3, fontPx×0.2) 对齐），颜色仍是那支深墨。
 * @param {object} opts bakeBoldText 的 opts（fontPx/tint/stroke/italic）+ strokeWidth/bold
 */
export function bakeAutoLine(text, opts = {}) {
  if (!hasMarkup(text)) return bakeBoldText(text, opts);
  // 只挑富文本路径认得的键转发（undefined 会被 bakeRichLine 的缺省值接管）：
  // bakeBoldText 的 stroke(色)/italic 与富文本无关，不往这边泄
  const { fontPx, tint, bold, maxWidth, scale, strokeWidth } = opts;
  return bakeRichLine(text, {
    fontPx, tint, bold, maxWidth, scale,
    strokeWidth: strokeWidth ?? Math.max(3, (fontPx ?? 16) * 0.2),
  });
}
