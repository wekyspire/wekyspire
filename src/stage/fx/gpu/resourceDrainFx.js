// 资源消耗汇聚特效（PARTICLE_SYSTEM_V2 首个消费者 / uber 参数化试金石）——
// 魏启/AP 被消耗时：资源图标处径向爆散（radial 初速 + steerDelay 爆散相位）
// → 弧线汇聚（curveK）→ 吸附到卡面对应**费用徽章**（右上：魏启最右、AP 其左，
// circle 锚 + domainMode 3 出生序均布到圆周，arrival 收敛不震荡）即死（endMode 2）。
// 非卡来源的消耗（维持费等）纯爆散（burst 不带目的锚）。
// 卡牌发动演出的衔接 = 调用方按 DRAIN_FLIGHT_MS 推迟起飞（编排常量，不做 GPU→CPU 回读）。
//
// 手感旋钮（调参区）：类型的 spawn/destination/render 全参数在下表；
// 编排时长 = DRAIN_FLIGHT_MS；每点费用粒子数 = PARTICLES_PER_POINT。
import * as THREE from 'three';
import { defineParticleType } from './particleTypes.js';
import { costBadgeUvs, COST_BADGE_RADIUS } from '../../richtext/cardFace.js';

/** 汇聚抵达的编排时长（卡牌发动展示延迟量）——必须 ≥ 实际抵达时间，否则卡先飞走
 *  粒子追进牌库（提速解决；GPU alive 读回延迟数百 ms 当不了
 *  节拍锚，故用固定编排延迟——retarget/节拍回读已在 PARTICLE_SYSTEM_V2 §八排期）。
 *  提速后实测 burst→抵达 ≈0.3-0.5s（steerK 200 / delay+ramp 0.22 / arrival gain 8）。 */
export const DRAIN_FLIGHT_MS = 600;
/** 每点费用的粒子数（总量另夹上限）。 */
const PARTICLES_PER_POINT = 26;
const MAX_BURST = 130;

// 费用徽章位置走 cardFace.costBadgeUvs（绘制规则的单一事实源——零开销不出徽章、
// 只耗 AP 时 AP 顶最右等排位细节都在那边，这里不许再存一份常量）。
// 卡 quad（cardWidth×cardHeight）与纹理同比例，直接按比例换算世界偏移。
// domainMode 0（圆盘填充）：粒子目标点落在徽章盘面内——曾用 3（圆周均布），
// 背侧目标点让粒子穿过圆心，视觉上「微微飞过头」（验收）。

// 魏启 = 冰蓝；AP = 暖金（与状态栏两图标同色系的能量化表达）
const T_MANA = defineParticleType({
  name: 'resDrainMana', space: 'ui', cap: 384,
  spawn: { ttl: 1.2, ttlJit: 0.1, vel: [0, 2, 0], velJit: 3, spread: 1.6, radial: 20, drag: 2.0 },
  destination: { domainMode: 0, steerDelay: 0.10, steerRamp: 0.12, steerK: 200, arriveR: 1.8, curveK: 0.7 },
  endMode: 2, progressMode: 1,
  render: { size: 1.6, sizeEndK: 0.5, color: [0.55, 1.5, 2.6], colorEnd: [0.3, 0.8, 2.0], alpha: 1, heat: 1.1 },
});
const T_AP = defineParticleType({
  name: 'resDrainAp', space: 'ui', cap: 384,
  spawn: { ttl: 1.2, ttlJit: 0.1, vel: [0, 2, 0], velJit: 3, spread: 1.6, radial: 20, drag: 2.0 },
  destination: { domainMode: 0, steerDelay: 0.10, steerRamp: 0.12, steerK: 200, arriveR: 1.8, curveK: 0.7 },
  endMode: 2, progressMode: 1,
  render: { size: 1.6, sizeEndK: 0.5, color: [2.6, 1.7, 0.45], colorEnd: [2.0, 1.0, 0.2], alpha: 1, heat: 1.1 },
});

const _tmpV = new THREE.Vector3();

/**
 * @param pool  UI 空间粒子池（createParticlePool space:'ui'；null 时全部静默跳过）
 * @param getters { manaPos: () => THREE.Vector3-like, apPos: () => ... } 资源图标位
 */
export function createResourceDrainFx(pool, getters) {
  if (!pool) return null;

  const count = (amount) => Math.min(MAX_BURST, Math.max(10, Math.round(amount * PARTICLES_PER_POINT)));

  // 锚点跟随（验收抓：锚点曾是出牌时点的一次性快照，卡牌飞展示位
  // 后粒子仍汇向手牌旧位）。跟随条目存活期每帧重算徽章世界位（含 scale 变化）
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

  /**
   * 卡费消耗：双资源各自爆散 → 汇聚到卡面**自己的费用徽章**（魏启→魏启徽章、
   * AP→AP 徽章；各一个跟随式 circle 锚。目的地 = 开销标位置）。
   * cardView = CardObject（读 position/cardWidth/cardHeight）。
   */
  function playCardCost({ mana = 0, ap = 0, cardView }) {
    if (!cardView || (mana <= 0 && ap <= 0)) return;
    const badges = costBadgeUvs({ mana, actionPoint: ap });
    const spawn = (kind, amount) => {
      const p = kind === 'mana' ? getters.manaPos() : getters.apPos();
      const T = kind === 'mana' ? T_MANA : T_AP;
      const f = { anchor: -1, cardView, badges, kind, t: 0 };
      f.anchor = pool.addAnchor({ type: 'circle', center: badgeCenter(f), radius: badgeRadius(cardView) });
      pool.burst(T, count(amount), { at: [p.x, p.y, p.z], to: f.anchor });
      pool.onDrained(T, () => { pool.removeAnchor(f.anchor); dropFollower(f); });
      _followers.push(f);
    };
    if (mana > 0) spawn('mana', mana);
    if (ap > 0) spawn('ap', ap);
  }

  /** 非卡来源消耗：纯爆散（目的地关 = burst 传 to:-1）。 */
  function playDrain({ kind, amount }) {
    if (amount <= 0) return;
    const p = kind === 'mana' ? getters.manaPos() : getters.apPos();
    pool.burst(kind === 'mana' ? T_MANA : T_AP, count(amount),
      { at: [p.x, p.y, p.z], to: -1 });
  }

  /** 每帧跟随（BattleStage tick 驱动）。条目寿命收紧到 1.0s = 飞行段+起飞瞬间：
   *  之后卡牌进入离场链（回手/飞牌库），残星脱锚就地消散，不追进牌库。 */
  function update(dt) {
    for (let i = _followers.length - 1; i >= 0; i--) {
      const f = _followers[i];
      f.t += dt;
      if (f.t > 1.0) { pool.removeAnchor(f.anchor); _followers.splice(i, 1); continue; }
      pool.moveAnchor(f.anchor, { center: badgeCenter(f) });
    }
  }

  function dispose() { _followers.length = 0; }

  return { playCardCost, playDrain, update, dispose };
}
