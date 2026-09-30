// 施术演出模板系统（spellFx，2026-09-30 用户定「动画逻辑生成器」架构）：
// 类比 PCG 管线（生成器 → 物体生成器 → SDK）的三层——
//   · 基础块 SDK：fx/spells/blocks.js（cardFlare/arcProjectile/impactBurst/slashSweep/
//     punchImpact/fireBurst/lightPillar…）
//   · 模板生成器：本目录一文件一模板，`build(params)` 拼装基础块产出「动画逻辑本身」
//   · 决议链 + 节拍接线：本文件管施术拍（BASE → SERIES_SPELLS → CARD_SPELLS，
//     挂 _skillDisplay 节拍）；**伤害拍**（命中那一刻）归 damageFx.js
//     （resolveDamageFx + runDamageBeat，挂 _damageHit 节拍）。
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
//   CARD_SPELLS[defId]（逐卡覆写：换模板或调参数）→ SERIES_SPELLS[series]
//   （体系级 { id, params }）→ null（BASE = _skillDisplay 现行为原样，零回归）。
//   参数合并 defaults ← 体系行 ← 逐卡行。观战兼容：模板选择只用 defId/series
//   （两端同 bundle 反查），wire 契约零改动。
import { getSkillDefinition } from '../../../core/skills/registry.js';
import { runScript } from '../script.js';
import { emberBurst } from './emberBurst.js';
import { castFlare } from './castFlare.js';
import { fireballCast } from './fireballCast.js';
import { fireRainCast } from './fireRainCast.js';
import { igniteCast } from './igniteCast.js';
import { heavenCleave } from './heavenCleave.js';

export { resolveDamageFx, runDamageBeat, slashScaleFor, punchScaleFor, fireScaleFor } from './damageFx.js';

// 模板注册表（一文件一模板，id 即登记键）
const TEMPLATES = {
  emberBurst, castFlare, fireballCast, fireRainCast, igniteCast, heavenCleave,
};

// 体系级映射（series → { id, params }）。命中本体全在伤害拍的体系挂 castFlare
// （起手色参数化）；投射物体系挂各自的 cast 模板（落点爆在伤害拍）。
const SERIES_SPELLS = {
  ember:         { id: 'emberBurst' },                                   // 余烬系（旧先锋模板整链）
  blade:         { id: 'castFlare', params: { flareColor: 0xcfd8ea } },  // 刀法：冷白起手
  fist:          { id: 'castFlare', params: { flareColor: 0xf2e7d2 } },  // 拳系：暖白起手
  punch:         { id: 'castFlare', params: { flareColor: 0xf2e7d2 } },  // 基石拳
  fireBall:      { id: 'fireballCast' },                                 // 火球链+蓄热火球
  firstStrike:   { id: 'fireballCast' },                                 // 先发火弹/火矢/火球
  fireRain:      { id: 'fireRainCast' },                                 // 火雨/火瀑
  ignite:        { id: 'igniteCast' },                                   // 点火/烈焰/炙焰/热浪
  burst:         { id: 'castFlare', params: { flareColor: 0xff9a3d } },  // 爆裂咏唱（新星在伤害拍）
  selfImmolate:  { id: 'castFlare', params: { flareColor: 0xffb066 } },  // 焰刃/玩火（火刀）
};

// 逐卡覆写（defId → { template, params }）：换模板或微调参数（同体系内单卡变体）。
const CARD_SPELLS = {
  // 火球链变体：连发双弹 / 大火球加重弹 / 白炽火球热核偏白
  fireBarrage:    { template: 'fireballCast', params: { shots: 2 } },
  greaterFireBall: { template: 'fireballCast', params: { size: 3.4, projMs: 380, arcH: 8 } },
  heatBallMaster: { template: 'fireballCast', params: { hot: [1.0, 0.95, 0.86], color: [1.0, 0.5, 0.2] } },
  // 先发链体量递进：小弹快掷 / 火矢平弧疾射 / 先发火球标准
  firstShot:      { template: 'fireballCast', params: { size: 1.7, projMs: 240, arcH: 3 } },
  firstArrow:     { template: 'fireballCast', params: { size: 1.4, projMs: 200, arcH: 1 } },
  // S/X 天斩：实体锁全演出（暗柱预兆→双脉冲→巨刃+冲天光柱）
  skyCleave:      { template: 'heavenCleave', params: { grade: 'S' } },
  godCleave:      { template: 'heavenCleave', params: { grade: 'X' } },
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
  const row = SERIES_SPELLS[def?.series];
  const template = row ? TEMPLATES[row.id] : null;
  return template ? { template, params: { ...(row?.params ?? {}) } } : null;
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
