// 伤害演出配方表（fx 架构「配方」筐的首个落地）：
// 高频同构演出（每次伤害命中）走查表，不再在 BattleStage 里写内联魔法数。
// 决议链：BASE（主级默认 = 现行暖红模板）
//   → TAG 主题覆写（payload.tags 首个命中：burn/poison/thorns/blood/miracle…）
//   → SERIES 主题覆写（payload.skillDefId → 技能注册表反查 series，如刀法银白斩痕）
//   → MINOR 降规格覆写（payload.type==='minor'：小数字、无击退、无震荡、无闪红、
//     短节拍——附级伤害「减法即丰富」，hit-fx 方案第 1 层落地）
//   → KILL 加重覆写（payload.killed：震荡加成、数字放大）
// 调视觉参数只改本文件；新增体系/标签主题 = 表里加一行。
import { getSkillDefinition } from '../../core/skills/registry.js';
import { makeBodyFlames } from './bodyFlames.js';
import { makeVaporPlumes } from './vaporPlumes.js';
import { makeStasisShell } from './stasisShell.js';
import { makeStunStars } from './stunStars.js';
import gsap from 'gsap';

// 主级默认模板（与 _damageHit 现行参数逐项对齐——默认路径零回归）
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
    // DoT tick 专属演出（runDotTickBeat，fire-and-forget）：燃烧 = 脚下小火腾起 +
    // 上升余烬 + 暖灯闪；中毒 = 毒液飞溅坠落 + 病绿蒸气 + 绿灯闪。中毒另配立牌
    // 短暂染绿（flash 在 minor 路径的还原时点在节拍末尾——见 units.js）
    if (tagKey === 'burn' || tagKey === 'poison') r.tick = tagKey;
    if (tagKey === 'poison') r.flash = 0x4f9a55;
  }
  if (payload.killed) {
    r.shakeBonus = KILL.shakeBonus;
    r.numberScale = KILL.numberScale;
  }
  return r;
}

// ============ 常驻 aura 配方（fx 架构「附件」筐，Phase 2）============
// 单位的常驻状态 FX（buff 光环等）同样查表：效果投影 → aura 定义。
// aura 定义挂进 AuraHost（fx/aura.js）——状态机/过渡纪律见该文件；这里只产数据。
// 铁律：aura 由**显示状态 diff** 驱动（sync 节拍对账），不订阅 core 事件——
// 观战端经同一份 state sync 自动一致。enter/exit 是 fire-and-forget 短过渡，不进节拍。

// 单位 aura 主题表（VFX 结构大更新 Phase 2，升级为层级/槽位声明）：
// effectId → { layer, build, levelOf, body?, emitter? }。aura def 退化成纯「槽位导演」——
// 建件收件全在 UnitFxLayer（一效果一槽位，key = effectId），def 的 enter/update/exit
// 只推 level 标量。字段口径：
//   layer   目标层级 1|2|3（L0 本体层无几何件，经 body 键推 uniform）
//   build   建件器 (layer) => 句柄|null（headless 返 null，幂等挂层）
//   levelOf 层数 → 强度标量（stacks 缺席按 1 计；enter/update 共用此口径）
//   body    可选：level 同时推 L0 本体补丁的同名 uniform（burn→uBurn / poison→uPoison）
//   bodyCalm 可选：燃烧专属——deps.calm（火焰亲和在场）推 L0 的 uCalm（可控的火）
//   enterDur/exitDur 可选：赋予/消除过渡时长（level 斜坡本身即过渡演出的驱动——
//           燃烧 0.7/0.9：碳化扩张 + 火舌 stagger；凝滞 0.55/0.7：结晶前锋扫掠/消退；
//           中毒 0.6/0.7：浸润前锋漫升/退潮 + 毒雾逐股浮现；眩晕 0.4/0.5：星星逐颗
//           弹入/缩没。各件的过渡造型由 level 标量在 shader/tick 里派生）
//   emitter 可选：附带点粒子发射参数（粒子进全局 Points 池；gravity 为正 = 上飘，
//           yOff = 发射位相对单位脚底的抬升，radius = 发射位抖动）
//   gpuEmit 可选：GPU 粒子池联动（'burn' = 燃烧图集发射，见 fx/gpu/burnSparks.js）——
//           GPU 池就位时优先于 emitter（emitter 字段留作能力降级的回退路径）
const UNIT_AURA_THEMES = {
  burn: {
    layer: 1,
    build: (layer) => makeBodyFlames(layer, { color: 0xff8a3a }),
    // 层数 → 烧灼进度（境界锚点）：
    //   3 层 0.29（局部碳化 + 火星，可读）｜ 30 层 0.67（烧透橙红，只留少部分原纹理）｜
    //   60 层 1.0（白炙，HDR 过阈交 bloom）；30 层内线性，30→60 走余量段，60 后封顶
    levelOf: (s) => {
      const n = s ?? 1;
      return n <= 30 ? 0.25 + n * 0.014 : Math.min(0.67 + (n - 30) / 30 * 0.33, 1);
    },
    body: 'uBurn',
    bodyCalm: true,
    enterDur: 0.7,
    exitDur: 0.9,
    gpuEmit: 'burn', // 火星走 GPU 池（发射源 = 燃烧图集：活动火线处起飞、随风飘散）
    emitter: { rate: 14, color: 0xff7a30, speed: 7, ttl: 0.9, gravity: 9, size: 1.3, radius: 1.4, yOff: 1.5 },
  },
  poison: {
    layer: 1,
    build: (layer) => makeVaporPlumes(layer, { color: 0x7fe06a }),
    levelOf: (s) => Math.min(0.3 + (s ?? 1) * 0.05, 0.8),
    body: 'uPoison',
    enterDur: 0.6, // 浸润前锋漫升 + 毒雾逐股浮现（unitBodyFx 毒段 / vaporPlumes stagger）
    exitDur: 0.7,
    emitter: { rate: 5, color: 0x7fe06a, speed: 3.5, ttl: 1.2, gravity: 4, size: 1.5, radius: 1.2, yOff: 2.0 },
  },
  stasis: {
    layer: 2,
    build: (layer) => makeStasisShell(layer),
    levelOf: () => 0.9, // ⚠ stasisShell 结晶前锋按 /0.9 归一——改稳态值要同步改 shader
    enterDur: 0.55, // 结晶前锋自下而上扫过（stasisShell front 段）
    exitDur: 0.7,
  },
  stun: {
    layer: 3,
    build: (layer) => makeStunStars(layer),
    levelOf: () => 1,
    enterDur: 0.4, // 星星逐颗弹入 + 转速渐入（stunStars backOut/phase）
    exitDur: 0.5,
  },
};

// 通用 aura 工厂（Phase 2）：主题声明 → 槽位导演 def。enter 渐升 / update 追层数
// （AuraHost 的 set() 只管增删，存续 aura 的强度由同步侧逐个调 def.update）/
// exit 渐熄（teardown 时 dispose 归零收尸）。
function makeAuraDef(effectId, theme, { particles, unit, calm, gpu }) {
  const fxLayer = unit._fxLayer; // UnitFxLayer（UnitObject 构造时自建）
  // GPU 粒子联动：gpuEmit 主题且 GPU 池就位时走 GPU 发射（燃烧火星
  // 从火缘起飞、随风飘散）；否则回退旧 CPU emitter（能力降级/headless 假 renderer）
  const useGpu = !!theme.gpuEmit && !!gpu;
  const spawnAt = theme.emitter && !useGpu
    ? () => particles.spawnEmitter(
        unit.position.x, unit.position.y + theme.emitter.yOff,
        { ...theme.emitter, rate: 0, z: unit.position.z }, // rate 从 0 起，enter 渐升
      )
    : null;
  // level → 槽位 + L0 uniform 落地（补间 onUpdate 与 update 钩共用这一个落笔点）
  const applyLevel = (aura) => {
    const l = aura.data.level ?? 0;
    fxLayer.setLevel(effectId, l);
    if (theme.body) fxLayer.body[theme.body].value = l;
    if (theme.bodyCalm) fxLayer.body.uCalm.value = calm ? 1 : 0; // 火焰亲和：可控的火
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
  const rampRate = spawnAt ? (aura) => new Promise((resolve) => {
    gsap.to(aura.data.emitter, {
      rate: theme.emitter.rate, duration: 0.4, ease: 'power1.out', overwrite: 'auto',
      onComplete: resolve, onInterrupt: resolve, // 被顶掉也要落地：enter 的 Promise.all 靠它转态
    });
  }) : null;
  return {
    enter(aura) {
      fxLayer.overlay(effectId, theme.layer, theme.build); // 幂等建件（headless → null 句柄）
      if (useGpu) gpu.burnAddUnit(unit); // GPU 联动：注册进燃烧图集（幂等）
      else if (spawnAt) aura.data.emitter = spawnAt();
      aura.data.level = 0;
      return Promise.all([
        rampLevel(aura, aura.data.target ?? theme.levelOf(1), theme.enterDur ?? 0.45),
        rampRate ? rampRate(aura) : Promise.resolve(),
      ]);
    },
    // 强度追层数（同步侧钩；gsap 同属性补间顶掉在途——entering 中也平滑改道）
    update(aura, e) {
      aura.data.target = theme.levelOf(e?.stacks ?? 1);
      // 亲和每拍直推（不走进场补间）：BattleStage 每 sync 用本批新建的 def 调 update，
      // 闭包里的 calm 常新——flameAffinity 后到/先消都即时生效
      if (theme.bodyCalm) fxLayer.body.uCalm.value = calm ? 1 : 0;
      rampLevel(aura, aura.data.target, 0.35);
    },
    // exit 打断重挂（aura 纪律②）：emitter 已 stop 需重建；level 直接回 target
    reenter(aura) {
      fxLayer.overlay(effectId, theme.layer, theme.build);
      if (useGpu) gpu.burnAddUnit(unit); // 幂等
      else if (spawnAt && !aura.data.emitter) {
        aura.data.emitter = spawnAt();
        rampRate(aura);
      }
      return rampLevel(aura, aura.data.target ?? theme.levelOf(1), 0.3);
    },
    // 软退出：停发射 + level 渐熄（teardown 由 AuraHost 收尾，dispose 钩清场）
    exit(aura) {
      if (useGpu) gpu.burnRemoveUnit(unit);
      aura.data.emitter?.stop();
      aura.data.emitter = null;
      return rampLevel(aura, 0, theme.exitDur ?? 0.55);
    },
    dispose(aura) {
      gsap.killTweensOf(aura.data);
      if (useGpu) gpu.burnRemoveUnit(unit);
      aura.data.emitter?.stop();
      aura.data.emitter = null;
      fxLayer.clear(effectId);
      if (theme.body) fxLayer.body[theme.body].value = 0; // 防御性归零（材质随单位消亡）
      if (theme.bodyCalm) fxLayer.body.uCalm.value = 0;
    },
  };
}

/**
 * 由单位效果投影 diff 出应有 aura 集合。
 * @param {Array} effects 投影效果列表 [{ effectId, stacks, ... }]
 * @param {object} deps { particles, unit }（unit = UnitObject，读 position/z/_fxLayer）
 * @returns Map<auraKey, auraDef>
 */
export function resolveUnitAuras(effects, deps) {
  const out = new Map();
  // 火焰亲和在场 → 燃烧的火更可控（烧碳收敛、火势放缓；经 deps.calm 进 aura def）
  const calm = (effects ?? []).some(e => e?.effectId === 'flameAffinity' && (e.stacks ?? 0) > 0);
  for (const e of effects ?? []) {
    const theme = UNIT_AURA_THEMES[e?.effectId];
    if (!theme || (e.stacks ?? 0) <= 0) continue;
    out.set(e.effectId, makeAuraDef(e.effectId, theme, { ...deps, calm }));
  }
  return out;
}
