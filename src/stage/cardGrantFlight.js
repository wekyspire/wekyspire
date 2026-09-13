// 「择卡得卡」演出（公共组件）：三选一类界面确认得卡后的统一表演。
//
// 背景（用户 2026-09-13 报）：战后奖励三选一选完卡毫无反馈——面板直接消失进切幕，
// 卡静悄悄进牌组。本组件给出统一的两拍语言：
//   ① 选中脉冲：**只放缩**（「就是这张」的一拍；不打金色闪光——用户同日报：
//      金闪与升级特效撞语言，耀眼到像 bug，闪光类语言专属升级/power 变化）；
//   ② 收编飞行：贝塞尔弧线飞向收编锚点 + 途中缩小 + 尾段淡出 + 中段微倾
//      （同 BattleStage._cardFlight/_addCardBeat 的飞行语言），落位销毁。
// 整段作为**一条指令挂上 animation sequencer**（宿主注入，可空 = 直接播），与后续的
// 场景切换/清层动画天然串行（同一队列定序，见 runController 的节拍链）。
// 宿主在 onDone 里上行意图——**状态变更发生在演出之后**（卡先落袋，面板再重建）。
//
// 使用面：战后奖励三选一（BattleStage 模态面板）、老虎机卡多选一（RoomStage 操纵条）、
// 古尔帕斯卡包（MapStage 模态面板）、训练抓牌（RoomStage 操纵条）、商店卡包
// （stagePickerKit 全屏选卡界面）。事件给卡是直接入组（走通用获得特写），多选确认类
// （种子包九选三）语义不同——都不走这里。

import gsap from 'gsap';
import { EventNames } from '../bridge/events.js';

export const CARD_GRANT_TIMING = Object.freeze({
  pulseMs: 300,   // 选中脉冲（只放缩——无金色闪光）
  flyMs: 540,     // 收编飞行
});
const TOTAL_MS = CARD_GRANT_TIMING.pulseMs + CARD_GRANT_TIMING.flyMs;
// sequencer 指令保险丝：节拍卫生要求远宽于实际时长（≥2.5 倍），强杀只是防僵死兜底
const FUSE_MS = TOTAL_MS * 3;

/**
 * 播「择卡得卡」演出。
 * @param {object} opts
 *   card: CardObject——演出**接管所有权**（演完移除 + dispose；调用方须先把它从原容器
 *         的簿记/拾取中摘出，见 PanelObject.takeCard / ScrollPickerObject.takeEntry）
 *   target: { x, y, z } 收编锚点（战斗舞台 = 牌库图标；塔楼/房间 = 玩家状态栏）
 *   sequencer: AnimationSequencer | null（有则指令化、与后续节拍串行；无则直接播）
 *   onDone: 结束回调，**恰好一次**（tween 完成或兜底计时器先到为准；sequencer 保险丝
 *           强杀不影响它——tween 独立于队列计时，意图上行绝不会被吞）
 * @returns 是否受理（card/target 无效 = false 且已同步回调 onDone，调用方直接续走）
 */
export function playCardGrantFlight({ card, target, sequencer = null, onDone = null }) {
  if (!card || !target) { onDone?.(); return false; }

  const run = (finishBeat = () => {}) => {
    let settled = false;
    const tweens = [];
    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(safety);
      for (const tw of tweens) tw.kill();
      card.removeFromParent?.();
      card.dispose();
      finishBeat();
      onDone?.();
    };
    // 兜底：tween 链断裂（异常/外部清场）也不吞上行——意图延迟可以，丢失不行
    const safety = setTimeout(settle, TOTAL_MS + 400);

    // ① 选中脉冲：只放缩、**不打金色卡面闪光**（用户 2026-09-13 报：金色脉冲与卡牌升级
    // 特效撞语言，"过于明显和耀眼、看起来反而像是有 bug"——得卡的一拍留给放缩 + 飞行，
    // 闪光类语言从此专属「升级/power 变化」）。
    const s0 = card.scale.x || 1;
    tweens.push(gsap.to(card.scale, {
      x: s0 * 1.18, y: s0 * 1.18,
      duration: CARD_GRANT_TIMING.pulseMs / 1000, ease: 'back.out(2)',
      onComplete: fly,
    }));

    // ② 收编飞行：贝塞尔弧线（控制点在航线中点上方，弧高随距离自适应钳制）
    function fly() {
      const from = {
        x: card.position.x, y: card.position.y, z: card.position.z,
        s: card.scale.x, rot: card.rotation.z,
      };
      const dist = Math.hypot(target.x - from.x, target.y - from.y);
      const arcH = Math.min(Math.max(dist * 0.25, 6), 18);
      const ctrl = { x: (from.x + target.x) / 2, y: (from.y + target.y) / 2 + arcH };
      const toS = 0.45;
      const mat = card.faceMesh?.material ?? null;
      const state = { t: 0 };
      tweens.push(gsap.to(state, {
        t: 1, duration: CARD_GRANT_TIMING.flyMs / 1000, ease: 'power1.in',
        onUpdate: () => {
          const t = state.t; const u = 1 - t;
          card.position.set(
            u * u * from.x + 2 * u * t * ctrl.x + t * t * target.x,
            u * u * from.y + 2 * u * t * ctrl.y + t * t * target.y,
            u * u * from.z + 2 * u * t * ((from.z + target.z) / 2 + arcH) + t * t * target.z,
          );
          const s = from.s + (toS - from.s) * t;
          card.scale.set(s, s, 1);
          card.rotation.z = from.rot * (1 - t) + Math.sin(Math.PI * t) * 0.14;
          if (mat) mat.opacity = t < 0.62 ? 1 : 1 - (t - 0.62) / 0.38; // 尾段淡出（落袋感）
        },
        onComplete: settle,
      }));
    }
  };

  if (!sequencer) { run(); return true; }
  sequencer.enqueueInstruction({
    meta: { event: 'run:card-grant' },
    durationMs: FUSE_MS,
    start: ({ id, emit }) => run(() => emit(EventNames.ANIMATION_INSTRUCTION_FINISHED, { id })),
  });
  return true;
}
