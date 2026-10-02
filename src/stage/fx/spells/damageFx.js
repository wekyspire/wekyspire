// 伤害节拍演出决议器（2026-09-30 刀光体系的泛化）：施术节拍（index.js 决议链）
// 管「怎么起手」，本文件管「命中那一刻长什么样」——伤害量/受击方位/攻击来向
// 这些**只在伤害节拍有真值**的语义都在这里消费（units.js _damageHit 钩子调用）。
//
// 决议输入 = 技能 defId（payload.skillDefId），输出 = { kind, ...params } 纯数据；
// kind → 基础块映射在 runDamageBeat。语义源：体系 series（主）+ 卡名（方向变体）。
// 多段伤害逐拍触发 = 连击/乱拳的密集命中白送（每拍独立缩放伤害量）。
import { getSkillDefinition } from '../../../core/skills/registry.js';
import { slashSweep, punchImpact, fireBurst, screenFlash, arcProjectile } from './blocks.js';
import { cartoonNova } from './cartoonNova.js';

// 爆裂术大爆炸的去重表（defId → 上次爆心演出的 performance.now()）
const _novaRecent = new Map();

/**
 * 爆裂术终止大爆（2026-10-02 用户定艺术方向）：敌方阵型中心一场**卡通烟云**
 * 大爆炸——黑烟云朵为主体（cartoonNova：法线混合暗色 puff + 描边 + 变色），
 * 配全屏暖白闪一瞬 + 灯池爆闪 + 重震屏。火球面片不上（写实湍流与卡通烟云
 * 风格打架）。粒子对象 fire-and-forget，本协程只管编排时序。
 */
async function novaBlast(ctx, deps, { at, scale = 1, spread = 0 }) {
  if (!at) return;
  // 要吞没的阵型横展（世界单位；单敌 = 14 保底宽度）——烟云横向散布的依据
  const width = Math.max(14, spread * 2 + 12);
  // 烟云协程直接挂本协程（ctx.spawn 会随父本收尾连杀——爆炸要比震屏活得久，
  // 收尾时 await 它）
  const novaP = cartoonNova(ctx, deps, {
    at: { x: at.x, y: at.y + 1.0, z: at.z }, scale, width,
  });
  // 白闪（一瞬）+ 灯爆 + 震屏（重击 + 短促持续微震）
  ctx.spawn((c) => screenFlash(c, deps, { intensity: 0.5, ms: 240, color: 0xffe0b0 }));
  const lamp = deps.cast?.get?.('light:fx0') ?? null;
  if (lamp) {
    lamp.color.setRGB(1.0, 0.62, 0.25);
    lamp.position.set(at.x, at.y, (at.z ?? 0) + 4);
    ctx.spawn(async (c) => {
      await c.tweenRaw(lamp, { intensity: 2600 * scale }, { durationMs: 90, ease: 'power2.out' });
      await c.tweenRaw(lamp, { intensity: 0 }, { durationMs: 620, ease: 'power2.in' });
    });
    ctx.onKill(() => { lamp.intensity = 0; });
  }
  deps.shake?.impulse?.(2.4 * scale);
  deps.shake?.sustain?.(0.8);
  ctx.onKill(() => deps.shake?.sustain?.(0));
  await ctx.wait(520);
  deps.shake?.sustain?.(0);
  await novaP;   // 烟云散净才收本协程
}

// ---- 刀光方向语义（卡名后缀 = 数据）：…斩=竖劈斩、…劈=横扫劈、…刀舞=连击；缺省斜 ----
const SLASH_VARIANTS = {
  chop:  { angle: 1.38, ms: 320 },   // 斩：竖置（近垂直，微偏读作「劈落」）
  sweep: { angle: 0.10, ms: 340 },   // 劈：横置
  combo: { jitter: 0.85, ms: 210 },  // 刀舞：逐击随机斜率 + 短促
  diagonal: { angle: -0.30, ms: 300 }, // 缺省
};

function slashVariantOf(def) {
  const name = def.name ?? '';
  if (name.includes('刀舞')) return { ...SLASH_VARIANTS.combo };
  if (name.endsWith('劈')) return { ...SLASH_VARIANTS.sweep };
  if (name.endsWith('斩') || name.endsWith('爆斩')) return { ...SLASH_VARIANTS.chop };
  return { ...SLASH_VARIANTS.diagonal };
}

// 焰刃配色（自焚系的火刀：红热→金热→白热三档，卡面语言直读）
const FLAME_BLADE_LOOKS = {
  redHotBlade:   { color: [1.0, 0.72, 0.42], fringe: [1.7, 0.45, 0.14] },
  goldHotBlade:  { color: [1.0, 0.85, 0.55], fringe: [1.8, 1.05, 0.18] },
  whiteHotBlade: { color: [1.0, 0.97, 0.90], fringe: [1.5, 1.35, 0.75] },
};
const FLAME_BLADE_DEFAULT = { color: [1.0, 0.75, 0.45], fringe: [1.6, 0.5, 0.16] };

// 重拳名单（卡名语义）：命中要「重」——更大冲击 + 更长节拍 + 灰尘
const HEAVY_FIST = /轰|崩|蓄满|全神|真拳|纯粹|坠机|神/;

// ---- 伤害量 → 尺寸系数（开方压曲线：大伤害不糊屏，同 slashScaleFor 口径）----
export function slashScaleFor(dealt) {
  if (!Number.isFinite(dealt) || dealt <= 0) return 1.0;
  return Math.min(2.1, Math.max(0.7, Math.sqrt(dealt / 18)));
}
export function punchScaleFor(dealt, heavy) {
  if (!Number.isFinite(dealt) || dealt <= 0) return 1.0;
  return Math.min(heavy ? 2.3 : 1.6, Math.max(0.6, Math.sqrt(dealt / 16)));
}
export function fireScaleFor(dealt) {
  if (!Number.isFinite(dealt) || dealt <= 0) return 1.0;
  return Math.min(2.4, Math.max(0.7, Math.sqrt(dealt / 20)));
}

/**
 * 伤害节拍决议：技能 defId → { kind, ...params } | null。
 * kind 词汇：slash（刀法）/ flameslash（焰刃火刀）/ punch（拳系）/
 * fireburst（火球落点/火雨落地）/ nova（爆裂新星·大）/ ignition（点火引燃·小）。
 */
export function resolveDamageFx(defId) {
  let def = null;
  try { def = getSkillDefinition(defId); } catch { return null; }
  if (!def) return null;
  // 天斩链（A/S/X）：heavenCleave 在施术拍已实体锁演完整场（压迫+巨刃+光柱+
  // 断裂），伤害拍不再补刀光——避免双斩读感
  if (def.id === 'godCleave' || def.id === 'skyCleave' || def.id === 'mountainCleave') return null;
  switch (def.series) {
    case 'blade':
      return { kind: 'slash', variant: slashVariantOf(def) };
    case 'selfImmolate':   // 焰刃链 + 玩火/焚烧系（火刀近身，焰刃配三档色）
      return {
        kind: 'flameslash',
        variant: { angle: -0.45, ms: 320 },
        look: FLAME_BLADE_LOOKS[def.id] ?? FLAME_BLADE_DEFAULT,
      };
    case 'fist':
    case 'punch': {
      const name = def.name ?? '';
      const heavy = HEAVY_FIST.test(name);
      const rapid = /连击|乱拳|雨拳|千手|万手|瞬击|快拳/.test(name);
      return { kind: 'punch', heavy, rapid };
    }
    case 'block': {        // 格挡系攻击链（掌/腿/破架——体修同源，施术拍已逐卡走 fistCast）
      const name = def.name ?? '';
      const heavy = /摘星|贯心|旋风腿|碎骨|扫堂/.test(name);
      const rapid = /二击|双击/.test(name);
      return { kind: 'punch', heavy, rapid };
    }
    case 'fireBall':       // 火球链 + 蓄热火球链（单体投射落点；proj=tracked：施术拍登记、本拍等抵达）
    case 'firstStrike':    // 先发火弹/火矢/火球
    case 'shock':          // 爆震/轰灭（火系单体斩杀件）
      return { kind: 'fireburst', proj: 'tracked' };
    case 'fireRain':       // 火雨/火瀑（群伤落地）
      return { kind: 'fireburst', ground: true };
    case 'fireWhirl':      // 火焰旋风（群伤——施术拍主角火环外推，逐敌落地火）
      return { kind: 'fireburst', ground: true };
    case 'spark':          // 火花链（乱射：本拍自持投射物——随机弧快弹，抵达才爆）
      return { kind: 'ignition', proj: 'owned' };
    case 'fireControl': {  // 控火术：按 id 分——燃=单体火爆 / 爆=群伤落地 / 破=小火
      if (def.id === 'fireControlBurn') return { kind: 'fireburst' };
      if (def.id === 'fireControlDetonate') return { kind: 'fireburst', ground: true };
      if (def.id === 'burnSnap' || def.id === 'burnSnapPlus') return { kind: 'ignition' };
      return null;
    }
    case 'burst':          // 爆裂术终止新星（咏唱熄灭的群伤爆发；id 供 AOE 多拍去重）
      return { kind: 'nova', id: def.id };
    case 'ignite':         // 点火/热浪（小伤 + 燃烧赋予；施术拍点种投射物，本拍等抵达）
      return { kind: 'ignition', proj: 'tracked' };
    default:
      return null;
  }
}

/**
 * 在伤害节拍跑一次命中演出（units.js _damageHit 经 _fxRunScript 调用，
 * fire-and-forget 不占节拍时序）。锚点口径：胸口锚 = 立绘中心（血条同款
 * 3.4×scale），脚边锚 = 落地爆心（火向上烧）。fromX = 攻击来向（拳面镜像）。
 * projSync（投射物抵达门，projectileTrack.js）：tracked = 施术拍发射的飞行
 * （await gate() 等真实抵达）；owned = 本拍自持发射（火花乱射——发完 arcProjectile
 * 落定即 arrived() 回报，主受击拍同源等待）。
 */
export async function runDamageBeat(ctx, deps, { fx, unit, dealt, fromX = null, projSync = null }) {
  if (!fx || !unit) return;
  const s = unit._baseScale ?? 1;
  const chest = { x: unit.position.x, y: unit.position.y + 3.4 * s, z: unit.position.z };
  const feet = { x: unit.position.x, y: unit.position.y + 0.6 * s, z: unit.position.z };
  switch (fx.kind) {
    case 'slash':
    case 'flameslash': {
      const v = fx.variant;
      const angle = v.jitter != null ? (Math.random() * 2 - 1) * v.jitter : v.angle;
      const look = fx.look ?? { color: [1.0, 0.98, 0.92], fringe: [0.5, 0.8, 1.6] };
      const flame = fx.kind === 'flameslash';
      await slashSweep(ctx, deps, {
        at: chest, angle, ms: v.ms,
        // 焰刃：下限抬高（火刀要罩住敌人全身）+ 上移避开血条 + 弧更弯（火舌感）
        scale: flame ? Math.max(slashScaleFor(dealt), 0.9) : slashScaleFor(dealt),
        color: look.color, fringe: look.fringe,
        yOff: flame ? 1.9 : 1.1,
        arc: flame ? 0.22 : 0.14,
      });
      if (flame) {
        // 火刀的余烬（无主资产）：刃过之后火星子飘（与火球爆的火花区分——慢速细碎）
        deps.particles?.spawn?.(chest.x, chest.y, {
          color: 0xffa04a, count: 12, speed: 8, size: 0.6, ttl: 0.9,
          gravity: -7, z: chest.z,
        });
      }
      return;
    }
    case 'punch': {
      const dir = fromX != null ? Math.sign(unit.position.x - fromX) || 1 : 1;
      const s = unit._baseScale ?? 1;
      // 拳锚明显高于胸口（4.9×scale）——胸口锚与血条同位互相污染（glm-flash 第七轮）
      const at = { x: unit.position.x, y: unit.position.y + 4.9 * s, z: unit.position.z };
      await punchImpact(ctx, deps, {
        at, dir,
        scale: Math.max(punchScaleFor(dealt, fx.heavy), 0.8),
        ms: fx.heavy ? 340 : fx.rapid ? 200 : 260,
        sparkCount: fx.heavy ? 26 : 14,
        lampIntensity: fx.heavy ? 950 : 620,
      });
      if (fx.heavy) {
        // 重拳落地尘（无主资产）：灰白慢速沉降——与火花区分的「地面响应」
        deps.particles?.spawn?.(feet.x, feet.y, {
          color: 0xb8a98c, count: 16, speed: 11, size: 1.2, ttl: 1.0,
          gravity: -10, z: feet.z,
        });
        deps.shake?.impulse?.(1.6);
      }
      return;
    }
    case 'fireburst': {
      if (fx.proj === 'tracked') await projSync?.gate();   // 等投射物真实抵达再爆
      await fireBurst(ctx, deps, {
        at: feet,
        scale: fireScaleFor(dealt) * (fx.ground ? 0.9 : 1.0),
        ms: fx.ground ? 480 : 420,
        // 火雨落地：火花压低贴地横向铺（坠感余韵）；火球落点：向上迸（爆感）
        sparkCount: fx.ground ? 18 : 24,
        sparkSpeed: fx.ground ? 15 : 26,
        linger: fx.ground
          ? { count: 16, speed: 5, ttl: 2.0, size: 0.8, gravity: -14 }
          : { count: 12, speed: 8, ttl: 1.8, size: 0.8, gravity: -5 },
      });
      return;
    }
    case 'nova': {
      // 爆裂术终止 = 敌方阵型中心**一场**巨大的爆炸。AOE 是 N 拍伤害（每敌一拍），
      // 同 defId 900ms 时间窗去重——首拍跑大爆炸（阵心），同窗内的其余拍只给
      // 落敌脚边小火反馈（每敌仍有命中读感，但爆心只有一个）。
      const now = performance.now();
      const last = _novaRecent.get(fx.id) ?? -1e9;
      const form = deps.enemyFormation?.() ?? null;
      if (now - last > 900) {
        _novaRecent.set(fx.id, now);
        await novaBlast(ctx, deps, {
          at: form?.center ?? chest,
          spread: form?.spread ?? 0,
          // 伤害量主缩放 + 阵型散布加成（炸的阵型越宽场面越大）
          scale: Math.min(1.6, Math.max(0.9, fireScaleFor(dealt) * 0.8
            + Math.min(0.4, (form?.spread ?? 0) * 0.03))),
        });
      } else {
        // 同窗跟随拍：脚边一小团卡通烟云（同款语言，量级区分）
        await cartoonNova(ctx, deps, {
          at: { x: chest.x, y: chest.y - 1.2, z: chest.z }, scale: 0.9, mini: true,
        });
        return;
      }
      return;
    }
    case 'ignition': {
      if (fx.proj === 'owned') {
        // 火花乱射：本拍自持投射物（随机弧+随机时效），从主角手上弹出，抵达才爆；
        // 落定即回执 projSync——主受击拍（受伤/数字）与此爆点同源触发
        await arcProjectile(ctx, deps, {
          from: deps.playerAnchor?.() ?? { x: 0, y: 5, z: 0 },
          to: chest,
          color: [1.0, 0.78, 0.30], hot: [1.2, 1.05, 0.55], size: 2.0,
          ms: 170, arcH: 2.5, arcJitter: 1.2, stretch: 2.0, lampIntensity: 0,
          trail: { color: 0xffc95e, count: 1, ttl: 0.22, speed: 3, size: 0.6 },
        });
        projSync?.arrived?.();
      } else if (fx.proj === 'tracked') {
        await projSync?.gate();   // 点火链：施术拍点种的投射物落定再引燃
      }
      await fireBurst(ctx, deps, {
        at: feet,
        scale: Math.max(1.0, fireScaleFor(dealt) * 0.9),
        ms: 420,
        // 引燃走橙金调（深红会与受击红闪同色系，火属辨识度被稀释——glm-flash 第七轮）
        color: [1.0, 0.55, 0.20], ember: [1.0, 0.25, 0.06],
        sparkCount: 12, sparkSpeed: 13,
        linger: { count: 8, speed: 4, ttl: 1.6, size: 0.6, gravity: -3 },
        lampIntensity: 550,
      });
      // 引燃读感：火苗子向上蹿的细碎组（燃烧已挂上——演出追认）
      deps.particles?.spawn?.(chest.x, chest.y - 1, {
        color: 0xffb066, count: 10, speed: 7, size: 0.5, ttl: 1.2,
        gravity: -2, z: chest.z,
      });
      return;
    }
    default:
      return;
  }
}
