// 富文本「行内引用」的外观解析：markup 里的 /effect{名} /named{词} /card{id}
// 各自该用什么颜色、什么图标、什么显示名。三个环境共用同一份口径：
//   · 卡面烘焙（cardFace.js）——canvas 正文的排版注入
//   · 行内文本烘焙（textBakers.bakeRichLine）——面板/特写的单行富文本
//   · DOM 行内渲染（shell/components/RichTextInline.vue 走 inline.js）
// 纯查表（Stage→Core 查注册表是允许方向），不碰 canvas/DOM，node 可全量单测。
//
// 卡面色表也归在这里（cardTheme/seriesGlyph）：主题色是「卡面语言」，而卡面正文的
// 行内引用要按同一套色相着色，放在一起才不会两头漂移。

import { allEffects } from '../../core/effects/registry.js';
import { getNamedTerm } from '../../core/skills/namedTerms.js';
import { getSkillDefinition, hasSkill } from '../../core/skills/registry.js';
import { DEFAULT_COLOR_TABLE } from './layout.js';

// 等阶色（仅卡面等阶徽章/边框用量；行内引用的描述语言不含等阶）
export const TIER_COLORS = Object.freeze({
  D: '#8a8f9d', C: '#5aa2e8', B: '#a06ee8', A: '#e8b34c', S: '#e85a5a', Z: '#4a3a5a',
});
// 系列类型色（旧主题源，现作 series 未归口时的回落）；未知回落体修灰
const TYPE_COLORS = Object.freeze({
  normal: '#8a8f9d',
  fire: '#e85a5a',
  wood: '#4aa56e',
  water: '#5aa2e8',
  earth: '#b8894a',
  thunder: '#e8d34c',
  light: '#e8e0c0',
  dark: '#7a5aa8',
});
// 灵脉主题色（大体系）：卡面整体色调（底板/边框/斜纹/分隔线/页脚）跟随灵脉——
// 一眼区分系别（用户定）。等阶只保留在等阶标记上（徽章色 + 边框粗细/箔金），
// 不再左右整卡色相。
const LEINO_THEME = Object.freeze({
  body: '#8a8f9d',  // 体修：岩灰
  fire: '#e85a5a',  // 火
  wood: '#4aa56e',  // 木
  air: '#7ad0e8',   // 风
});
// 通用灰卡（pack='common'）：偏白主题色——与所有体系卡拉开距离，且区分方式同样是主题色
const COMMON_THEME = '#e8e6e0';
// series（技能家族）→ 灵脉归口：新体系内容落定后在此补一行；未归口回落类型色
const SERIES_LEINO = Object.freeze({
  fist: 'body', block: 'body', blade: 'body', punch: 'body', focusChant: 'body',
  inflame: 'fire',
});
/** 卡面主题色：通用灰卡（偏白）优先 → 灵脉（series 归口）→ 类型色回落 → 体修灰。 */
export function cardTheme(card) {
  if (card?.pack === 'common') return COMMON_THEME;
  const leino = SERIES_LEINO[card?.series];
  if (leino && LEINO_THEME[leino]) return LEINO_THEME[leino];
  return TYPE_COLORS[card?.type] ?? TYPE_COLORS.normal;
}

// 系列字形（无卡图时的占位水印字，也是行内卡牌引用的图标）；新系列登记定义后在此补一行
const SERIES_GLYPHS = Object.freeze({
  fist: '拳', blade: '刃', block: '盾',
  fire: '炎', wood: '木', water: '水', earth: '岳', thunder: '雷', light: '光', dark: '冥',
});
/** 系列字形占位字：series 优先，回落 type，未知回落「技」。 */
export function seriesGlyph(card) {
  return SERIES_GLYPHS[card?.series] ?? SERIES_GLYPHS[card?.type] ?? '技';
}

/**
 * 效果外观解析（markup 里是效果显示名，按 name 反查定义）。
 * 特征色：def.color 是 richtext 颜色名，经颜色表转 css；未注册/无色 → null（回落正文色）。
 * @returns {{ color: string|null, icon: string|null }}
 */
export function effectLook(name) {
  const def = allEffects().find(d => d.name === name);
  const color = def?.color ? (DEFAULT_COLOR_TABLE[def.color] ?? def.color) : null;
  return { color, icon: def?.icon ?? null };
}

/** 命名实体（NAMED 术语）外观：术语表自带特征色（含尾缀参数如「衰败2」）。 */
export function namedLook(name) {
  const term = getNamedTerm(name);
  return { color: term?.color ?? null };
}

/**
 * 卡牌引用外观：id 反查显示名（印出的名字永远等于定义名；未注册 id 不抛错，
 * 回落印原文 id——注册表 get 对未知 id 抛异常，先 has 兜底）+ 卡面主题色 + 系列字形。
 * @returns {{ name: string, color: string|null, glyph: string|null }}
 */
export function cardLook(cardId) {
  const def = hasSkill(cardId) ? getSkillDefinition(cardId) : null;
  if (!def) return { name: cardId, color: null, glyph: null };
  return { name: def.name, color: cardTheme(def), glyph: seriesGlyph(def) };
}
