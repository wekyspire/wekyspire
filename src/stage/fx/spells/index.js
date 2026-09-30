// 施术演出模板系统（spellFx，2026-09-30 用户定「动画逻辑生成器」架构）：
// 类比 PCG 管线（生成器 → 物体生成器 → SDK）的三层——
//   · 基础块 SDK：fx/spells/blocks.js（cardFlare/arcProjectile/impactBurst/slashSweep…）
//   · 模板生成器：本目录一文件一模板，`build(params)` 拼装基础块产出「动画逻辑本身」
//   · 决议链 + 节拍接线：本文件（BASE → SERIES_SPELLS → CARD_SPELLS，挂 _skillDisplay 节拍）
//
// 模板契约（动画逻辑生成器）：
//   { defaults, build(params) → async (ctx, deps, notify) => void, warm?(deps) }
//   - 返回的 async 协程即动画逻辑；ctx = fx/script 的 ScriptContext
//     （tween/wait/spawn + 结构化 kill——被杀时后续语句不执行、onKill 清理必达）
//   - notify() = 通知 sequencer「本节拍完成，可进下一个动画」。时机归模板自选
//     （2026-09-30 用户定的三档口径）：
//       · 小卡 200~500ms：全程演完才 notify（短促刀光/抓伤）
//       · 大卡：主体落定即 notify（如爆炸开始后 ~700ms），余烬等无主资产后台散尽
//       · 依赖战斗实体不被打扰的强卡（摧山斩类：受击 billboard 断裂两半等）：
//         全程演完才 notify——sequencer 串行化即实体锁，后续节拍动不了它
//   - runner 保证 notify 幂等 + 异常/被杀兜底必达（节拍链永不被 Jam）
//   - notify 之后只许存在无主资产（ttl 粒子自然熄 / 灯强度 tween 归零 / gsap 自驱）；
//     自建 mesh/材质必须在 notify 前回收完毕（onKill 只兜异常路径）
//
// 决议链（stage 层表驱动——core 的技能 def 不加视觉字段，外观策略集中查表）：
//   CARD_SPELLS[defId]（逐卡覆写：换模板或调参数）→ SERIES_SPELLS[series]（体系级）
//   → null（BASE = _skillDisplay 现行为原样，零回归）。参数合并 defaults ← 体系行 ← 逐卡行。
// 观战兼容：模板选择只用 defId/series（两端同 bundle 反查），wire 契约零改动。
import { getSkillDefinition } from '../../../core/skills/registry.js';
import { runScript } from '../script.js';
import { emberBurst } from './emberBurst.js';
import { bladeSlash } from './bladeSlash.js';

// 模板注册表（一文件一模板，id 即登记键）
const TEMPLATES = { emberBurst, bladeSlash };

// 体系级映射（series → 模板 id）。先锋期只挂两系打样；铺量 = 往这里加行。
// ⚠ 挂上即全体系生效（26 张刀法卡都会获得刀光）——影响面大，逐系验收后再挂。
const SERIES_SPELLS = {
  ember: 'emberBurst',
  blade: 'bladeSlash',
};

// 逐卡覆写（defId → { template, params }）：换模板或微调参数（同体系内单卡变体）。
const CARD_SPELLS = {
  // 例：'meltDown': { template: 'emberBurst', params: { count: 40, speed: 32 } },
};

/**
 * 决议：defId → { template, params } | null。
 * @param {string} defId 技能 id（payload.def.id 或 skill.defId）
 */
export function resolveSpellFx(defId) {
  const card = CARD_SPELLS[defId];
  if (card) {
    const template = TEMPLATES[card.template];
    if (template) return { template, params: { ...(card.params ?? {}) } };
  }
  const def = (() => { try { return getSkillDefinition(defId); } catch { return null; } })();
  const sid = SERIES_SPELLS[def?.series];
  const template = sid ? TEMPLATES[sid] : null;
  return template ? { template, params: {} } : null;
}

// ---- 刀光方向语义（2026-09-30 用户定：伤害节拍驱动——伤害量在那里才有真值，
// 且多段伤害逐拍触发 = 连击的「短促随机斜率连击」白送）----
// 语义源 = 卡名后缀（设计侧命名即数据）：…斩=竖劈斩、…劈=横扫劈、…刀舞=连击；
// 缺省斜置。数值为旋向弧度（正=顺时针）。
const SLASH_VARIANTS = {
  chop:  { angle: 1.38, ms: 320 },   // 斩：竖置（近垂直，微偏读作「劈落」）
  sweep: { angle: 0.10, ms: 340 },   // 劈：横置
  combo: { jitter: 0.85, ms: 210 },  // 刀舞：逐击随机斜率 + 短促
  diagonal: { angle: -0.30, ms: 300 }, // 缺省
};

/**
 * 刀法卡的刀光方向变体：defId → { angle | jitter, ms }。
 * 返回 null = 非刀法卡（不出刀光）。
 */
export function resolveSlashVariant(defId) {
  let def = null;
  try { def = getSkillDefinition(defId); } catch { return null; }
  if (!def || def.series !== 'blade') return null;
  const name = def.name ?? '';
  if (name.includes('刀舞')) return { ...SLASH_VARIANTS.combo };
  if (name.endsWith('劈')) return { ...SLASH_VARIANTS.sweep };
  if (name.endsWith('斩') || name.endsWith('爆斩')) return { ...SLASH_VARIANTS.chop };
  return { ...SLASH_VARIANTS.diagonal };
}

/**
 * 伤害量 → 刀光尺寸系数（模板参数化的起效案例：伤害越高刀光越大）。
 * 基准 18 伤害 = 1.0（同阶白板刀伤量级），开方压曲线（大伤害不糊屏）。
 */
export function slashScaleFor(dealt) {
  if (!Number.isFinite(dealt) || dealt <= 0) return 1.0;
  return Math.min(2.1, Math.max(0.7, Math.sqrt(dealt / 18)));
}

/**
 * 在 ANIM_SKILL_USED 节拍内跑一次施术演出。
 * @returns {null | { done: Promise }} null = 未命中模板（调用方走 BASE 行为）；
 *   done = 协程整体落定（含 notify 之后的余烬段——调用方不必等它）
 */
export function runSpellFx({ defId, deps, notify }) {
  const hit = resolveSpellFx(defId);
  if (!hit) return null;
  let notified = false;
  const notifySafe = () => { if (!notified) { notified = true; try { notify?.(); } catch (_) {} } };
  const fn = hit.template.build(hit.params);
  const h = runScript(async (ctx) => {
    try {
      await fn(ctx, deps, notifySafe);
    } finally {
      notifySafe();   // 模板忘调/异常/被杀：兜底必达，不 Jam 节拍链
    }
  }, { animator: deps.animator ?? null });
  // 节拍保险丝（ANIM_TIMING.SKILL_USED = 5s）强杀指令时协程由舞台 dispose 链兜底收
  return { done: h.promise };
}

/**
 * 战斗开场按卡组预告预热（shader 变体 compileAsync——Boss 房 charBurn 预热同款
 * 机制；先锋模板全是内建材质+现役粒子类型，暂无要预热的变体，机制先就位）。
 * @param {string[]} deckDefIds 卡组 defId 列表
 * @param {object} deps 舞台服务袋（renderer/scene）
 */
export function warmSpellFx(deckDefIds, deps) {
  const seen = new Set();
  for (const id of deckDefIds ?? []) {
    const hit = resolveSpellFx(id);
    if (!hit || seen.has(hit.template)) continue;
    seen.add(hit.template);
    try { hit.template.warm?.(deps); } catch (err) {
      console.warn('[fx/spells] 模板预热异常（忽略）：', err);
    }
  }
}
