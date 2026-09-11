// RichTextEngine 排版器：token 流 → 逐字形放置 + hit map。
// 纯数据计算，不接触 Canvas：文本宽度通过注入的 measure(text, style) 获得，
// 因此 node 环境下可用假 measure 全量单测；texture.js 负责把放置结果画到离屏 canvas。
//
// 铁律（§4.6）：每次排版同时产出纹理所需的 placements 与 hitRegions，两者成对替换。
// hitRegions 的 rect 使用排版局部坐标（与烘焙分辨率无关），Picker 用 UV 反算后查询。

export const DEFAULT_TEXT_STYLE = Object.freeze({
  fontSize: 16,
  lineHeight: 22,
  iconSize: 18,       // /effect{} /card{} 行内图标边长
  iconGap: 2,         // 图标与相邻文本的间距
  color: '#ffffff',
  fontWeight: 'normal', // 'bold' 等（伤害数字等强调文本用）
});

// token.type → 绘制时的样式来源，外观解析（颜色表、实体配色）由调用方注入。
export const DEFAULT_COLOR_TABLE = Object.freeze({
  red: '#ff4444',
  blue: '#4444ff',
  green: '#44ff44',
  purple: '#ff44ff',
});

/**
 * @param {Array} tokens  parseRichText 的输出
 * @param {object} options
 *   maxWidth: number            排版宽度上限（局部坐标）
 *   measure: (text, style) => number   文本宽度测量（浏览器里包 canvas measureText）
 *   style: 覆盖 DEFAULT_TEXT_STYLE 的子集
 *   colorTable: 颜色名 → css 颜色
 *   resolveNamed: (name) => ({ color? }) 命名实体外观
 *   resolveEffect: (name) => ({ color? }) 效果外观（名称特征色；css 颜色或颜色表颜色名）
 *   resolveCard: (cardId) => ({ name?, color? }) 卡牌外观（id → 显示名 + 特征色）
 * @returns {{ width:number, height:number, placements:Array, hitRegions:Array }}
 *   placement: { kind:'glyph', char, x, y, width, style:{fontSize,color} }
 *            | { kind:'icon', iconType:'effect'|'card', name, x, y, size }
 *   hitRegion: { type:'named'|'card'|'effect', payload:{name}|{cardId, params}, rect:{x,y,w,h} }
 */
export function layoutRichText(tokens, options) {
  const {
    maxWidth = 200,
    measure,
    colorTable = DEFAULT_COLOR_TABLE,
    resolveNamed = () => ({}),
    resolveEffect = () => ({}),
    resolveCard = () => ({}),
  } = options;
  if (typeof measure !== 'function') throw new Error('layoutRichText: measure(text, style) is required');

  const st = { ...DEFAULT_TEXT_STYLE, ...(options.style || {}) };
  const placements = [];
  const hitRegions = [];

  let cursorX = 0;
  let cursorY = 0; // 行顶
  let maxLineWidth = 0;

  const newLine = () => {
    maxLineWidth = Math.max(maxLineWidth, cursorX);
    cursorX = 0;
    cursorY += st.lineHeight;
  };

  // 放置一段带样式的文本（逐字符换行）；每行片段记录为一个 run 供 hitRegion 聚合
  const placeText = (text, style) => {
    const runs = []; // [{x, y, w}]
    let runStart = cursorX;
    let runY = cursorY;
    for (const char of text) {
      const w = measure(char, style);
      if (cursorX > 0 && cursorX + w > maxWidth) {
        runs.push({ x: runStart, y: runY, w: cursorX - runStart });
        newLine();
        runStart = 0;
        runY = cursorY;
      }
      placements.push({ kind: 'glyph', char, x: cursorX, y: cursorY, width: w, style: { fontSize: st.fontSize, color: style.color, fontWeight: st.fontWeight } });
      cursorX += w;
    }
    runs.push({ x: runStart, y: runY, w: cursorX - runStart });
    return runs;
  };

  const placeIcon = (iconType, name) => {
    const w = st.iconSize + st.iconGap;
    if (cursorX > 0 && cursorX + w > maxWidth) newLine();
    placements.push({ kind: 'icon', iconType, name, x: cursorX, y: cursorY + (st.lineHeight - st.iconSize) / 2, size: st.iconSize });
    cursorX += w;
    return { x: cursorX - w, y: cursorY, w };
  };

  for (const token of tokens) {
    switch (token.type) {
      case 'text':
        placeText(token.content, { color: st.color });
        break;
      case 'color':
        placeText(token.content, { color: colorTable[token.color] || st.color });
        break;
      case 'effect': {
        // 图标 + 特征色名称文本（与 skill token 同构），两段都是热区
        const look = resolveEffect(token.effectName) || {};
        const iconRun = placeIcon('effect', token.effectName);
        hitRegions.push({ type: 'effect', payload: { name: token.effectName }, rect: { x: iconRun.x, y: iconRun.y, w: iconRun.w, h: st.lineHeight } });
        const runs = placeText(token.effectName, { color: colorTable[look.color] || look.color || st.color });
        for (const run of runs) {
          if (run.w > 0) hitRegions.push({ type: 'effect', payload: { name: token.effectName }, rect: { x: run.x, y: run.y, w: run.w, h: st.lineHeight } });
        }
        break;
      }
      case 'named': {
        const look = resolveNamed(token.content) || {};
        const runs = placeText(token.content, { color: look.color || st.color });
        for (const run of runs) {
          if (run.w > 0) hitRegions.push({ type: 'named', payload: { name: token.content }, rect: { x: run.x, y: run.y, w: run.w, h: st.lineHeight } });
        }
        break;
      }
      case 'card': {
        // 卡名按 id 反查（resolveCard 注入，缺省回落原文 id）；图标 + 名称文本两段热区
        const look = resolveCard(token.cardId) || {};
        const label = look.name ?? token.cardId;
        const payload = { cardId: token.cardId, params: token.params ?? {} };
        const iconRun = placeIcon('card', label);
        hitRegions.push({ type: 'card', payload, rect: { x: iconRun.x, y: iconRun.y, w: iconRun.w, h: st.lineHeight } });
        const runs = placeText(label, { color: colorTable[look.color] || look.color || st.color });
        for (const run of runs) {
          if (run.w > 0) hitRegions.push({ type: 'card', payload, rect: { x: run.x, y: run.y, w: run.w, h: st.lineHeight } });
        }
        break;
      }
      default:
        break; // 未知 token 静默忽略（前向兼容）
    }
  }

  maxLineWidth = Math.max(maxLineWidth, cursorX);
  return {
    width: Math.min(maxLineWidth, maxWidth),
    height: cursorY + st.lineHeight,
    placements,
    hitRegions,
  };
}

/**
 * 热区命中查询（布局局部坐标，与烘焙分辨率无关）：返回首个包含 (lx,ly) 的热区。
 * 唯一实现，两类消费方共用：卡面 3D 拾取（CardObject.hitTestUV 反算局部坐标后
 * 委托）与 DOM 预览（CardFacePreview 把 img 显示像素换算成布局坐标后委托）。
 */
export function hitTestRegions(regions, lx, ly) {
  for (const region of regions) {
    const r = region.rect;
    if (lx >= r.x && lx <= r.x + r.w && ly >= r.y && ly <= r.y + r.h) return region;
  }
  return null;
}
