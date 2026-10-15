// Boss 剧本：穿山甲王（pangolinKing，11 层 Boss 池·装甲主题）。
// 一只 Boss 的全部自定义演出聚合在本文件（内容归属原则，同 pyro.js）。触发点见
// core enemies/bosses.js pangolinKing act 的转段拍（血量 < 190 → 恼怒：净化全部
// 效果 + 占拍，本剧本占住那一拍）。
//
// 主题（装甲巨兽）＝「恼怒·地动」：
//   蓄力（1.1s）：压低涨宽（鳞甲绷紧的体态）+ 震颤渐强 + 琥珀三记渐亮闪 +
//     地面碎石被震得跳起（怒气从地里渗出来）
//   爆发（瞬发+0.9s）：猛立过冲 + 双道细环尘浪 + 石屑喷发 + 尘吼柱 +
//     重震荡 + 渐晕；终态涨大一圈（装甲的体格，常驻）
//   常驻（挂舞台寿命）：琥珀跟随点光（装甲反光）+ 环身浮尘 + 低频碎砂洒落
//     （装甲缝里掉的砂）+ 结构光压暗半档
// 与三火 Boss 的差异：pyro 烧房间、kardas 烧自己、mefm1 机器过热——穿山甲王
// 是**大地在替它发怒**：光是暖的但焰是尘，一切附加物都往下坠（砂/石/土）。
// 美术口径：暂无立绘（占位色块），全部效果按立牌体量派生、不依赖贴图内容。
import * as THREE from 'three';
import { duelPose } from '../../camera.js';
import { groundRing } from '../../spells/blocks.js';
import { registerEnemyHitBeat, enemyImpactBeat } from '../../spells/enemyHitFx.js';
import { registerEnemyAct } from '../enemyAct.js';
import { registerBossStateFx, registerBossHurtFx } from '../../bossStateFx.js';
import { makePlateArmor } from '../../plateArmor.js';

// 细环冲击纹理（同 pyro/kardas 的「白热细峰」口径，暖砂色调——尘浪不是火浪）
let _ringTex = null;
function ringTexture() {
  if (_ringTex) return _ringTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 100, 128, 128, 126);
  grad.addColorStop(0, 'rgba(255,190,110,0)');
  grad.addColorStop(0.74, 'rgba(255,190,110,0.1)');
  grad.addColorStop(0.94, 'rgba(255,244,220,1)');
  grad.addColorStop(1, 'rgba(210,150,80,0)');
  g.fillStyle = grad;
  g.beginPath(); g.arc(128, 128, 128, 0, Math.PI * 2); g.fill();
  _ringTex = new THREE.CanvasTexture(c);
  _ringTex.colorSpace = THREE.SRGBColorSpace;
  return _ringTex;
}

const T = {
  CROUCH: 1100, // 蓄力：压低 + 震颤 + 碎石跳
  POP: 260,     // 爆发过冲弹起
  SETTLE: 340,  // 收稳
};
const sstep = (x) => x * x * (3 - 2 * x);

/** 一撮地面碎砂（震起来又落回去——怒气渗出地面的读法）。 */
function gritBurst(particles, ux, uy, uz, H, n = 8) {
  particles.spawn(ux + (Math.random() - 0.5) * H * 0.8, uy + H * 0.05, {
    color: 0x9a8468, count: n, speed: 3, vby: 6, ttl: 1.1, size: 1.3, gravity: -12, z: uz + 0.6,
  });
}

/** 石屑喷发（重拍：带棱角的碎块抛物坠地，与细碎砂尘区分开）。 */
function rockShards(particles, ux, uy, uz, n = 12) {
  particles.spawn(ux, uy, {
    color: 0x8a6f4d, count: n, speed: 26, ttl: 1.2, size: 2.1, gravity: -22, z: uz + 1,
  });
  particles.spawn(ux, uy, {
    color: 0x6f5a42, count: Math.round(n * 0.6), speed: 16, ttl: 1.4, size: 2.6, gravity: -18, z: uz + 1,
  });
}

// 转段「恼怒」（净化拍，放行 ≈3.1s 阻塞节拍）
async function pangolinKingP2({ ctx, args, cast, particles, shake, vignette, camera, onStageDispose, runScript, unitById }) {
  const unit = unitById(args.unit);
  if (!unit) return; // 快照缺失兜底：静默收拍
  const id = unit.uniqueID;
  const ux = unit.position.x, uy = unit.position.y, uz = unit.position.z;
  const s = unit._baseScale ?? 1;
  const H = unit._standeeHeight ?? 22;

  // —— 转段机位（演出期间接管，收尾弹栈还给人）：长焦平视，同 kardas 紧半档 ——
  const base = camera?.basePose;
  const pose = base ? duelPose(base, { fovScale: 0.82, elScale: 0.45 }) : null;
  camera?.pushOverride?.('pangolinP2', {
    poses: pose ? { pangolinP2: pose } : {},
    onEnter: (dir) => { if (pose) dir.flyTo('pangolinP2', { durationMs: 680, ease: 'power2.out' }); },
  });

  // —— 蓄力：压低涨宽 + 琥珀三记渐亮 + 地面碎石被震起 ——
  const SURGE = [[0.15, 0x6b4a20], [0.45, 0x9a6c28], [0.78, 0xd9a04c]];
  const hit = SURGE.map(() => false);
  shake.impulse(0.4);
  ctx.spawn(async (c) => {
    // 碎石跳：越接近爆发越密（1.1s 窗内 3+5 撮）
    for (let i = 0; i < 3; i++) { gritBurst(particles, ux, uy, uz, H, 6); await c.wait(260); }
    for (let i = 0; i < 5; i++) { gritBurst(particles, ux, uy, uz, H, 8); await c.wait(120); }
  });
  await ctx.custom(id, {
    durationMs: T.CROUCH, ease: 'none',
    onUpdate: (t) => {
      const sec = (t * T.CROUCH) / 1000;
      const press = sstep(Math.min(1, t / 0.7));
      const held = Math.max(0, (t - 0.7) / 0.3); // 底位震颤随剩余时间渐强（鳞甲绷不住）
      const shudder = held * Math.sin(sec * Math.PI * 2 * 9.5) * 0.022;
      // 压低 + 涨宽：装甲巨兽的蓄力体态（与 pyro 的纯压扁区分——它是横向绷开的）
      unit.scale.set(s * (1 + 0.10 * press + shudder * 0.4), s * (1 - 0.26 * press + shudder), 1);
      SURGE.forEach(([at, col], i) => {
        if (hit[i] || t < at) return;
        hit[i] = true;
        unit.flash?.(col);
      });
    },
  });

  // —— 爆发：猛立过冲 + 双环尘浪 + 石屑 + 尘吼柱 ——
  // 恼怒净化（转段核心事件）：岩板甲当场崩落——「它不要甲了，要你命」
  unit._bossPhase = 2;
  unit._armorShattered = true;
  unit._fxLayer?.get('bossPlates')?.shatter?.();
  unit.flash?.(0xffc86a);
  rockShards(particles, ux, uy + H * 0.4, uz, 14);
  particles.spawn(ux, uy + H * 0.35, {
    count: 26, color: 0xb8a98c, speed: 34, ttl: 0.8, size: 1.7, gravity: -10, z: uz,
  });
  // 尘吼柱：自口部向上连发三串（同 kardas 吼柱口径，换土色——从地里吼出来的尘）
  ctx.spawn(async (c) => {
    for (let i = 0; i < 3; i++) {
      particles.spawn(ux, uy + H * 0.6, {
        count: 10, color: i < 2 ? 0xb08a52 : 0xe0c496, speed: 5, vby: 26, ttl: 0.7,
        size: 2.2, gravity: -10, z: uz + 1,
      });
      await c.wait(90);
    }
  });
  const WAVES = [
    { w1: H * 1.5, ms: 540, ttl: 0.52 },
    { w1: H * 1.05, ms: 740, ttl: 0.7 },
  ];
  for (const [i, wv] of WAVES.entries()) {
    // 环放低位（H*0.22）：读作地面荡开的尘浪；贴地世界环在长焦平视下会侧看成线
    const ring = particles.spawnSprite(ux, uy + H * 0.22, {
      texture: ringTexture(), width: H * 0.3, height: H * 0.3, z: uz + 2 + i, ttl: wv.ttl, gravity: 0,
    });
    if (!ring) continue;
    (runScript ?? ((body) => ctx.spawn(body)))(async (c) => {
      await c.tweenRaw(ring, { w: wv.w1, h: wv.w1 }, { durationMs: wv.ms, ease: 'power2.out' });
    });
  }
  shake.impulse(6.2);
  vignette.pulse(2.4);
  // 猛立过冲（0.74/0.74 → 1.28）再压回装甲体格（1.06 常驻涨大）
  await ctx.custom(id, {
    durationMs: T.POP, ease: 'power3.out',
    onUpdate: (t) => unit.scale.set(s * (0.96 + 0.32 * t), s * (0.74 + 0.54 * t), 1),
  });
  await ctx.custom(id, {
    durationMs: T.SETTLE, ease: 'power2.out',
    onUpdate: (t) => { const k = 1.28 - 0.22 * t; unit.scale.set(s * k, s * k, 1); },
  });
  unit.scale.set(s * 1.06, s * 1.06, 1);

  // —— 余威：一记衰减余震 + 碎砂坠地 ——
  gritBurst(particles, ux, uy, uz, H, 10);
  shake.impulse(1.2);
  await ctx.wait(380);

  // —— 常驻（挂舞台寿命）：琥珀点光 + 环身浮尘 + 低频碎砂 + 结构光压暗 ——
  // 灯从舞台光池借（light:fx0）：演出中途 add 灯 = 全场景着色器重编译冻帧；
  // 池灯入场即在场景里，重挂到单位不触发重编译
  const rageLight = cast.get('light:fx0');
  if (rageLight) {
    rageLight.color.set(0xd9a04c);
    rageLight.distance = H * 5;
    rageLight.position.set(0, H * 0.5, H * 0.25);
    unit.add(rageLight);
    onStageDispose?.(() => { rageLight.intensity = 0; unit.remove(rageLight); });
  }
  const aura = particles.spawnEmitter(ux, uy + H * 0.06, {
    rate: 0, radius: H * 0.45, color: 0xc09a5a, speed: 3.5, ttl: 2.4, size: 1.5,
    gravity: 2.5, zJitter: H * 0.4, z: uz,
  });
  if (aura) onStageDispose?.(() => aura.stop());
  (runScript ?? ((body) => ctx.spawn(body)))(async (c) => {
    const jobs = [];
    if (rageLight) {
      jobs.push(c.tweenRaw(rageLight, { intensity: 1200 }, { durationMs: 900, ease: 'power2.out' }));
    }
    if (aura) jobs.push(c.tweenRaw(aura, { rate: 8 }, { durationMs: 1500 }));
    const mood = cast.get('light:mood');
    if (mood) jobs.push(c.tweenRaw(mood, { dim: mood.dim * 0.85 }, { durationMs: 1800, delayMs: 200 }));
    await Promise.all(jobs);
    // 低频碎砂：装甲缝里一直掉砂（无限循环到舞台寿命为止）
    for (;;) {
      await c.wait(2400 + Math.random() * 1600);
      if (!unit.parent) break;
      gritBurst(particles, ux, uy, uz, H, 4);
    }
  });

  // 演出机位退场：先补间飞回基准（flyHome 连 fov），再弹栈——瞬时硬切是病灶
  await camera?.flyHome?.({ durationMs: 720, ease: 'power2.inOut' }) ?? null;
  camera?.popOverride?.('pangolinP2');
  unit.restoreColor?.();
}

// —— 命中 beat（岩甲主题）：重击 = 岩崩（琥珀金冲击 + 石屑 + 贴地尘环 + 落地砂尘），
// 连拍 = 鳞甲连击（砂砾火花），普击 = 大爪击。共享底座 enemyImpactBeat。
async function pangolinHitBeat(ctx, deps, args) {
  const heavy = args.fx.tier === 'heavy';
  await enemyImpactBeat(ctx, deps, {
    ...args,
    pal: {
      color: heavy ? [0.98, 0.55, 0.18] : [0.95, 0.62, 0.30],
      hot: heavy ? [1.3, 0.95, 0.5] : [1.15, 0.9, 0.55],
      rim: [1.0, 0.7, 0.4],
      sparkColor: heavy ? 0xe8b45a : 0xd9a860,
      dustColor: 0x9a8a6a,
      flashColor: 0xffe2b0,
      shakeK: heavy ? 1.9 : 1.5,
    },
    garnish: (c2, d, { at, heavy: hv, unit: target }) => {
      if (hv) {
        // 岩崩：带棱角的石屑从命中点抛物坠散（与通用落地尘区分：这是被砸出来的）
        d.particles?.spawn?.(at.x, at.y, {
          color: 0x8a6f4d, count: 10, speed: 20, size: 2.0, ttl: 1.1, gravity: -22, z: at.z,
        });
        d.particles?.spawn?.(at.x, at.y, {
          color: 0xb8a98c, count: 12, speed: 12, size: 1.4, ttl: 0.9, gravity: -8, z: at.z,
        });
        // 贴地尘环：重锤落地，尘浪从脚边荡开（真贴地平躺环，俯角透视自读椭圆）
        c2.spawn((c3) => groundRing(c3, d, {
          at: { x: at.x, y: target?.position.y ?? 0, z: at.z ?? 0 },
          size: 17, ms: 720, spin: 1.1,
          color: [0.62, 0.5, 0.36], hot: [1.05, 0.85, 0.55],
        }));
      } else {
        // 砂砾火花：鳞甲蹭出来的碎砂
        d.particles?.spawn?.(at.x, at.y, {
          color: 0xc09a5a, count: 8, speed: 11, size: 1.0, ttl: 0.7, gravity: -14, z: at.z,
        });
      }
    },
  });
}

// 棘刺纹理：细针（棘甲竖起的一根刺——白瓷尖 + 琥珀根）
let _spikeTex = null;
function spikeTexture() {
  if (_spikeTex) return _spikeTex;
  const c = document.createElement('canvas');
  c.width = 32; c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 128, 0, 0);
  grad.addColorStop(0, 'rgba(233,180,90,0)');
  grad.addColorStop(0.25, 'rgba(233,180,90,0.85)');
  grad.addColorStop(0.8, 'rgba(255,244,220,0.95)');
  grad.addColorStop(1, 'rgba(255,250,235,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(10, 128); g.lineTo(16, 0); g.lineTo(22, 128); g.closePath();
  g.fill();
  _spikeTex = new THREE.CanvasTexture(c);
  _spikeTex.colorSpace = THREE.SRGBColorSpace;
  return _spikeTex;
}

// —— 起手 beat：攻击拍 = 碾压蓄势——P1 沉身短蓄（一撮砂），P2 重锤（蓄势叠满的
// 那拍）深压涨宽 + 碎石连跳 + 琥珀两闪；突进砸击由伤害节拍接棒。上甲拍
// （盾50 + 脆弱如山）= 岩甲生长；荆棘/增强拍（buff）= 棘甲竖起——背脊弹出一蓬
// 细刺 + 金属细纹闪。
async function pangolinAct({ ctx, deps, unit, kinds, args }) {
  const ux = unit.position.x, uy = unit.position.y, uz = unit.position.z;
  const H = unit._standeeHeight ?? 22;
  if (kinds.includes('attack')) {
    const deep = (unit._bossPhase ?? 0) >= 2; // P2 蓄势重锤（P1 普攻 12 与重锤同 hits=1，靠相位分档）
    const id = unit.uniqueID;
    if (deep) {
      unit.flash?.(0x9a6c28);
      gritBurst(deps.particles, ux, uy, uz, H, 7);
      ctx.spawn(async (c) => { await c.wait(260); gritBurst(deps.particles, ux, uy, uz, H, 9); });
      deps.shake?.impulse?.(0.5);
    }
    await ctx.custom(id, {
      durationMs: deep ? 600 : 280, ease: 'power2.in',
      onUpdate: (t) => unit.setPose({
        squash: 1 - (deep ? 0.24 : 0.13) * t,
        widen: 1 + (deep ? 0.2 : 0.1) * t,
        lean: -0.05 * t,
      }),
    });
    unit.resetPose?.();
    if (deep) { unit.flash?.(0xd9a04c); gritBurst(deps.particles, ux, uy, uz, H, 8); }
    return;
  }
  if (kinds.includes('defend')) {
    deps.shake?.impulse?.(0.6);
    unit.flash?.(0xd9a04c);
    for (let wave = 0; wave < 2; wave++) {
      deps.particles?.spawn?.(ux, uy + H * 0.1, {
        color: 0xe8b45a, count: 12, speed: 4, vby: 10, ttl: 1.0, size: 1.2, gravity: 4, z: uz + 0.8,
      });
      await ctx.wait(220);
    }
    const id = unit.uniqueID;
    await ctx.custom(id, {
      durationMs: 340, ease: 'power2.out',
      onUpdate: (t) => unit.setPose({ widen: 1 + 0.12 * Math.sin(t * Math.PI), squash: 1 - 0.06 * Math.sin(t * Math.PI) }),
    });
    unit.resetPose?.();
    return;
  }
  if (kinds.includes('buff')) {
    // 棘甲竖起：背脊一蓬细刺弹出（上抛缓落）+ 金属细纹闪——「别碰我」的读感。
    // 远场口径：Boss 在 z≈-56，1.1×3.4 的针亚像素化读不出
    for (let i = 0; i < 9; i++) {
      const a = Math.PI * (0.16 + (i / 8) * 0.68); // 扇形放射（朝上半圆）
      const rec = deps.particles?.spawnSprite?.(
        ux + Math.cos(a) * H * 0.24, uy + H * 0.44 + Math.sin(a) * H * 0.22, {
          texture: spikeTexture(), width: 1.5, height: 4.6, z: uz + 1.6,
          vx: Math.cos(a) * 4, vy: Math.sin(a) * 4.5 + 3, gravity: -5, ttl: 0.7, scalePop: 0.45,
        });
      if (rec) rec.sprite.material.rotation = a - Math.PI / 2; // 针尖朝外
    }
    deps.particles?.spawn?.(ux, uy + H * 0.3, {
      color: 0xe8b45a, count: 8, speed: 4, ttl: 0.6, size: 0.9, gravity: 2, z: uz + 0.8,
    });
    unit.flash?.(0xb8863a);
    await ctx.wait(300);
  }
}

export function registerPangolinKingScripts(register) {
  register('bosses/pangolinKingP2', pangolinKingP2);
  registerEnemyHitBeat('pangolinKing', pangolinHitBeat);
  registerEnemyAct('pangolinKing', pangolinAct);
  // 常驻岩甲导演（bossStateFx）：defense = 鳞板甲在线（上甲逐排显形）；
  // momentum（蓄势）= 甲缝/体缝渗炽光（P2 板片崩落后热缝留在裸躯上）；
  // 转段拍剧本置 _armorShattered 并播崩落，此后板甲不再重建
  registerBossStateFx('pangolinKing', (obj, unitProj) => {
    if (unitProj.isDead) return;
    const def = unitProj.effects?.find((e) => e.effectId === 'defense');
    const mom = unitProj.effects?.find((e) => e.effectId === 'momentum')?.stacks ?? 0;
    const armorOn = (def?.stacks ?? 0) > 0 && !obj._armorShattered;
    const heat = Math.min(mom / 12, 1);
    if (armorOn) obj._fxLayer?.overlay('bossPlates', 2, (l) => makePlateArmor(l));
    obj._fxLayer?.setLevel('bossPlates', armorOn ? 1 : 0);
    const plates = obj._fxLayer?.get('bossPlates');
    if (plates) plates.setHeat(heat);
    else if (heat > 0 && obj._armorShattered) {
      // P2 裸躯热缝：板甲已碎，仍需建件承 heat（板形项已被 plateFade/level 归零）
      obj._fxLayer?.overlay('bossPlates', 2, (l) => makePlateArmor(l))?.setHeat?.(heat);
    }
  });
  // 受击补充：甲在 = 打铁（clank 震颤 + 岩屑）；甲碎后 = 砂尘 + 热缝一涌
  registerBossHurtFx('pangolinKing', (ctx, deps, { unit, dealt }) => {
    const H = unit._standeeHeight ?? 22;
    const plates = unit._fxLayer?.get('bossPlates');
    const y = unit.position.y + H * 0.5;
    if (plates && plates.levelNow() > 0.25) {
      plates.clank();
      deps.particles?.spawn?.(unit.position.x, y, {
        color: 0x8a6f4d, count: Math.min(4 + Math.round(dealt / 5), 11), speed: 15,
        size: 1.1, ttl: 0.7, gravity: -16, z: unit.position.z + 1,
      });
      return;
    }
    deps.particles?.spawn?.(unit.position.x, y, {
      color: 0xb8a98c, count: Math.min(4 + Math.round(dealt / 6), 9), speed: 10,
      size: 1.2, ttl: 0.8, gravity: -8, z: unit.position.z + 1,
    });
    if (plates) plates.setHeat(Math.min(plates.u.uHeat.value + 0.12, 1)); // 挨打添一把火（下一拍 director 按真值收回）
  });
}
