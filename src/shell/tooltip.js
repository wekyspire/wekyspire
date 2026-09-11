// tooltip 内容契约（塔楼/房间层共享的唯一解析器）：tooltipModel(kind, payload) →
// 结构化模型 { title, delta?, body, tint? }，渲染统一走 TooltipOverlay（App.vue
// 挂载的唯一样式宿主），本模块不产 HTML。
//
// token 源（Picker 3D 热区 / CardFacePreview DOM 热区 / 意图图标条）只产
// { kind, payload }，内容解析全部集中在此：
//   effect   优先 effectId 反查（单位效果行——投影自带 id，注册表按 id 命中）；
//            缺省按显示名反查（卡面富文本 markup 以显示名为载体——烘焙即快照，
//            名字匹配与卡面上印的文本天然一致，这是有意为之的快照语义）
//   card     卡牌整卡预览：按 id 反查（markup 只存 id，印出的名字永远等于定义名）；
//            模型带 cardPreview { skillId, params }，TooltipOverlay 渲染 CardFacePreview
//            （应用前口径 describe，params 经 ctx.params 透传插值）
//   named    术语文档（namedTerms，键即术语名，含参数如「衰败2」）
//   intention 意图投影数据直译短句（与 UnitObject 意图条图标一一对应）
//   shift    Shift 详情方标（文案由热区携带）

import { allEffects, getEffectDefinition } from '../core/effects/registry.js';
import { getSkillDefinition, hasSkill } from '../core/skills/registry.js';
import { getNamedTerm } from '../core/skills/namedTerms.js';

// 整卡预览的估算尺寸（tooltipHub 边缘翻转用）：CardFacePreview 宽 200 + 宿主 padding
export const CARD_PREVIEW_SIZE = Object.freeze({ w: 216, h: 294 });

export function tooltipModel(kind, payload = {}) {
  switch (kind) {
    case 'effect': return effectModel(payload);
    case 'card': return cardModel(payload);
    case 'named': return namedModel(payload);
    case 'intention': return intentionModel(payload);
    case 'shift': return { title: payload.name ?? '', body: '' };
    default: return { title: `[${kind}] ${payload.name ?? ''}`, body: '' };
  }
}

function effectModel({ effectId, name }) {
  const def = (effectId != null ? getEffectDefinition(effectId) : null)
    ?? allEffects().find(d => d.name === name);
  if (!def) return { title: `[effect] ${name ?? effectId}`, body: '' };
  return { title: `${def.icon ?? ''}${def.name}`, body: def.description ?? '' };
}

// card：整卡预览模型——文字只有标题兜底（定义缺失时），正常路径 TooltipOverlay
// 渲染 CardFacePreview 整卡（自身已含卡名/费用/正文，不再重复文本摘要）
function cardModel({ cardId, params }) {
  const def = (cardId != null && hasSkill(cardId)) ? getSkillDefinition(cardId) : null;
  if (!def) return { title: `[card] ${cardId}`, body: '' };
  return {
    title: def.name,
    body: '',
    cardPreview: { skillId: def.id, params: params ?? {} },
    size: CARD_PREVIEW_SIZE,
  };
}

function namedModel({ name }) {
  const term = getNamedTerm(name);
  return term
    ? { title: `${term.name}${term.param ?? ''}`, body: term.text }
    : { title: name ?? '', body: '' };
}

function intentionModel({ intention, unitName }) {
  return { title: unitName ? `${unitName}的意图` : '意图', body: intentionSentence(intention) };
}

// 意图释义短句：kinds 最多两两组合 → 「下回合将…，…」；攻击附 N×M（多发带总量），
// 未知意图单独成句。文案与 UnitObject 意图条图标一一对应（剑/盾/升/降/星光/?）。
const INTENTION_ACTS = Object.freeze({
  defend: '获得护盾',
  buff: '强化自身',
  debuff: '赋予负面效果',
  summon: '召唤援军',
  stun: '晕眩（不行动）',
});

function intentionSentence(intention) {
  const kinds = (intention?.kinds?.length ? intention.kinds : ['unknown']).slice(0, 2);
  const note = intention?.note ? `；${intention.note}` : ''; // 行动逻辑补充说明（固定索敌规则等）
  if (kinds.includes('unknown')) return `下回合行动未知${note}`;
  const parts = kinds.map((k) => {
    if (k !== 'attack') return INTENTION_ACTS[k] ?? '行动';
    if (intention.damage == null) return '进行攻击';
    return intention.hits > 1
      ? `造成 ${intention.hits}×${intention.damage}（共 ${intention.hits * intention.damage}）点伤害`
      : `造成 ${intention.damage} 点伤害`;
  });
  return `下回合将${parts.join('，')}${note}`;
}
