// 文本格式化：把 core 定义/运行时对象渲染成中文文本行（卡面行、结算日志、奖项描述）。
// 引擎（engine.mjs）与状态渲染（render.mjs）共用；不持有会话状态、不依赖寻址（addressing.mjs）。
import { canUseSkill, makeSkillCtx } from '../../src/core/skills/helpers.js';
import { getSkillDefinition } from '../../src/core/skills/registry.js';
import { getEffectDefinition } from '../../src/core/effects/registry.js';

// 富文本 → 纯文本：/effect{x}|/named{x} 保留内文；/card{id} 解析为卡名（渲染层同款语义）
export const plain = (s) => String(s ?? '')
  .replace(/\/card\{([^}]*)\}/g, (_, id) => getSkillDefinition(id)?.name ?? id)
  .replace(/\/(?:effect|named)\{([^}]*)\}/g, '$1');

export const defOf = (rt) => getSkillDefinition(rt.defId);

export const costText = (def) => {
  const c = def.cost ?? {};
  const parts = [];
  if (c.mana === 'X') parts.push('X魏启'); else if (c.mana) parts.push(`${c.mana}魏启`);
  if (c.actionPoint) parts.push(`${c.actionPoint}AP`);
  return parts.join(' ') || '0费';
};

export const kwText = (def) => (def.keywords ?? [])
  .filter(k => k !== 'blade').map(k => ({
    exhaust: '消耗', transient: '短暂', innate: '固有', anchored: '锁定', slowStart: '慢热',
  }[k] ?? k)).join(' ');

export const effectsText = (unit) => unit.effects?.length
  ? unit.effects.map(e => `${getEffectDefinition(e.effectId)?.name ?? e.effectId}${e.stacks}`).join(' ') : '';

export const intentText = (u) => {
  const it = u.intention;
  if (!it) return '未知';
  // 语义性意图（只有 unknown 一种 kind 且有说明）：直接显示说明，不套「未知（…）」
  if (it.kinds?.length === 1 && it.kinds[0] === 'unknown' && it.note) return it.note;
  const kind = (it.kinds ?? []).map(k => ({
    attack: '攻击', defend: '防御', buff: '强化', debuff: '削弱',
    summon: '召唤', unknown: '未知', stun: '晕眩',
  }[k] ?? k)).join('+');
  const dmg = it.damage ? ` ${it.damage}${it.hits > 1 ? `×${it.hits}` : ''}` : '';
  return kind + dmg + (it.note ? `（${it.note}）` : '');
};

export function cardLine(idx, rt, battleCtx) {
  const def = defOf(rt);
  // 咏唱卡前置「咏唱N·」标记（打出前可见——点燃/解除语义靠它）
  const nameTag = def.cardMode === 'chant' ? `咏唱${def.chantWeight ?? 2}·${def.name}` : def.name;
  const bits = [`[${idx}] ${nameTag} ${def.tier}阶 ${costText(def)}`];
  const kw = kwText(def); if (kw) bits.push(kw);
  if (rt.isActivated) bits.push('★已激活咏唱');
  else if (rt.remainingUses <= 0) bits.push(`冷却中(剩${rt.currentCooldown}拍)`);
  if (rt.power) bits.push(`威力${rt.power > 0 ? '+' : ''}${rt.power}`);
  let desc;
  try {
    desc = (battleCtx && def.battleDescribe)
      ? plain(def.battleDescribe(makeSkillCtx(battleCtx, rt)))
      : plain(def.describe());
  } catch { desc = plain(def.describe()); }
  bits.push(`「${desc}」`);
  if (battleCtx) bits.push(canUseSkill(battleCtx, rt) ? '可用' : '不可用');
  return bits.join(' | ');
}

// 无战斗上下文的卡面行（升级预览用）：名/阶/费用/关键词/描述
export function cardDefLine(def) {
  const nameTag = def.cardMode === 'chant' ? `咏唱${def.chantWeight ?? 2}·${def.name}` : def.name;
  const bits = [`${nameTag} ${def.tier}阶 ${costText(def)}`];
  const kw = kwText(def); if (kw) bits.push(kw);
  bits.push(`「${plain(def.describe?.() ?? '')}」`);
  return bits.join(' | ');
}

// 老虎机产出/事件结果的中文呈现（内部 id → 名称）
export function slotResultText(p) {
  if (!p) return '（无）';
  const head = p.tier === 'major' ? '★大奖 ' : (p.tier === 'none' ? '' : '小奖 ');
  const body = p.money != null ? `金币+${p.money}`
    : p.healPct != null ? `恢复${Math.round(p.healPct * 100)}%生命`
      : p.fullRestore ? '全状态恢复'
        : p.special ? `特殊物品：${p.special}`
          : p.relicChoices?.length ? `三选一A级遗物：${p.relicChoices.map(r => `${r.name}(${r.id})`).join(' / ')}`
            : p.relicId ? `遗物：${p.relicId}`
              : p.upgradeCopyId ? `升级后复制品：${p.upgradeCopyId}`
                : p.upgrade?.kind === 'random' ? `随机升级${p.upgrade.count}张`
                  : p.upgrade?.kind === 'free' ? '免费指定升级一张卡'
                    : p.choices?.length ? `卡${p.choices.length}选1：${p.choices.map(c => `${c.name}(${c.id})`).join(' / ')}`
                      : p.kind;
  return head + body;
}

// 事件结果的中文呈现：从**效果流水**（事件内容主动施加后记的账）拼一句话。
// 效果语义见 src/core/run/runEffects.js——这里只做文本映射，不参与逻辑。
const EFFECT_TEXT = {
  money: (e) => `金币 +${e.amount}`,
  spend: (e) => `金币 -${e.amount}`,
  heal: (e) => `恢复 ${e.amount} 生命`,
  damage: (e) => `损失 ${e.amount} 生命`,
  manaBonus: (e) => `下场战斗开局魏启 +${e.amount}`,
  relic: (e) => `获得遗物 ${e.name ?? e.relicId}`,
  card: (e) => `获得卡牌 ${e.name ?? e.defId}`,
};

export function eventResultText(r) {
  const bits = (r.effects ?? []).map(e => (EFFECT_TEXT[e.kind] ? EFFECT_TEXT[e.kind](e) : e.kind));
  return `「${r.name ?? r.eventId}」${bits.length ? bits.join('，') : '无事发生'}`;
}
