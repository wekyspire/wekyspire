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
  const alarm = new THREE.PointLight(0xff3a3a, 0, H * 5, 1.8);
  alarm.position.set(0, H * 0.6, H * 0.3);
  unit.add(alarm);
  onStageDispose?.(() => { unit.remove(alarm); alarm.dispose?.(); });

  // —— ① 故障：阶梯抽搐 + 红蓝告警闪 + 电火花 + 微震荡连击 ——
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
      alarm.intensity = 520 + 420 * Math.sin(sec * Math.PI * 2 * 2.2);
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
    ctx.tweenRaw(alarm, { intensity: 0 }, { durationMs: T.STALL, ease: 'power2.in' }),
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
      alarm.intensity = 2400 * Math.min(1, t * 2.2);   // 告警灯变熔炉光
    },
  });
  unit.scale.set(s * 1.03, s * 1.03, 1);
  alarm.color.set(0xff8a4a);

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

  // 演出机位退场
  camera?.popOverride?.('mefm1P2');
  unit.restoreColor?.();
}

export function registerMefm1Scripts(register) {
  register('bosses/mefm1P2', mefm1P2);
}
