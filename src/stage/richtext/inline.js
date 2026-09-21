// 富文本 → DOM 行内片段表：给「用 HTML 渲染一行 markup」的消费方（tooltip 正文、
// Vue 浮层等）提供与 canvas 排版同口径的片段序列。
//
// 为什么单独一层：canvas 版排版（layout.js）把「字形位置 + 热区矩形」算到像素，
// DOM 版交给浏览器排版，只需要「这行文本由哪些片段组成、每段什么颜色/图标」。
// 本模块是纯函数（只查注册表，不碰 DOM/canvas），因此 node 下可全量断言。
//
// 与 canvas 版的一致性口径：
//   · 颜色/图标/显示名一律经 appearance.js（与卡面正文同一份外观解析）
//   · 未知/未注册引用回落原文（不抛错——注册表 get 对未知 id 抛异常，先 has 兜底）
//
// 「引用段」在这里**只是呈现**：特征色 + 图标 + 系列字形徽章，不带任何交互语义
// （tooltip 内不做 hover，见 RichTextInline 头注）。带热区的引用在卡面上——那边走
// layout.js 的 hitRegions，与 DOM 无关。

import { parseRichText } from './parser.js';
import { DEFAULT_COLOR_TABLE } from './layout.js';
import { effectLook, namedLook, cardLook } from './appearance.js';

/**
 * @param {string} text markup 文本
 * @param {object} options
 *   colorTable: 颜色名 → css 颜色
 *   defaultColor: 纯文本段颜色（缺省 null = 交给宿主 CSS 继承）
 *   resolveEffect / resolveNamed / resolveCard: 覆盖外观解析（缺省走 appearance.js）
 * @returns {Array<{ type:'text', text:string, color:string|null }
 *               | { type:'effect'|'named'|'card', label:string, color:string|null,
 *                   icon:string|null, glyph:string|null }>}
 *   `label` 是显示文本（卡引用 = 卡定义名），`icon`/`glyph` 是可选的行内图标
 *   （效果 emoji / 卡牌系列字形）。
 */
export function inlineSegments(text, options = {}) {
  const colorTable = options.colorTable ?? DEFAULT_COLOR_TABLE;
  const defaultColor = options.defaultColor ?? null;
  const resolveEffect = options.resolveEffect ?? effectLook;
  const resolveNamed = options.resolveNamed ?? namedLook;
  const resolveCard = options.resolveCard ?? cardLook;

  const out = [];
  for (const token of parseRichText(text)) {
    switch (token.type) {
      case 'text':
        out.push({ type: 'text', text: token.content, color: defaultColor });
        break;
      case 'color':
        out.push({ type: 'text', text: token.content, color: colorTable[token.color] ?? defaultColor });
        break;
      case 'effect': {
        const look = resolveEffect(token.effectName) ?? {};
        out.push({
          type: 'effect', label: token.effectName,
          color: tokenColor(look, colorTable) ?? defaultColor,
          icon: look.icon ?? null, glyph: null,
        });
        break;
      }
      case 'named': {
        const look = resolveNamed(token.content) ?? {};
        out.push({
          type: 'named', label: token.content,
          color: tokenColor(look, colorTable) ?? defaultColor,
          icon: null, glyph: null,
        });
        break;
      }
      case 'card': {
        const look = resolveCard(token.cardId) ?? {};
        out.push({
          type: 'card', label: look.name ?? token.cardId,
          color: tokenColor(look, colorTable) ?? defaultColor,
          icon: null, glyph: look.glyph ?? null,
        });
        break;
      }
      default:
        break; // 未知 token 静默忽略（与排版器同口径的前向兼容）
    }
  }
  return out;
}

/** 外观色可能是颜色表里的名字（如 'red'）也可能是 css 颜色，统一转 css。 */
function tokenColor(look, colorTable) {
  return look.color ? (colorTable[look.color] ?? look.color) : null;
}

/**
 * 文本里是否含任何 markup（含纯着色的 /red{}）——「走富文本渲染还是走纯文本渲染」的
 * 唯一判据，3D 烘焙（bakeAutoLine）与 tooltip 正文（tooltipModel.markup）同源。
 */
export function hasMarkup(text) {
  if (typeof text !== 'string' || text.length === 0) return false;
  return parseRichText(text).some(t => t.type !== 'text');
}
