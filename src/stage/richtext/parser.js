// RichTextEngine 解析器：markup 文本 → token 流。
// 语法与旧 ColoredText.vue 完全等价：
//   /颜色{文本}     颜色名（red/blue/green/purple 等，排除保留字 effect/named/card）
//   /effect{效果名}  行内效果引用：图标（定义 emoji，无图标回落徽章）+ 特征色名称文本，
//                    两段都是热区（tooltip 由 Shell 消费）；外观经 resolveEffect/drawIcon 注入
//   /named{实体名}   命名实体（可交互热区，tooltip 由 Shell 消费）
//   /card{卡id, k=v, ...}  行内卡牌引用：卡名按 id 从注册表反查（卡面印出的名字永远等于
//                    定义名，改名不失配）；k=v 为卡参数（字符串值，消费方自行 Number()），
//                    预览时经 ctx.params 透传给 def.describe 插值；热区 tooltip 为整卡预览
// 解析器是纯函数，不依赖任何渲染环境；icon/color 等外观解析是 layout/texture 的职责。

const COLOR_RE = /\/(\w+)\{([^}]+)\}/g;
const EFFECT_RE = /\/effect\{([^}]+)\}/g;
const NAMED_RE = /\/named\{([^}]+)\}/g;
const CARD_RE = /\/card\{([^}]+)\}/g;

const RESERVED = ['effect', 'named', 'card'];

/**
 * 解析 /card{...} 的参数体：'instantStrike' / 'ironShard, damage=10, tier=B'
 * → { cardId, params }（params 值恒为字符串；无参数时为 {}）。
 */
export function parseCardRef(raw) {
  const parts = String(raw ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const cardId = parts.shift() ?? '';
  const params = {};
  for (const kv of parts) {
    const eq = kv.indexOf('=');
    if (eq <= 0) continue; // 无 = 的裸段静默丢弃（前向兼容）
    params[kv.slice(0, eq).trim()] = kv.slice(eq + 1).trim();
  }
  return { cardId, params };
}

/**
 * 解析 markup 文本为 token 流。
 * @param {string} text
 * @returns {Array<{type:string, content?:string, color?:string, effectName?:string, cardId?:string, params?:object}>}
 */
export function parseRichText(text) {
  if (typeof text !== 'string' || text.length === 0) return [];

  const matches = [];
  let match;

  COLOR_RE.lastIndex = 0;
  while ((match = COLOR_RE.exec(text)) !== null) {
    if (RESERVED.includes(match[1])) continue;
    matches.push({ index: match.index, lastIndex: COLOR_RE.lastIndex, type: 'color', color: match[1], content: match[2] });
  }

  EFFECT_RE.lastIndex = 0;
  while ((match = EFFECT_RE.exec(text)) !== null) {
    matches.push({ index: match.index, lastIndex: EFFECT_RE.lastIndex, type: 'effect', effectName: match[1] });
  }

  NAMED_RE.lastIndex = 0;
  while ((match = NAMED_RE.exec(text)) !== null) {
    matches.push({ index: match.index, lastIndex: NAMED_RE.lastIndex, type: 'named', content: match[1] });
  }

  CARD_RE.lastIndex = 0;
  while ((match = CARD_RE.exec(text)) !== null) {
    matches.push({ index: match.index, lastIndex: CARD_RE.lastIndex, type: 'card', ...parseCardRef(match[1]) });
  }

  matches.sort((a, b) => a.index - b.index);

  const tokens = [];
  let lastIndex = 0;
  for (const cur of matches) {
    // 重叠/嵌套 match 直接跳过（与旧实现行为一致：旧实现 sort 后顺序消费，重叠段会乱序，
    // 这里取更稳妥的做法——丢弃与已消费区间重叠的 match）
    if (cur.index < lastIndex) continue;
    if (cur.index > lastIndex) tokens.push({ type: 'text', content: text.slice(lastIndex, cur.index) });
    tokens.push(stripRange(cur));
    lastIndex = cur.lastIndex;
  }
  if (lastIndex < text.length) tokens.push({ type: 'text', content: text.slice(lastIndex) });
  return tokens;
}

function stripRange(match) {
  const { index, lastIndex, ...token } = match;
  return token;
}

/**
 * token 是否为可交互热区（named/card/effect 会弹 tooltip）。
 */
export function isInteractiveToken(token) {
  return token.type === 'named' || token.type === 'card' || token.type === 'effect';
}
