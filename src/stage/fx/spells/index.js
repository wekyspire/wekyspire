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
import { fistCast } from './fistCast.js';
import { burnSurge } from './burnSurge.js';
import { sparkCast } from './sparkCast.js';
import { selfFlame } from './selfFlame.js';
import { fuelCast } from './fuelCast.js';
import { fireWhirlCast } from './fireWhirlCast.js';

export { resolveDamageFx, runDamageBeat, slashScaleFor, punchScaleFor, fireScaleFor } from './damageFx.js';

// 模板注册表（一文件一模板，id 即登记键）
const TEMPLATES = {
  emberBurst, castFlare, fireballCast, fireRainCast, igniteCast, heavenCleave,
  fistCast, burnSurge, sparkCast, selfFlame, fuelCast, fireWhirlCast,
};

// 体系级映射（series → { id, params }）。命中本体全在伤害拍的体系挂 castFlare
// （起手色参数化）；投射物体系挂各自的 cast 模板（落点爆在伤害拍）。
const SERIES_SPELLS = {
  ember:         { id: 'emberBurst' },                                   // 余烬系（旧先锋模板整链）
  blade:         { id: 'castFlare', params: { flareColor: 0xcfd8ea } },  // 刀法：冷白起手
  fist:          { id: 'fistCast' },                                     // 体修：拳风破空（四模式）
  punch:         { id: 'fistCast' },                                     // 基石拳同体修
  fireBall:      { id: 'fireballCast' },                                 // 火球链+蓄热火球
  firstStrike:   { id: 'fireballCast' },                                 // 先发火弹/火矢/火球
  fireRain:      { id: 'fireRainCast' },                                 // 火雨/火瀑
  ignite:        { id: 'igniteCast' },                                   // 点火/烈焰/炙焰/热浪
  burst:         { id: 'castFlare', params: { flareColor: 0xff9a3d } },  // 爆裂咏唱（新星在伤害拍）
  selfImmolate:  { id: 'castFlare', params: { flareColor: 0xffb066 } },  // 焰刃/玩火（火刀）
  // ---- 2026-10-02 火系铺量 ----
  burnDoubler:   { id: 'burnSurge' },                                    // 焚烧/焚天/星炎：燃烧翻倍
  spark:         { id: 'sparkCast' },                                    // 火花链（多段小伤连珠）
  fireWhirl:     { id: 'fireWhirlCast' },                                // 火焰旋风：主角火环外推
  flameHeal:     { id: 'selfFlame', params: {                            // 焰愈/浴火：金焰缠身
                     color: [1.0, 0.72, 0.30], hot: [1.2, 1.05, 0.70], ember: [1.0, 0.42, 0.08], core: 0xffc27a } },
  kindling:      { id: 'selfFlame', params: { scale: 0.7 } },            // 可燃血液（小）
  fever:         { id: 'selfFlame' },                                    // 急燃/高热/白炽
  fireWall:      { id: 'selfFlame', params: { scale: 0.7 } },            // 火盾/火墙/火壁
  magmaArmor:    { id: 'selfFlame', params: {                            // 熔岩铠甲：深红岩浆调
                     color: [0.9, 0.30, 0.10], hot: [1.1, 0.75, 0.40], ember: [0.8, 0.12, 0.02], core: 0xff5a2a } },
  patience:      { id: 'selfFlame', params: {                            // 血焰：深红
                     color: [0.95, 0.25, 0.12], hot: [1.1, 0.65, 0.45], ember: [0.75, 0.08, 0.05], core: 0xff4a3a } },
  willOWisp:     { id: 'selfFlame', params: {                            // 鬼火：青白冷焰
                     color: [0.45, 0.95, 0.70], hot: [0.80, 1.10, 0.95], ember: [0.15, 0.55, 0.35], core: 0x7affc8,
                     sparks: { color: 0x8affd0 } } },
  mirrorBurn:    { id: 'selfFlame' },                                    // 镜燃
  fireChant:     { id: 'selfFlame' },                                    // 燃心决/绝炎/火焰披风（自燃件）
  fuel:          { id: 'fuelCast' },                                     // 添柴/烧却/燎原：焚卡回蓝
  burnWind:      { id: 'fuelCast' },                                     // 焚风（焚牌抽牌）
  condense:      { id: 'igniteCast', params: { selfSparks: true } },     // 焰生链：点火+纳气
  shock:         { id: 'fireballCast', params: {                         // 爆裂冲击/轰灭：重弹平射
                     size: 2.8, projMs: 230, arcH: 1.5, color: [1.0, 0.36, 0.12], core: 0xff6a3d } },
  fireControl:   { id: 'castFlare', params: { flareColor: 0xff8a4d } },  // 控火术（0 费快件——短起手）
  fireControlFinder: { id: 'castFlare', params: { flareColor: 0xff8a4d } },
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
  // S/X 天斩：实体锁全演出 v2（压迫幕+fov 拉大+微震 → 白刃一闪+全屏白闪 →
  // 白金迸裂+冲天光柱+复原；击杀走立牌断裂两半）。A 摧山斩入档（轻量级）
  mountainCleave:  { template: 'heavenCleave', params: { grade: 'A' } },
  skyCleave:      { template: 'heavenCleave', params: { grade: 'S' } },
  godCleave:      { template: 'heavenCleave', params: { grade: 'X' } },
  // ---- 体修逐卡（2026-10-02）----
  // 重拳蓄力：崩/轰/炮/猛/真/虎/空形
  boomFist:       { template: 'fistCast', params: { mode: 'heavy' } },
  collapseFist:   { template: 'fistCast', params: { mode: 'heavy' } },
  cannonFist:     { template: 'fistCast', params: { mode: 'heavy' } },
  fierceFist:     { template: 'fistCast', params: { mode: 'heavy' } },
  trueFist:       { template: 'fistCast', params: { mode: 'heavy', gatherMs: 520 } },
  tigerFist:      { template: 'fistCast', params: { mode: 'heavy' } },
  emptyFist:      { template: 'fistCast', params: { mode: 'heavy', gatherMs: 560 } },   // S 空形拳
  fullCharge:     { template: 'fistCast', params: { mode: 'heavy', aoe: true } },      // 蓄满一击（群）
  fullChargePlus: { template: 'fistCast', params: { mode: 'heavy', aoe: true } },
  fullSpirit:     { template: 'fistCast', params: { mode: 'heavy', aoe: true, gatherMs: 500 } },  // 全神一击（群）
  // 连击多射：雨拳/乱拳/千手/万手
  rainFist:       { template: 'fistCast', params: { mode: 'rapid', shots: 3 } },
  wildFlurry:     { template: 'fistCast', params: { mode: 'rapid', shots: 3 } },
  thousandHands:  { template: 'fistCast', params: { mode: 'rapid', shots: 4, staggerMs: 80 } },
  myriadHands:    { template: 'fistCast', params: { mode: 'rapid', shots: 6, staggerMs: 65 } },   // S 万手
  // ---- 火系逐卡（2026-10-02）----
  burnBurstStar:  { template: 'burnSurge', params: { scale: 1.25 } },     // 星炎（×3，S）
  fireSpark:      { template: 'sparkCast', params: { shots: 4 } },        // 火花 C（3伤×4）
  blazingStream:  { template: 'sparkCast', params: { shots: 4 } },        // 火花 B（4伤×4）
  sparkStorm:     { template: 'sparkCast', params: { shots: 5, staggerMs: 85 } },  // 终极火花（×5）
  nirvana:        { template: 'selfFlame', params: { pillar: true, scale: 1.1,    // 涅槃（S）
                    color: [1.0, 0.72, 0.30], hot: [1.3, 1.1, 0.75], ember: [1.0, 0.42, 0.08], core: 0xffd27a } },
  bathFlame:      { template: 'selfFlame', params: { pillar: true, scale: 1.0,    // 浴火（A）
                    color: [1.0, 0.72, 0.30], hot: [1.2, 1.05, 0.70], ember: [1.0, 0.42, 0.08], core: 0xffc27a } },
  // 群燃件（对所有敌人施加燃烧）：逐敌点火种
  warmUp:         { template: 'igniteCast', params: { all: true } },
  dazzleEye:      { template: 'igniteCast', params: { all: true } },
  scorchBody:     { template: 'igniteCast', params: { all: true, selfSparks: true } },  // 灼身：己身也燃
  // 焚卡回蓝件的火咏唱变体
  smeltCard:      { template: 'fuelCast' },
  smeltCardPlus:  { template: 'fuelCast' },
  // 焚尽牌库/手牌的决绝件（depth）
  lastStand:      { template: 'fuelCast', params: { motes: 5, core: 0xff5a2a } },
  lastStandMaster: { template: 'fuelCast', params: { motes: 5, core: 0xff5a2a } },
  allIn:          { template: 'fuelCast', params: { motes: 6, core: 0xff5a2a } },
  // 庆典礼花（抽出所有爆裂术）：金焰缠身 + 火柱
  fireworkShow:   { template: 'selfFlame', params: { pillar: true, scale: 1.05,
                    color: [1.0, 0.75, 0.30], hot: [1.25, 1.1, 0.75], ember: [1.0, 0.45, 0.10], core: 0xffd27a,
                    sparks: { color: 0xffd27a, count: 24 } } },
  grandNewYear:   { template: 'selfFlame', params: { pillar: true, scale: 1.2,
                    color: [1.0, 0.70, 0.25], hot: [1.35, 1.15, 0.80], ember: [1.0, 0.40, 0.08], core: 0xffe08a,
                    sparks: { color: 0xffe08a, count: 30 } } },
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
  const fn = hit.template.build({ ...hit.params, _defId: defId });   // _defId：模板内反查 def（目标口径等）
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
