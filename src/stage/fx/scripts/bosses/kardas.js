// Boss 剧本：卡达斯（kardas，11 层 Boss 池三之一）。一只 Boss 的全部自定义演出聚合在
// 本文件（内容归属原则，同 pyro.js）。触发点见 core enemies.js kardas act 的转段拍
//（血量跌至 50 → 嘶吼：回血 25 + 暴怒 2，本剧本占住那一拍）。
//
// 主题（lore：狂躁魔化古姆拉，獠牙利爪电离空气产生等离子体）＝「暴怒觉醒」：
//   蓄力（1.2s）：下蹲压低 + 血气逐级上涌（四记渐亮的暗红闪）+ 周身等离子电弧断续噼啪
//   嘶吼（瞬发）：过冲弹起 + 双道细环音浪 + 竖直吼柱 + 六道电弧炸开 + 重震荡 + 渐晕
//   余威（1.1s）：两记衰减的余脉 + 暗红碎屑坠地；终态涨大一圈（暴怒的体格，常驻）
// 常驻（挂舞台寿命）：怒气红光（跟随点光）+ 环身上升的暗红余烬 + 等离子折线雷
//   （rageArcs v2 几何弧，随暴怒层数爬上身，剧本点放走 burst()）+ 结构光压暗半档。与 pyro 的差异：**不常驻改机位**——
//   火主是把整个房间变成他的舞台，魔兽只是自己烧红了，镜头还给人。
// 美术口径：kardas 暂无立绘（占位色块），全部效果按立牌体量派生、不依赖贴图内容。
import * as THREE from 'three';
import { duelPose } from '../../camera.js';
import { registerEnemyHitBeat, enemyImpactBeat } from '../../spells/enemyHitFx.js';
import { registerEnemyAct } from '../enemyAct.js';
import { registerBossStateFx, registerBossHurtFx } from '../../bossStateFx.js';
import { makeRageArcs } from '../../rageArcs.js';

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

// 冲击环纹理（与 pyro 同「细环」口径：白热细峰读气浪，宽带版会糊成肥皂泡）
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

// 爪痕纹理：三道**纺锤形**割线——两端尖细、中段最粗
// （等宽圆头线会读成「三道粉杠」）。白热芯主导（暗红房间里红晕零对比）。
// 生灭动画由 clawRake 承担（短幅画出 + 挥向旋转），纹理本体只管形状。
let _clawTex = null;
function clawTexture() {
  if (_clawTex) return _clawTex;
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  // 三条趾痕的中心线（二次贝塞尔控制点，左上→右下微弯微散）
  const TOES = [
    [44, 118, 256, 150, 474, 186],
    [60, 250, 268, 288, 466, 322],
    [92, 376, 278, 410, 448, 438],
  ];
  const N = 26;
  const fillToe = (T, wBase, style) => {
    const [x0, y0, cx, cy, x1, y1] = T;
    const left = [], right = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, u = 1 - t;
      const x = u * u * x0 + 2 * u * t * cx + t * t * x1;
      const y = u * u * y0 + 2 * u * t * cy + t * t * y1;
      const dx = 2 * u * (cx - x0) + 2 * t * (x1 - cx);   // 贝塞尔切线
      const dy = 2 * u * (cy - y0) + 2 * t * (y1 - cy);
      const dl = Math.hypot(dx, dy) || 1;
      const w = wBase * Math.pow(Math.sin(Math.PI * t), 0.75);   // 纺锤包络
      left.push([x - (-dy / dl) * w, y - (dx / dl) * w]);
      right.push([x + (-dy / dl) * w, y + (dx / dl) * w]);
    }
    g.beginPath();
    g.moveTo(left[0][0], left[0][1]);
    for (const p of left) g.lineTo(p[0], p[1]);
    for (let i = right.length - 1; i >= 0; i--) g.lineTo(right[i][0], right[i][1]);
    g.closePath();
    g.fillStyle = style;
    g.fill();
  };
  for (const T of TOES) fillToe(T, 30, 'rgba(255,60,48,0.28)');   // 红晕
  for (const T of TOES) fillToe(T, 15, 'rgba(255,165,135,0.8)');  // 橙芯
  for (const T of TOES) fillToe(T, 6.5, 'rgba(255,250,246,1)');   // 白热
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _clawTex = tex;
  return tex;
}

// 小光点纹理（蓄力汇聚火花的弹体：白热核 + 红晕软点）
let _dotTex = null;
function dotTexture() {
  if (_dotTex) return _dotTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 1, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,240,230,1)');
  grad.addColorStop(0.35, 'rgba(255,150,120,0.75)');
  grad.addColorStop(1, 'rgba(255,80,60,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _dotTex = tex;
  return tex;
}

// 在目标胸口拍一记爪痕 sprite（dir 镜像左右手）。刀光式生灭：出生从 0.3 幅
// 挥到全幅 + 挥向旋转（rake() 里的两条 tween），消失走 ttl 线性衰（白炽余温）。
// 15wu 基准（纺锤形两端尖，放大不糊成盘）
function clawRake(particles, at, { dir = 1, scale = 1, ttl = 0.3, delayRot = 0 } = {}) {
  const W = 15 * scale;
  const rec = particles.spawnSprite(at.x, at.y, {
    texture: clawTexture(), width: W, height: W, z: (at.z ?? 0) + 2.5,
    ttl, gravity: 0, scalePop: 0.5, fadeIn: false,
  });
  if (rec) {
    rec._r1 = (dir > 0 ? 1 : -1) * (0.35 + delayRot) + (dir > 0 ? 0 : Math.PI);
    rec._wFull = W;
    rec.sprite.material.rotation = rec._r1 - dir * 0.4; // 起手回带（挥的前一瞬）
    rec.w = W * 0.3;
  }
  return rec;
}

/** 爪痕 + 画出 tween（rec.w/rec.rotation 由粒子系统每帧重写，tween 落 rec 字段与材质）。 */
function rake(c2, d, at, opts) {
  const rec = clawRake(d.particles, at, opts);
  if (!rec) return;
  c2.tweenRaw(rec, { w: rec._wFull }, { durationMs: 110, ease: 'power3.out' });
  c2.tweenRaw(rec.sprite.material, { rotation: rec._r1 }, { durationMs: 150, ease: 'power3.out' });
}

/** 周身电弧点放（rageArcs v2 几何折线雷；缺席/headless 静默）。 */
function arcBurst(unit, n = 2, ms = 180) {
  unit._fxLayer?.get('bossRage')?.burst?.(n, ms);
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
  unit._bossPhase = 2; // 暴怒地板：P2 起电弧常驻低燃（director 读此标记）
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
    // 电弧前奏：越接近爆发越密（1.2s 窗内 4+6 发，走折线雷件的 burst 点放）
    for (let i = 0; i < 4; i++) { arcBurst(unit, 1, 200); await c.wait(210); }
    for (let i = 0; i < 6; i++) { arcBurst(unit, 2, 180); await c.wait(90); }
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
  unit._fxLayer?.get('bossRage')?.pulse?.(1.4); // 全身电弧随嘶吼炸亮一拍
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
  arcBurst(unit, 6, 500); // 嘶吼：六道折线雷齐鸣
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
    arcBurst(unit, 3, 260); // 余威一记折线雷
    shake.impulse(1.4 - k * 0.5);
    particles.spawn(ux, uy + H * 0.5, {
      count: 14, color: 0x8a2a34, speed: 12, ttl: 1.3, size: 1.7, gravity: -18, z: uz,
    });
    await ctx.wait(420);
  }

  // —— 常驻（挂舞台寿命）：怒气红光 + 环身余烬 + 低频电弧 + 结构光压暗 ——
  // 红光从舞台光池借（light:fx0——中途 add 灯会全场景重编译冻帧）；
  // 池灯入场即在场景里，这里只挪位/换色/推强度
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
    // 常驻低频电弧不另设——rageArcs 折线雷件本体就是常驻（director 推 level）
  });

  // 演出机位退场：先补间飞回基准机位（flyHome 连 fov 一起飞），再弹栈——
  // 直接 pop 会瞬时硬切 63u + 4.8°
  await camera?.flyHome?.({ durationMs: 720, ease: 'power2.inOut' }) ?? null;
  camera?.popOverride?.('kardasP2');
  unit.restoreColor?.();
}

// —— 命中 beat（等离子主题）：爪 = clawRake 三趾贴图 sprite
// （白热芯 + 深红晕渐细割线，普击单挥 / 重击撕碎交叉双挥）+ 命中点电弧迸溅。
// 冲击骨架仍是 enemyImpactBeat（量级/震屏/尘走三档表），爪痕叠在它上面读「撕裂」。
async function kardasHitBeat(ctx, deps, args) {
  const heavy = args.fx.tier === 'heavy';
  const dir = args.fromX != null ? (Math.sign(args.unit.position.x - args.fromX) || 1) : 1;
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
      // 爪 = 纺锤爪痕 sprite 刀光式画出（短幅→全幅 + 挥向旋转），贴胸口（冲击骨架的
      // at 偏低落腿位，爪抬 1.8wu 上胸）；重击撕碎 = 第二道反手错峰 90ms 交叉成 X
      const clawAt = { x: at.x, y: at.y + 1.8, z: at.z };
      rake(c2, d, clawAt, { dir, scale: hv ? 1.4 : 1.0, ttl: hv ? 0.42 : 0.3 });
      if (hv) {
        c2.spawn(async (c3) => {
          await c3.wait(90);
          rake(c2, d, clawAt, { dir: -dir, scale: 1.55, ttl: 0.46, delayRot: 0.15 });
        });
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

// —— 起手 beat：攻击拍 = 兽性蓄力。轻击（多段连击）= 短压 + 一记折线雷；重击撕碎 =
// 完整预备演出（anticipation）：深蹲压满 + 底位高频颤 + 等离子火花
// 向爪尖汇聚 + 血气两段渐亮 + 蓄满一刻周身电弧齐鸣——力量感来自「蓄」不是「扑」，
// 突进撕扑由伤害节拍的突进编排接棒。盾拍（盾10）= 植爪卸力（压宽一拍 + 电弧 + 扬尘）。
// 嘶吼转段拍由 P2 剧本接管。
async function kardasAct({ ctx, deps, unit, kinds, args }) {
  if (kinds.includes('attack')) {
    const heavy = (args?.hits ?? 1) <= 1; // 撕碎（单发重击）：P1 15 / P2 27
    const ux = unit.position.x, uy = unit.position.y, uz = unit.position.z;
    const H = unit._standeeHeight ?? 22;
    const id = unit.uniqueID;
    if (!heavy) {
      arcBurst(unit, 1, 160);
      await ctx.custom(id, {
        durationMs: 230, ease: 'power2.in',
        onUpdate: (t) => unit.setPose({
          squash: 1 - 0.12 * t,
          widen: 1 + 0.08 * t,
          lean: -0.06 * t,
        }),
      });
      unit.resetPose?.();
      return;
    }
    // 撕碎预备（0.95s）：前 62% 深蹲到底、底位高频颤（蓄不住），火花倒吸进前爪
    const claw = { x: ux - H * 0.3, y: uy + H * 0.34, z: uz + 1 };   // 前爪（朝玩家侧）
    ctx.spawn(async (c) => {   // 汇聚：四批火花倒吸入爪尖，越到后越密越急
      for (let i = 0; i < 4; i++) {
        const n = 3 + i;
        const pull = 0.30 - i * 0.04;
        for (let k = 0; k < n; k++) {
          const a = Math.random() * Math.PI * 2;
          const r = H * (0.26 + Math.random() * 0.24);
          const px = claw.x + Math.cos(a) * r, py = claw.y + Math.sin(a) * r * 0.7;
          deps.particles?.spawnSprite?.(px, py, {
            texture: dotTexture(), width: 2.2, height: 2.2, z: uz + 1.5,
            vx: (claw.x - px) / pull, vy: (claw.y - py) / pull, gravity: 0, ttl: pull, scalePop: 0.25,
          });
        }
        await c.wait(170);
      }
    });
    ctx.spawn(async (c) => {   // 电弧前奏渐密（两段都在 950ms 主窗内收完，不收 promise）
      for (let i = 0; i < 3; i++) { arcBurst(unit, 1 + i, 200); await c.wait(250 - i * 60); }
    });
    deps.particles?.spawn?.(ux, uy + H * 0.06, {
      color: 0x8a5a44, count: 10, speed: 6, size: 1.2, ttl: 0.9, gravity: -6, z: uz + 0.5,
    });
    unit.flash?.(0x8a2432);
    let lit = false;
    await ctx.custom(id, {
      durationMs: 950, ease: 'none',
      onUpdate: (t) => {
        const press = sstep(Math.min(1, t / 0.62));       // 前 62% 蹲到底
        const held = Math.max(0, (t - 0.62) / 0.38);      // 底位颤动渐强
        const shudder = held * Math.sin(t * 9.5 * Math.PI * 2 * 0.95) * 0.022;
        unit.setPose({
          squash: 1 - 0.26 * press + shudder,
          widen: 1 + 0.22 * press,
          lean: -0.08 * press,
        });
        if (!lit && t > 0.55) { lit = true; unit.flash?.(0xe8505a); }
      },
    });
    unit.resetPose?.();
    arcBurst(unit, 5, 320);   // 蓄满：周身电弧齐鸣一拍
    return;
  }
  if (!kinds.includes('defend')) return;
  const ux = unit.position.x, uy = unit.position.y, uz = unit.position.z;
  const H = unit._standeeHeight ?? 22;
  deps.particles?.spawn?.(ux, uy + H * 0.06, {
    color: 0x8a5a44, count: 12, speed: 8, size: 1.2, ttl: 0.8, gravity: -9, z: uz + 0.5,
  });
  arcBurst(unit, 1, 150);
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
  // 常驻电弧导演（bossStateFx）：等离子电弧随 rage 层数爬上身（数量/幅度/闪烁率
  // 同涨）；P2 起 0.3 地板（觉醒后永远带电）——「打它越狠它越痛」直接可见
  registerBossStateFx('kardas', (obj, unitProj) => {
    if (unitProj.isDead) return;
    const rage = unitProj.effects?.find((e) => e.effectId === 'rage')?.stacks ?? 0;
    const floor2 = obj._bossPhase >= 2 ? 0.3 : 0;
    const level = Math.max(floor2, Math.min(rage / 6, 1));
    if (level <= 0) { obj._fxLayer?.setLevel('bossRage', 0); return; }
    obj._fxLayer?.overlay('bossRage', 2, (l) => makeRageArcs(l));
    obj._fxLayer?.setLevel('bossRage', level);
  });
  // 受击补充：挨打 = 全身电弧炸亮（暴怒的「越打越兴奋」）+ 暗红等离子迸点
  registerBossHurtFx('kardas', (ctx, deps, { unit, dealt }) => {
    const H = unit._standeeHeight ?? 22;
    unit._fxLayer?.get('bossRage')?.pulse?.(Math.min(0.5 + dealt / 26, 1.3));
    deps.particles?.spawn?.(unit.position.x, unit.position.y + H * 0.5, {
      color: 0xff5a4a, count: Math.min(4 + Math.round(dealt / 5), 10), speed: 12,
      size: 0.9, ttl: 0.5, z: unit.position.z + 1,
    });
  });
}
