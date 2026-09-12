// run 状态效果原语：**内容（事件/剧情）改 run 状态的唯一入口**。
//
// 为什么要有这一层（用户定 2026-09-13）：事件内容应该"主动施加效果 + 主动要求演出"，
// 而不是返回 `{ money: 15 }` 让 Shell 去解释执行——那样每加一种事件效果都要改 runController，
// 效果语义被摊在表现层，故事模式无法承载。现在内容这样写：
//
//   import { gainMoney, damagePlayer } from '../../run/runEffects.js';
//   resolve(run, choiceId, ctx) {
//     if (choiceId === 'takeAll') { gainMoney(ctx, 15, { source: '钱袋' }); return { pages: [...] }; }
//     const lost = damagePlayer(ctx, 5, { source: '钱袋 · 铁牌' });   // 返回实际值，可写进文案
//     ...
//   }
//
// 每个原语做三件事：①改 run（唯一事实源）②记 `ctx.log`（纯描述，文本前端 / 日志用）
// ③按需向 `ctx.presenter.showcase(...)` 声明表现意图（**怎么演是 Shell 的事**）。
// 约定：治疗/伤害不打断叙事（不声明特写），获得物才特写；遗物特写由 Shell 的差分机制
// 自动兜（Shell 在 notify 里 diff `run.player.relics`），所以 gainRelic 不重复声明。
import { createSkillRuntime } from '../state/skillRuntime.js';
import { getSkillDefinition } from '../skills/registry.js';
import { getRelicDefinition } from '../relics/registry.js';
import { grantRelic } from './prep.js';
import { recordEffect } from './runContext.js';

/** 获得金币（amount ≤ 0 视为无事发生：不记账、不演出）。 */
export function gainMoney(ctx, amount, { source = '' } = {}) {
  const n = Math.max(0, Math.floor(amount ?? 0));
  if (n <= 0) return 0;
  ctx.run.player.money += n;
  recordEffect(ctx, { kind: 'money', amount: n, source });
  ctx.presenter.showcase({ kind: 'gold', amount: n, title: `+${n} 金币`, desc: source });
  return n;
}

/** 花费金币（不够则不动账并返回 false，由内容决定怎么叙述）。 */
export function spendMoney(ctx, amount, { source = '' } = {}) {
  const n = Math.max(0, Math.floor(amount ?? 0));
  if (n <= 0) return true;
  if (ctx.run.player.money < n) return false;
  ctx.run.player.money -= n;
  recordEffect(ctx, { kind: 'spend', amount: n, source });
  return true;
}

/** 回复生命（封顶 maxHp）；返回**实际**回复量，供内容写进文案。 */
export function healPlayer(ctx, amount, { source = '' } = {}) {
  const p = ctx.run.player;
  const healed = Math.max(0, Math.min(p.maxHp - p.hp, Math.floor(amount ?? 0)));
  if (healed <= 0) return 0;
  p.hp += healed;
  recordEffect(ctx, { kind: 'heal', amount: healed, source });
  return healed;
}

/**
 * 扣除生命（默认 1 点地板，事件不致死）；返回**实际**扣除量。
 * @param opts.floor 生命地板（默认 1：事件房不杀人）
 */
export function damagePlayer(ctx, amount, { source = '', floor = 1 } = {}) {
  const p = ctx.run.player;
  const lost = Math.max(0, Math.min(p.hp - floor, Math.floor(amount ?? 0)));
  if (lost <= 0) return 0;
  p.hp -= lost;
  recordEffect(ctx, { kind: 'damage', amount: lost, source });
  return lost;
}

/** 下场战斗开局额外魏启（与老虎机赠品同一机制：战斗根节点兑现即清）。 */
export function grantManaBonus(ctx, amount = 1, { source = '' } = {}) {
  const n = Math.max(0, Math.floor(amount ?? 0));
  if (n <= 0) return 0;
  ctx.run.pendingManaBonus = (ctx.run.pendingManaBonus ?? 0) + n;
  recordEffect(ctx, { kind: 'manaBonus', amount: n, source });
  return n;
}

/**
 * 获得遗物。**不声明特写**：Shell 在 notify 里 diff `run.player.relics` 自动补特写
 * （见 runController 的遗物差分），这里再声明一次会演两遍。
 * 一局内遗物唯一 → 可能重复触发的事件请在 `choices`/`requires` 里用 hasRelic 先挡。
 */
export function gainRelic(ctx, relicId, { source = '' } = {}) {
  grantRelic(ctx.run, relicId);
  recordEffect(ctx, { kind: 'relic', relicId, name: getRelicDefinition(relicId).name, source });
  return relicId;
}

/** 获得一张卡（入构筑牌组尾；立刻可用，不占卡包名额）。 */
export function gainCard(ctx, defId, { source = '' } = {}) {
  const def = getSkillDefinition(defId); // 未注册直接抛错（内容笔误要早暴露）
  ctx.run.player.deck.push(createSkillRuntime(defId));
  recordEffect(ctx, { kind: 'card', defId, name: def.name, source });
  ctx.presenter.showcase({ kind: 'card', defId, title: def.name, desc: source });
  return defId;
}

// ---- 剧情旗标（故事模式的"记忆"；run 内存续，跨 run 的进度放 run.profile）----
export function setFlag(ctx, key, value = true) {
  const run = ctx.run;
  run.eventFlags = { ...(run.eventFlags ?? {}), [key]: value };
  return value;
}

export const hasFlag = (run, key) => !!(run.eventFlags ?? {})[key];
