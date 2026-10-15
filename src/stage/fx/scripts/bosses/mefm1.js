// Boss 剧本：MEFM-1（mefm1，11 层 Boss 池三之一）。一只 Boss 的全部自定义演出聚合在
// 本文件（内容归属原则，同 pyro.js）。触发点见 core enemies.js mefm1 act 的转段拍
//（血量跌至 80 → 铁壳剥落、故障空转一拍，本剧本占住那一拍）。
//
// 主题（lore：警戒的无人战体）＝「故障 · 点火」，三段读法各占一拍：
//   故障（1.5s）：机体抽搐（阶梯式 scale 抖动，不做平滑补间——机器的抖是离散的）+
//     红蓝交替告警闪 + 白蓝电火花迸溅 + 告警红灯扫射（跟随点光正弦脉动）+ 微震荡连击
//   停机（0.7s）：一切骤停——机体塌一档、灯光压到近黑、一粒白火花慢慢落。留白拍：
//     「它坏了」与「它要醒了」之间的呼吸口
//   点火（1.4s）：橙闪 + 弹性回胀（故障时缩的都撑回来，常驻涨 3%）+ 细环气浪 +
//     火花爆发 + 一口灰烟 + 熔炉光起燃（橙点光 0→满）+ 三路排焰口错峰开喷
// 常驻（挂舞台寿命）：熔炉光 + 三路排焰（不同高度/速率/颜色，错峰起步）+ 低频电火花
//   （机器还是那台坏机器）+ 结构光压暗 + 火光乘子反抬（fireGain，口径同 pyro 但幅度收敛）。
// 与另外两位的差异：pyro 烧房间、kardas 烧自己，mefm1 是**机器过热**——光和焰都收在
// 机体近旁，房间里只留半档压暗，不整场洗色。
// 美术口径：mefm1 暂无立绘（占位色块），全部效果按立牌体量派生、不依赖贴图内容。
import * as THREE from 'three';
import { duelPose } from '../../camera.js';
import { arcProjectile, lampPulse } from '../../spells/blocks.js';
import { registerEnemyHitBeat, enemyImpactBeat, registerEnemyNoLunge } from '../../spells/enemyHitFx.js';
import { registerEnemyAct } from '../enemyAct.js';
import { registerBossStateFx, registerBossHurtFx } from '../../bossStateFx.js';
import { makeHexShield } from '../../hexShield.js';
import { isAttackKind, isBuffKind, isDebuffKind } from '../../../../core/intentKinds.js';

// 电火花纹理：横向拉长的白蓝炽核 + 尾迹（与 pyro 余烬拖影同构、换色温——冷电 vs 热火）
let _sparkTex = null;
function sparkTexture() {
  if (_sparkTex) return _sparkTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(8, 64, 120, 64);
  grad.addColorStop(0, 'rgba(120,190,255,0)');
  grad.addColorStop(0.6, 'rgba(150,205,255,0.5)');
  grad.addColorStop(1, 'rgba(235,250,255,1)');
  g.fillStyle = grad;
  g.beginPath();
  g.ellipse(64, 64, 58, 9, 0, 0, Math.PI * 2);
  g.fill();
  const core = g.createRadialGradient(104, 64, 1, 104, 64, 16);
  core.addColorStop(0, 'rgba(255,255,255,0.95)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = core;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _sparkTex = tex;
  return tex;
}

// 细环冲击纹理（同 pyro/kardas 的「白热细峰」口径）
let _ringTex = null;
function ringTexture() {
  if (_ringTex) return _ringTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 100, 128, 128, 126);
  grad.addColorStop(0, 'rgba(255,130,50,0)');
  grad.addColorStop(0.74, 'rgba(255,140,60,0.1)');
  grad.addColorStop(0.94, 'rgba(255,246,232,1)');
  grad.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grad;
  g.beginPath(); g.arc(128, 128, 128, 0, Math.PI * 2); g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _ringTex = tex;
  return tex;
}

// 枪口焰纹理：金色四芒星闪（白热核 + 十字主芒 + 斜芒 + 暖晕）——机发那一瞬的
// 「发射源在喷火」读感，配灯闪与迸射火光粒子
let _muzzleTex = null;
function muzzleTexture() {
  if (_muzzleTex) return _muzzleTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const spike = (rot, len, wid) => {
    g.save(); g.translate(64, 64); g.rotate(rot);
    const grad = g.createLinearGradient(-len, 0, len, 0);
    grad.addColorStop(0, 'rgba(255,190,90,0)');
    grad.addColorStop(0.5, 'rgba(255,230,170,0.9)');
    grad.addColorStop(1, 'rgba(255,190,90,0)');
    g.fillStyle = grad;
    g.beginPath(); g.ellipse(0, 0, len, wid, 0, 0, Math.PI * 2); g.fill();
    g.restore();
  };
  spike(0, 60, 9); spike(Math.PI / 2, 60, 9);
  spike(Math.PI / 4, 40, 6); spike(-Math.PI / 4, 40, 6);
  const core = g.createRadialGradient(64, 64, 1, 64, 64, 22);
  core.addColorStop(0, 'rgba(255,252,240,1)');
  core.addColorStop(0.5, 'rgba(255,220,140,0.85)');
  core.addColorStop(1, 'rgba(255,180,80,0)');
  g.fillStyle = core;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _muzzleTex = tex;
  return tex;
}

const T = {
  GLITCH: 1500, // 故障：抽搐 + 告警 + 电火花
  STALL: 700,   // 停机：骤停留白
  IGNITE: 1400, // 点火：回胀 + 熔炉起燃
  STUTTER: 0.09, // 抽搐步长（秒）：机器的抖是离散的，不是平滑补间
};

/** 迸一撮白蓝电火花（点粒 + 一两道拖影）。 */
function burstSparks(particles, ux, uy, uz, H, n = 10) {
  particles.spawn(ux, uy + H * 0.5, {
    count: n, color: 0xbfe0ff, speed: 26, ttl: 0.5, size: 1.1, z: uz + 1,
  });
  for (let i = 0; i < 2; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 16 + Math.random() * 12;
    const rec = particles.spawnSprite(ux, uy + H * 0.5, {
      texture: sparkTexture(), width: 2.6, height: 0.7, z: uz + 2,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.7, gravity: -10, ttl: 0.3,
    });
    if (rec) rec.sprite.material.rotation = Math.atan2(Math.sin(a) * 0.7, Math.cos(a));
  }
}

/** 跳弹落地：一小蓬土石 + 金属火星（脱靶弹「打在环境里」的交代）。 */
function groundPuff(particles, x, y, z) {
  particles.spawn(x, y, { count: 8, color: 0x8a7a5e, speed: 7, size: 0.9, ttl: 0.55, gravity: -14, z });
  particles.spawn(x, y + 0.4, { count: 5, color: 0xffc35a, speed: 11, size: 0.7, ttl: 0.3, gravity: -8, z });
}

async function mefm1P2({ ctx, args, cast, particles, shake, vignette, camera, onStageDispose, runScript, unitById }) {
  const unit = unitById(args.unit);
  if (!unit) return; // 快照缺失兜底：静默收拍
  const id = unit.uniqueID;
  const ux = unit.position.x, uy = unit.position.y, uz = unit.position.z;
  const s = unit._baseScale ?? 1;
  const H = unit._standeeHeight ?? 22;

  // —— 转段机位（演出期间接管，收尾弹栈）：长焦平视，比 kardas 略松（看整台机器）——
  const base = camera?.basePose;
  const pose = base ? duelPose(base, { fovScale: 0.85, elScale: 0.55 }) : null;
  camera?.pushOverride?.('mefm1P2', {
    poses: pose ? { mefm1P2: pose } : {},
    onEnter: (dir) => { if (pose) dir.flyTo('mefm1P2', { durationMs: 650, ease: 'power2.out' }); },
  });

  // —— 告警红灯（跟随点光，故障段正弦扫射；停机段熄灭；点火段换橙色熔炉光起燃）——
  // 从舞台光池借（light:fx0）：常驻灯统一走 fx0——瞬态灯脉冲（punchImpact 的
  // lampPulse）走 fx1，借同一盏会在转段后把熔炉灯拽去命中点。池灯入场即在场景里，
  // 重挂到单位不触发重编译（add 灯 = 全场景着色器重编译冻帧）
  const alarm = cast.get('light:fx0');
  if (alarm) {
    alarm.color.set(0xff3a3a);
    alarm.distance = H * 5;
    alarm.position.set(0, H * 0.6, H * 0.3);
    unit.add(alarm);
    onStageDispose?.(() => { alarm.intensity = 0; unit.remove(alarm); });
  }

  // —— ① 故障：阶梯抽搐 + 红蓝告警闪 + 电火花 + 微震荡连击 ——
  // 装甲失效（转段核心事件）：蜂窝力场当场碎裂剥落——「它最硬的东西没了」
  unit._armorShattered = true;
  unit._bossPhase = 2;
  unit._fxLayer?.get('bossArmor')?.shatter?.();
  let step = -1;
  await ctx.custom(id, {
    durationMs: T.GLITCH, ease: 'none',
    onUpdate: (t) => {
      const sec = (t * T.GLITCH) / 1000;
      const nowStep = Math.floor(sec / T.STUTTER);
      if (nowStep !== step) {            // 每步换一组离散的抖动目标（机器抽搐，非平滑）
        step = nowStep;
        unit.scale.set(
          s * (0.93 + Math.random() * 0.15),
          s * (0.94 + Math.random() * 0.13),
          1,
        );
        unit.flash?.(Math.random() < 0.5 ? 0x9ecbff : 0xff5a5a);
      }
      if (alarm) alarm.intensity = 520 + 420 * Math.sin(sec * Math.PI * 2 * 2.2);
      if (Math.random() < 0.09) shake.impulse(0.5);
      if (Math.random() < 0.06) burstSparks(particles, ux, uy, uz, H, 6);
    },
  });

  // —— ② 停机：骤停留白 ——
  await Promise.all([
    ctx.custom(id, {
      durationMs: T.STALL, ease: 'power2.in',
      onUpdate: (t) => unit.scale.set(s * (0.97 - 0.05 * t), s * (0.97 - 0.05 * t), 1),
    }),
    alarm ? ctx.tweenRaw(alarm, { intensity: 0 }, { durationMs: T.STALL, ease: 'power2.in' }) : null,
  ]);
  // 一粒白火花慢慢落下去（「灯灭了」的那口气）
  particles.spawnSprite(ux + H * 0.2, uy + H * 0.55, {
    texture: sparkTexture(), width: 1.6, height: 0.5, z: uz + 2,
    vy: -6, gravity: -4, ttl: 0.8, fadeIn: true,
  });
  shake.impulse(0);
  await ctx.wait(180);

  // —— ③ 点火：橙闪 + 弹性回胀 + 气浪 + 灰烟 + 熔炉光起燃 ——
  unit.flash?.(0xff8a3a);
  shake.impulse(5.5);
  vignette.pulse(2.2);
  const ring = particles.spawnSprite(ux, uy + H * 0.5, {
    texture: ringTexture(), width: H * 0.28, height: H * 0.28, z: uz + 2, ttl: 0.62, gravity: 0,
  });
  if (ring) (runScript ?? ((body) => ctx.spawn(body)))(async (c) => {
    await c.tweenRaw(ring, { w: H * 1.35, h: H * 1.35 }, { durationMs: 600, ease: 'power2.out' });
  });
  particles.spawn(ux, uy + H * 0.5, {
    count: 34, color: 0xffb066, speed: 40, ttl: 0.6, size: 1.6, z: uz,
  });
  particles.spawn(ux, uy + H * 0.5, {
    count: 18, color: 0xff6a3a, speed: 22, ttl: 0.9, size: 2.0, z: uz,
  });
  // 一口灰烟（点火那拍呛出来的）
  particles.spawn(ux, uy + H * 0.68, {
    count: 16, color: 0x555a66, speed: 7, vby: 6, ttl: 1.8, size: 2.6, gravity: 2, z: uz + 1,
  });
  await ctx.custom(id, {
    durationMs: T.IGNITE, ease: 'none',
    onUpdate: (t) => {
      // 弹性回胀：过冲 1.18 → 收回 1.03（故障缩掉的都撑回来，常驻涨一档）
      const k = 1 + 0.24 * Math.sin(t * Math.PI * 0.78) * (1 - t * 0.35);
      unit.scale.set(s * (0.92 + 0.11 * t) * k, s * (0.92 + 0.11 * t) * k, 1);
      if (alarm) alarm.intensity = 2400 * Math.min(1, t * 2.2);   // 告警灯变熔炉光
    },
  });
  unit.scale.set(s * 1.03, s * 1.03, 1);
  if (alarm) alarm.color.set(0xff8a4a);

  // —— 常驻（挂舞台寿命）：三路排焰错峰开喷 + 火光乘子 + 低频电火花 ——
  const VENTS = [
    { dx: -H * 0.3, dy: H * 0.45, rate: 8, color: 0xff8a3a, speed: 5.5, size: 1.3, lag: 200 },
    { dx: H * 0.34, dy: H * 0.28, rate: 6, color: 0xffa04c, speed: 4.5, size: 1.1, lag: 700 },
    { dx: 0, dy: H * 0.72, rate: 5, color: 0xff7030, speed: 6.5, size: 1.5, lag: 1200 },
  ];
  (runScript ?? ((body) => ctx.spawn(body)))(async (c) => {
    const jobs = [];
    for (const v of VENTS) {
      const em = particles.spawnEmitter(ux + v.dx, uy + v.dy, {
        rate: 0, radius: H * 0.12, color: v.color, speed: v.speed, ttl: 1.4,
        size: v.size, gravity: 6, zJitter: H * 0.1, z: uz + 0.5,
      });
      if (!em) continue;
      onStageDispose?.(() => em.stop());
      jobs.push(c.tweenRaw(em, { rate: v.rate }, { durationMs: 1600, delayMs: v.lag }));
    }
    const mood = cast.get('light:mood');
    if (mood) {
      jobs.push(c.tweenRaw(mood, { dim: mood.dim * 0.72 }, { durationMs: 1800, delayMs: 300 }));
      jobs.push(c.tweenRaw(mood, { fireGain: mood.fireGain * 1.55 }, { durationMs: 1600, delayMs: 400 }));
    }
    await Promise.all(jobs);
    // 低频电火花：机器还是坏的（无限循环到舞台寿命为止）
    for (;;) {
      await c.wait(2600 + Math.random() * 1800);
      if (!unit.parent) break;
      burstSparks(particles, ux, uy, uz, H, 4);
    }
  });

  // 演出机位退场：先补间飞回基准（flyHome 连 fov），再弹栈——瞬时硬切是病灶
  await camera?.flyHome?.({ durationMs: 720, ease: 'power2.inOut' }) ?? null;
  camera?.popOverride?.('mefm1P2');
  unit.restoreColor?.();
}

// —— 命中 beat（钢铁电蚀主题）：弹链/普攻都是金属撞击的
// 白蓝电火花（不是血肉撞击），多段连发时读成「挨了一梭子」。共享底座
// enemyImpactBeat，garnish 复用本文件的 burstSparks（电火花 + 拖影）。
async function mefm1HitBeat(ctx, deps, args) {
  const rapid = args.fx.tier === 'rapid';
  await enemyImpactBeat(ctx, deps, {
    ...args,
    pal: {
      color: rapid ? [0.62, 0.72, 0.86] : [0.72, 0.78, 0.88],
      hot: rapid ? [0.85, 0.95, 1.2] : [0.9, 0.95, 1.15],
      rim: [0.6, 0.78, 1.05],
      sparkColor: 0xbfe0ff,
      flashColor: 0xcfe4ff,
    },
    garnish: (c2, d, { at, heavy: hv }) => {
      burstSparks(d.particles, at.x, at.y - 7, at.z ?? 0, 14, hv ? 12 : 7);   // uy - H/2 抵消内部 +H/2 偏移
    },
  });
}

// —— 起手 beat：攻击拍 = 金色弹雨扫射（狂躁化）——实弹数 = 伤害段数，
// 脱靶弹三族：贴地跳弹（落点迸土石）/ 过顶飞弹 / 侧墙流弹（外观与实弹一致、不做区分；
// 压迫感来自弹幕密度而非命中数）。脱靶弹按 x 排成一条扫线（方向随机）= 弹着点从一侧
// 扫到另一侧的「压着枪口扫」，实弹均布插进弹链藏起。每发配枪口焰（四芒星闪 + 迸射
// 火光 + 大金色点光短闪——fx1 让给枪口焰，弹体不再挂灯）；连射中枪口缓缓上跳（后座
// 压不住）。P2 弹量/射速/枪口焰全面上调（过热齐射）。命中侧的电火花由 hit beat 承接。
// 钩爪拍（赋予伤残，无伤害）= 钩爪发射——钢蓝钩爪弹划弧飞向玩家，抵达炸电火花；
// 积焰拍（P1 buff）= 排焰口喷一口橙火；点火完成拍（P2 buff，炎魔2）= 蓄势→三口齐喷大拍。
async function mefm1Act({ ctx, deps, unit, player, kinds, args }) {
  const H = unit._standeeHeight ?? 22;
  const from = { x: unit.position.x, y: unit.position.y + H * 0.5, z: unit.position.z };
  const to = player
    ? { x: player.position.x, y: player.position.y + 3.4 * (player._baseScale ?? 1), z: player.position.z }
    : null;
  if (kinds.some(isAttackKind)) {
    const hits = Math.max(1, Math.min(args?.hits ?? 1, 6));
    const p2 = (unit._bossPhase ?? 1) >= 2;
    const extras = p2 ? 10 : 5;           // 脱靶弹（P2 弹幕密度翻倍——狂躁）
    const total = hits + extras;
    const gap = p2 ? 60 : 85;             // 射速（间隔 < 飞行时长 = 空中同时多弹，读弹幕不读滴漏）
    const flyMs = p2 ? 230 : 260;
    unit.flash?.(0xffd27a);
    // 后座体态：先仰 0.14s，射流期间缓缓回正。收 promise 与弹链一起等齐——
    // 子剧本随父本结算被杀（铁律），不收敛会让回正段在末尾被腰斩、机体残留后仰
    const id = unit.uniqueID;
    const recoil = ctx.spawn(async (c) => {
      await c.custom(id, {
        durationMs: 140, ease: 'power2.out',
        onUpdate: (t) => unit.setPose({ lean: (p2 ? 0.07 : 0.05) * t }),
      });
      await c.custom(id, {
        durationMs: 120 + total * gap, ease: 'power1.inOut',
        onUpdate: (t) => unit.setPose({ lean: (p2 ? 0.07 : 0.05) * (1 - t) }),
      });
      unit.resetPose?.();
    });
    await ctx.wait(140);
    // 弹着点表：脱靶三族（贴地跳弹/过顶飞弹/侧墙流弹）排成一条 x 扫线（方向随机），
    // 实弹均布插进弹链——弹着点从一侧扫到另一侧，实弹藏进弹雨读不出「哪发会掉血」
    let chain = [];
    if (to) {
      const floorY = player?.position.y ?? (to.y - 3.4);
      for (let i = 0; i < extras; i++) {
        const fam = Math.random();
        if (fam < 0.42) {        // 贴地跳弹：弹雨犁地，落点迸土石
          chain.push({
            x: to.x + (Math.random() - 0.5) * 2 * (3 + Math.random() * 10),
            y: floorY + 0.6 + Math.random() * 1.2, z: to.z, ground: true,
          });
        } else if (fam < 0.72) { // 过顶飞弹：从头顶擦过去
          chain.push({
            x: to.x + (Math.random() - 0.5) * 7,
            y: to.y + 4 + Math.random() * 5.5, z: to.z,
          });
        } else {                 // 侧墙流弹：彻底打飞
          chain.push({
            x: to.x + (Math.random() < 0.5 ? -1 : 1) * (8 + Math.random() * 8),
            y: to.y + (Math.random() - 0.5) * 3.5, z: to.z,
          });
        }
      }
      const sweepDir = Math.random() < 0.5 ? 1 : -1;   // 扫线方向（本梭子从左扫到右或反向）
      chain.sort((a, b) => sweepDir * (a.x - b.x));
      for (let k = 0; k < hits; k++) {   // 实弹均布插队
        chain.splice(Math.floor(((k + 0.5) / hits) * (chain.length + 1)), 0, to);
      }
    } else {
      chain = Array(hits).fill(null);
    }
    // 子剧本随父本结算即被杀（script.js 铁律）——全部收 promise 末尾统一 await
    const jobs = [recoil.promise];
    for (let i = 0; i < total; i++) {
      // 出膛口逐发微移（多管齐射）+ 连射上跳（后坐压不住，枪口缓缓爬）
      const muzzle = {
        x: from.x + (Math.random() - 0.5) * 2.2,
        y: from.y + (Math.random() - 0.5) * 1.6 + Math.min(i * 0.14, 1.6),
        z: from.z,
      };
      const tgt = chain[i] ?? to;
      jobs.push(ctx.spawn(async (c) => {
        await arcProjectile(c, deps, {
          from: muzzle, to: tgt,
          color: [1.05, 0.75, 0.26], hot: [1.65, 1.3, 0.6],
          // 远场口径：Boss 在 z≈-56 远端——曳光弹给 2.2wu + 大拉伸
          // 读「成串钢芯弹」，靠 ms/间隔而非尺寸表达「小快灵」
          size: p2 ? 2.8 : 2.6, ms: flyMs, arcH: tgt?.ground ? 0.25 : 0.6, stretch: 2.6, darting: 0.12,
          lampName: null,
          trail: { color: 0xffc35a, speed: 2, size: 1.0, ttl: 0.28 },
        });
        if (tgt?.ground) groundPuff(deps.particles, tgt.x, tgt.y, tgt.z); // 跳弹落地迸溅
      }).promise);
      // 枪口焰：金色四芒星闪 + 迸射火光 + 大金色点光短闪
      deps.particles?.spawnSprite?.(muzzle.x, muzzle.y, {
        texture: muzzleTexture(), width: p2 ? 5.6 : 4.2, height: p2 ? 5.6 : 4.2,
        z: muzzle.z + 1.5, ttl: 0.12, scalePop: 0.9, gravity: 0,
      });
      deps.particles?.spawn?.(muzzle.x, muzzle.y, {
        color: 0xffa844, count: p2 ? 12 : 7, speed: 15, size: 1.2, ttl: 0.28, z: muzzle.z + 1,
      });
      jobs.push(ctx.spawn((c) => lampPulse(c, deps, {
        name: 'light:fx1', at: { x: muzzle.x, y: muzzle.y, z: muzzle.z + 2 },
        color: [1.0, 0.74, 0.3], peak: p2 ? 2400 : 1500, attackMs: 26, decayMs: p2 ? 110 : 90,
      })).promise);
      if (i < total - 1) await ctx.wait(gap);
    }
    await Promise.all(jobs);
    return;
  }
  if (kinds.some(isDebuffKind)) {
    await arcProjectile(ctx, deps, {
      from, to,
      color: [0.55, 0.65, 0.8], hot: [0.85, 0.95, 1.25],
      size: 2.6, ms: 380, arcH: 3.2, stretch: 1.6,
      lampName: 'light:fx1', lampIntensity: 480,
      trail: { color: 0x9ecbff, speed: 4, size: 1.0, ttl: 0.3 },
    });
    if (player) {
      const px = player.position.x, py = player.position.y + 3.4 * (player._baseScale ?? 1);
      burstSparks(deps.particles, px, py - H * 0.5, player.position.z, H, 10);
    }
    return;
  }
  if (kinds.some(isBuffKind)) {
    const ux = unit.position.x, uy = unit.position.y, uz = unit.position.z;
    if ((unit._bossPhase ?? 1) >= 2) {
      // —— 点火完成（炎魔2）：大动作前摇——火星倒吸回排焰口 + 机体绷紧
      // 下压 + 熔炉灯先憋暗，顶点憋一拍（高频微颤）；再三口排焰同时全开：火柱 +
      // 电火花风暴 + 冲击炽闪 + 熔炉灯冲顶回落 + 机体弹性回胀。
      const VENTS = [
        { dx: -H * 0.3, dy: H * 0.45 }, { dx: H * 0.34, dy: H * 0.28 }, { dx: 0, dy: H * 0.72 },
      ];
      const furnace = deps.cast?.get?.('light:fx0') ?? null; // P2 剧本挂的常驻熔炉灯
      const furnaceBase = furnace?.intensity ?? 0;
      const jobs = [];
      // ① 蓄势（~0.6s）：三批火星倒吸（渐急）+ 熔炉灯憋暗 + 机体下压绷紧
      jobs.push(ctx.spawn(async (c) => {
        for (let i = 0; i < 3; i++) {
          for (const v of VENTS) {
            for (let k = 0; k < 3; k++) {
              const px = ux + v.dx + (Math.random() - 0.5) * H * 0.55;
              const py = uy + v.dy + (Math.random() - 0.5) * H * 0.35;
              const pull = 0.24;
              const rec = deps.particles?.spawnSprite?.(px, py, {
                texture: sparkTexture(), width: 2.4, height: 0.65, z: uz + 1.5,
                vx: (ux + v.dx - px) / pull, vy: (uy + v.dy - py) / pull,
                gravity: 0, ttl: pull, scalePop: 0.25,
              });
              if (rec) rec.sprite.material.rotation = Math.atan2((uy + v.dy - py) / pull, (ux + v.dx - px) / pull);
            }
          }
          await c.wait(155 - i * 30);
        }
      }).promise);
      if (furnace) {
        jobs.push(ctx.spawn((c) => c.tweenRaw(furnace, { intensity: furnaceBase * 0.35 }, { durationMs: 520, ease: 'power2.in' })).promise);
      }
      const id = unit.uniqueID;
      await ctx.custom(id, {
        durationMs: 600, ease: 'power2.in',
        onUpdate: (t) => unit.setPose({ squash: 1 - 0.14 * t, widen: 1 + 0.10 * t }),
      });
      // 顶点憋 150ms（蓄不住的高频微颤）
      await ctx.custom(id, {
        durationMs: 150, ease: 'none',
        onUpdate: (t) => {
          const sh = Math.sin(t * Math.PI * 2 * 6) * 0.018 * (0.5 + t);
          unit.setPose({ squash: 0.86, widen: 1.10 + sh });
        },
      });
      unit.resetPose?.();
      // ② 齐喷：三口火柱 + 径向电火花风暴 + 炽闪 + 震 + 熔炉灯冲顶回落
      unit.flash?.(0xff8a3a);
      deps.shake?.impulse?.(3.2);
      for (const v of VENTS) {
        deps.particles?.spawn?.(ux + v.dx, uy + v.dy, {
          color: 0xff8a3a, count: 22, speed: 12, vby: 26, size: 1.8, ttl: 0.9, gravity: 3, z: uz + 0.6,
        });
        deps.particles?.spawnSprite?.(ux + v.dx, uy + v.dy + 2, {
          texture: ringTexture(), width: 4.5, height: 4.5, z: uz + 1.6, ttl: 0.5, scalePop: 0.7, gravity: 0,
        });
      }
      for (let i = 0; i < 14; i++) {   // 机器的火带着电——白蓝电火花风暴
        const a = (i / 14) * Math.PI * 2 + Math.random() * 0.3;
        const sp = 18 + Math.random() * 9;
        const rec = deps.particles?.spawnSprite?.(ux, uy + H * 0.5, {
          texture: sparkTexture(), width: 3.2, height: 0.8, z: uz + 1.5,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6 + 2, gravity: 4, ttl: 0.7, scalePop: 0.3,
        });
        if (rec) rec.sprite.material.rotation = Math.atan2(Math.sin(a) * 0.6, Math.cos(a));
      }
      jobs.push(ctx.spawn((c) => lampPulse(c, deps, {
        name: 'light:fx1', at: { x: ux, y: uy + H * 0.5, z: uz + 2 },
        color: [1.0, 0.55, 0.2], peak: 2400, attackMs: 50, decayMs: 650,
      })).promise);
      if (furnace) {
        jobs.push(ctx.spawn(async (c) => {
          await c.tweenRaw(furnace, { intensity: furnaceBase * 2.2 }, { durationMs: 120, ease: 'power3.out' });
          await c.tweenRaw(furnace, { intensity: furnaceBase }, { durationMs: 900, ease: 'power2.inOut' });
        }).promise);
      }
      // 机体弹性回胀（喷完那口气的舒张）
      await ctx.custom(id, {
        durationMs: 380, ease: 'power3.out',
        onUpdate: (t) => {
          const k = 1 + 0.10 * Math.sin(t * Math.PI);
          unit.setPose({ widen: k, squash: 1 - (k - 1) * 0.7 });
        },
      });
      unit.resetPose?.();
      await Promise.all(jobs);
      return;
    }
    // P1 积焰：两侧排焰口喷两口橙火星上扬 + 一记钢色闪
    for (const dx of [-H * 0.3, H * 0.34]) {
      deps.particles?.spawn?.(ux + dx, uy + H * 0.4, {
        color: 0xff8a3a, count: 9, speed: 4, vby: 9, size: 1.1, ttl: 0.8, gravity: 5, z: uz + 0.5,
      });
    }
    unit.flash?.(0x9ecbff);
    await ctx.wait(340);
  }
}

export function registerMefm1Scripts(register) {
  register('bosses/mefm1P2', mefm1P2);
  registerEnemyHitBeat('mefm1', mefm1HitBeat);
  registerEnemyAct('mefm1', mefm1Act);
  // 射击机器：不突进——笨重战体的攻击是原地扫射（曳光弹承担距离），不是飞扑
  registerEnemyNoLunge('mefm1');
  // 常驻装甲导演（bossStateFx）：P1 持有 defense = 六边形能量硬化装甲在线；
  // 转段拍剧本置 _armorShattered 并播碎裂，此后不再重建（甲没了就是没了）
  registerBossStateFx('mefm1', (obj, unitProj) => {
    if (unitProj.isDead) return;
    const def = unitProj.effects?.find((e) => e.effectId === 'defense');
    const on = (def?.stacks ?? 0) > 0 && !obj._armorShattered;
    if (on) obj._fxLayer?.overlay('bossArmor', 2, (l) => makeHexShield(l));
    obj._fxLayer?.setLevel('bossArmor', on ? 1 : 0);
  });
  // 受击补充（目标侧）：甲在 = 命中点涟漪 + 白蓝金属火星（打在力场上）；
  // 甲碎后 = 橙白火花 + 灰烟星点（打在裸露机壳上）
  registerBossHurtFx('mefm1', (ctx, deps, { unit, dealt, fromX }) => {
    const H = unit._standeeHeight ?? 22;
    const armor = unit._fxLayer?.get('bossArmor');
    const nx = fromX == null ? 0.5 : (fromX < unit.position.x ? 0.24 : 0.76);
    if (armor && armor.levelNow() > 0.25) {
      armor.impact(nx + (Math.random() - 0.5) * 0.14, 0.35 + Math.random() * 0.35);
      deps.particles?.spawn?.(unit.position.x, unit.position.y + H * 0.55, {
        color: 0xbfe0ff, count: Math.min(4 + Math.round(dealt / 4), 12), speed: 14,
        size: 0.8, ttl: 0.45, z: unit.position.z + 1,
      });
      return;
    }
    deps.particles?.spawn?.(unit.position.x, unit.position.y + H * 0.55, {
      color: 0xffb066, count: Math.min(5 + Math.round(dealt / 4), 14), speed: 16,
      size: 0.9, ttl: 0.5, gravity: -6, z: unit.position.z + 1,
    });
  });
}
