// Boss 剧本：穿山甲王（pangolinKing，11 层 Boss 池·装甲主题）。
// 一只 Boss 的全部自定义演出聚合在本文件（内容归属原则，同 pyro.js）。
//
// 主题：**大地替它发怒**。三层语言，全部从脚下长出来：
//   · 甲——鳞板逐片锁合、崩落、崩落后的体缝余热（plateArmor 状态件）；
//   · 地——石板立墙（负山）、地裂贴花、掘地扬尘；一切都是下沉的重量；
//   · 爪——三道并行爪痕与岩刺，从地面撕出来（不用钝器拳环）。
//
// 拍表：
//   P1 首拍（防御2）＝锁甲：甲片自下而上合缝 + 三记锁扣火花 + 尘从甲缝挤出
//   P1 无盾拍（盾50+脆弱如山）＝负山：五片石板破土立起成墙 + 石墙脆裂线
//   P1 荆棘拍＝竖鳞：背甲整圈竖刺（quillRise）+ 刺尖走光
//   P1 攻击 12＝裂地爪：后仰抬爪 → 短扑，命中拍三道并行爪痕撕过目标
//   P1 攻击 3×3＝三连耙：三记快挥 + 三次短扑，逐拍三道小爪痕
//   转段（<190 生命，恼怒净化）＝崩甲狂怒：大地倒吸 → 甲片崩飞 → 仰首怒吼 →
//     地裂贴花 + 体缝熔金 + 琥珀怒光常驻
//   P2 每拍（重击9+蓄势5）＝掘地突袭：伏地掘土 → 潜地（地表尘脊追踪）→
//     在玩家身前破土 → 命中拍岩刺自脚下爆起；收势再潜回原位。蓄势越高，
//     破土岩刺越多越大（读「攒着的劲」）。
//
// 机位纪律同 pyro：按舞台真 fov 反解，不写死距离；转段全程不切特写。
import * as THREE from 'three';
import { duelPose } from '../../camera.js';
import { groundRing, screenFlash, lampPulse } from '../../spells/blocks.js';
import { registerEnemyHitBeat, registerEnemyLunge, enemyImpactBeat } from '../../spells/enemyHitFx.js';
import { registerEnemyAct } from '../enemyAct.js';
import { registerBossStateFx, registerBossHurtFx } from '../../bossStateFx.js';
import { makePlateArmor } from '../../plateArmor.js';
import { quillRise, plateSeal, unitH } from '../enemies/fxPieces.js';
import { glowTexture } from '../../orbs.js';
import { isAttackKind, isBuffKind } from '../../../../core/intentKinds.js';

const sstep = (x) => x * x * (3 - 2 * x);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const rand = (a, b) => a + Math.random() * (b - a);

// ---------------------------------------------------------------------------
// 贴图（模块级缓存：演出件共用，不随局销毁）
// ---------------------------------------------------------------------------

// 细环冲击纹理：thin = 白热细峰（冲击波/声波），fat = 宽带光晕（破土炽闪）
const _ringTex = new Map();
function ringTexture(thin = true) {
  const key = thin ? 'thin' : 'fat';
  if (_ringTex.has(key)) return _ringTex.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 100, 128, 128, 126);
  if (thin) {
    grad.addColorStop(0, 'rgba(210,190,150,0)');
    grad.addColorStop(0.76, 'rgba(210,190,150,0)');
    grad.addColorStop(0.9, 'rgba(225,200,150,0.08)');
    grad.addColorStop(0.958, 'rgba(255,248,230,1)');
    grad.addColorStop(0.986, 'rgba(230,200,150,0.32)');
    grad.addColorStop(1, 'rgba(200,170,120,0)');
  } else {
    grad.addColorStop(0, 'rgba(220,200,160,0)');
    grad.addColorStop(0.8, 'rgba(230,205,160,0.5)');
    grad.addColorStop(0.92, 'rgba(255,250,235,1)');
    grad.addColorStop(1, 'rgba(210,180,130,0)');
  }
  g.fillStyle = grad;
  g.beginPath(); g.arc(128, 128, 128, 0, Math.PI * 2); g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _ringTex.set(key, tex);
  return tex;
}

// 土尘拖影：头亮尾暗的横长条（sprite.rotation 对齐速度即拖在身后）
let _streakTex = null;
function streakTexture() {
  if (_streakTex) return _streakTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(8, 64, 120, 64);
  grad.addColorStop(0, 'rgba(150,132,104,0)');
  grad.addColorStop(0.6, 'rgba(170,150,120,0.5)');
  grad.addColorStop(1, 'rgba(246,236,214,0.95)');
  g.fillStyle = grad;
  g.beginPath(); g.ellipse(64, 64, 58, 10, 0, 0, Math.PI * 2); g.fill();
  const core = g.createRadialGradient(104, 64, 1, 104, 64, 16);
  core.addColorStop(0, 'rgba(255,250,235,0.9)');
  core.addColorStop(1, 'rgba(255,250,235,0)');
  g.fillStyle = core;
  g.fillRect(0, 0, 128, 128);
  _streakTex = new THREE.CanvasTexture(c);
  _streakTex.colorSpace = THREE.SRGBColorSpace;
  return _streakTex;
}

// 石板（负山）：不规则五边形厚板，左上受光、右下沉影、裂线从板中穿过
let _slabTex = null;
function slabTexture() {
  if (_slabTex) return _slabTex;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const pts = [[40, 58], [208, 26], [238, 188], [70, 234], [18, 150]];
  const path = () => {
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
  };
  const fill = g.createLinearGradient(40, 40, 220, 230);
  fill.addColorStop(0, '#8f8069');
  fill.addColorStop(0.55, '#6a5d4b');
  fill.addColorStop(1, '#463c30');
  path();
  g.fillStyle = fill;
  g.fill();
  // 上缘受光 / 下缘沉影（厚板的两道边）
  g.lineJoin = 'round';
  path();
  g.strokeStyle = 'rgba(220,204,172,0.7)';
  g.lineWidth = 7;
  g.stroke();
  g.save();
  path();
  g.clip();
  g.strokeStyle = 'rgba(24,20,16,0.85)';
  g.lineWidth = 10;
  g.beginPath(); g.moveTo(0, 40); g.lineTo(256, 46); g.stroke(); // 顶部暗压边
  // 裂线：一条主裂 + 两条细裂，裂线里透一点暖光（脆的预兆）
  g.strokeStyle = 'rgba(26,21,16,0.9)';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(86, 30); g.lineTo(128, 96); g.lineTo(108, 150); g.lineTo(152, 232);
  g.stroke();
  g.strokeStyle = 'rgba(214,150,86,0.5)';
  g.lineWidth = 1.8;
  g.beginPath();
  g.moveTo(88, 30); g.lineTo(130, 96); g.lineTo(110, 150); g.lineTo(154, 232);
  g.stroke();
  g.strokeStyle = 'rgba(30,25,19,0.7)';
  g.lineWidth = 2.5;
  g.beginPath(); g.moveTo(178, 44); g.lineTo(196, 120); g.lineTo(236, 168); g.stroke();
  // 石面颗粒
  for (let i = 0; i < 46; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '210,196,168' : '30,26,20'},${rand(0.05, 0.16)})`;
    g.beginPath(); g.arc(rand(24, 236), rand(26, 232), rand(1, 3), 0, Math.PI * 2); g.fill();
  }
  g.restore();
  _slabTex = new THREE.CanvasTexture(c);
  _slabTex.colorSpace = THREE.SRGBColorSpace;
  return _slabTex;
}

// 鳞片碎块（崩甲）：带层脊的三角板，尖端留一点熔金色
let _shardTex = null;
function shardTexture() {
  if (_shardTex) return _shardTex;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(20, 120, 108, 12);
  grad.addColorStop(0, '#3c3328');
  grad.addColorStop(0.6, '#6f6250');
  grad.addColorStop(1, '#b3a184');
  g.beginPath(); g.moveTo(64, 4); g.lineTo(118, 120); g.lineTo(12, 116); g.closePath();
  g.fillStyle = grad; g.fill();
  g.strokeStyle = 'rgba(240,226,196,0.75)'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(64, 10); g.lineTo(38, 116); g.stroke(); // 层脊受光
  g.strokeStyle = 'rgba(22,18,14,0.85)'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(64, 12); g.lineTo(88, 114); g.stroke();
  g.fillStyle = 'rgba(255,196,120,0.8)';
  g.beginPath(); g.moveTo(64, 4); g.lineTo(70, 26); g.lineTo(58, 26); g.closePath(); g.fill();
  _shardTex = new THREE.CanvasTexture(c);
  _shardTex.colorSpace = THREE.SRGBColorSpace;
  return _shardTex;
}

// 岩刺（破土）：底粗尖细的锥体，暗石背光面 + 顶端冷白
let _spikeTex = null;
function spikeTexture() {
  if (_spikeTex) return _spikeTex;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 256, 0, 0);
  grad.addColorStop(0, '#2e2820');
  grad.addColorStop(0.55, '#5f5444');
  grad.addColorStop(0.88, '#8f8069');
  grad.addColorStop(1, '#d8c8a8');
  g.beginPath();
  g.moveTo(64, 4); g.lineTo(92, 118); g.lineTo(84, 210); g.lineTo(72, 256);
  g.lineTo(52, 256); g.lineTo(40, 206); g.lineTo(34, 118);
  g.closePath();
  g.fillStyle = grad; g.fill();
  // 受光棱（左上一条亮边，右下一条暗边）
  g.strokeStyle = 'rgba(236,224,198,0.55)'; g.lineWidth = 6;
  g.beginPath(); g.moveTo(64, 10); g.lineTo(44, 200); g.stroke();
  g.strokeStyle = 'rgba(14,12,10,0.75)'; g.lineWidth = 7;
  g.beginPath(); g.moveTo(64, 12); g.lineTo(84, 206); g.stroke();
  // 岩纹
  g.strokeStyle = 'rgba(20,17,13,0.5)'; g.lineWidth = 2;
  for (const y of [120, 164, 204]) {
    g.beginPath(); g.moveTo(36, y + 8); g.lineTo(56, y - 4); g.lineTo(74, y + 6); g.lineTo(90, y - 2); g.stroke();
  }
  _spikeTex = new THREE.CanvasTexture(c);
  _spikeTex.colorSpace = THREE.SRGBColorSpace;
  return _spikeTex;
}

// 爪痕：一道横向新月形裂口，白热芯 + 暖晕，端部收细消隐
let _clawTex = null;
function clawTexture() {
  if (_clawTex) return _clawTex;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 256, 0);
  grad.addColorStop(0, 'rgba(255,230,190,0)');
  grad.addColorStop(0.16, 'rgba(255,214,160,0.45)');
  grad.addColorStop(0.5, 'rgba(255,250,236,0.95)');
  grad.addColorStop(0.84, 'rgba(255,214,160,0.45)');
  grad.addColorStop(1, 'rgba(255,230,190,0)');
  g.beginPath();
  g.moveTo(4, 56);
  g.quadraticCurveTo(128, 6, 252, 24);
  g.quadraticCurveTo(128, 20, 8, 48);
  g.closePath();
  g.fillStyle = grad; g.fill();
  g.strokeStyle = 'rgba(255,255,250,0.95)'; g.lineWidth = 2.2;
  g.beginPath(); g.moveTo(14, 51); g.quadraticCurveTo(128, 14, 246, 26); g.stroke();
  _clawTex = new THREE.CanvasTexture(c);
  _clawTex.colorSpace = THREE.SRGBColorSpace;
  return _clawTex;
}

// 地裂贴花（转段常驻）：同心放射裂纹，暗缝 + 熔金内芯，边缘径向淡出
let _crackTex = null;
function crackTexture() {
  if (_crackTex) return _crackTex;
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const cx = S / 2, cy = S / 2;
  const drawCrack = (a0, len, seed) => {
    let x = cx + Math.cos(a0) * 12, y = cy + Math.sin(a0) * 12;
    const steps = 9 + Math.floor(seed * 5);
    const pts = [[x, y]];
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const a = a0 + Math.sin(i * 1.7 + seed * 9) * 0.22;
      x += Math.cos(a) * (len / steps) * (0.7 + Math.sin(i * 2.3 + seed * 5) * 0.3);
      y += Math.sin(a) * (len / steps) * (0.7 + Math.sin(i * 2.9 + seed * 7) * 0.3);
      pts.push([x, y]);
    }
    const stroke = (w, style) => {
      g.strokeStyle = style; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
      for (const [px, py] of pts) g.lineTo(px, py);
      g.stroke();
    };
    stroke(9, 'rgba(16,13,10,0.92)');
    stroke(3.2, 'rgba(196,120,52,0.75)');
    stroke(1.3, 'rgba(255,214,150,0.6)');
    // 分叉
    if (seed > 0.35) {
      const bi = Math.floor(steps * 0.45);
      const [bx, by] = pts[bi];
      const ba = a0 + (seed > 0.65 ? 0.8 : -0.7);
      g.strokeStyle = 'rgba(20,16,12,0.8)'; g.lineWidth = 4;
      g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + Math.cos(ba) * len * 0.32, by + Math.sin(ba) * len * 0.32); g.stroke();
      g.strokeStyle = 'rgba(200,130,60,0.5)'; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + Math.cos(ba) * len * 0.32, by + Math.sin(ba) * len * 0.32); g.stroke();
    }
  };
  for (let i = 0; i < 11; i++) {
    const a0 = (i / 11) * Math.PI * 2 + rand(-0.18, 0.18);
    drawCrack(a0, rand(170, 236), Math.random());
  }
  // 中心破碎区：几块更密的短裂
  for (let i = 0; i < 7; i++) drawCrack(rand(0, Math.PI * 2), rand(60, 120), Math.random());
  // 边缘径向淡出（方形画布不露边）
  g.globalCompositeOperation = 'destination-in';
  const mask = g.createRadialGradient(cx, cy, S * 0.12, cx, cy, S * 0.5);
  mask.addColorStop(0, 'rgba(0,0,0,1)');
  mask.addColorStop(0.62, 'rgba(0,0,0,0.85)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = mask;
  g.fillRect(0, 0, S, S);
  _crackTex = new THREE.CanvasTexture(c);
  _crackTex.colorSpace = THREE.SRGBColorSpace;
  return _crackTex;
}

// ---------------------------------------------------------------------------
// 公共小件（土系粒子：全部往下坠/从地里出来）
// ---------------------------------------------------------------------------

/** 一撮砂尘（GPU 爆发）：n 粒、带初速，默认下坠。 */
function grit(particles, x, y, z, {
  n = 8, speed = 5, vy = 8, size = 1.2, ttl = 1.0, gravity = -10, spread = 0,
} = {}) {
  particles?.spawn?.(x + (Math.random() - 0.5) * spread, y, {
    color: 0x9a8468, count: n, speed, vy, size, ttl, gravity, z: z + 0.6,
  });
}

/** 石屑两档（大块暗 + 小块亮，一起抛）。 */
function rockBurst(particles, x, y, z, n = 12) {
  particles?.spawn?.(x, y, {
    color: 0x7a674c, count: n, speed: 24, size: 1.9, ttl: 0.9, gravity: -22, z,
  });
  particles?.spawn?.(x, y, {
    color: 0xc4b494, count: Math.round(n * 0.6), speed: 13, size: 1.3, ttl: 1.2, gravity: -10, z,
  });
}

/** 鳞片碎块（CPU 贴图，带旋转与抛物坠）。 */
function scaleShards(particles, x, y, z, H, n = 8) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = rand(10, 26);
    const rec = particles?.spawnSprite?.(x + (Math.random() - 0.5) * H * 0.5, y + (Math.random() - 0.5) * H * 0.4, {
      texture: shardTexture(), width: H * rand(0.08, 0.16), height: H * rand(0.12, 0.2),
      z: z + 1.6 + Math.random() * 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6 + rand(6, 16),
      gravity: -32, ttl: rand(0.8, 1.3), scalePop: 0.5,
    });
    if (rec) rec.sprite.material.rotation = Math.random() * Math.PI * 2;
  }
}

/** 三道并行爪痕（命中目标处；screen-plane 斜切）。 */
function clawRake(particles, at, H, { scale = 1, ttl = 0.32, heavy = false } = {}) {
  for (let i = 0; i < 3; i++) {
    const off = (i - 1) * H * 0.15;
    const rec = particles?.spawnSprite?.(at.x, at.y + off, {
      texture: clawTexture(), width: H * 0.92 * scale, height: H * 0.13 * scale,
      z: at.z + 2.2, ttl, fadeIn: true, gravity: 0, scalePop: 0.45,
    });
    if (rec) rec.sprite.material.rotation = -0.5 + i * 0.16;
  }
  particles?.spawn?.(at.x, at.y, {
    color: 0xffe0a8, count: heavy ? 16 : 10, speed: 20, size: 0.9, ttl: 0.35, gravity: -12, z: at.z,
  });
}

/** 岩刺破土：多根锥体自地面下升起再坠回（下方部分被地板遮住 = 真破土）。 */
function spikeErupt(particles, base, H, n = 8) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
    const r = H * rand(0.18, 0.5);
    const rec = particles?.spawnSprite?.(base.x + Math.cos(a) * r, base.y - H * 0.42, {
      texture: spikeTexture(), width: H * rand(0.12, 0.2), height: H * rand(0.5, 0.8),
      z: base.z + Math.sin(a) * r * 0.45 + 2,
      vy: rand(46, 66), vx: Math.cos(a) * rand(-4, 4),
      gravity: -58, ttl: rand(0.5, 0.75), scalePop: 0.12,
    });
    if (rec) rec.sprite.material.rotation = rand(-0.35, 0.35);
  }
}

/** 向心土尘拖影（吸气/汇聚用：从 src 拽向 dst）。 */
function streakTo(particles, from, to, pull, w = 3.2, h = 0.95) {
  const vx = (to.x - from.x) / pull;
  const vy = (to.y - from.y) / pull;
  const rec = particles?.spawnSprite?.(from.x, from.y, {
    texture: streakTexture(), width: w, height: h, z: (from.z ?? 0) + 1.4,
    vx, vy, gravity: 0, ttl: pull, scalePop: 0.25,
  });
  if (rec) rec.sprite.material.rotation = Math.atan2(vy, vx);
}

/**
 * 爪犁地：岩刺沿地面逐段犁向目标（命中拍的「远程连接」——Boss 在远场，
 * 没有这条线，爪痕就只是凭空出现在玩家身上）。每段错开 30ms，最后一段与
 * 短扑抵近同刻。from/to 只给 xz（y 取 Boss 脚下地板）。
 */
function clawFurrow(ctx, deps, from, to, H) {
  const n = 5;
  for (let i = 1; i <= n; i++) {
    ctx.spawn(async (c) => {
      await c.wait(i * 30);
      const t = i / n;
      const x = from.x + (to.x - from.x) * t;
      const z = from.z + (to.z - from.z) * t;
      const y = from.y;
      const rec = deps.particles?.spawnSprite?.(x, y - H * 0.22, {
        texture: spikeTexture(), width: H * rand(0.05, 0.09), height: H * rand(0.15, 0.24),
        z: z + 1, vy: rand(24, 32), gravity: -42, ttl: rand(0.35, 0.5), scalePop: 0.1,
      });
      if (rec) rec.sprite.material.rotation = rand(-0.35, 0.35);
      deps.particles?.spawn?.(x, y + 0.2, {
        color: 0x9a8468, count: 3, speed: 3, vy: 7, size: 0.9, ttl: 0.5, gravity: -10, z,
      });
    });
  }
}

/** 低角度地面尘浪（世界环，平躺）。 */
function dustRing(ctx, deps, at, size, ms = 700, spin = 1.2) {
  return groundRing(ctx, deps, {
    at, size, ms, spin,
    color: [0.62, 0.53, 0.40], hot: [1.05, 0.9, 0.68],
  });
}

/** 机位反解（同 pyro）：按 bodyFrac/feetFrac 从舞台真 fov 解距离。 */
function poseFor(unit, camera, { bodyFrac, feetFrac, lateral = 0, tilt = 0 }) {
  const H = unitH(unit);
  const { fov = 24 } = camera?.framing ?? {};
  const k = 2 * Math.tan((fov * Math.PI) / 360);
  const viewH = H / bodyFrac;
  const dist = viewH / k;
  const lookY = unit.position.y + (feetFrac - 0.5) * viewH;
  return {
    position: { x: unit.position.x + lateral, y: lookY + tilt * viewH, z: unit.position.z + dist },
    lookAt: { x: unit.position.x, y: lookY, z: unit.position.z },
  };
}

/** 地裂贴花（转段常驻）：贴地平面，舞台销毁时摘除；返回 { mat }。 */
function spawnCrackDecal(ctx, scene, onStageDispose, at, H) {
  if (!scene) return null;
  const geo = new THREE.PlaneGeometry(H * 2.7, H * 2.7);
  const mat = new THREE.MeshBasicMaterial({
    map: crackTexture(), transparent: true, opacity: 0, depthWrite: false, fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'fx:pangolinCrackDecal';
  mesh.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
  mesh.position.set(at.x, at.y + 0.18, at.z);
  mesh.renderOrder = 1;
  scene.add(mesh);
  onStageDispose?.(() => {
    scene.remove(mesh);
    geo.dispose();
    mat.dispose();
  });
  return { mat };
}

// ---------------------------------------------------------------------------
// 自定义突进：claw = 短扑；burrow = 掘地潜行（P2 重击签名）
// ---------------------------------------------------------------------------

const BURROW = Object.freeze({ SINK: 250, TRAVEL: 480, ERUPT: 240 });
const CLAW = Object.freeze({ DASH: 170 });

function restoreSrc(src, sx, sy, sz) {
  const s = src._baseScale ?? 1;
  src.position.set(sx, sy, sz);
  src.scale.set(s, s, 1);
  src.resetPose?.();
  src.showStatus?.();
  src._pkAmbush = null;
}

function pangolinLunge() {
  return {
    async approach(ctx, deps, { src, sx, sy, sz, ux, uz, reach, dist, unit }) {
      const H = unitH(src);
      const mode = src._pkLunge ?? ((src._bossPhase ?? 0) >= 2 ? 'burrow' : 'claw');
      ctx.onKill(() => restoreSrc(src, sx, sy, sz));

      if (mode === 'burrow') {
        // 潜地：整体沉入地板（立牌下缘被地板深度裁掉 = 真钻地），地表只剩尘。
        // 血条随单位走——潜到玩家面前时会变成一块压住玩家的巨幅读数，先收起来
        src.hideStatus?.();
        grit(deps.particles, sx, sy + 0.5, sz, { n: 18, speed: 12, vy: 16, size: 1.5, ttl: 0.9, gravity: -12, spread: H * 0.9 });
        await ctx.custom(src.uniqueID, {
          durationMs: BURROW.SINK, ease: 'power2.in',
          onUpdate: (t) => {
            src.position.y = sy - H * 0.95 * sstep(t);
            src.setPose({ squash: 1 - 0.35 * t, widen: 1 + 0.12 * t, lean: 0.06 * t });
          },
        });
        // 地下潜行：地表尘脊按路程一段段拱起（玩家读「地底下有东西在逼近」）
        const gap = Math.max(H * 0.75, 18);
        const travel = Math.max(0, dist - gap);
        const cx = sx + ux * travel;
        const cz = sz + uz * travel;
        src._pkAmbush = { x: cx, z: cz };
        let lastK = -1;
        await ctx.custom(src.uniqueID, {
          durationMs: BURROW.TRAVEL, ease: 'power1.inOut',
          onUpdate: (t) => {
            src.position.x = sx + (cx - sx) * t;
            src.position.z = sz + (cz - sz) * t;
            src.position.y = sy - H * 0.95;
            const k = Math.floor(t * 6);
            if (k !== lastK) {
              lastK = k;
              const px = sx + (cx - sx) * (k / 6);
              const pz = sz + (cz - sz) * (k / 6);
              grit(deps.particles, px, sy + 0.4, pz, {
                n: 7, speed: 8, vy: 13, size: 1.4, ttl: 0.7, gravity: -14, spread: H * 0.55,
              });
            }
          },
        });
        // 破土：在原位猛地弹起，岩屑与尘环同帧
        deps.particles?.spawn?.(cx, sy + H * 0.2, {
          color: 0x8a7458, count: 30, speed: 30, size: 2.0, ttl: 0.8, gravity: -18, z: cz,
        });
        rockBurst(deps.particles, cx, sy + H * 0.25, cz, 10);
        deps.shake?.impulse?.(1.8);
        await ctx.custom(src.uniqueID, {
          durationMs: BURROW.ERUPT, ease: 'power3.out',
          onUpdate: (t) => {
            src.position.y = sy - H * 0.95 * (1 - t);
            const o = Math.sin(Math.PI * t);
            src.setPose({ squash: 1 - 0.35 * (1 - t) + 0.18 * o, widen: 1.12 - 0.12 * t - 0.08 * o, lean: 0.06 * (1 - t) + 0.10 * o });
          },
        });
      } else {
        // 爪击短扑：贴地前压，前爪在途中刮地（尘从脚边翻起）
        const travel = Math.min(reach, 8);
        grit(deps.particles, sx, sy + 0.4, sz, { n: 8, speed: 9, vy: 10, size: 1.3, ttl: 0.6, gravity: -14, spread: H * 0.7 });
        await ctx.custom(src.uniqueID, {
          durationMs: CLAW.DASH, ease: 'power2.in',
          onUpdate: (t) => {
            src.position.x = sx + ux * travel * t;
            src.position.z = sz + uz * travel * t;
            src.setPose({ lean: -0.12 + 0.34 * t, squash: 1 - 0.08 * t, widen: 1 + 0.06 * t });
            if (t > 0.45 && Math.random() < 0.22) {
              grit(deps.particles, src.position.x, sy + 0.35, src.position.z, {
                n: 3, speed: 7, vy: 9, size: 1.1, ttl: 0.5, gravity: -16, spread: H * 0.5,
              });
            }
          },
        });
      }
    },

    async recover(ctx, deps, { src, sx, sy, sz, ux, uz, reach }) {
      const H = unitH(src);
      const mode = src._pkLunge ?? ((src._bossPhase ?? 0) >= 2 ? 'burrow' : 'claw');
      ctx.onKill(() => restoreSrc(src, sx, sy, sz));
      if (mode !== 'burrow') {
        const travel = Math.min(reach, 8);
        await ctx.custom(src.uniqueID, {
          durationMs: 210, ease: 'power2.out',
          onUpdate: (t) => {
            src.position.x = sx + ux * travel * (1 - t);
            src.position.z = sz + uz * travel * (1 - t);
            src.setPose({ lean: 0.22 * (1 - t), squash: 1 - 0.04 * (1 - t) });
          },
        });
        restoreSrc(src, sx, sy, sz);
        return;
      }
      // 潜回：在突袭点再钻下去，地下退回原位，从原位重新破土（扬尘收势）
      const amb = src._pkAmbush ?? { x: sx + ux * Math.min(reach, 8), z: sz + uz * Math.min(reach, 8) };
      await ctx.wait(500);
      grit(deps.particles, amb.x, sy + 0.4, amb.z, { n: 12, speed: 10, vy: 12, size: 1.4, ttl: 0.8, gravity: -12, spread: H * 0.7 });
      await ctx.custom(src.uniqueID, {
        durationMs: 220, ease: 'power2.in',
        onUpdate: (t) => {
          src.position.y = sy - H * 0.95 * sstep(t);
          src.setPose({ squash: 1 - 0.32 * t, widen: 1 + 0.1 * t });
        },
      });
      await ctx.custom(src.uniqueID, {
        durationMs: 360, ease: 'power1.inOut',
        onUpdate: (t) => {
          src.position.x = amb.x + (sx - amb.x) * t;
          src.position.z = amb.z + (sz - amb.z) * t;
          src.position.y = sy - H * 0.95;
          if (t > 0.35 && t < 0.9 && Math.random() < 0.14) {
            grit(deps.particles, src.position.x, sy + 0.35, src.position.z, {
              n: 5, speed: 7, vy: 11, size: 1.3, ttl: 0.6, gravity: -14, spread: H * 0.5,
            });
          }
        },
      });
      await ctx.custom(src.uniqueID, {
        durationMs: 260, ease: 'power3.out',
        onUpdate: (t) => {
          src.position.y = sy - H * 0.95 * (1 - t);
          src.setPose({ squash: 0.68 + 0.32 * t, widen: 1.12 - 0.12 * t });
        },
      });
      grit(deps.particles, sx, sy + 0.4, sz, { n: 10, speed: 8, vy: 12, size: 1.3, ttl: 0.8, gravity: -12, spread: H * 0.7 });
      restoreSrc(src, sx, sy, sz);
      src._pkAmbush = null;
    },
  };
}

// ---------------------------------------------------------------------------
// 起手 beat
// ---------------------------------------------------------------------------

/** 锁甲（P1 首拍 防御2）：甲片自下而上合缝，三记锁扣火花从脊背迸出。 */
async function armorLock({ ctx, deps, unit }) {
  const H = unitH(unit);
  const id = unit.uniqueID;
  const at = { x: unit.position.x, y: unit.position.y, z: unit.position.z };
  const seal = plateSeal(ctx, deps, { at, h: H * 1.02, color: 0xc8a05a, ms: 720 });
  ctx.spawn(async (c) => {
    for (let i = 0; i < 3; i++) {
      const px = at.x + (i - 1) * H * 0.2;
      const py = at.y + H * (0.34 + i * 0.07);
      deps.particles?.spawn?.(px, py, {
        color: 0xffe0a0, count: 7, speed: 14, size: 0.9, ttl: 0.35, gravity: -12, z: at.z + 1,
      });
      deps.shake?.impulse?.(0.25);
      await c.wait(160);
    }
  });
  // 一沉一锁：先压下去，再锁死在原地
  await ctx.custom(id, {
    durationMs: 250, ease: 'power2.in',
    onUpdate: (t) => unit.setPose({ squash: 1 - 0.07 * t, widen: 1 + 0.05 * t, lean: -0.03 * t }),
  });
  unit.flash?.(0xd9b06a);
  await ctx.custom(id, {
    durationMs: 330, ease: 'power2.out',
    onUpdate: (t) => unit.setPose({ squash: 0.93 + 0.07 * t, widen: 1.05 - 0.05 * t, lean: -0.03 * (1 - t) }),
  });
  // 甲缝挤出尘：锁得越紧，缝里的土越往外冒
  grit(deps.particles, at.x, at.y + H * 0.12, at.z, { n: 14, speed: 6, vy: -2, size: 1.2, ttl: 1.1, gravity: -8, spread: H * 1.0 });
  await Promise.all([seal?.promise ?? Promise.resolve()]);
  unit.resetPose?.();
}

/** 负山（P1 无盾拍 盾50+脆弱如山）：五片石板破土立起成墙，随后石墙透出脆裂线。 */
async function mountainRaise({ ctx, deps, unit }) {
  const H = unitH(unit);
  const id = unit.uniqueID;
  const at = { x: unit.position.x, y: unit.position.y, z: unit.position.z };
  // 矮石垒：贴地一圈参差石板，不遮头脸（护盾罩负责「罩」，石墙只交代「脚下立起山」
  const offs = [
    { x: -0.72, y: 0.16, rot: 0.14, lag: 0 },
    { x: -0.38, y: 0.10, rot: -0.10, lag: 60 },
    { x: -0.04, y: 0.18, rot: 0.05, lag: 120 },
    { x: 0.32, y: 0.12, rot: -0.13, lag: 60 },
    { x: 0.68, y: 0.17, rot: 0.11, lag: 0 },
  ];
  // 前摇：伏低撑身（把山背起来）
  const pose = ctx.custom(id, {
    durationMs: 520, ease: 'power2.in',
    onUpdate: (t) => unit.setPose({ squash: 1 - 0.12 * t, widen: 1 + 0.09 * t, lean: -0.04 * t }),
  });
  // 石板自地下升起：越边的板越高越慢，形成参差的墙
  for (const [i, o] of offs.entries()) {
    const rec = deps.particles?.spawnSprite?.(at.x + o.x * H, at.y - H * 0.28, {
      texture: slabTexture(), width: H * 0.42, height: H * 0.5,
      z: at.z + H * 0.2 + i * 0.06, ttl: 2.0, gravity: 0, scalePop: 0.03,
    });
    if (!rec) continue;
    rec.sprite.material.rotation = o.rot;
    ctx.spawn(async (c) => {
      await c.wait(o.lag);
      // rec 是粒子记录（不是 Object3D）：走进度代理写 rec.y（tweenRaw(rec,{y}) 会打空）
      const st = { t: 0 };
      const y0 = at.y - H * 0.28;
      const y1 = at.y + o.y * H;
      await c.tweenRaw(st, { t: 1 }, {
        durationMs: 340, ease: 'power3.out',
        onUpdate: () => { rec.y = y0 + (y1 - y0) * st.t; },
      });
      grit(deps.particles, at.x + o.x * H, at.y + 0.4, at.z + H * 0.14, {
        n: 7, speed: 8, vy: 12, size: 1.2, ttl: 0.8, gravity: -10, spread: H * 0.18,
      });
      deps.shake?.impulse?.(0.2);
    });
  }
  deps.particles?.spawn?.(at.x, at.y + 0.5, {
    color: 0x9a8468, count: 20, speed: 10, vy: 8, size: 1.4, ttl: 1.0, gravity: -8, z: at.z + 1,
  });
  await ctx.wait(560);
  // 脆裂线：石墙合拢后从墙心撕开三道（脆弱如山的预告）
  for (let i = 0; i < 3; i++) {
    const rec = deps.particles?.spawnSprite?.(at.x + (i - 1) * H * 0.34, at.y + H * 0.24, {
      texture: clawTexture(), width: H * 0.34, height: H * 0.06,
      z: at.z + H * 0.24, ttl: 0.4, fadeIn: true, gravity: 0, scalePop: 0.2,
    });
    if (rec) rec.sprite.material.rotation = Math.PI / 2 + (i - 1) * 0.3;
    await ctx.wait(90);
  }
  unit.flash?.(0xb8a888);
  deps.shake?.impulse?.(0.7);
  ctx.spawn((c) => dustRing(c, deps, { x: at.x, y: at.y, z: at.z }, H * 1.6, 760, 1.5));
  await pose;
  unit.resetPose?.();
}

/** 竖鳞（P1 荆棘拍）：背甲整圈竖刺 + 刺尖走光。 */
async function scaleBristle({ ctx, deps, unit }) {
  const H = unitH(unit);
  const at = { x: unit.position.x, y: unit.position.y, z: unit.position.z };
  const quills = quillRise(ctx, deps, { at, h: H, color: 0xd8c25a, ms: 760 });
  await ctx.custom(unit.uniqueID, {
    durationMs: 260, ease: 'power2.out',
    onUpdate: (t) => unit.setPose({ squash: 1 - 0.05 * t, widen: 1 + 0.07 * t }),
  });
  // 金属走光：四个随机刺尖先后亮一瞬
  ctx.spawn(async (c) => {
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2;
      deps.particles?.spawnSprite?.(
        at.x + Math.cos(a) * H * 0.5, at.y + H * (0.34 + Math.sin(a) * 0.22), {
          texture: glowTexture(0xffe6b0), width: H * 0.18, height: H * 0.18,
          z: at.z + 2, ttl: 0.22, fadeIn: true, gravity: 0,
        });
      await c.wait(120);
    }
  });
  deps.particles?.spawn?.(at.x, at.y + H * 0.42, {
    color: 0xd8c25a, count: 12, speed: 14, size: 0.8, ttl: 0.5, gravity: -6, z: at.z + 1,
  });
  unit.flash?.(0xc8b06a);
  await Promise.all([quills?.promise ?? Promise.resolve()]);
  unit.resetPose?.();
}

/** 裂地爪（P1 攻击 12）：后仰抬爪 → 落爪前压；投射身体在 damage 拍的短扑。 */
async function clawWindup({ ctx, deps, unit }) {
  const H = unitH(unit);
  const id = unit.uniqueID;
  const at = { x: unit.position.x, y: unit.position.y, z: unit.position.z };
  unit._pkLunge = 'claw';
  grit(deps.particles, at.x - H * 0.3, at.y + 0.5, at.z, { n: 7, speed: 8, vy: 10, size: 1.2, ttl: 0.7, gravity: -12, spread: H * 0.5 });
  await ctx.custom(id, {
    durationMs: 260, ease: 'power2.in',
    onUpdate: (t) => unit.setPose({ lean: -0.12 * t, squash: 1 - 0.06 * t, widen: 1 + 0.05 * t }),
  });
  unit.flash?.(0xc8a05a);
  deps.shake?.impulse?.(0.3);
  await ctx.custom(id, {
    durationMs: 130, ease: 'power2.in',
    onUpdate: (t) => unit.setPose({ lean: -0.12 + 0.26 * t, squash: 0.94 + 0.08 * t, widen: 1.05 - 0.04 * t }),
  });
  unit.resetPose?.();
}

/** 三连耙（P1 攻击 3×3）：三记快挥（左-右-左），每记配一道身前爪风。 */
async function tripleRake({ ctx, deps, unit }) {
  const H = unitH(unit);
  const id = unit.uniqueID;
  const at = { x: unit.position.x, y: unit.position.y, z: unit.position.z };
  unit._pkLunge = 'claw';
  for (let i = 0; i < 3; i++) {
    const dir = i % 2 === 0 ? 1 : -1;
    const rec = deps.particles?.spawnSprite?.(
      at.x + dir * H * 0.25, at.y + H * (0.32 + i * 0.06), {
        texture: clawTexture(), width: H * 0.55, height: H * 0.09,
        z: at.z + 2, ttl: 0.26, fadeIn: true, gravity: 0, scalePop: 0.35,
      });
    if (rec) rec.sprite.material.rotation = dir * 0.55;
    unit.flash?.(0xc8a05a);
    await ctx.custom(id, {
      durationMs: 120, ease: i === 0 ? 'power2.in' : 'power1.inOut',
      onUpdate: (t) => unit.setPose({
        lean: dir * (0.06 + 0.10 * Math.sin(t * Math.PI)),
        squash: 1 - 0.03 * Math.sin(t * Math.PI),
        widen: 1 + 0.03 * Math.sin(t * Math.PI),
      }),
    });
    grit(deps.particles, at.x + dir * H * 0.35, at.y + 0.4, at.z, {
      n: 4, speed: 7, vy: 8, size: 1.0, ttl: 0.5, gravity: -14, spread: H * 0.35,
    });
  }
  unit.resetPose?.();
}

/** 掘地蓄势（P2 每拍）：伏地掘土，双爪刨地 → 记录蓄势层数（破土岩刺按它加码）。 */
async function digWindup({ ctx, deps, unit }) {
  const H = unitH(unit);
  const id = unit.uniqueID;
  const at = { x: unit.position.x, y: unit.position.y, z: unit.position.z };
  unit._pkLunge = 'burrow';
  unit._pkMomentum = unit.getEffectStacks?.('momentum') ?? 0;
  const plates = unit._fxLayer?.get('bossPlates');
  plates?.setHeat?.(1);
  await ctx.custom(id, {
    durationMs: 420, ease: 'power2.in',
    onUpdate: (t) => unit.setPose({ squash: 1 - 0.20 * t, widen: 1 + 0.12 * t, lean: 0.05 * t }),
  });
  // 双爪刨地：身前两道斜爪风 + 三次向下喷的碎土
  for (let i = 0; i < 2; i++) {
    const rec = deps.particles?.spawnSprite?.(
      at.x + (i === 0 ? -1 : 1) * H * 0.24, at.y + H * 0.08, {
        texture: clawTexture(), width: H * 0.5, height: H * 0.1,
        z: at.z + 2, ttl: 0.3, fadeIn: true, gravity: 0, scalePop: 0.3,
      });
    if (rec) rec.sprite.material.rotation = Math.PI * 0.5 + (i === 0 ? -0.5 : 0.5);
  }
  ctx.spawn(async (c) => {
    for (let i = 0; i < 3; i++) {
      grit(deps.particles, at.x + rand(-H * 0.35, H * 0.35), at.y + 0.35, at.z + H * 0.1, {
        n: 8, speed: 9, vy: 16, size: 1.5, ttl: 0.7, gravity: -16, spread: H * 0.4,
      });
      deps.shake?.impulse?.(0.35);
      await c.wait(110);
    }
  });
  unit.flash?.(0xd9b06a);
  await ctx.wait(190);
  await ctx.custom(id, {
    durationMs: 150, ease: 'power2.out',
    onUpdate: (t) => unit.setPose({ squash: 0.8 + 0.2 * t, widen: 1.12 - 0.12 * t, lean: 0.05 * (1 - t) }),
  });
  unit.resetPose?.();
}

/** 起手分流：按意图 kinds 与 P1 拍位（actionIndex / defend）选拍。 */
async function pangolinAct(a) {
  const { ctx, unit, kinds } = a;
  const phase2 = (unit._bossPhase ?? 0) >= 2;
  if (kinds.some(isAttackKind)) {
    if (phase2) return digWindup(a);
    // P1 普攻（12，hits=1）与三连耙（3×3，hits=3）同 kinds，靠意图 hits 分档
    return (a.args?.hits ?? 1) >= 2 ? tripleRake(a) : clawWindup(a);
  }
  if (kinds.includes('defend')) return mountainRaise(a);
  if (kinds.some(isBuffKind)) {
    if (phase2) return undefined;   // P2 的 buff 都并进重击拍，无独立增益拍
    // 首拍（actionIndex 0）= 防御2：锁甲；其余纯 buff = 荆棘：竖鳞
    return (unit.actionIndex ?? 0) === 0 ? armorLock(a) : scaleBristle(a);
  }
  // 转段拍（kinds ['unknown']）：让位给 pangolinKingP2 大剧本
  return undefined;
}

// ---------------------------------------------------------------------------
// 命中 beat：claw = 三道爪痕；burrow = 岩刺自脚下爆起
// ---------------------------------------------------------------------------

function findPangolin(deps) {
  for (const { handle } of deps.cast?.query?.('unit:') ?? []) {
    if (handle?._defId === 'pangolinKing') return handle;
  }
  return null;
}

async function pangolinHitBeat(ctx, deps, args) {
  const { unit, dealt } = args;
  const heavy = args.fx.tier === 'heavy';
  const boss = findPangolin(deps);
  const mode = boss?._pkLunge ?? ((boss?._bossPhase ?? 0) >= 2 ? 'burrow' : 'claw');
  const H = unitH(unit);
  const feet = { x: unit.position.x, y: unit.position.y, z: unit.position.z };
  const at = { x: feet.x, y: feet.y + H * 0.5, z: feet.z };
  const pal = {
    color: heavy ? [0.98, 0.72, 0.34] : [0.92, 0.76, 0.48],
    hot: heavy ? [1.28, 1.02, 0.62] : [1.15, 0.98, 0.72],
    rim: [1.0, 0.82, 0.55],
    sparkColor: heavy ? 0xf0c070 : 0xe0b878,
    dustColor: 0x9a8a6a,
    flashColor: 0xffe6c0,
    shakeK: heavy ? 2.1 : 1.5,
  };

  if (mode === 'burrow') {
    // 命中拍在潜地突袭的破土帧开演（approach 末尾）
    await ctx.wait(900);
    const mom = boss?._pkMomentum ?? 0;
    const n = 8 + Math.min(5, Math.round(mom / 5));
    spikeErupt(deps.particles, feet, H, n);
    rockBurst(deps.particles, feet.x, feet.y + 0.4, feet.z, 12 + Math.round(mom / 4));
    deps.particles?.spawn?.(feet.x, feet.y + 0.3, {
      color: 0x9a8468, count: 26, speed: 24, size: 2.1, ttl: 1.0, gravity: -12, z: feet.z,
    });
    ctx.spawn((c) => dustRing(c, deps, { x: feet.x, y: feet.y, z: feet.z }, H * 2.0, 700, 1.7));
    ctx.spawn((c) => screenFlash(c, deps, { intensity: 0.12, ms: 180, color: 0xffe0b8 }));
    deps.shake?.impulse?.(heavy ? 3.2 : 2.2);
    clawRake(deps.particles, at, H, { scale: 1.1, heavy: true });
    await enemyImpactBeat(ctx, deps, { ...args, pal });
    return;
  }

  // P1 爪击：短扑抵近后撕三道（normal/rapid 按档缩尺寸）。
  // 先沿地面犁出裂隙（三线 = 单次重爪，单线 = 连耙的每一段），把远场的 Boss
  // 与玩家连起来——命中拍起跑时短扑也在同一刻进行（approach 170ms）。
  if (boss) {
    const src = { x: boss.position.x, y: boss.position.y, z: boss.position.z };
    const dx = feet.x - src.x;
    const dz = feet.z - src.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len;
    const nz = dx / len;
    const lines = args.fx.tier === 'rapid' ? 1 : 3;
    for (let l = 0; l < lines; l++) {
      const off = (l - (lines - 1) / 2) * H * 0.16;
      clawFurrow(ctx, deps, { x: src.x + nx * off, y: src.y, z: src.z + nz * off },
        { x: feet.x + nx * off * 0.4, z: feet.z + nz * off * 0.4 }, H);
    }
  }
  await ctx.wait(heavy ? 160 : 140);
  clawRake(deps.particles, at, H, {
    scale: heavy ? 1.0 : (args.fx.tier === 'rapid' ? 0.62 : 0.8),
    heavy,
  });
  deps.particles?.spawn?.(feet.x, feet.y + 0.3, {
    color: 0x9a8468, count: heavy ? 12 : 7, speed: 10, size: 1.2, ttl: 0.7, gravity: -12, z: feet.z,
  });
  if (heavy) {
    ctx.spawn((c) => dustRing(c, deps, { x: feet.x, y: feet.y, z: feet.z }, H * 1.2, 620, 1.2));
  }
  await enemyImpactBeat(ctx, deps, { ...args, pal });
}

// ---------------------------------------------------------------------------
// 转阶段：崩甲狂怒（净化拍，放行 ≈3.6s）
// ---------------------------------------------------------------------------

async function pangolinKingP2({
  ctx, args, cast, particles, shake, vignette, camera, scene, uiScene,
  onStageDispose, runScript, unitById,
}) {
  const unit = unitById(args.unit);
  if (!unit) return;
  const id = unit.uniqueID;
  const s = unit._baseScale ?? 1;
  const H = unitH(unit);
  const ux = unit.position.x, uy = unit.position.y, uz = unit.position.z;
  const chest = { x: ux, y: uy + H * 0.55, z: uz };
  const mouth = { x: ux - H * 0.28, y: uy + H * 0.42, z: uz };
  const fxDeps = { scene, uiScene, particles, cast, shake };
  const plates = unit._fxLayer?.get('bossPlates');
  const mood = cast.get('light:mood');
  const dim0 = mood?.dim ?? 1;
  const fire0 = mood?.fireGain ?? 1;
  let moodHanded = false;
  ctx.onKill(() => {
    if (!moodHanded && mood) { mood.dim = dim0; mood.fireGain = fire0; }
    unit._pkChargeHeat = 0;
    unit.scale.set(s, s, 1);
    unit.resetPose?.();
    shake.sustain?.(0);
    camera?.clearFovOffset?.('pkP2Roar');
  });

  // —— 机位：转段全程只在「对抗机位」里演，不切特写 ——
  const base = camera?.basePose;
  const p2Pose = base
    ? duelPose(base, { fovScale: 0.78, elScale: 0.42 })
    : poseFor(unit, camera, { bodyFrac: 0.6, feetFrac: 0.64, lateral: -10, tilt: -0.02 });
  camera?.pushOverride?.('pangolinP2', {
    poses: p2Pose ? { pangolinP2: p2Pose } : {},
    onEnter: (dir) => { if (p2Pose) dir.flyTo('pangolinP2', { durationMs: 820, ease: 'power2.out' }); },
  });

  // —— 蓄势（大地倒吸）：压身 + 甲片升温 + 碎石被吸进甲缝 + 渐强的地颤 ——
  const CHARGE = 1500;
  const SURGE = [[0.22, 0x8a6a38], [0.55, 0xb8863a], [0.82, 0xe0b060]];
  const surged = SURGE.map(() => false);
  ctx.spawn(async (c) => {
    // 碎石倒吸：外圈 8 拍，越吸越急（大地之力被拽进甲缝）
    for (let i = 0; i < 8; i++) {
      const n = 3 + Math.min(i, 3);
      const pull = 0.5 - i * 0.035;
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2;
        const r = H * rand(0.7, 1.35);
        streakTo(particles, {
          x: ux + Math.cos(a) * r,
          y: uy + H * 0.38 + Math.sin(a) * r * 0.5,
          z: uz + Math.sin(a) * r * 0.25,
        }, chest, pull, 3.4, 1.0);
      }
      await c.wait(170);
    }
  });
  ctx.spawn(async (c) => {
    // 地颤随蓄势爬升；地面碎砂一跳一跳
    for (let i = 0; i < 6; i++) {
      shake.sustain?.(0.06 + i * 0.045);
      grit(particles, ux + rand(-H * 0.9, H * 0.9), uy + 0.35, uz + H * 0.15, {
        n: 6, speed: 4, vy: 15, size: 1.4, ttl: 0.9, gravity: -18, spread: H * 0.25,
      });
      await c.wait(220);
    }
  });
  ctx.spawn(async (c) => {
    // 甲片温度：0 → 1 一路爬，导演会读 _pkChargeHeat 保底
    for (let i = 1; i <= 10; i++) {
      unit._pkChargeHeat = i / 10;
      plates?.setHeat?.(i / 10);
      await c.wait(CHARGE / 10);
    }
  });
  ctx.spawn((c) => lampPulse(c, { cast }, {
    name: 'light:fx1', at: { x: ux, y: uy + H * 0.5, z: uz + 2 }, color: [1, 0.62, 0.24],
    peak: 900, attackMs: Math.round(CHARGE * 0.85), decayMs: 200,
  }));
  await ctx.custom(id, {
    durationMs: CHARGE, ease: 'none',
    onUpdate: (t) => {
      const sec = (t * CHARGE) / 1000;
      const press = sstep(clamp01(t / 0.62));
      const held = Math.max(0, (t - 0.62) / 0.38);
      const sh = held * Math.sin(sec * Math.PI * 2 * 9) * 0.018;
      unit.scale.set(s * (1 + 0.06 * press + sh * 0.5), s * (1 - 0.22 * press + sh), 1);
      SURGE.forEach(([at, col], i) => {
        if (surged[i] || t < at) return;
        surged[i] = true;
        unit.flash?.(col);
      });
    },
  });

  // —— 崩甲：甲片按 hash 崩飞 + 双细环 + 石屑风暴 + 地裂贴花就位 ——
  unit._bossPhase = 2;
  unit._armorShattered = true;
  unit._pkChargeHeat = 0;
  plates?.shatter?.();
  unit.flash?.(0xffe0b0);
  ctx.spawn((c) => screenFlash(c, fxDeps, { intensity: 0.22, ms: 260, color: 0xffd9a8 }));
  scaleShards(particles, ux, uy + H * 0.5, uz, H, 26);
  // 大板碎片：翻着跟头坠出去（甲不是碎屑，是整片掉）
  for (let i = 0; i < 7; i++) {
    const a = Math.random() * Math.PI * 2;
    const rec = particles?.spawnSprite?.(ux + Math.cos(a) * H * 0.3, uy + H * rand(0.25, 0.7), {
      texture: slabTexture(), width: H * rand(0.2, 0.3), height: H * rand(0.3, 0.45),
      z: uz + 2 + Math.random() * 2, vx: Math.cos(a) * rand(8, 18), vy: rand(8, 20),
      gravity: -34, ttl: rand(1.0, 1.6), scalePop: 0.2,
    });
    if (rec) rec.sprite.material.rotation = Math.random() * Math.PI * 2;
  }
  // 双细环 + 地浪 + 石屑风暴
  const WAVES = [
    { w0: 0.35, w1: 2.7, ttl: 0.6, ms: 600 },
    { w0: 0.25, w1: 1.9, ttl: 0.82, ms: 800 },
  ];
  for (const [i, wv] of WAVES.entries()) {
    const ring = particles?.spawnSprite?.(ux, chest.y, {
      texture: ringTexture(true), width: H * wv.w0, height: H * wv.w0, z: uz + 2 + i,
      ttl: wv.ttl, gravity: 0,
    });
    if (!ring) continue;
    ctx.spawn(async (c) => {
      await c.tweenRaw(ring, { w: H * wv.w1, h: H * wv.w1 }, { durationMs: wv.ms, ease: 'power2.out' });
    });
  }
  ctx.spawn((c) => dustRing(c, fxDeps, { x: ux, y: uy, z: uz }, H * 2.4, 820, 1.9));
  particles?.spawn?.(ux, chest.y, { count: 44, color: 0x9a8468, speed: 44, size: 2.2, ttl: 0.9, gravity: -14, z: uz });
  particles?.spawn?.(ux, chest.y, { count: 22, color: 0xd8c8a8, speed: 66, size: 1.4, ttl: 0.7, gravity: -10, z: uz });
  particles?.spawn?.(ux, chest.y, { count: 16, color: 0x8a7458, speed: 20, size: 2.6, ttl: 1.5, gravity: -6, z: uz });
  shake.impulse(7.2);
  vignette?.pulse?.(3);
  // 镜头被崩甲顶一下（FOV 收窄再放开 —— 只动偏移通道）
  const fovSt = { v: 0 };
  const applyFov = () => camera?.setFovOffset?.('pkP2Roar', fovSt.v);
  ctx.spawn((c) => c.tweenRaw(fovSt, { v: -2.4 }, { durationMs: 200, ease: 'power2.out', onUpdate: applyFov }));
  ctx.spawn(async (c) => {
    await c.wait(320);
    await c.tweenRaw(fovSt, { v: 0 }, { durationMs: 780, ease: 'power2.inOut', onUpdate: applyFov });
  });
  // 地裂贴花：甲碎的同时刻在地面刻下痕迹，常驻到战斗结束
  const crack = spawnCrackDecal(ctx, scene, onStageDispose, { x: ux, y: uy, z: uz }, H);
  if (crack) ctx.tweenRaw(crack.mat, { opacity: 0.9 }, { durationMs: 900, ease: 'power2.out' });
  // 过冲：崩甲一瞬被自己的劲顶起
  await ctx.custom(id, {
    durationMs: 220, ease: 'power3.out',
    onUpdate: (t) => unit.scale.set(s * (0.9 + 0.18 * t), s * (0.78 + 0.22 * t), 1),
  });
  await ctx.custom(id, {
    durationMs: 300, ease: 'power2.out',
    onUpdate: (t) => unit.scale.set(s * (1.08 - 0.08 * t), s * (1.0 + 0.0 * t), 1),
  });
  unit.scale.set(s, s, 1);

  // —— 怒吼：仰首、尘柱、两圈声波、地裂余震 ——
  await ctx.custom(id, {
    durationMs: 420, ease: 'power2.out',
    onUpdate: (t) => unit.setPose({ lean: -0.11 * t, widen: 1 + 0.14 * t, squash: 1 + 0.02 * t }),
  });
  unit.flash?.(0xffc884);
  for (let i = 0; i < 3; i++) {
    particles?.spawn?.(mouth.x, mouth.y, {
      count: 14, color: i === 0 ? 0xffd9a0 : 0xc8b494, speed: 6, vx: -10, vy: 26,
      size: 2.2, ttl: 0.85, gravity: -8, z: uz + 1.5,
    });
    await ctx.wait(130);
  }
  for (const [i, w1] of [[0, 2.2], [1, 1.6]]) {
    const ring = particles?.spawnSprite?.(mouth.x, mouth.y, {
      texture: ringTexture(true), width: H * 0.35, height: H * 0.35, z: uz + 2 + i,
      ttl: 0.72, gravity: 0,
    });
    if (!ring) continue;
    ctx.spawn((c) => c.tweenRaw(ring, { w: H * w1, h: H * w1 }, { durationMs: 700, ease: 'power2.out' }));
  }
  ctx.spawn((c) => dustRing(c, fxDeps, { x: ux, y: uy, z: uz }, H * 3.0, 900, 2.2));
  // 碎甲后的落石：从画面上方坠回地面
  for (let i = 0; i < 10; i++) {
    const rec = particles?.spawnSprite?.(ux + rand(-H * 1.1, H * 1.1), uy + H * rand(1.2, 2.2), {
      texture: shardTexture(), width: H * rand(0.08, 0.14), height: H * rand(0.11, 0.18),
      z: uz + rand(-1, 3), vx: rand(-6, 6), vy: rand(-4, 4), gravity: -40,
      ttl: rand(0.7, 1.1), scalePop: 0.2,
    });
    if (rec) rec.sprite.material.rotation = Math.random() * Math.PI * 2;
  }
  shake.impulse(2.6);
  shake.sustain?.(0.22);
  await ctx.wait(620);
  shake.sustain?.(0);
  unit.resetPose?.();

  // —— 蜕变收尾：体缝熔金、琥珀怒光、暗场、常驻地尘 ——
  moodHanded = true;
  plates?.setHeat?.(1);
  for (let i = 0; i < 3; i++) {
    unit.flash?.(0xe0b060);
    await ctx.wait(120);
  }
  const rage = cast.get('light:fx0');
  if (rage) {
    rage.color.set(0xffb060);
    rage.distance = H * 6;
    rage.position.set(0, H * 0.5, H * 0.3);
    unit.add(rage);
    onStageDispose?.(() => { rage.intensity = 0; unit.remove(rage); });
  }
  const dust = particles?.spawnEmitter?.(ux, uy + H * 0.05, {
    rate: 0, radius: H * 0.55, color: 0x9a8a70, speed: 2.6, ttl: 3.0, size: 1.4,
    gravity: 1.4, zJitter: H * 0.35, z: uz,
  });
  if (dust) onStageDispose?.(() => dust.stop());
  (runScript ?? ((body) => ctx.spawn(body)))(async (c) => {
    const jobs = [];
    if (rage) jobs.push(c.tweenRaw(rage, { intensity: 1500 }, { durationMs: 900, ease: 'power2.out' }));
    if (dust) jobs.push(c.tweenRaw(dust, { rate: 7 }, { durationMs: 1500 }));
    if (mood) {
      jobs.push(c.tweenRaw(mood, { dim: dim0 * 0.78 }, { durationMs: 1600, delayMs: 150 }));
      jobs.push(c.tweenRaw(mood, { fireGain: fire0 * 0.92 }, { durationMs: 1600, delayMs: 150 }));
    }
    await Promise.all(jobs);
    // 常驻低频：地尘从甲缝/尾端一阵阵漏出来（站在那里的东西在往下掉土）
    for (;;) {
      await c.wait(2400 + Math.random() * 1800);
      if (!unit.parent || unit._dead) break;
      grit(particles, ux + rand(-H * 0.6, H * 0.6), uy + 0.4, uz + rand(-1, 2), {
        n: 5, speed: 5, vy: 9, size: 1.2, ttl: 1.0, gravity: -10, spread: H * 0.2,
      });
      plates?.setHeat?.(0.95);
    }
  });

  // 机位归位（先飞回再弹栈，避免硬切）
  await camera?.flyHome?.({ durationMs: 760, ease: 'power2.inOut' });
  camera?.popOverride?.('pangolinP2');
  unit.restoreColor?.();
}


// ---------------------------------------------------------------------------
// 注册
// ---------------------------------------------------------------------------

export function registerPangolinKingScripts(register) {
  register('bosses/pangolinKingP2', pangolinKingP2);
  registerEnemyHitBeat('pangolinKing', pangolinHitBeat);
  registerEnemyAct('pangolinKing', pangolinAct);
  registerEnemyLunge('pangolinKing', pangolinLunge());

  // 常驻状态导演：甲在 = 板甲显形（上甲扫掠）；甲碎 = 板形退场、体缝熔金承蓄势。
  // 转段蓄势窗的甲片升温走 _pkChargeHeat（sync 拍会按投影重算 heat，必须给脚本留上限）。
  registerBossStateFx('pangolinKing', (obj, unitProj) => {
    if (unitProj.isDead) return;
    const def = unitProj.effects?.find((e) => e.effectId === 'defense');
    const mom = unitProj.effects?.find((e) => e.effectId === 'momentum')?.stacks ?? 0;
    const armorOn = (def?.stacks ?? 0) > 0 && !obj._armorShattered;
    const shattered = !!obj._armorShattered;
    const heat = clamp01(
      (obj._pkChargeHeat ?? 0) * 0.9
      + (shattered ? 0.55 + mom / 18 : mom / 16),
    );
    // 板甲纵横比取立牌真实宽高：默认 0.66 是竖构图口径，横构图会把菱形鳞阵拉成
    // 一排横金条（穿山甲立绘 ≈2.2）
    const params = obj.body?.geometry?.parameters;
    const aspect = (params?.width && params?.height) ? params.width / params.height : undefined;
    if (armorOn || heat > 0.02) {
      obj._fxLayer?.overlay('bossPlates', 2, (l) => makePlateArmor(l, aspect ? { aspect } : {}));
    }
    obj._fxLayer?.setLevel('bossPlates', armorOn || heat > 0.02 ? 1 : 0);
    obj._fxLayer?.get('bossPlates')?.setHeat?.(heat);
  });

  // 受击补充：甲在 = 打铁（金属火花 + 碎鳞）；甲碎 = 尘 + 体缝热涌；
  // 山盾被打穿 = 岩块崩落（配合 shieldDome 的碎裂演出）
  registerBossHurtFx('pangolinKing', (ctx, deps, { unit, dealt, absorbed }) => {
    const H = unitH(unit);
    const plates = unit._fxLayer?.get('bossPlates');
    const px = unit.position.x;
    const py = unit.position.y + H * 0.5;
    const pz = unit.position.z;
    const armored = plates && plates.levelNow() > 0.25 && !unit._armorShattered;
    if (armored) {
      plates.clank();
      deps.particles?.spawn?.(px, py, {
        color: 0xffe0a0, count: Math.min(4 + Math.round(dealt / 4), 14), speed: 18,
        size: 0.9, ttl: 0.35, gravity: -16, z: pz + 1,
      });
      deps.particles?.spawn?.(px, py, {
        color: 0x8a7a62, count: Math.min(3 + Math.round(dealt / 5), 10), speed: 12,
        size: 1.1, ttl: 0.7, gravity: -14, z: pz + 1,
      });
      scaleShards(deps.particles, px, py, pz, H, 2 + Math.min(3, Math.round(dealt / 8)));
    } else {
      deps.particles?.spawn?.(px, py, {
        color: 0xb8a98c, count: Math.min(4 + Math.round(dealt / 6), 10), speed: 11,
        size: 1.2, ttl: 0.8, gravity: -10, z: pz + 1,
      });
      deps.particles?.spawn?.(px, py, {
        color: 0xff9a4a, count: 3 + Math.min(3, Math.round(dealt / 9)), speed: 9,
        size: 0.8, ttl: 0.5, gravity: -6, z: pz + 1,
      });
      plates?.setHeat?.(1);
    }
    if (absorbed > 0 && unit.shield <= 0) {
      // 山壳被打穿：石墙整片垮下来
      rockBurst(deps.particles, px, py, pz, 16);
      deps.particles?.spawn?.(px, unit.position.y + 0.6, {
        color: 0x9a8468, count: 22, speed: 18, size: 2.0, ttl: 1.1, gravity: -10, z: pz,
      });
      scaleShards(deps.particles, px, py, pz, H, 6);
      deps.shake?.impulse?.(2.0);
    }
  });
}
