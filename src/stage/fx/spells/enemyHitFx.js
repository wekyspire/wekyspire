// 敌方攻击命中演出（2026-10-06 五模板通配方案）：与玩家卡 damageFx.js 同位的
// 「敌方来源」决议器——_damageHit 在 resolveDamageFx（玩家技能表）落空时回落到这里。
// 三式：normal（普攻撞击）/ rapid（连击小快）/ heavy（重击大冲击+震屏+尘）。
// 判据优先级：ENEMY_HIT_SPELLS 逐敌覆写 → 伤害 tags['heavy']（内容数据，长期正解）
// → 怪意图（预告 damage 阈值判重击、hits≥2 判连击——**怪的出力口径**，与玩家侧
// 格挡/虚弱无关）→ 意图缺失时同源时间窗连拍兜底。
// 配色走暗铜橙系——与玩家拳的白亮（帅）和受击红闪（疼）三方都不同调（威胁）。
import { punchImpact, screenFlash } from './blocks.js';
import { punchScaleFor } from './damageFx.js';

// 逐敌覆写（未来特殊敌人）：defId → 'none'（关闭）| { tier: 'normal'|'rapid'|'heavy', ...params }
export const ENEMY_HIT_SPELLS = Object.freeze({
});

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
 * 只接「敌方 + 主级 + 有生命值伤害」——附级 tick（燃烧/中毒/荆棘）与环境伤害
 * （source 为 null）不给；玩家卡来源在调用方已被 resolveDamageFx 优先接管。
 * intention = 快照里该敌人的本次行动预告（伤害拍时点尚未刷新，仍是本次值）。
 */
export function resolveEnemyHitFx(stage, payload, dealt, intention = null) {
  if (dealt <= 0) return null;
  if (payload?.source?.side !== 'enemy') return null;
  if ((payload?.type ?? 'major') !== 'major') return null;

  const defId = payload.source.defId ?? null;
  const override = ENEMY_HIT_SPELLS[defId];
  if (override === 'none') return null;
  if (override) return { tier: override.tier ?? 'normal', ...override };

  const tags = payload?.tags ?? [];
  if (tags.includes(HEAVY_TAG)) return { tier: 'heavy' };

  // 意图口径（主判据）：重击 = 预告伤害够大；连击 = 意图 hits ≥ 2
  if (typeof intention?.damage === 'number' && intention.damage >= HEAVY_INTENT_FALLBACK) {
    return { tier: 'heavy' };
  }
  if ((intention?.hits ?? 0) >= 2) return { tier: 'rapid' };

  // 意图缺失兜底：同源连拍记账（窗内第 2 拍起 = 连击式）
  const now = performance.now();
  if (!stage._enemyHitRecent) stage._enemyHitRecent = new Map();
  const srcId = payload.source.uniqueID;
  const last = stage._enemyHitRecent.get(srcId);
  const inWindow = last != null && now - last.t <= RAPID_WINDOW_MS;
  stage._enemyHitRecent.set(srcId, { t: now, n: inWindow ? last.n + 1 : 1 });

  if (inWindow && last.n >= 1) return { tier: 'rapid' };
  return { tier: 'normal' };
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
 */
export async function runEnemyHitBeat(ctx, deps, { fx, unit, dealt, fromX = null }) {
  if (!fx || !unit) return;
  const t = ENEMY_HIT_TIERS[fx.tier] ?? ENEMY_HIT_TIERS.normal;
  const s = unit._baseScale ?? 1;
  const at = { x: unit.position.x, y: unit.position.y + 4.9 * s, z: unit.position.z };
  const dir = fromX != null ? Math.sign(unit.position.x - fromX) || 1 : 1;
  const heavy = fx.tier === 'heavy';
  await punchImpact(ctx, deps, {
    at, dir,
    scale: Math.max(t.scaleK * punchScaleFor(dealt, heavy), 0.9),
    ms: t.ms,
    color: heavy ? [1.0, 0.44, 0.22] : [1.0, 0.62, 0.30],
    hot: heavy ? [1.25, 0.72, 0.42] : [1.15, 0.85, 0.52],
    rim: [0.95, 0.62, 0.40],
    sparkColor: heavy ? 0xff8a4a : 0xe8a860,
    sparkCount: t.sparkCount, sparkSpeed: heavy ? 24 : 16,
    lampIntensity: t.lampIntensity,
  });
  if (heavy) {
    // 重击的「地动山摇」：震屏 + 落地尘 + 轻微暖闪（比玩家重拳的量级收一档）
    const feet = { x: unit.position.x, y: unit.position.y + 0.6 * s, z: unit.position.z };
    deps.particles?.spawn?.(feet.x, feet.y, {
      color: 0xb8a98c, count: 14, speed: 10, size: 1.1, ttl: 0.9, gravity: -10, z: feet.z,
    });
    deps.shake?.impulse?.(1.5);
    deps.shake?.sustain?.(0.45);
    ctx.onKill(() => deps.shake?.sustain?.(0));
    ctx.spawn((c) => screenFlash(c, deps, { intensity: 0.18, ms: 200, color: 0xffd8b0 }));
    await ctx.wait(320);
    deps.shake?.sustain?.(0);
  }
}
