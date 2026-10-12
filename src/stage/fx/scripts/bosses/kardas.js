// Boss 剧本：卡达斯（kardas，11 层 Boss 池三之一）。一只 Boss 的全部自定义演出聚合在
// 本文件（内容归属原则，同 pyro.js）。触发点见 core enemies.js kardas act 的转段拍
//（血量跌至 50 → 嘶吼：回血 25 + 暴怒 2，本剧本占住那一拍）。
//
// 主题（lore：狂躁魔化古姆拉，獠牙利爪电离空气产生等离子体）＝「暴怒觉醒」：
//   蓄力（1.2s）：下蹲压低 + 血气逐级上涌（四记渐亮的暗红闪）+ 周身等离子电弧断续噼啪
//   嘶吼（瞬发）：过冲弹起 + 双道细环音浪 + 竖直吼柱 + 六道电弧炸开 + 重震荡 + 渐晕
//   余威（1.1s）：两记衰减的余脉 + 暗红碎屑坠地；终态涨大一圈（暴怒的体格，常驻）
// 常驻（挂舞台寿命）：怒气红光（跟随点光）+ 环身上升的暗红余烬 + 断续电弧（低频噼啪，
//   「这头东西一直是带电的」）+ 结构光压暗半档。与 pyro 的差异：**不常驻改机位**——
//   火主是把整个房间变成他的舞台，魔兽只是自己烧红了，镜头还给人。
// 美术口径：kardas 暂无立绘（占位色块），全部效果按立牌体量派生、不依赖贴图内容。
import * as THREE from 'three';
import { duelPose } from '../../camera.js';
import { registerEnemyHitBeat, enemyImpactBeat } from '../../spells/enemyHitFx.js';
import { registerEnemyAct } from '../enemyAct.js';

// 电弧纹理（三档缓存：锯齿折线 + 白热内核 + 暗红晕。每次爆发随机取档 + 随机旋转，
// 同一张折线复读太多次会读出「贴图感」，三档足够错开）。
const _arcTex = new Map();
function arcTexture(i = 0) {
  if (_arcTex.has(i)) return _arcTex.get(i);
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  const segs = 7 + i * 2;                    // 档位越高折点越多 = 越细碎
  const pts = [];
  for (let k = 0; k <= segs; k++) {
    pts.push([
      12 + (232 * k) / segs + (k > 0 && k < segs ? (Math.random() - 0.5) * 34 : 0),
      64 + (k > 0 && k < segs ? (Math.random() - 0.5) * 58 : 0),
    ]);
  }
  // 外晕（暗红，粗）
  g.strokeStyle = 'rgba(255,70,60,0.34)';
  g.lineWidth = 11; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) g.lineTo(x, y);
  g.stroke();
  // 中层（亮橙红）
  g.strokeStyle = 'rgba(255,150,110,0.85)';
  g.lineWidth = 4.5;
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) g.lineTo(x, y);
  g.stroke();
  // 白热内核（细）
  g.strokeStyle = 'rgba(255,250,244,1)';
  g.lineWidth = 1.6;
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) g.lineTo(x, y);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _arcTex.set(i, tex);
  return tex;
}

// 冲击环纹理（与 pyro 同「细环」口径：白热细峰读气浪，宽带版会糊成肥皂泡——09-23 定论）
let _ringTex = null;
function ringTexture() {
  if (_ringTex) return _ringTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 100, 128, 128, 126);
  grad.addColorStop(0, 'rgba(255,90,60,0)');
  grad.addColorStop(0.74, 'rgba(255,110,70,0.1)');
  grad.addColorStop(0.94, 'rgba(255,244,235,1)');
  grad.addColorStop(1, 'rgba(255,100,50,0)');
  g.fillStyle = grad;
  g.beginPath(); g.arc(128, 128, 128, 0, Math.PI * 2); g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const T = {
  CROUCH: 1200, // 蓄力：压低 + 血气上涌
  ROAR: 900,    // 嘶吼：过冲弹起的收稳段
  AFTER: 1100,  // 余威：两记余脉 + 碎屑坠地
};
const sstep = (x) => x * x * (3 - 2 * x);

/** 在躯干附近炸一道电弧（sprite + 随机旋转 + 短 ttl；颜色乘白闪一拍）。 */
function sparkArc(particles, ux, uy, uz, H, { scale = 1, ttl = 0.14 } = {}) {
  const rec = particles.spawnSprite(
    ux + (Math.random() - 0.5) * H * 0.7,
    uy + H * (0.25 + Math.random() * 0.55),
    {
      texture: arcTexture(Math.floor(Math.random() * 3)),
      width: H * 0.62 * scale, height: H * 0.3 * scale,
      z: uz + 1.5, ttl, gravity: 0,
    });
  if (rec) rec.sprite.material.rotation = (Math.random() - 0.5) * 1.2;
  return rec;
}

async function kardasP2({ ctx, args, cast, particles, shake, vignette, camera, onStageDispose, runScript, unitById }) {
  const unit = unitById(args.unit);
  if (!unit) return; // 快照缺失兜底：静默收拍
  const id = unit.uniqueID;
  const ux = unit.position.x, uy = unit.position.y, uz = unit.position.z;
  const s = unit._baseScale ?? 1;
  const H = unit._standeeHeight ?? 22;
  const chestY = uy + H * 0.55;

  // —— 转段机位（只在演出期间接管，收尾弹栈还给人）：长焦平视派生，比基准紧半档 ——
  const base = camera?.basePose;
  const pose = base ? duelPose(base, { fovScale: 0.8, elScale: 0.4 }) : null;
  camera?.pushOverride?.('kardasP2', {
    poses: pose ? { kardasP2: pose } : {},
    onEnter: (dir) => { if (pose) dir.flyTo('kardasP2', { durationMs: 700, ease: 'power2.out' }); },
  });

  // —— 蓄力：下蹲 + 血气四记渐亮 + 断续电弧 ——
  const SURGE = [[0.1, 0x6a1d28], [0.34, 0x8a2432], [0.58, 0xb03440], [0.82, 0xe8505a]];
  const hit = SURGE.map(() => false);
  shake.impulse(0.35);
  ctx.spawn(async (c) => {
    // 电弧前奏：越接近爆发越密（1.2s 窗内 4+6 发）
    for (let i = 0; i < 4; i++) { sparkArc(particles, ux, uy, uz, H, { scale: 0.6 }); await c.wait(210); }
    for (let i = 0; i < 6; i++) { sparkArc(particles, ux, uy, uz, H, { scale: 0.85 }); await c.wait(90); }
  });
  ctx.spawn(async (c) => {
    // 地面暗红浮尘被吸起（怒气蓄在身体里，尘先知道）
    for (let i = 0; i < 5; i++) {
      particles.spawn(ux + (Math.random() - 0.5) * H * 0.9, uy + H * 0.08, {
        count: 5, color: 0x9a3040, speed: 4, ttl: 1.1, size: 1.6, gravity: 3, z: uz + 1,
      });
      await c.wait(200);
    }
  });
  await ctx.custom(id, {
    durationMs: T.CROUCH, ease: 'none',
    onUpdate: (t) => {
      const press = sstep(t);
      unit.scale.set(s * (1 - 0.06 * press), s * (1 - 0.3 * press), 1);
      SURGE.forEach(([at, col], i) => {
        if (hit[i] || t < at) return;
        hit[i] = true;
        unit.flash?.(col);
      });
    },
  });

  // —— 嘶吼爆发：弹起过冲 + 双环音浪 + 吼柱 + 电弧炸开 ——
  unit.flash?.(0xff6a5a);
  particles.spawn(ux, chestY, {
    count: 40, color: 0xff5a4a, speed: 46, ttl: 0.7, size: 1.8, z: uz,
  });
  particles.spawn(ux, chestY, {
    count: 22, color: 0xffe0cc, speed: 64, ttl: 0.55, size: 1.2, z: uz,
  });
  // 竖直吼柱：自口部向上连发四串（读成一股顶上去的气流，不是烟花）
  ctx.spawn(async (c) => {
    for (let i = 0; i < 4; i++) {
      particles.spawn(ux, uy + H * 0.62, {
        count: 12, color: i < 2 ? 0xff7a5a : 0xffc8b0, speed: 6, vby: 30, ttl: 0.6,
        size: 2.1, gravity: -12, z: uz + 1,
      });
      await c.wait(80);
    }
  });
  for (let i = 0; i < 6; i++) sparkArc(particles, ux, uy, uz, H, { scale: 1.25, ttl: 0.18 });
  const WAVES = [
    { w1: H * 1.6, ms: 520, ttl: 0.5 },
    { w1: H * 1.1, ms: 720, ttl: 0.68 },
  ];
  for (const [i, wv] of WAVES.entries()) {
    const ring = particles.spawnSprite(ux, chestY, {
      texture: ringTexture(), width: H * 0.3, height: H * 0.3, z: uz + 2 + i, ttl: wv.ttl, gravity: 0,
    });
    if (!ring) continue;
    (runScript ?? ((body) => ctx.spawn(body)))(async (c) => {
      await c.tweenRaw(ring, { w: wv.w1, h: wv.w1 }, { durationMs: wv.ms, ease: 'power2.out' });
    });
  }
  shake.impulse(6);
  vignette.pulse(2.6);
  // 过冲弹起（0.7→1.32）再压回暴怒体格（1.07 常驻涨大）
  await ctx.custom(id, {
    durationMs: T.ROAR, ease: 'power3.out',
    onUpdate: (t) => unit.scale.set(s * (0.94 + 0.38 * t), s * (0.7 + 0.62 * t), 1),
  });
  unit.scale.set(s * 1.07, s * 1.07, 1);

  // —— 余威：两记衰减余脉 + 暗红碎屑坠地 ——
  for (let k = 0; k < 2; k++) {
    const ring = particles.spawnSprite(ux, chestY, {
      texture: ringTexture(), width: H * 0.24, height: H * 0.24, z: uz + 2, ttl: 0.6, gravity: 0,
    });
    if (ring) (runScript ?? ((body) => ctx.spawn(body)))(async (c) => {
      await c.tweenRaw(ring, { w: H * (0.7 - k * 0.2), h: H * (0.7 - k * 0.2) }, { durationMs: 560, ease: 'power1.out' });
    });
    sparkArc(particles, ux, uy, uz, H, { scale: 0.9 });
    shake.impulse(1.4 - k * 0.5);
    particles.spawn(ux, uy + H * 0.5, {
      count: 14, color: 0x8a2a34, speed: 12, ttl: 1.3, size: 1.7, gravity: -18, z: uz,
    });
    await ctx.wait(420);
  }

  // —— 常驻（挂舞台寿命）：怒气红光 + 环身余烬 + 低频电弧 + 结构光压暗 ——
  // 红光从舞台光池借（light:fx0）：演出中途 add 灯会触发全场景着色器重编译
  // （实测 1.2s 冻帧，09-24）；池灯入场即在场景里，这里只挪位/换色/推强度
  const rageLight = cast.get('light:fx0');
  if (rageLight) {
    rageLight.color.set(0xff4a34);
    rageLight.distance = H * 5;
    rageLight.position.set(0, H * 0.55, H * 0.25);
    unit.add(rageLight);   // 重挂不改变场景灯数 → 不重编译
    onStageDispose?.(() => { rageLight.intensity = 0; unit.remove(rageLight); });
  }
  const aura = particles.spawnEmitter(ux, uy + H * 0.08, {
    rate: 0, radius: H * 0.42, color: 0xd93a2a, speed: 4.5, ttl: 2.2, size: 1.4,
    gravity: 3.5, zJitter: H * 0.3, z: uz,
  });
  if (aura) onStageDispose?.(() => aura.stop());
  (runScript ?? ((body) => ctx.spawn(body)))(async (c) => {
    const jobs = [];
    if (rageLight) {
      jobs.push(c.tweenRaw(rageLight, { intensity: 1500 }, { durationMs: 900, ease: 'power2.out' }));
    }
    if (aura) jobs.push(c.tweenRaw(aura, { rate: 9 }, { durationMs: 1400 }));
    const mood = cast.get('light:mood');
    if (mood) jobs.push(c.tweenRaw(mood, { dim: mood.dim * 0.78 }, { durationMs: 1800, delayMs: 200 }));
    await Promise.all(jobs);
    // 低频电弧：无限循环到舞台寿命为止（runScript 的独立剧本锚；unit 快照没了就退出）
    for (;;) {
      await c.wait(2000 + Math.random() * 1200);
      if (!unit.parent) break;
      sparkArc(particles, ux, uy, uz, H, { scale: 0.7 + Math.random() * 0.4, ttl: 0.12 });
      if (Math.random() < 0.4) sparkArc(particles, ux, uy, uz, H, { scale: 0.55, ttl: 0.1 });
    }
  });

  // 演出机位退场：先补间飞回基准机位（flyHome 连 fov 一起飞），再弹栈——
  // 直接 pop 会瞬时硬切 63u + 4.8°（报「动画结束后相机弹回原位」的病灶，09-24 修）
  await camera?.flyHome?.({ durationMs: 720, ease: 'power2.inOut' }) ?? null;
  camera?.popOverride?.('kardasP2');
  unit.restoreColor?.();
}

// —— 命中 beat（等离子主题，2026-10-09 补齐）：多段 = 爪痕（暗红电弧拖痕在命中点
// 炸开），重击（15/27）= 撕碎（交叉双爪痕 + 电弧连爆）。共享底座 enemyImpactBeat。
async function kardasHitBeat(ctx, deps, args) {
  const heavy = args.fx.tier === 'heavy';
  await enemyImpactBeat(ctx, deps, {
    ...args,
    pal: {
      color: heavy ? [0.95, 0.22, 0.16] : [1.0, 0.38, 0.24],
      hot: heavy ? [1.3, 0.55, 0.42] : [1.2, 0.62, 0.45],
      rim: [1.05, 0.4, 0.32],
      sparkColor: heavy ? 0xff5a4a : 0xff8a6a,
      flashColor: 0xffb8a0,
    },
    garnish: (c2, d, { at, heavy: hv }) => {
      // 爪痕：命中点炸 1~2 道斜切电弧（arcTexture 的白热内核读成爪锋），重击交叉双痕
      const n = hv ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const rec = d.particles?.spawnSprite?.(at.x + (i - (n - 1) / 2) * 2.2, at.y, {
          texture: arcTexture(Math.floor(Math.random() * 3)),
          width: hv ? 8.5 : 6.2, height: hv ? 3.6 : 2.6,
          z: (at.z ?? 0) + 1.6, ttl: 0.16, gravity: 0, scalePop: 0.25,
        });
        if (rec) rec.sprite.material.rotation = (i % 2 === 0 ? 0.55 : -0.45) + (Math.random() - 0.5) * 0.2;
      }
      // 等离子迸溅：命中点本体电弧（重击多炸两道）。H 传半量：sparkArc 的 H 同时
      // 驱动 sprite 尺寸与高度散布，全量 22 会把电弧抬到头顶、宽过半身
      sparkArc(d.particles, at.x, at.y - 5, at.z ?? 0, 10, { scale: hv ? 1.15 : 0.7, ttl: 0.14 });
      if (hv) {
        sparkArc(d.particles, at.x, at.y - 5, at.z ?? 0, 10, { scale: 0.9, ttl: 0.12 });
        sparkArc(d.particles, at.x, at.y - 5, at.z ?? 0, 10, { scale: 0.75, ttl: 0.16 });
      }
    },
  });
}

// —— 起手 beat：盾拍（盾10）= 植爪卸力——前爪砸地蓄势（姿态压宽一拍 + 爪侧电弧 +
// 扬尘）。攻击拍静默（突进 + 爪痕命中 beat 已是语言）；嘶吼转段拍由 P2 剧本接管。
async function kardasAct({ ctx, deps, unit, kinds }) {
  if (kinds.includes('attack')) return;
  if (!kinds.includes('defend')) return;
  const ux = unit.position.x, uy = unit.position.y, uz = unit.position.z;
  const H = unit._standeeHeight ?? 22;
  deps.particles?.spawn?.(ux, uy + H * 0.06, {
    color: 0x8a5a44, count: 12, speed: 8, size: 1.2, ttl: 0.8, gravity: -9, z: uz + 0.5,
  });
  sparkArc(deps.particles, ux, uy, uz, H, { scale: 0.65, ttl: 0.13 });
  unit.flash?.(0xb03440);
  const id = unit.uniqueID;
  await ctx.custom(id, {
    durationMs: 360, ease: 'power2.out',
    onUpdate: (t) => unit.setPose({ squash: 1 - 0.10 * Math.sin(t * Math.PI), widen: 1 + 0.14 * Math.sin(t * Math.PI) }),
  });
  unit.resetPose?.();
}

export function registerKardasScripts(register) {
  register('bosses/kardasP2', kardasP2);
  registerEnemyHitBeat('kardas', kardasHitBeat);
  registerEnemyAct('kardas', kardasAct);
}
