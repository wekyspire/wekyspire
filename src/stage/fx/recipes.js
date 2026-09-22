// 伤害演出配方表（fx 架构「配方」筐的首个落地，2026-09-22）：
// 高频同构演出（每次伤害命中）走查表，不再在 BattleStage 里写内联魔法数。
// 决议链：BASE（主级默认 = 2026-09 现行暖红模板）
//   → TAG 主题覆写（payload.tags 首个命中：burn/poison/thorns/blood/miracle…）
//   → SERIES 主题覆写（payload.skillDefId → 技能注册表反查 series，如刀法银白斩痕）
//   → MINOR 降规格覆写（payload.type==='minor'：小数字、无击退、无震荡、无闪红、
//     短节拍——附级伤害「减法即丰富」，2026-09-19 hit-fx 方案第 1 层落地）
//   → KILL 加重覆写（payload.killed：震荡加成、数字放大）
// 调视觉参数只改本文件；新增体系/标签主题 = 表里加一行。
import { getSkillDefinition } from '../../core/skills/registry.js';

// 主级默认模板（与 2026-09 _damageHit 现行参数逐项对齐——默认路径零回归）
const BASE = {
  flash: 0xff2222,
  sparks: [
    { count: 24, color: 0xff6a3d, speed: 22, size: 1.6 },
    { count: 10, color: 0xffd9a0, speed: 30, ttl: 0.8, size: 1.1 },
  ],
  number: {
    base: 34, per: 2.4, max: 96,
    ttlBase: 0.85, ttlPer: 0.02, ttlMax: 1.3,
    color: '#ff4d4d', vy: 22, scalePop: 0.5,
  },
  knockback: true,
  shakeScale: 1,
  beatMs: 80,          // 无击退路径的节拍停留（全吸收/无生命值伤害）
};

// 附级降规格覆写（燃烧/中毒/荆棘 tick、终止群伤、瑞米协战……）
const MINOR = {
  flash: null,          // 不翻红
  sparks: null,         // null = 用标签单色小火花（由 _minorSparks 生成）
  number: {
    base: 20, per: 0.8, max: 30,
    ttlBase: 0.7, ttlPer: 0, ttlMax: 0.8,
    color: '#c9d4e8', vy: 14, scalePop: 0.25,
  },
  knockback: false,
  shakeScale: 0,        // 无震荡
  beatMs: 90,
};

// 致命击加重
const KILL = { shakeBonus: 2, numberScale: 1.3 };

// 标签主题（附级伤害的主要配色来源；spark = 火花色，number = 数字色）
const TAG_THEMES = {
  burn:   { spark: 0xff8c3a, number: '#ff9a4d' },
  poison: { spark: 0x7fe06a, number: '#93e57d' },
  thorns: { spark: 0xd8c25a, number: '#e3d06e' },
  blood:  { spark: 0xc23a3a, number: '#d06565' },
  miracle:{ spark: 0xffd34c, number: '#ffd97a' },
  aoe:    { spark: 0xffa060, number: '#ffb080' },
};

// 体系主题（主级直伤的差异化：斩系银白斩痕）
const SERIES_THEMES = {
  blade: {
    flash: 0xeaf2ff,
    sparks: [
      { count: 16, color: 0xcfd8ea, speed: 34, size: 1.2 },
      { count: 8, color: 0xffffff, speed: 44, ttl: 0.5, size: 0.9 },
    ],
    number: { color: '#eef3ff' },
  },
};

function minorSparks(color) {
  return [{ count: 8, color, speed: 12, size: 1.0, ttl: 0.5 }];
}

/**
 * 由 ANIM_DAMAGE payload 决议演出配方。
 * @param {object} payload { dealt, shieldAbsorbed, pierce, type?, tags?, skillDefId?, killed? }
 * @returns 配方（纯数据）：{ flash, sparks, number, knockback, shakeScale, shakeBonus,
 *                           numberScale, beatMs, tier }
 */
export function resolveDamageRecipe(payload = {}) {
  const tier = payload.type === 'minor' ? 'minor' : 'major';
  const r = {
    ...BASE,
    number: { ...BASE.number },
    sparks: BASE.sparks.map(s => ({ ...s })),
    shakeBonus: 0,
    numberScale: 1,
    tier,
  };

  // 标签主题（首个命中）
  const tags = payload.tags ?? [];
  const tagKey = tags.find(t => TAG_THEMES[t]);
  const tagTheme = tagKey ? TAG_THEMES[tagKey] : null;

  // 体系主题（skillDefId 反查 series）
  const series = payload.skillDefId ? getSkillDefinition(payload.skillDefId)?.series : null;
  const seriesTheme = series ? SERIES_THEMES[series] : null;

  if (tagTheme) {
    r.number.color = tagTheme.number;
  }
  if (seriesTheme) {
    if (seriesTheme.flash !== undefined) r.flash = seriesTheme.flash;
    if (seriesTheme.sparks) r.sparks = seriesTheme.sparks.map(s => ({ ...s }));
    if (seriesTheme.number) r.number = { ...r.number, ...seriesTheme.number };
  }
  if (tier === 'minor') {
    r.flash = MINOR.flash;
    r.number = { ...MINOR.number, color: tagTheme?.number ?? MINOR.number.color };
    // 附级一律单色小火花（标签色，无标签中性灰蓝）——减法即丰富，体系火花让位
    r.sparks = minorSparks(tagTheme?.spark ?? 0xaab6cc);
    r.knockback = MINOR.knockback;
    r.shakeScale = MINOR.shakeScale;
    r.beatMs = MINOR.beatMs;
  }
  if (payload.killed) {
    r.shakeBonus = KILL.shakeBonus;
    r.numberScale = KILL.numberScale;
  }
  return r;
}
