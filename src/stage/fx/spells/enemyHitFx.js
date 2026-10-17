// 敌方攻击命中演出：与玩家卡 damageFx.js 同位的
// 「敌方来源」决议器——_damageHit 在 resolveDamageFx（玩家技能表）落空时回落到这里。
// 三式：normal（普攻撞击）/ rapid（连击小快）/ heavy（重击大冲击+震屏+尘）。
// 判据优先级：ENEMY_HIT_SPELLS 逐敌覆写 → 伤害 tags['heavy']（内容数据，长期正解）
// → 怪意图（预告 damage 阈值判重击、hits≥2 判连击——**怪的出力口径**，与玩家侧
// 格挡/虚弱无关）→ 意图缺失时同源时间窗连拍兜底。
// 配色走暗铜橙系——与玩家拳的白亮（帅）和受击红闪（疼）三方都不同调（威胁）。
import { punchImpact, screenFlash } from './blocks.js';
import { punchScaleFor } from './damageFx.js';
import { unitH } from '../scripts/enemies/fxPieces.js';

// 逐敌覆写（未来特殊敌人）：defId → 'none'（关闭）| { tier: 'normal'|'rapid'|'heavy', ...params }
export const ENEMY_HIT_SPELLS = Object.freeze({
});

// 逐敌专属命中 beat（Boss 主题化）：defId → async (ctx, deps, {fx, unit, dealt, fromX})。
// fx.tier 仍是三档决议（normal/rapid/heavy），Boss beat 只换视觉皮（palette + garnish），
// 共享底座是导出的 enemyImpactBeat。注册口给 fx/scripts/bosses/ 一文件一 Boss
// （内容归属原则）；未注册 = 三式通配。注册随 BattleStage 模块加载发生，早于任何战斗。
const ENEMY_HIT_BEATS = new Map();
export function registerEnemyHitBeat(defId, fn) { ENEMY_HIT_BEATS.set(defId, fn); }

// 小怪命中主题表（2026-10-15 敌人演出批）：defId → { pal, garnish }——
// 不重写 beat 编排（三式底座不动），只换命中瞬间的配色与主题附加粒子。
// pal 键对位 enemyImpactBeat 的 pal 参数（color/hot/rim/sparkColor/dustColor 等）；
// garnish(ctx, deps, {unit, at, heavy, dealt, swing, s}) = 命中一拍的种族附加件
// （在冲击主体之前起跑，fire-and-forget）。内容注册在 fx/scripts/enemies/。
const ENEMY_HIT_THEMES = new Map();
export function registerEnemyHitTheme(defId, theme) { ENEMY_HIT_THEMES.set(defId, theme); }

// 远程型敌人名单：命中拍的「蓄势后拉 → 发力突进」对它们是错语言（施法者/射击机器/
// 扎根植物不扑人——身体语言由 act 起手的投射物承担）。注册口同在 fx/scripts/bosses/。
const ENEMY_NO_LUNGE = new Set();
export function registerEnemyNoLunge(defId) { ENEMY_NO_LUNGE.add(defId); }
export function enemyLungeSuppressed(defId) { return ENEMY_NO_LUNGE.has(defId); }

// 逐敌突进覆写：defId → { approach(ctx, deps, g), recover(ctx, deps, g) }，
// g = { src, sx, sy, sz, ux, uz, reach, dist, unit }。契约同通用三段：approach
// 在命中前 await 演完（末帧 = 锋尖抵近，受击演出自此起），recover 返回 promise
// 与受击并行收尾；onKill 自理归位归零。签名飞行语言（史莱姆跳扑等，
// ENEMY_FX.md）注册在 fx/scripts/enemies/。
const ENEMY_LUNGE_OVERRIDES = new Map();
export function registerEnemyLunge(defId, choreo) { ENEMY_LUNGE_OVERRIDES.set(defId, choreo); }
export function enemyLungeOverrideOf(defId) { return ENEMY_LUNGE_OVERRIDES.get(defId) ?? null; }

// 重击内容数据标签（DealDamageInstruction tags）：敌方 def 的 act 里提交伤害时
// 带上即入重击档——意图 note 里的「重击」文案不进演出判定（文案解析脆）。
export const HEAVY_TAG = 'heavy';

// 重击意图阈值（intention.damage ≥ 此值）：口径 = 预告面板伤害（含攻击面板加成）。
// 章1 普攻预告 4–10 / 明示重击 13、18——阈值 14 让重击越过、普攻不误入；
// 数值通胀的章节优先走 tags 内容数据（阈值只是通配兜底）
const HEAVY_INTENT_FALLBACK = 14;
// 同源连拍窗口：意图快照缺失时连击的兜底判据（敌方多段攻击逐拍间隔约 0.7–1s）
const RAPID_WINDOW_MS = 1200;

/**
 * 敌方来源的伤害节拍决议：payload + 意图 → { tier, ...params } | null。
 * 只接「敌方 + 主级」——附级 tick（燃烧/中毒/荆棘）与环境伤害（source 为 null）
 * 不给；玩家卡来源在调用方已被 resolveDamageFx 优先接管。**不按 dealt 门控**：
 * 命中演出是攻击方施加的特效，被护盾整吞（dealt=0）与被闪避（dodged 拍）都照播
 * ——量级由调用方另传 swing（出手重量）决定，不由实际生命损失决定。
 * intention = 快照里该敌人的本次行动预告（伤害拍时点尚未刷新，仍是本次值）。
 */
export function resolveEnemyHitFx(stage, payload, dealt, intention = null) {
  if (payload?.source?.side !== 'enemy') return null;
  if ((payload?.type ?? 'major') !== 'major') return null;

  const defId = payload.source.defId ?? null;
  const override = ENEMY_HIT_SPELLS[defId];
  if (override === 'none') return null;
  // 小怪命中主题（pal/garnish 参数行）：与 tier/beat 合并进 fx 描述符
  const theme = ENEMY_HIT_THEMES.get(defId) ?? null;
  if (override) return { tier: override.tier ?? 'normal', beat: ENEMY_HIT_BEATS.get(defId), ...theme, ...override };

  const tags = payload?.tags ?? [];
  const beat = ENEMY_HIT_BEATS.get(defId);
  if (tags.includes(HEAVY_TAG)) return { tier: 'heavy', beat, ...theme };

  // 意图口径（主判据）：重击 = 预告伤害够大；连击 = 意图 hits ≥ 2
  if (typeof intention?.damage === 'number' && intention.damage >= HEAVY_INTENT_FALLBACK) {
    return { tier: 'heavy', beat, ...theme };
  }
  if ((intention?.hits ?? 0) >= 2) return { tier: 'rapid', beat, ...theme };

  // 意图缺失兜底：同源连拍记账（窗内第 2 拍起 = 连击式）
  const now = performance.now();
  if (!stage._enemyHitRecent) stage._enemyHitRecent = new Map();
  const srcId = payload.source.uniqueID;
  const last = stage._enemyHitRecent.get(srcId);
  const inWindow = last != null && now - last.t <= RAPID_WINDOW_MS;
  stage._enemyHitRecent.set(srcId, { t: now, n: inWindow ? last.n + 1 : 1 });

  if (inWindow && last.n >= 1) return { tier: 'rapid', beat, ...theme };
  return { tier: 'normal', beat, ...theme };
}

// 三式配方：量级对齐玩家拳（punchImpact 同款下限口径）——敌侧立牌远、玩家侧
// 像素密度低，敌方冲击压得比玩家拳还小会读不出「被打了」
const ENEMY_HIT_TIERS = Object.freeze({
  normal: { scaleK: 1.05, ms: 240, sparkCount: 14, lampIntensity: 620 },
  rapid:  { scaleK: 0.80, ms: 170, sparkCount: 8,  lampIntensity: 400 },
  heavy:  { scaleK: 1.50, ms: 360, sparkCount: 30, lampIntensity: 1100 },
});

/**
 * 跑一次敌方命中演出（units.js _damageHit 经 _fxRunScript 调用，fire-and-forget
 * 不占节拍时序——突进/击退/红闪等受击既有演出照常并行）。
 * fx.beat（Boss 主题注册）优先；缺省走三式通配。
 */
export async function runEnemyHitBeat(ctx, deps, args) {
  const { fx, unit } = args;
  if (!fx || !unit) return;
  if (fx.beat) { await fx.beat(ctx, deps, args); return; }
  // 小怪命中主题行（pal/garnish）经 fx 描述符流入三式底座
  await enemyImpactBeat(ctx, deps, { ...args, pal: fx.pal ?? {}, garnish: fx.garnish ?? null });
}

/**
 * 三式通用配方（Boss 主题 beat 的共享底座）：punchImpact 主体 + 重击段（震屏/落地尘/
 * 暖闪）。pal 覆盖档位默认（palette/量级），garnish = 命中瞬间的主题附加粒子
 * （重击/普击分别给），都在 punchImpact 之前起跑（fire-and-forget 叠在冲击上）。
 */
export async function enemyImpactBeat(ctx, deps, { fx, unit, dealt, swing = null, fromX = null, pal = {}, garnish = null }) {
  const t = ENEMY_HIT_TIERS[fx.tier] ?? ENEMY_HIT_TIERS.normal;
  const s = unit._baseScale ?? 1;
  const at = { x: unit.position.x, y: unit.position.y + unitH(unit) * 0.50, z: unit.position.z }; // 中弹位=躯干
  const dir = fromX != null ? Math.sign(unit.position.x - fromX) || 1 : 1;
  const heavy = fx.tier === 'heavy';
  // 量级按 swing（出手重量，盾吞/闪避时 = gross）——dealt=0 不缩成无物
  const mag = swing ?? dealt;
  if (garnish) {
    try { garnish(ctx, deps, { unit, at, heavy, dealt, swing: mag, s }); } catch { /* 主题附加件失败不拦冲击主体 */ }
  }
  await punchImpact(ctx, deps, {
    at, dir,
    scale: Math.max((pal.scaleK ?? t.scaleK) * punchScaleFor(mag, heavy), 0.9),
    ms: pal.ms ?? t.ms,
    color: pal.color ?? (heavy ? [1.0, 0.44, 0.22] : [1.0, 0.62, 0.30]),
    hot: pal.hot ?? (heavy ? [1.25, 0.72, 0.42] : [1.15, 0.85, 0.52]),
    rim: pal.rim ?? [0.95, 0.62, 0.40],
    sparkColor: pal.sparkColor ?? (heavy ? 0xff8a4a : 0xe8a860),
    sparkCount: pal.sparkCount ?? t.sparkCount,
    sparkSpeed: pal.sparkSpeed ?? (heavy ? 24 : 16),
    lampIntensity: pal.lampIntensity ?? t.lampIntensity,
  });
  if (heavy) {
    // 重击的「地动山摇」：震屏 + 落地尘 + 轻微暖闪（比玩家重拳的量级收一档）
    const feet = { x: unit.position.x, y: unit.position.y + 0.6 * s, z: unit.position.z };
    deps.particles?.spawn?.(feet.x, feet.y, {
      color: pal.dustColor ?? 0xb8a98c, count: 14, speed: 10, size: 1.1, ttl: 0.9, gravity: -10, z: feet.z,
    });
    deps.shake?.impulse?.(pal.shakeK ?? 1.5);
    deps.shake?.sustain?.(0.45);
    ctx.onKill(() => deps.shake?.sustain?.(0));
    ctx.spawn((c) => screenFlash(c, deps, { intensity: 0.18, ms: 200, color: pal.flashColor ?? 0xffd8b0 }));
    await ctx.wait(320);
    deps.shake?.sustain?.(0);
  }
}
