// RichTextEngine 烘焙器：placements → 离屏 canvas → THREE.CanvasTexture。
// 铁律（§4.6）：renderRichTextBlock 返回的 { texture, hitRegions } 永远成对替换，
// 调用方不得单独缓存其中之一。hitRegions 保持排版局部坐标，与烘焙分辨率（scale）无关。
//
// 浏览器外（单测）无法创建真实 canvas，因此 canvas 工厂与图标绘制器均注入；
// 单测用 mock 2d context 验证绘制调用序列即可。

import * as THREE from 'three';
import { parseRichText } from './parser.js';
import { layoutRichText, DEFAULT_TEXT_STYLE } from './layout.js';

export { DEFAULT_TEXT_STYLE };

/**
 * 浏览器环境的默认 measure：单个共享 canvas context 做 measureText。
 */
export function createCanvasMeasurer(style = {}) {
  const st = { ...DEFAULT_TEXT_STYLE, ...style };
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  return (text) => {
    const weight = st.fontWeight && st.fontWeight !== 'normal' ? `${st.fontWeight} ` : '';
    ctx.font = `${weight}${st.fontSize}px sans-serif`;
    return ctx.measureText(text).width;
  };
}

/**
 * 烘焙一段富文本为纹理 + hit map。
 * @param {string} text  markup 文本
 * @param {object} options
 *   maxWidth, style, colorTable, resolveNamed —— 同 layoutRichText
 *   measure: (text, style) => number   缺省用 createCanvasMeasurer（浏览器）
 *   scale: number = 2                  烘焙分辨率倍率（清晰度，按最大显示尺寸取）
 *   fixedSize: {width, height} = null  固定排版盒（内容从左上绘制，超出裁切）；
 *                                      牌面等需要稳定 hit map 坐标系的场景必传
 *   createCanvas: (w, h) => canvas     缺省 document.createElement
 *   drawIcon: (ctx, {iconType, name, x, y, size, scale}) => void  图标绘制器（缺省画占位框）
 *   textStroke: { width, color } = null  文本深描边（与 bakeBoldText 同语言）：小字号
 *     billboard 文本缩小采样后发灰，描边保对比度；null 关闭（卡面等大字号不用）
 * @returns {{ texture: THREE.CanvasTexture, hitRegions: Array, width: number, height: number }}
 *   width/height 为排版局部坐标尺寸（plane 几何直接用），texture 内部为 scale 倍分辨率。
 */
export function renderRichTextBlock(text, options = {}) {
  const {
    scale = 2,
    createCanvas = (w, h) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    },
    drawIcon = defaultDrawIcon,
  } = options;
  const measure = options.measure || createCanvasMeasurer(options.style);

  const layout = layoutRichText(parseRichText(text), { ...options, measure });
  const outWidth = options.fixedSize?.width ?? layout.width;
  const outHeight = options.fixedSize?.height ?? layout.height;
  const canvas = createCanvas(Math.max(1, Math.ceil(outWidth * scale)), Math.max(1, Math.ceil(outHeight * scale)));
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  drawPlacements(ctx, layout.placements, { style: options.style, drawIcon, textStroke: options.textStroke });

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearMipmapLinearFilter; // 按最大尺寸烘焙 + mipmap（§8.4 风险条款）
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;

  return { texture, hitRegions: layout.hitRegions, width: outWidth, height: outHeight };
}

/**
 * 把排版结果画到任意 2d context（可指定偏移，供 cardFace 等复合烘焙复用）。
 * 调用方负责 ctx.scale；offset 单位为排版局部坐标。
 * textStroke 开启时两遍绘制：先描边全部字形、再填充——圆角描边外扩 ~width/2，
 * 逐字 stroke-then-fill 会让后字的描边咬掉前字填充的边缘。
 */
export function drawPlacements(ctx, placements, { style, drawIcon = defaultDrawIcon, offsetX = 0, offsetY = 0, textStroke = null }) {
  const st = { ...DEFAULT_TEXT_STYLE, ...(style || {}) };
  const glyphFont = (s) => `${s.fontWeight && s.fontWeight !== 'normal' ? `${s.fontWeight} ` : ''}${s.fontSize}px sans-serif`;
  if (textStroke) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = textStroke.width ?? 3;
    ctx.strokeStyle = textStroke.color ?? 'rgba(5, 7, 12, 0.85)';
    for (const p of placements) {
      if (p.kind !== 'glyph') continue;
      ctx.font = glyphFont(p.style);
      ctx.strokeText(p.char, offsetX + p.x, offsetY + p.y + st.lineHeight / 2);
    }
  }
  for (const p of placements) {
    if (p.kind === 'glyph') {
      ctx.font = glyphFont(p.style);
      ctx.fillStyle = p.style.color;
      ctx.textBaseline = 'middle';
      ctx.fillText(p.char, offsetX + p.x, offsetY + p.y + st.lineHeight / 2);
    } else {
      drawIcon(ctx, { iconType: p.iconType, name: p.name, x: offsetX + p.x, y: offsetY + p.y, size: p.size });
    }
  }
}

// 默认图标：圆形徽章（effect 橙 / skill 蓝），比白框占位耐看
export function defaultDrawIcon(ctx, { iconType, x, y, size }) {
  const cx = x + size / 2;
  const cy = y + size / 2;
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2 - 1, 0, Math.PI * 2);
  ctx.fillStyle = iconType === 'effect' ? '#e8843c' : '#4c8de8';
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.stroke();
}
