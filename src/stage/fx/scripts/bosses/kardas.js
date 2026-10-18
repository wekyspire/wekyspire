// Boss 剧本：卡达斯（kardas，11 层 Boss 池三之一）。一只 Boss 的全部自定义演出聚合在
// 本文件（内容归属原则，同 pyro.js）。
//
// 主题（lore：狂躁魔化古姆拉，獠牙利爪电离空气）＝「雷兽」：
//   所有电都以**世界空间面片雷**出现（fx/plasmaStorm.js）——白热内核推过 bloom 阈
//   出真电光晕，弧在身体前后有自己的 z，被立牌真深度遮挡；不在立面上贴纹样。
//   蓄力 = 伏低 + 爪/地之间电弧渐密 + 电火花向爪尖回吸；
//   出手 = 天雷（P2 重击/转段）或爪痕雷（命中拍）——攻击的「爪」由三道斜向雷线承担。
//   转段（血量跌至 70 的嘶吼拍）：蓄电 → 三道天雷劈体 → 雷环外扩 + 周身体表雷爆，
//   此后常驻雷暴（rage 层数 + P2 地板）。
// 常驻雷暴由 bossStateFx 导演按 rage 层数推 level；件挂 _rig（跟随、yaw 对镜头），
// 剧本点放走 burst()/pulse()。
import * as THREE from 'three';
import { duelPose } from '../../camera.js';
import { registerEnemyHitBeat } from '../../spells/enemyHitFx.js';
import { registerEnemyAct } from '../enemyAct.js';
import { registerBossStateFx, registerBossHurtFx } from '../../bossStateFx.js';
import {
  makePlasmaStorm, plasmaSlash, plasmaBurst, skyBolt, lightningRing, boltGroup,
} from '../../plasmaStorm.js';
import { lampPulse, screenFlash } from '../../spells/blocks.js';
import { unitH, unitW } from '../enemies/fxPieces.js';
import { isAttackKind } from '../../../../core/intentKinds.js';

const BOLT_LIGHT = [0.62, 0.80, 1.25];   // 借池灯的冷白电光（>1 的蓝让地面泛冷）
const SPARK = 0xaad8ff;

// 电火花拖尾（蓄力回吸件：每粒一根短蓝白条，沿速度方向旋转）——per-粒子纹理走
// CPU floatFx（十几个以内的少量件），主电形体仍在世界空间面片雷里。
let _streakTex = null;
function streakTexture() {
  if (_streakTex) return _streakTex;
  if (typeof document === 'undefined' || !document.createElement) return null;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 8;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 64, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.35, 'rgba(150,205,255,0.65)');
  grad.addColorStop(0.72, 'rgba(235,248,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 2, 64, 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _streakTex = tex;
  return tex;
}

// ---- 世界锚（单位 rig 局部：x 横向、y 高度、z 朝镜头）----
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
function basisOf(unit) {
  const rig = unit._rig;
  if (rig) {
    rig.updateWorldMatrix?.(true, false);
    rig.getWorldQuaternion(_q);
    _m.makeRotationFromQuaternion(_q);
  } else {
    _q.identity();
    _m.identity();
  }
  return {
    right: new THREE.Vector3(1, 0, 0).applyMatrix4(_m),
    fwd: new THREE.Vector3(0, 0, 1).applyMatrix4(_m),
  };
}
function worldPoint(unit, H, x, y, z) {
  const { right, fwd } = basisOf(unit);
  return {
    x: unit.position.x + right.x * x * H + fwd.x * z * H,
    y: unit.position.y + y * H,
    z: unit.position.z + right.z * x * H + fwd.z * z * H,
  };
}

/** 电火花向一点回吸（蓄力：身体里的电先聚到爪尖）。 */
function chargeStreaks(particles, at, H, n, rimK = 1) {
  const tex = streakTexture();
  if (!tex) return;
  for (let k = 0; k < n; k++) {
    const a = Math.random() * Math.PI * 2;
    const r = H * rimK * (0.22 + Math.random() * 0.26);
    const px = at.x + Math.cos(a) * r;
    const py = at.y + Math.sin(a) * r * 0.7;
    const pull = 0.26 + Math.random() * 0.16;
    const vx = (at.x - px) / pull, vy = (at.y - py) / pull;
    const rec = particles?.spawnSprite?.(px, py, {
      texture: tex, width: H * 0.13, height: H * 0.028, z: at.z + 1.5,
      vx, vy, gravity: 0, ttl: pull, scalePop: 0.2,
    });
    if (rec) rec.sprite.material.rotation = Math.atan2(vy, vx);
  }
}

/** 爪→地的一记短弧（蓄力/防御的「接地」语言；落点溅几粒电火花）。
 *  两端都落在剪影/脚边（不出到空气里），形状从爪端向地面收细。 */
function groundArc(ctx, deps, unit, H, side, { energy = 1.0, ms = 240 } = {}) {
  const a = worldPoint(unit, H, side * 0.44, 0.16, 0.20);
  const b = worldPoint(unit, H, side * (0.54 + Math.random() * 0.12), 0.01, 0.20);
  deps.particles?.spawn?.(b.x, b.y + 0.4, {
    count: 3, color: SPARK, speed: 8, ttl: 0.34, size: 0.55, gravity: 9, z: b.z,
  });
  return boltGroup(ctx, deps, [{ from: a, to: b, width: H * 0.18 }], {
    lifeMs: ms, reachMs: 60, energy, name: 'spellFx:kardasGroundArc', viewAt: a,
    wave: 0.45, amp: 0.10, leaf: 0, end: 0.5, tip: 0.2,
    branches: 1, branchLenK: [0.16, 0.30], branchWidthK: [0.28, 0.45],
  }).promise;
}

const T = {
  SURGE: 1150,   // 转段蓄电
  ROAR: 840,     // 嘶吼过冲收稳
  AFTER: 600,    // 余威
};
const sstep = (x) => x * x * (3 - 2 * x);

// ---------------------------------------------------------------------------
// 转阶段：蓄电 → 三雷劈体 → 雷环 + 体表雷爆
// ---------------------------------------------------------------------------
async function kardasP2({ ctx, args, cast, particles, shake, vignette, camera, renderCamera, scene, uiScene, onStageDispose, unitById }) {
  const unit = unitById(args.unit);
  if (!unit) return;
  unit._bossPhase = 2;
  const H = unitH(unit);
  const s = unit._baseScale ?? 1;
  const ux = unit.position.x, uy = unit.position.y, uz = unit.position.z;
  const chest = { x: ux, y: uy + H * 0.55, z: uz };
  const feet = { x: ux, y: uy, z: uz };
  const deps = { scene, uiScene, particles, cast, shake, camera, renderCamera };

  // 常驻雷暴就位（sync 导演通常已建；转段拍先手取/建，保证蓄电期有电可看）
  const storm = unit._fxLayer?.overlay?.('bossPlasma', 2, (l) => makePlasmaStorm(l, { particles })) ?? null;
  storm?.setLevel(0.55);
  storm?.burst(5, 800);

  // —— 机位：长焦平视派生（比基准紧半档），只在演出期间接管 ——
  const base = camera?.basePose;
  const pose = base ? duelPose(base, { fovScale: 0.8, elScale: 0.4 }) : null;
  camera?.pushOverride?.('kardasP2', {
    poses: pose ? { kardasP2: pose } : {},
    onEnter: (dir) => { if (pose) dir.flyTo('kardasP2', { durationMs: 700, ease: 'power2.out' }); },
  });

  // —— 蓄电：伏低 + 接地弧渐密 + 电火花回吸（越到后越急）——
  shake.impulse(0.35);
  ctx.spawn(async (c) => {
    for (let i = 0; i < 6; i++) {
      groundArc(c, deps, unit, H, i % 2 ? 1 : -1, { energy: 0.9 + i * 0.06, ms: 210 });
      await c.wait(170);
    }
  });
  ctx.spawn(async (c) => {
    for (let i = 0; i < 5; i++) {
      chargeStreaks(particles, chest, H, 3 + i, 0.9);
      particles?.spawn?.(ux, uy + H * 0.06, {
        count: 3, color: SPARK, speed: 6, ttl: 0.4, size: 0.5, gravity: 5, z: uz + 1,
      });
      await c.wait(190);
    }
  });
  await ctx.custom(unit.uniqueID, {
    durationMs: T.SURGE, ease: 'none',
    onUpdate: (t) => {
      const press = sstep(t);
      unit.setPose?.({
        squash: 1 - 0.28 * press,
        widen: 1 + 0.22 * press,
        lean: -0.08 * press,
      });
    },
  });
  unit.resetPose?.();

  // —— 三道天雷劈体：每道一记硬直（scale 抖动由姿态通道表达）+ 白闪 + 震屏 ——
  for (let i = 0; i < 3; i++) {
    skyBolt(ctx, deps, {
      at: chest, height: H * (5.2 + i * 0.5), ms: 200, energy: 1.45, spread: H * 0.4,
    });
    ctx.spawn((c) => screenFlash(c, deps, { intensity: 0.13, ms: 160, color: 0xcfe6ff }));
    shake.impulse(2.4 + i * 0.5);
    particles?.spawn?.(chest.x, chest.y, {
      count: 10, color: 0xbfe6ff, speed: 20, ttl: 0.34, size: 0.8, gravity: -5, z: chest.z,
    });
    storm?.pulse(1.1);
    storm?.burst(6, 260);
    await ctx.wait(105);
  }

  // —— 嘶吼：弹起过冲 + 地面雷环外扩 + 体表雷爆（全向广播 = 威慑宣示）——
  lightningRing(ctx, deps, { at: feet, radius: H * 3.1, ms: 640 });
  // 从胸口向四周炸开的弧（8 向）
  {
    const bolts = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.random() * 0.4;
      const len = H * (0.5 + Math.random() * 0.35);
      bolts.push({
        from: { x: chest.x, y: chest.y, z: chest.z + 1.4 },
        to: {
          x: chest.x + Math.cos(a) * len,
          y: chest.y + Math.sin(a) * len * 0.75,
          z: chest.z + 1.4 + (Math.random() - 0.5) * H * 0.2,
        },
        width: H * 0.10,   // 电晕容器宽（可见线宽由着色收尖包络决定）
      });
    }
    boltGroup(ctx, deps, bolts, {
      lifeMs: 340, reachMs: 70, energy: 1.35, name: 'spellFx:kardasRoarBolt', viewAt: chest,
      wave: 0.5, amp: 0.10, leaf: 0.12, end: 0.55, tip: 0.12,
      branches: 1, branchLenK: [0.16, 0.32], branchWidthK: [0.28, 0.46],
    });
  }
  particles?.spawn?.(ux, chest.y, {
    color: 0xbfe6ff, count: 26, speed: 44, ttl: 0.6, size: 0.9, gravity: 2, z: uz,
  });
  shake.impulse(6);
  vignette?.pulse?.(2.4);
  ctx.spawn((c) => screenFlash(c, deps, { intensity: 0.2, ms: 220, color: 0xcfe6ff }));
  await ctx.custom(unit.uniqueID, {
    durationMs: T.ROAR, ease: 'power3.out',
    onUpdate: (t) => unit.setPose?.({
      squash: 0.72 + 0.36 * t,
      widen: 0.94 + 0.24 * t,
      lean: -0.06 * (1 - t),
    }),
  });
  unit.resetPose?.();
  unit.scale.set(s * 1.07, s * 1.07, 1);   // 觉醒后体格涨大一圈（终态）

  // —— 余威：两记衰减雷爆 + 电尘落定 ——
  for (let k = 0; k < 2; k++) {
    plasmaBurst(ctx, deps, {
      at: chest, size: H * (0.55 - k * 0.12), count: 4, ms: 300, energy: 0.95 - k * 0.15,
    });
    shake.impulse(1.2 - k * 0.45);
    particles?.spawn?.(ux, uy + H * 0.08, {
      count: 8, color: 0x8ea8c8, speed: 9, ttl: 0.9, size: 0.8, gravity: -2, z: uz,
    });
    await ctx.wait(280);
  }

  // —— 常驻：冷白电光（借池灯；中途 new 灯会全场景重编译）+ 结构光压暗半档 ——
  const light = cast.get('light:fx0');
  if (light) {
    light.color.set(0x9fd0ff);
    light.distance = H * 5;
    light.position.set(0, H * 0.55, H * 0.25);
    unit.add(light);
    onStageDispose?.(() => { light.intensity = 0; unit.remove(light); });
  }
  const mood = cast.get('light:mood');
  ctx.spawn(async (c) => {
    const jobs = [];
    if (light) jobs.push(c.tweenRaw(light, { intensity: 1400 }, { durationMs: 900, ease: 'power2.out' }));
    if (mood) jobs.push(c.tweenRaw(mood, { dim: mood.dim * 0.80 }, { durationMs: 1800 }));
    await Promise.all(jobs);
  });
  storm?.setLevel(0.42);

  await camera?.flyHome?.({ durationMs: 720, ease: 'power2.inOut' }) ?? null;
  camera?.popOverride?.('kardasP2');
}

// ---------------------------------------------------------------------------
// 命中拍：爪痕雷（三道斜向雷线）+ 命中点迸裂；重击交叉双挥 / P2 加天雷
// ---------------------------------------------------------------------------
async function kardasHitBeat(ctx, deps, args) {
  const target = args.unit;
  if (!target) return;
  const heavy = args.fx.tier === 'heavy';
  const p2 = (args.source?._bossPhase ?? 1) >= 2;
  const H = unitH(target);
  // 爪痕按**立牌可见宽**定尺寸：同一套演出落在窄体型的骑士与宽体型的 Boss 身上
  // 都要刚好覆盖躯干（按体高会把爪痕甩到身体两侧的空气里）。
  const W = unitW(target);
  const at = { x: target.position.x, y: target.position.y + H * 0.52, z: target.position.z };
  const dir = args.fromX != null ? (Math.sign(target.position.x - args.fromX) || 1) : 1;
  const scale = heavy ? 1.06 + Math.min((args.dealt ?? 0) / 80, 0.22) : 0.98;
  // P2 命中档整体抬一档：更长的爪痕尺寸、多一道、迸裂多一向 + 地面余震
  const k2 = p2 ? 1.14 : 1;
  const strokes = heavy ? (p2 ? 4 : 3) : (p2 ? 3 : 2);

  plasmaSlash(ctx, deps, {
    at, size: W * scale * k2, dir, strokes, heavy,
  });
  // 迸裂错后起爆：先看到爪痕划过、再在痕心炸开（同刻齐出会糊成一团）
  ctx.spawn(async (c) => {
    await c.wait(heavy ? 78 : 52);
    await plasmaBurst(c, deps, {
      at, size: W * (heavy ? 0.55 : 0.42) * scale * k2,
      count: (heavy ? 5 : 3) + (p2 ? 1 : 0), ms: heavy ? 250 : 190,
      energy: heavy ? 1.0 : 0.92 + (p2 ? 0.06 : 0),
    });
  });

  if (heavy) {
    // 撕碎：反手第二道爪痕错峰（第一道划过后再交叉成 X）
    ctx.spawn(async (c) => {
      await c.wait(120);
      await plasmaSlash(c, deps, { at, size: W * scale * k2, dir: -dir, strokes, heavy: true });
    });
  } else if (p2) {
    // P2 普攻余震：命中点下方补一圈贴地电 + 冷白闪（与 P1 普攻拉开强度）
    ctx.spawn(async (c) => {
      await c.wait(120);
      await plasmaBurst(c, deps, {
        at: { x: at.x, y: target.position.y + 0.8, z: at.z },
        size: W * 0.36, count: 3, ms: 180, energy: 0.85,
      });
      await screenFlash(c, deps, { intensity: 0.09, ms: 140, color: 0xcfe6ff });
    });
    deps.shake?.impulse?.(0.9);
  }
  if (heavy && p2) {
    // P2 撕碎 = 雷兽扑杀：双爪交叉落定后补一道天雷
    ctx.spawn(async (c) => {
      await c.wait(190);
      skyBolt(c, deps, {
        at, height: H * 5.6, ms: 280, energy: 1.6, spread: H * 0.5,
      });
      await screenFlash(c, deps, { intensity: 0.20, ms: 200, color: 0xcfe6ff });
    });
    deps.shake?.impulse?.(2.6);
  } else if (heavy) {
    ctx.spawn(async (c) => {
      await c.wait(110);
      await screenFlash(c, deps, { intensity: 0.10, ms: 160, color: 0xd8ecff });
    });
    deps.shake?.impulse?.(1.2);
  }
  ctx.spawn((c) => lampPulse(c, deps, {
    name: 'light:fx1', at, color: BOLT_LIGHT,
    peak: heavy ? 1300 : 650, attackMs: 50, decayMs: heavy ? 320 : 200,
  }));
  // 等最后一道（含第二道交叉 / 天雷分叉 / P2 余震）走完淡出再交棒
  await ctx.wait(heavy ? 500 : (p2 ? 330 : 250));
}

// ---------------------------------------------------------------------------
// 起手拍
// ---------------------------------------------------------------------------
async function kardasAct({ ctx, deps, unit, kinds, args }) {
  if (!unit) return;
  const H = unitH(unit);
  const id = unit.uniqueID;
  const p2 = (unit._bossPhase ?? 1) >= 2;
  const storm = unit._fxLayer?.get?.('bossPlasma') ?? null;
  const ux = unit.position.x, uy = unit.position.y, uz = unit.position.z;
  const chest = { x: ux, y: uy + H * 0.52, z: uz };

  if (kinds.some(isAttackKind)) {
    const heavy = kinds.includes('heavy') || (args?.hits ?? 1) <= 1;
    if (!heavy) {
      // 快速掠击：低压身 + 双侧接地弧（P2 多一道爪间横弧）
      storm?.pulse(0.55);
      storm?.burst(2, 260);
      groundArc(ctx, deps, unit, H, -1, { energy: 0.9, ms: 220 });
      groundArc(ctx, deps, unit, H, 1, { energy: 0.9, ms: 220 });
      if (p2) {
        // 爪间横雷：两爪同时抬起的横贯弧（首端粗、尾端收尖）
        const a = worldPoint(unit, H, -0.5, 0.16, 0.36);
        const b = worldPoint(unit, H, 0.5, 0.16, 0.36);
        boltGroup(ctx, deps, [{ from: a, to: b, width: H * 0.14 }], {
          lifeMs: 230, reachMs: 55, energy: 1.05, name: 'spellFx:kardasClawArc', viewAt: chest,
          wave: 0.45, amp: 0.11, leaf: 0.15, end: 0.45, tip: 0.12,
          branches: 1, branchLenK: [0.18, 0.34], branchWidthK: [0.3, 0.5],
        });
      }
      const windMs = p2 ? 300 : 230;
      await ctx.custom(id, {
        durationMs: windMs, ease: 'power2.in',
        onUpdate: (t) => unit.setPose?.({
          squash: 1 - (p2 ? 0.16 : 0.11) * t,
          widen: 1 + (p2 ? 0.12 : 0.08) * t,
          lean: -0.07 * t,
        }),
      });
      unit.resetPose?.();
      storm?.pulse(0.4);
      return;
    }

    // 撕碎预备：深蹲 + 底位高频颤 + 电火花向双爪回吸 + 接地弧渐密
    const windMs = p2 ? 1050 : 950;
    const claw = worldPoint(unit, H, -0.3, 0.30, 0.34);
    ctx.spawn(async (c) => {
      const batches = p2 ? 5 : 4;
      for (let i = 0; i < batches; i++) {
        chargeStreaks(deps.particles, claw, H, 3 + Math.min(i, 2), 0.95);
        chargeStreaks(deps.particles, worldPoint(unit, H, 0.3, 0.30, 0.34), H, 2 + Math.min(i, 2), 0.95);
        await c.wait(windMs / (batches + 1));
      }
    });
    ctx.spawn(async (c) => {
      const n = p2 ? 5 : 4;
      for (let i = 0; i < n; i++) {
        groundArc(c, deps, unit, H, i % 2 ? 1 : -1, { energy: 1.0 + i * 0.05, ms: 230 });
        await c.wait((windMs * 0.72) / n);
      }
    });
    if (p2) {
      // P2 蓄力 = 天雷灌体（蓄电期两劈，给足压迫感）
      ctx.spawn(async (c) => {
        for (let i = 0; i < 2; i++) {
          await c.wait(windMs * (i ? 0.20 : 0));
          skyBolt(c, deps, {
            at: chest, height: H * 5, ms: 190, energy: 1.3, spread: H * 0.35,
          });
          deps.shake?.impulse?.(1.8);
          deps.particles?.spawn?.(ux, chest.y, {
            count: 8, color: 0xbfe6ff, speed: 18, ttl: 0.3, size: 0.7, gravity: -4, z: uz,
          });
        }
      });
      storm?.burst(6, 900);
    } else {
      storm?.burst(4, 600);
    }
    storm?.setLevel(p2 ? 0.9 : 0.7);
    deps.particles?.spawn?.(ux, uy + H * 0.06, {
      color: 0x8ea8c8, count: 8, speed: 5, size: 0.7, ttl: 0.8, gravity: -4, z: uz + 0.5,
    });
    await ctx.custom(id, {
      durationMs: windMs, ease: 'none',
      onUpdate: (t) => {
        const press = sstep(Math.min(1, t / 0.62));
        const held = Math.max(0, (t - 0.62) / 0.38);
        const shudder = held * Math.sin(t * 9.5 * Math.PI * 2 * 0.95) * 0.024;
        unit.setPose?.({
          squash: 1 - 0.28 * press + shudder,
          widen: 1 + 0.24 * press,
          lean: -0.09 * press,
        });
      },
    });
    unit.resetPose?.();
    // 蓄满一拍：双爪雷爆
    plasmaBurst(ctx, deps, { at: claw, size: H * 0.5, count: 5, ms: 260, energy: 1.1 });
    plasmaBurst(ctx, deps, {
      at: worldPoint(unit, H, 0.3, 0.30, 0.34), size: H * 0.45, count: 4, ms: 260, energy: 1.0,
    });
    await ctx.wait(140);   // 雷爆先亮一瞬再交棒给伤害拍（否则随剧本收尾被立即回收）
    storm?.burst(6, 380);
    storm?.pulse(1.15);
    return;
  }

  if (kinds.includes('defend')) {
    // 植爪卸力：双爪捣地 + 两道接地弧 + 周身电衣一涨（护盾的可视化）
    deps.particles?.spawn?.(ux, uy + H * 0.06, {
      color: 0x8ea8c8, count: 10, speed: 7, size: 0.75, ttl: 0.8, gravity: -8, z: uz + 0.5,
    });
    groundArc(ctx, deps, unit, H, -1, { energy: 1.1, ms: 260 });
    groundArc(ctx, deps, unit, H, 1, { energy: 1.1, ms: 260 });
    storm?.pulse(0.9);
    storm?.burst(3, 300);
    await ctx.custom(id, {
      durationMs: 380, ease: 'power2.out',
      onUpdate: (t) => unit.setPose?.({
        squash: 1 - 0.11 * Math.sin(t * Math.PI),
        widen: 1 + 0.16 * Math.sin(t * Math.PI),
      }),
    });
    unit.resetPose?.();
  }
}

export function registerKardasScripts(register) {
  register('bosses/kardasP2', kardasP2);
  registerEnemyHitBeat('kardas', kardasHitBeat);
  registerEnemyAct('kardas', kardasAct);
  // 常驻雷暴导演：rage 层数 → 活弧数/重抽率/亮度；P2 起 0.3 地板（觉醒后永远带电）
  registerBossStateFx('kardas', (obj, unitProj, ctx) => {
    if (unitProj.isDead) return;
    const rage = unitProj.effects?.find((e) => e.effectId === 'rage')?.stacks ?? 0;
    // 常驻雷暴基态：P1 0.16（1 道槽，均值 ~4s 一场）/ P2 0.5（3 道槽，均值 ~2s）
    const p2 = obj._bossPhase >= 2;
    const level = Math.max(p2 ? 0.5 : 0.16, Math.min(rage / 6, 1));
    obj._fxLayer?.overlay('bossPlasma', 2, (l) => makePlasmaStorm(l, { particles: ctx?.particles ?? null }));
    obj._fxLayer?.setLevel('bossPlasma', level);
  });
  // 受击补充：挨打 = 周身雷暴炸亮 + 电火花
  registerBossHurtFx('kardas', (ctx, deps, { unit, dealt }) => {
    const H = unitH(unit);
    unit._fxLayer?.get?.('bossPlasma')?.pulse?.(Math.min(0.5 + (dealt ?? 0) / 30, 1.3));
    deps.particles?.spawn?.(unit.position.x, unit.position.y + H * 0.5, {
      color: SPARK, count: Math.min(4 + Math.round((dealt ?? 0) / 6), 9), speed: 12,
      size: 0.65, ttl: 0.4, z: unit.position.z + 1,
    });
  });
}
