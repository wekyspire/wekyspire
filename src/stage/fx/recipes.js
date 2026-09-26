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
import { attachBodyFlames } from './bodyFlames.js';
import gsap from 'gsap';

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

// ============ 常驻 aura 配方（fx 架构「附件」筐，2026-09-22 Phase 2）============
// 单位的常驻状态 FX（buff 光环等）同样查表：效果投影 → aura 定义。
// aura 定义挂进 AuraHost（fx/aura.js）——状态机/过渡纪律见该文件；这里只产数据。
// 铁律：aura 由**显示状态 diff** 驱动（sync 节拍对账），不订阅 core 事件——
// 观战端经同一份 state sync 自动一致。enter/exit 是 fire-and-forget 短过渡，不进节拍。

// 单位 aura 主题表：effectId → 发射参数（点粒子 emitter，粒子进全局 Points 池——
// 故 aura.group 对这类 aura 是空壳，视觉全在 emitter；sprite 类 aura 才用 group）。
// gravity 为正 = 上飘（y 向上）；yOff = 发射位相对单位脚底的抬升；radius = 发射位抖动。
// burn 另有本体（L0 unitBodyFx）与贴体叠火（L1 bodyFlames）两件——见 makeBurnAuraDef。
const UNIT_AURA_THEMES = {
  burn: { rate: 14, color: 0xff7a30, speed: 7, ttl: 0.9, gravity: 9, size: 1.3, radius: 1.4, yOff: 1.5 },
};

function makeUnitAuraDef(theme, { particles, unit }) {
  const spawnAt = () => particles.spawnEmitter(
    unit.position.x, unit.position.y + theme.yOff,
    { ...theme, rate: 0, z: unit.position.z }, // rate 从 0 起，enter 渐升
  );
  const ramp = (aura) => {
    // 进入渐升：直接补间 emitter.rate（句柄契约：rate 可变、逐帧生效）。
    // 裸 gsap 不经 ctx——aura 宿主被杀时 emitter 已随 dispose 关停，rate 残留无害。
    return new Promise((resolve) => {
      gsap.to(aura.data.emitter, { rate: theme.rate, duration: 0.4, ease: 'power1.out', onComplete: resolve });
    });
  };
  return {
    enter(aura) {
      aura.data.emitter = spawnAt();
      return ramp(aura);
    },
    // exit 打断重挂（aura 纪律②）：重建 emitter 并渐升
    reenter(aura) {
      aura.data.emitter = spawnAt();
      return ramp(aura);
    },
    // 软退出：停止发射，余烬按 ttl 自然衰减（~0.9s 内飘尽）——不额外播演出
    exit(aura) {
      aura.data.emitter?.stop();
      aura.data.emitter = null;
    },
    dispose(aura) {
      aura.data.emitter?.stop();
      aura.data.emitter = null;
    },
  };
}

// 燃烧 aura（Phase 1 重做，2026-09-26）：三通道合一——
//   L0 本体余烬（unitBodyFx 补丁的 uBurn：立绘自下而上泛橙红脉动）
//   L1 贴体叠火（bodyFlames：3 团 HDR sprite 火锚在下半身，过 bloom 阈真发光）
//   余烬粒子（旧 rate-14 emitter 保留：火屑上飘的纵深）
// 总控 level（0..1，stacks 映射）：enter 渐升 / **update 追层数**（AuraHost 的 set()
// 只管增删，存续 aura 的强度由同步侧逐个调 def.update——stacks 3→7 火焰随旺）/
// exit 渐熄（teardown 时 dispose 归零收尸）。
const BURN_LEVEL = (stacks) => Math.min(0.3 + (stacks ?? 1) * 0.07, 0.85);

function makeBurnAuraDef(theme, { particles, unit }) {
  const spawnAt = () => particles.spawnEmitter(
    unit.position.x, unit.position.y + theme.yOff,
    { ...theme, rate: 0, z: unit.position.z },
  );
  const rampRate = (aura) => new Promise((resolve) => {
    gsap.to(aura.data.emitter, {
      rate: theme.rate, duration: 0.4, ease: 'power1.out', overwrite: 'auto',
      onComplete: resolve, onInterrupt: resolve, // 被顶掉也要落地：enter 的 Promise.all 靠它转态
    });
  });
  // level → 三通道落地（补间 onUpdate 与 update 钩共用这一个落笔点）
  const applyLevel = (aura) => {
    const l = aura.data.level ?? 0;
    if (aura.data.bodyFx) aura.data.bodyFx.uBurn.value = l;
    aura.data.flames?.setLevel(l);
  };
  const rampLevel = (aura, target, dur) => new Promise((resolve) => {
    gsap.to(aura.data, {
      // overwrite: 后浪顶死前浪——exit(→0) 与 reenter/update(→target) 撞车时
      // 不顶掉的话，旧补间收尾段会把 level 拽回去（撞车闪烁病灶）；
      // onInterrupt 同样落地：被顶死的补间不许吞掉 Promise（enter 的转态全靠它）
      level: target, duration: dur, ease: 'power1.out', overwrite: 'auto',
      onUpdate: () => applyLevel(aura), onComplete: resolve, onInterrupt: resolve,
    });
  });
  return {
    enter(aura) {
      aura.data.bodyFx = unit._bodyFx ?? null; // BattleStage 建视图时挂的 L0 补丁
      aura.data.flames = attachBodyFlames(unit, { color: theme.color }); // headless → null
      aura.data.emitter = spawnAt();
      // 本体 uTime 只在 burn 存活期推进（熄灭即冻结，零空转）
      aura.data.untickBody = aura.data.bodyFx
        ? unit.addTick((dt) => { aura.data.bodyFx.uTime.value += dt; })
        : null;
      aura.data.level = 0;
      return Promise.all([rampLevel(aura, aura.data.target ?? 0.5, 0.45), rampRate(aura)]);
    },
    // 强度追层数（同步侧钩；gsap 同属性补间顶掉在途——entering 中也平滑改道）
    update(aura, e) {
      aura.data.target = BURN_LEVEL(e?.stacks ?? 1);
      rampLevel(aura, aura.data.target, 0.35);
    },
    // exit 打断重挂：emitter 已 stop 需重建；level 直接回 target
    reenter(aura) {
      if (!aura.data.emitter) {
        aura.data.emitter = spawnAt();
        rampRate(aura);
      }
      return rampLevel(aura, aura.data.target ?? 0.5, 0.3);
    },
    // 软退出：停发射 + 火焰渐熄（teardown 由 AuraHost 收尾，dispose 钩清场）
    exit(aura) {
      aura.data.emitter?.stop();
      aura.data.emitter = null;
      return rampLevel(aura, 0, 0.55);
    },
    dispose(aura) {
      gsap.killTweensOf(aura.data);
      aura.data.emitter?.stop();
      aura.data.untickBody?.();
      aura.data.flames?.dispose();
      if (aura.data.bodyFx) aura.data.bodyFx.uBurn.value = 0; // 防御性归零（材质随单位消亡）
      aura.data.flames = null;
      aura.data.bodyFx = null;
      aura.data.emitter = null;
    },
  };
}

/**
 * 由单位效果投影 diff 出应有 aura 集合。
 * @param {Array} effects 投影效果列表 [{ effectId, stacks, ... }]
 * @param {object} deps { particles, unit }（unit = UnitObject，读 position/z/_bodyFx）
 * @returns Map<auraKey, auraDef>
 */
export function resolveUnitAuras(effects, deps) {
  const out = new Map();
  for (const e of effects ?? []) {
    const theme = UNIT_AURA_THEMES[e?.effectId];
    if (!theme || (e.stacks ?? 0) <= 0) continue;
    out.set(e.effectId, e.effectId === 'burn'
      ? makeBurnAuraDef(theme, deps)
      : makeUnitAuraDef(theme, deps));
  }
  return out;
}
