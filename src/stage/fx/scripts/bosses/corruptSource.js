// Boss 剧本：腐败之源（corruptSource，11 层 Boss 池·召唤干扰流）。
// 一只 Boss 的全部自定义演出聚合在本文件（内容归属原则，同 pyro.js）。
//
// 「酝酿」开场剧本（bosses/corruptBrew，占住首拍不动作的那一拍）：
//   脉动（1.0s）：菌体呼吸式鼓胀两拍 + 暗绿闪 ×2 + 体表冒出第一撮孢子
//   漫场（1.4s）：三处孢子雾错峰漫起（主体 + 两翼）+ 光照压暗偏熄火（腐沼代谢）
//     + 暗绿跟随点光缓起 + 朝玩家侧吐一口孢子云
//   常驻（挂舞台寿命）：低浓度孢子雾 + 绿点光——「这场战斗泡在它的代谢物里」
// 与三火 Boss 的差异：它不爆发——酝酿是**静中孕育**，一切附加物都往上飘
// （孢子/瘴气），与穿山甲王的「一切往下坠」正好一对。
// 美术口径：暂无立绘（占位色块），全部效果按立牌体量派生、不依赖贴图内容。
import * as THREE from 'three';
import { duelPose } from '../../camera.js';
import { arcProjectile } from '../../spells/blocks.js';
import { registerEnemyHitBeat, enemyImpactBeat, registerEnemyNoLunge } from '../../spells/enemyHitFx.js';
import { registerEnemyAct } from '../enemyAct.js';
import { registerBossStateFx, registerBossHurtFx } from '../../bossStateFx.js';
import { makeSporeVeins } from '../../sporeVeins.js';
import { isAttackKind, isBuffKind, isDebuffKind } from '../../../../core/intentKinds.js';

// 孢子软点纹理（radial 渐隐——读成悬浮的孢子/瘴气微滴，不是火花）
let _sporeTex = null;
function sporeTexture() {
  if (_sporeTex) return _sporeTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(220,255,210,0.9)');
  grad.addColorStop(0.4, 'rgba(150,220,120,0.45)');
  grad.addColorStop(1, 'rgba(110,190,90,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  _sporeTex = new THREE.CanvasTexture(c);
  _sporeTex.colorSpace = THREE.SRGBColorSpace;
  return _sporeTex;
}

// 白热芯孢子变体：只给「孢子云」（debuff 拍）用——普通混合的软球在暗背景上
// 近乎隐形，云是这拍的主体读数，芯必须过亮白
let _sporeHotTex = null;
function sporeHotTexture() {
  if (_sporeHotTex) return _sporeHotTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 1, 32, 32, 30);
  grad.addColorStop(0, 'rgba(245,255,235,1)');
  grad.addColorStop(0.25, 'rgba(190,255,150,0.85)');
  grad.addColorStop(0.55, 'rgba(130,220,100,0.42)');
  grad.addColorStop(1, 'rgba(100,180,80,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  _sporeHotTex = new THREE.CanvasTexture(c);
  _sporeHotTex.colorSpace = THREE.SRGBColorSpace;
  return _sporeHotTex;
}

// 藤鞭纹理：横向长鞭——根端粗暗（左，连着菌体）、梢端细亮（右，抽向玩家），
// 上下带刺突（荆棘）。additive 下黑 = 透明
let _vineTex = null;
function vineTexture() {
  if (_vineTex) return _vineTex;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  // 主鞭身：从左粗到右细的渐亮条
  const grad = g.createLinearGradient(0, 0, 256, 0);
  grad.addColorStop(0, 'rgba(70,110,50,0.9)');
  grad.addColorStop(0.6, 'rgba(120,190,80,0.85)');
  grad.addColorStop(0.92, 'rgba(210,255,170,1)');
  grad.addColorStop(1, 'rgba(210,255,170,0)');
  g.strokeStyle = grad;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(4, 32);
  // 中段轻微起伏（鞭子是甩出来的，不是直线）
  g.bezierCurveTo(80, 22, 160, 42, 250, 30);
  g.lineWidth = 9;
  g.stroke();
  // 刺突：沿鞭身五根短刺（上下交替）
  g.strokeStyle = 'rgba(190,240,140,0.8)';
  g.lineWidth = 3;
  const barbs = [[60, 26, -1], [100, 38, 1], [140, 26, -1], [180, 37, 1], [215, 27, -1]];
  for (const [x, y, d] of barbs) {
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + 6, y + 9 * d); g.stroke();
  }
  _vineTex = new THREE.CanvasTexture(c);
  _vineTex.colorSpace = THREE.SRGBColorSpace;
  return _vineTex;
}

const T = {
  BREATHE: 1000, // 脉动：菌体鼓胀两拍
  FOG: 1400,     // 漫场：孢子雾错峰漫起
};

/** 一撮孢子（自某点向四周慢慢飘散）。 */
function sporePuff(particles, x, y, z, n = 10, speed = 4) {
  particles.spawn(x, y, {
    color: 0x9adf6a, count: n, speed, ttl: 1.6, size: 1.1, gravity: 1.5, z,
  });
}

async function corruptBrew({ ctx, args, cast, particles, shake, vignette, camera, onStageDispose, runScript, unitById }) {
  const unit = unitById(args.unit);
  if (!unit) return; // 快照缺失兜底：静默收拍
  const ux = unit.position.x, uy = unit.position.y, uz = unit.position.z;
  const s = unit._baseScale ?? 1;
  const H = unit._standeeHeight ?? 22;
  const player = cast.get('role:player') ?? null;

  // —— 酝酿机位（演出期间接管，收尾弹栈）：轻推半档——静中孕育也要有人看着 ——
  const base = camera?.basePose;
  const pose = base ? duelPose(base, { fovScale: 0.9, elScale: 0.5 }) : null;
  camera?.pushOverride?.('corruptBrew', {
    poses: pose ? { corruptBrew: pose } : {},
    onEnter: (dir) => { if (pose) dir.flyTo('corruptBrew', { durationMs: 800, ease: 'power2.out' }); },
  });

  // —— 脉动：鼓胀两拍 + 暗绿闪 + 体表冒孢子 ——
  const PULSE = [[0.22, 0x3d5a2e], [0.68, 0x5a8a3e]];
  const hit = PULSE.map(() => false);
  await ctx.custom(unit.uniqueID, {
    durationMs: T.BREATHE, ease: 'none',
    onUpdate: (t) => {
      // 呼吸式鼓胀：两个整正弦（t=0 严格为 0，与静止位连续），第二拍幅度更大
      const breathe = 0.035 * Math.sin(t * Math.PI * 2) + 0.05 * Math.max(0, Math.sin(t * Math.PI * 2 - Math.PI * 0.2));
      unit.scale.set(s * (1 + breathe), s * (1 + breathe * 1.3), 1);
      PULSE.forEach(([at, col], i) => {
        if (hit[i] || t < at) return;
        hit[i] = true;
        unit.flash?.(col);
        sporePuff(particles, ux, uy + H * 0.5, uz + 1, 7, 3);
      });
    },
  });
  unit.scale.set(s, s, 1);

  // —— 漫场：孢子雾错峰漫起 + 光照压暗熄火 + 绿点光 + 朝玩家吐一口 ——
  shake.impulse(0.5);
  vignette.pulse(0.7);
  // 朝玩家侧吐一口孢子云（酝酿的「预告」——下一步就轮到它动手了）
  if (player) {
    const px = player.position.x, py = player.position.y + 3.4 * (player._baseScale ?? 1);
    const dx = px - ux, dy = py - (uy + H * 0.5);
    for (let i = 0; i < 9; i++) {
      const rec = particles.spawnSprite(ux + (Math.random() - 0.5) * H * 0.3, uy + H * 0.5, {
        texture: sporeTexture(), width: 1.6, height: 1.6, z: uz + 2,
        vx: dx * (0.9 + Math.random() * 0.3), vy: dy * (0.9 + Math.random() * 0.3) + 2,
        gravity: 1.5, drag: 1.2, ttl: 1.1, scalePop: 0.4,
      });
      if (rec) rec.sprite.material.rotation = Math.random() * Math.PI;
    }
  }
  // 绿点光（挂单位跟随）：暗绿幽光把菌体从 Boss 房的血色基调里换出来——
  // 「这场仗的灯光归它的代谢物管」。从舞台光池借（light:fx0），add 灯即重编译
  const glow = cast.get('light:fx0');
  if (glow) {
    glow.color.set(0x6fae5a);
    glow.distance = H * 6;
    glow.position.set(0, H * 0.5, H * 0.3);
    unit.add(glow);
    onStageDispose?.(() => { glow.intensity = 0; unit.remove(glow); });
  }
  // 常驻孢子雾：主体一团 + 两翼各一团（错峰起步，腐沼是一层一层漫起来的）
  const MISTS = [
    { dx: 0, dy: H * 0.35, r: H * 0.5, rate: 11, lag: 0 },
    { dx: -H * 1.0, dy: H * 0.15, r: H * 0.55, rate: 7, lag: 500 },
    { dx: H * 0.9, dy: H * 0.1, r: H * 0.5, rate: 6, lag: 1000 },
  ];
  const mists = [];
  for (const m of MISTS) {
    const em = particles.spawnEmitter(ux + m.dx, uy + m.dy, {
      rate: 0, radius: m.r, color: 0x86c46a, speed: 2.5, ttl: 3.2, size: 1.6,
      gravity: 1.8, zJitter: H * 0.45, z: uz,
    });
    if (!em) continue;
    onStageDispose?.(() => em.stop());
    mists.push({ em, ...m });
  }
  (runScript ?? ((body) => ctx.spawn(body)))(async (c) => {
    const jobs = [];
    for (const m of mists) jobs.push(c.tweenRaw(m.em, { rate: m.rate }, { durationMs: 1600, delayMs: m.lag }));
    if (glow) jobs.push(c.tweenRaw(glow, { intensity: 900 }, { durationMs: 1400, ease: 'power2.out' }));
    const mood = cast.get('light:mood');
    if (mood) {
      jobs.push(c.tweenRaw(mood, { dim: mood.dim * 0.8 }, { durationMs: 2000, delayMs: 200 }));
      jobs.push(c.tweenRaw(mood, { fireGain: mood.fireGain * 0.7 }, { durationMs: 1800, delayMs: 300 }));
    }
    await Promise.all(jobs);
  });
  await ctx.wait(T.FOG);

  // 演出机位退场：先补间飞回基准（flyHome 连 fov），再弹栈
  await camera?.flyHome?.({ durationMs: 720, ease: 'power2.inOut' }) ?? null;
  camera?.popOverride?.('corruptBrew');
  unit.restoreColor?.();
}

// —— 命中 beat（毒沼绿主题）：藤鞭抽打（3×3 连拍）= 绿毒鞭痕 + 孢子迸溅；
// 普击同绿色。共享底座 enemyImpactBeat——它的攻击读成「被藤蔓抽」，不是钝器撞。
async function corruptHitBeat(ctx, deps, args) {
  const heavy = args.fx.tier === 'heavy';
  await enemyImpactBeat(ctx, deps, {
    ...args,
    pal: {
      color: heavy ? [0.45, 0.85, 0.35] : [0.55, 0.9, 0.42],
      hot: heavy ? [0.8, 1.3, 0.6] : [0.75, 1.15, 0.55],
      rim: [0.55, 1.0, 0.5],
      sparkColor: heavy ? 0x86e05a : 0x9adf6a,
      dustColor: 0x6a7a5a,
      flashColor: 0xc8ffb0,
    },
    garnish: (c2, d, { at, heavy: hv }) => {
      // 孢子迸溅：命中点炸一撮慢速上飘的孢子（毒沾身）
      d.particles?.spawn?.(at.x, at.y, {
        color: 0x9adf6a, count: hv ? 16 : 9, speed: hv ? 9 : 6,
        size: 1.1, ttl: 1.4, gravity: 2, z: at.z,
      });
      // 鞭痕：一道斜切绿痕短促亮灭（连拍时一道接一道 = 藤鞭连抽）
      const rec = d.particles?.spawnSprite?.(at.x, at.y, {
        texture: sporeTexture(), width: hv ? 7 : 5.2, height: hv ? 2.6 : 2.0,
        z: (at.z ?? 0) + 1.6, ttl: 0.14, gravity: 0, scalePop: 0.25,
      });
      if (rec) rec.sprite.material.rotation = 0.5 + (Math.random() - 0.5) * 0.3;
    },
  });
}

// —— 起手 beat：攻击拍（3×3 藤鞭抽打）= 菌体前倾 + 三道藤鞭逐道甩出（长鞭 sprite
// 横贯战场抽到玩家身上，逐道 130ms——命中侧的绿痕+孢子由 hit beat 承接）；
// 召唤拍 = 腐土隆起（主体脚下腐土翻起 + 两翼孢子柱冲天——召唤物立起由
// ANIM_UNIT_SPAWN 承接）；debuff 拍（虚弱+脆弱）= 孢子云缓慢漂向玩家（替代通用
// 紫色咒弹）；增益/回血拍 = 菌网输养（绿珠分流向两翼 + 全网养分一涌）。
// 酝酿首拍由 corruptBrew 剧本接管。
async function corruptAct({ ctx, deps, unit, player, kinds }) {
  const ux = unit.position.x, uy = unit.position.y, uz = unit.position.z;
  const H = unit._standeeHeight ?? 22;
  if (kinds.some(isAttackKind)) {
    const id = unit.uniqueID;
    // 前倾蓄势（扎根植物的「扑」= 上身倾压，不挪步）。子剧本随父本结算被杀
    // （铁律）——藤鞭循环只撑 390ms，会把 720ms 的回正段腰斩在中途（单位永久
    // 残留前倾）；收 promise 末尾等齐
    const pose = ctx.spawn(async (c) => {
      await c.custom(id, {
        durationMs: 220, ease: 'power2.in',
        onUpdate: (t) => unit.setPose({ lean: 0.13 * t, squash: 1 - 0.05 * t }),
      });
      await c.custom(id, {
        durationMs: 500, ease: 'power2.out',
        onUpdate: (t) => unit.setPose({ lean: 0.13 * (1 - t) }),
      });
      unit.resetPose?.();
    });
    // 三道藤鞭：从菌体甩向玩家胸口，横贯战场的长鞭 sprite（根端连 Boss、梢端抵达）
    const px = player?.position.x ?? ux - 30;
    const py = player ? player.position.y + 3.4 * (player._baseScale ?? 1) : uy + H * 0.4;
    const pz = player?.position.z ?? uz;
    const mx = (ux + px) / 2, my = (uy + H * 0.45 + py) / 2;
    const dx = px - ux, dy = py - (uy + H * 0.45);
    const dist = Math.hypot(dx, dy);
    const rot = Math.atan2(dy, dx);
    for (let i = 0; i < 3; i++) {
      const rec = deps.particles?.spawnSprite?.(
        mx + (Math.random() - 0.5) * 2, my + (i - 1) * 1.6, {
          texture: vineTexture(), width: dist * 0.8, height: 2.2, z: pz + 2.5,
          ttl: 0.24, gravity: 0, scalePop: 0.2, fadeIn: true,
        });
      // 根端在 Boss：纹理 +x 朝玩家；若玩家在左（恒如此）则贴图旋转 π+航向角
      if (rec) rec.sprite.material.rotation = rot + (dx < 0 ? Math.PI : 0);
      await ctx.wait(130);
    }
    await pose.promise;
    return;
  }
  if (kinds.includes('summon')) {
    unit._fxLayer?.get('bossVeins')?.pulse?.(1); // 召唤 = 菌网把养分推出去
    deps.shake?.impulse?.(0.5);
    deps.particles?.spawn?.(ux, uy + H * 0.06, {
      color: 0x5a6a3e, count: 16, speed: 7, vby: 8, ttl: 1.2, size: 1.6, gravity: -10, z: uz + 0.6,
    });
    // 两翼孢子柱：新芽破土的位置预告（召唤物落点的「先从地里冒一股」）
    for (const dx of [-H * 1.15, H * 1.05]) {
      deps.particles?.spawn?.(ux + dx, uy + H * 0.1, {
        color: 0x86c46a, count: 13, speed: 3.5, vby: 13, ttl: 1.5, size: 1.4, gravity: 2, z: uz + 1,
      });
    }
    sporePuff(deps.particles, ux, uy + H * 0.3, uz + 1, 10, 5);
    await ctx.wait(420);
    return;
  }
  if (kinds.some(isDebuffKind)) {
    // 孢子云：一缕缕慢速漂向玩家（毒是渗过去的，不是射过去的）。
    // 远场+普通混合双重折损：1.8wu 软球在暗房里近乎隐形（发射正常、
    // 屏上读不出）——云孢子换白热芯变体 + 加大一号
    if (player) {
      const px = player.position.x, py = player.position.y + 3.4 * (player._baseScale ?? 1);
      const dx = px - ux, dy = py - (uy + H * 0.5);
      for (let i = 0; i < 7; i++) {
        deps.particles?.spawnSprite?.(ux + (Math.random() - 0.5) * H * 0.4, uy + H * (0.3 + Math.random() * 0.4), {
          texture: sporeHotTexture(), width: 2.6, height: 2.6, z: uz + 2,
          vx: dx * (0.55 + Math.random() * 0.25), vy: dy * (0.55 + Math.random() * 0.25) + 1.5,
          gravity: 1.2, drag: 1.0, ttl: 1.5, scalePop: 0.35,
        });
        await ctx.wait(70);
      }
      sporePuff(deps.particles, px, py - 1, player.position.z + 1, 8, 3);
    }
    return;
  }
  if (kinds.some(isBuffKind) || kinds.includes('heal')) {
    unit._fxLayer?.get('bossVeins')?.pulse?.(1.2); // 治疗 = 全网养分一涌
    unit.flash?.(0x5a8a3e);
    // 输养：绿珠自胸口分流到每只为军召唤物（cast 前缀圈选取真实落点——硬编码两翼
    // 会把珠送到空槽位：三只召唤物全在右侧时左珠扑空）。子剧本随父本
    // 结算被杀（铁律）——收 promise 统一 await；全程远场（同排 z≈-56），尺寸按远场给足
    const playerView = deps.cast?.get?.('role:player');
    const allies = (deps.cast?.query?.('unit:') ?? [])
      .map((e) => e.handle)
      .filter((v) => v && v !== unit && v !== playerView && !v._dead);
    const orbs = [];
    for (const ally of allies.slice(0, 3)) {
      orbs.push(ctx.spawn((c) => arcProjectile(c, deps, {
        from: { x: ux, y: uy + H * 0.5, z: uz },
        to: { x: ally.position.x, y: ally.position.y + (ally._standeeHeight ?? 16) * 0.45, z: ally.position.z },
        color: [0.5, 0.85, 0.35], hot: [0.8, 1.2, 0.55],
        size: 1.9, ms: 480, arcH: 4.5, stretch: 1.15,
        lampName: 'light:fx1', lampIntensity: 200,
        trail: { color: 0x86c46a, speed: 2, size: 0.8, ttl: 0.34 },
      })).promise);
    }
    sporePuff(deps.particles, ux, uy + H * 0.4, uz + 1, 9, 3.5);
    await Promise.all(orbs);
  }
}

export function registerCorruptSourceScripts(register) {
  register('bosses/corruptBrew', corruptBrew);
  registerEnemyHitBeat('corruptSource', corruptHitBeat);
  registerEnemyAct('corruptSource', corruptAct);
  // 扎根植物：不突进——攻击的身体语言是前倾 + 藤鞭甩出，不是挪步扑人
  registerEnemyNoLunge('corruptSource');
  // 常驻菌络导演（bossStateFx）：菌体活着 = 菌网常绿（代谢行波 + 孢囊呼吸）；
  // 召唤/治疗拍的 pulse 由 act beat 触发
  registerBossStateFx('corruptSource', (obj, unitProj) => {
    if (unitProj.isDead) return;
    obj._fxLayer?.overlay('bossVeins', 2, (l) => makeSporeVeins(l));
    obj._fxLayer?.setLevel('bossVeins', 0.72);
  });
  // 受击补充：挨打 = 命中点孢子迸溅 + 菌网一缩（亮度小幅回涌）
  registerBossHurtFx('corruptSource', (ctx, deps, { unit, dealt }) => {
    const H = unit._standeeHeight ?? 22;
    unit._fxLayer?.get('bossVeins')?.pulse?.(0.4);
    sporePuff(deps.particles, unit.position.x, unit.position.y + H * (0.35 + Math.random() * 0.3),
      unit.position.z + 1, Math.min(5 + Math.round(dealt / 5), 12), 5);
  });
}
