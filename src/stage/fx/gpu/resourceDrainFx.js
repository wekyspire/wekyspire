// 资源消耗汇聚特效——两层结构：
//   · 主体能量 = projectile 光珠（uiScene mesh 面片，fx/spells 的 projectileShade
//     语言）：每资源 3 珠，从资源图标弧线加速飞进卡面费用徽章。**节拍权威**：
//     playCardCost 返回 { done } = 最后一珠真落地的 promise——卡牌起飞不靠
//     DRAIN_FLIGHT_MS 估算，由 projectile 完结时刻发送（缺宿主的兜底路径才用常量）。
//   · garnish = GPU 池碎星（uber burst + destination 汇聚）：资源「碎裂」的尘随，
//     数量级低于主体（光珠承担主体读感）。
// 非卡来源的消耗（维持费等）纯爆散（burst 不带目的锚）。
//
// 手感旋钮：ORBS（光珠流数/时长/弧高）+ 类型表 spawn/destination/render 参数；
// 每点费用碎星数 = PARTICLES_PER_POINT。预热 = warmDrainOrbs（常色两变体）。
import * as THREE from 'three';
import { uniform, uv } from 'three/tsl';
import { defineParticleType } from './particleTypes.js';
import { costBadgeUvs, COST_BADGE_RADIUS } from '../../richtext/cardFace.js';
import { spellQuad, linearColor, warmSpellQuad } from '../spells/blocks.js';
import { projectileShade } from '../spells/shaders.js';

/** 兜底编排时长（无 uiScene/runScript 宿主时的固定等待；正常路径不读——
 *  节拍由光珠 done promise 真值发送）。 */
export const DRAIN_FLIGHT_MS = 300;
/** 每点费用的碎星数（garnish 档；主体读感由光珠承担）。 */
const PARTICLES_PER_POINT = 10;
const MAX_BURST = 60;

// 光珠参数（肾上腺素 manaCast 同语言：贝塞尔弧 + power1.in 加速吸入）
const ORB = { streams: 3, maxStreams: 5, projMs: 220, staggerMs: 40, arcH: 5.0, size: 3.4, stretch: 1.4 };
// 魏启 = 冰蓝；AP = 暖金（与状态栏两图标/碎星同色系）
const MANA_ORB = { key: 'mana', color: [0.42, 0.68, 1.20], hot: [0.85, 1.05, 1.50] };
const AP_ORB = { key: 'ap', color: [1.10, 0.88, 0.30], hot: [1.35, 1.15, 0.60] };

const T_MANA = defineParticleType({
  name: 'resDrainMana', space: 'ui', cap: 384,
  spawn: { ttl: 0.6, ttlJit: 0.1, vel: [0, 2, 0], velJit: 3, spread: 1.6, radial: 40, drag: 3.0 },
  destination: { domainMode: 0, steerDelay: 0.04, steerRamp: 0.05, steerK: 900, arriveR: 2.2, curveK: 0.5, arriveGain: 18 },
  endMode: 2, progressMode: 1,
  render: { size: 1.1, sizeEndK: 0.5, color: [0.55, 1.5, 2.6], colorEnd: [0.3, 0.8, 2.0], alpha: 1, heat: 0.9 },
});
const T_AP = defineParticleType({
  name: 'resDrainAp', space: 'ui', cap: 384,
  spawn: { ttl: 0.6, ttlJit: 0.1, vel: [0, 2, 0], velJit: 3, spread: 1.6, radial: 40, drag: 3.0 },
  destination: { domainMode: 0, steerDelay: 0.04, steerRamp: 0.05, steerK: 900, arriveR: 2.2, curveK: 0.5, arriveGain: 18 },
  endMode: 2, progressMode: 1,
  render: { size: 1.1, sizeEndK: 0.5, color: [2.6, 1.7, 0.45], colorEnd: [2.0, 1.0, 0.2], alpha: 1, heat: 0.9 },
});

/** 常色变体预热（mana/AP 两珠；战斗开场 sync 批与 warmSpellFx 同点调用）。 */
export function warmDrainOrbs() {
  for (const c of [MANA_ORB, AP_ORB]) {
    warmSpellQuad(`drainOrb:${c.key}`, () => spellQuad({
      shade: projectileShade(uv(), uniform(0.5), linearColor(c.color), linearColor(c.hot)),
      width: ORB.size, height: ORB.size, name: 'warm:drainOrb',
    }));
  }
}

const _tmpV = new THREE.Vector3();

/**
 * @param pool  UI 空间粒子池（createParticlePool space:'ui'；null 时碎星静默跳过）
 * @param getters { manaPos: () => THREE.Vector3-like, apPos: () => ... } 资源图标位
 * @param host { uiScene, runScript } 光珠宿主（uiScene 挂面片；runScript = 舞台寿命
 *   剧本口（BattleStage._fxRunScript）——光珠随舞台 dispose 结构化回收）
 */
export function createResourceDrainFx(pool, getters, host = null) {

  const count = (amount) => Math.min(MAX_BURST, Math.max(6, Math.round(amount * PARTICLES_PER_POINT)));

  // 锚点跟随（碎星的目的地）：条目存活期每帧重算徽章世界位（含 scale 变化）
  // → moveAnchor 行更新（粒子存域内参数，目标点每帧现算，平滑追踪零跳变）。
  const _followers = []; // { anchor, cardView, badges, kind, t }

  const badgeCenter = (f) => {
    const cv = f.cardView;
    cv.getWorldPosition(_tmpV);
    const w = (cv.cardWidth ?? 20) * (cv.scale?.x || 1);
    const h = (cv.cardHeight ?? 27) * (cv.scale?.y || 1);
    const b = f.badges.find((x) => x.kind === f.kind);
    return [_tmpV.x + (b.u - 0.5) * w, _tmpV.y + (0.5 - b.vTop) * h, _tmpV.z];
  };
  const badgeRadius = (cv) => (COST_BADGE_RADIUS / 200) * (cv.cardWidth ?? 20) * (cv.scale?.x || 1);
  const dropFollower = (f) => {
    const i = _followers.indexOf(f);
    if (i >= 0) _followers.splice(i, 1);
  };

  // ---- 光珠飞行（fx/script 协程；完成承诺挂剧本 handle——正常落定/被杀双路必达）----
  function flyOrbs(kind, amount, cardView, badges) {
    const conf = kind === 'mana' ? MANA_ORB : AP_ORB;
    const p = kind === 'mana' ? getters.manaPos() : getters.apPos();
    const f = { cardView, badges, kind, t: 0 };
    const [bx, by, bz] = badgeCenter(f);   // 目的地快照：汇聚期内卡静止（节拍串行保证）
    let resolveDone = null;
    const done = new Promise((r) => { resolveDone = r; });
    const streams = Math.min(ORB.maxStreams, ORB.streams + Math.floor(amount / 2));   // 大费用更重
    const h = host.runScript(async (ctx) => {
      const jobs = [];
      for (let i = 0; i < streams; i++) {
        jobs.push(ctx.spawn(async (c) => {
          if (i > 0) await c.wait(i * ORB.staggerMs);
          if (c.killed) return;
          // 每珠独立轨道：起点绕图标微散、弧向交替（左右摆开，不成一列）
          const side = i % 2 === 0 ? 1 : -1;
          const from = { x: p.x + side * (1.2 + i * 0.8), y: p.y - 1.0 + (i % 3) * 1.4, z: p.z };
          const to = { x: bx - side * 0.6, y: by + 0.4, z: bz + 0.5 };
          const arcH = ORB.arcH * (0.8 + 0.4 * ((i * 37) % 10) / 10) * side;
          const uPhase = uniform(0);
          const { quad, release } = spellQuad({
            shade: projectileShade(uv(), uPhase, linearColor(conf.color), linearColor(conf.hot)),
            width: ORB.size, height: ORB.size, name: 'fx:drainOrb',
          });
          quad.position.set(from.x, from.y, from.z);
          host.uiScene.add(quad);
          c.onKill(release);
          const st = { t: 0 };
          const ctrl = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 + arcH };
          await c.tweenRaw(st, { t: 1 }, {
            durationMs: ORB.projMs, ease: 'power1.in',
            onUpdate: () => {
              const t = st.t, w = 1 - t;
              quad.position.set(
                w * w * from.x + 2 * w * t * ctrl.x + t * t * to.x,
                w * w * from.y + 2 * w * t * ctrl.y + t * t * to.y,
                w * from.z + t * to.z,
              );
              // 朝速度方向自旋（二次贝塞尔切线 w(C-P0)+t(P2-C)）+ 前向拉伸
              const vx = w * (ctrl.x - from.x) + t * (to.x - ctrl.x);
              const vy = w * (ctrl.y - from.y) + t * (to.y - ctrl.y);
              quad.rotation.z = Math.atan2(vy, vx);
              quad.scale.set(ORB.stretch, 1.0, 1);
              uPhase.value = t * 20;
            },
          });
          release();   // 正常落定自收（tweenRaw 覆写 onComplete，收尾只能放协程体；被杀走 onKill）
        }));
      }
      await Promise.all(jobs.map((j) => j.promise));   // 父本存活至全珠落定（子随父杀）
    });
    h.promise.then(() => resolveDone());
    return done;
  }

  /**
   * 卡费消耗：光珠（节拍权威）+ 碎星爆散汇聚（garnish）。
   * @returns {{ done: Promise } | null} done = 最后一珠落地；宿主缺席（无 uiScene/
   *   runScript，如 headless null presenter 路径）返回 null——调用方退回固定延迟。
   */
  function playCardCost({ mana = 0, ap = 0, cardView }) {
    if (!cardView || (mana <= 0 && ap <= 0)) return null;
    const badges = costBadgeUvs({ mana, actionPoint: ap });
    let done = null;
    if (host?.uiScene && host?.runScript) {
      const dones = [];
      if (mana > 0) dones.push(flyOrbs('mana', mana, cardView, badges));
      if (ap > 0) dones.push(flyOrbs('ap', ap, cardView, badges));
      done = Promise.all(dones).then(() => {});
    }
    const spawnDust = (kind, amount) => {
      if (!pool) return;
      const p = kind === 'mana' ? getters.manaPos() : getters.apPos();
      const T = kind === 'mana' ? T_MANA : T_AP;
      const f = { anchor: -1, cardView, badges, kind, t: 0 };
      f.anchor = pool.addAnchor({ type: 'circle', center: badgeCenter(f), radius: badgeRadius(cardView) });
      pool.burst(T, count(amount), { at: [p.x, p.y, p.z], to: f.anchor });
      pool.onDrained(T, () => { pool.removeAnchor(f.anchor); dropFollower(f); });
      _followers.push(f);
    };
    if (mana > 0) spawnDust('mana', mana);
    if (ap > 0) spawnDust('ap', ap);
    return done ? { done } : null;
  }

  /** 非卡来源消耗：纯爆散（目的地关 = burst 传 to:-1）。 */
  function playDrain({ kind, amount }) {
    if (amount <= 0 || !pool) return;
    const p = kind === 'mana' ? getters.manaPos() : getters.apPos();
    pool.burst(kind === 'mana' ? T_MANA : T_AP, count(amount),
      { at: [p.x, p.y, p.z], to: -1 });
  }

  /** 每帧跟随（BattleStage tick 驱动）。条目寿命收紧到 0.8s = 飞行段+起飞瞬间：
   *  之后卡牌进入离场链（回手/飞牌库），残星脱锚就地消散，不追进牌库。 */
  function update(dt) {
    for (let i = _followers.length - 1; i >= 0; i--) {
      const f = _followers[i];
      f.t += dt;
      if (f.t > 0.8) { pool.removeAnchor(f.anchor); _followers.splice(i, 1); continue; }
      pool.moveAnchor(f.anchor, { center: badgeCenter(f) });
    }
  }

  function dispose() { _followers.length = 0; }

  return { playCardCost, playDrain, update, dispose };
}
