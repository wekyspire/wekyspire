// 「卡牌升级」演出（公共组件）：局外晋升的统一变身表演——原卡金闪蓄势 → 放缩峰值
// 换面（原卡变升级后的卡）→ 新卡亮相 → 飞入牌库锚点（锚点缺席则原地缩小淡出）。
//
// 语言规范（cardGrantFlight 钦定的分工）：金色闪光专属「升级 / power 变化」——这里正是
// 它的主场（得卡飞行不打金闪，升级要打）；收编飞行与 playCardGrantFlight 同款（贝塞尔
// 弧线 + 途中缩小 + 尾段淡出 + 中段微倾），「卡落进牌库」的语言全游戏一致。
//
// 整段作为**一条指令挂上 animation sequencer**（宿主注入，可空 = 直接播），与后续的
// 场景切换/清层动画天然串行。宿主在 onDone 里上行意图——**状态变更发生在演出之后**
// （同 playCardGrantFlight 的节拍哲学：卡先变身落库，面板再重建）。
//
// 换面：`card.setCard(toCard)`——toCard 是目标 defId 或完整 view（CardObject 两种都吃），
// 烘焙与选卡界面同源（宿主注入同一份 bakeFace）。fx 闪光层（CardFxLayer）时间驱动，
// 本函数用 gsap.ticker 自带驱动，不依赖宿主的帧循环。
//
// 使用面：stagePickerKit.playCardUpgrade（篝火/训练/银行/老虎机升级选卡确认、事件升级
// 的 run 级声明排水，都从那里进来）。

import gsap from 'gsap';
import { EventNames } from '../bridge/events.js';

export const CARD_UPGRADE_TIMING = Object.freeze({
  gatherMs: 360,   // 集中：从选中位飞到亮相位并放大（已在亮相位则整拍跳过）
  surgeMs: 320,    // 上冲蓄势：金闪 + 放缩冲峰（原卡最后一次完整亮相）
  swapMs: 260,     // 峰值换面后的下落回稳（换面发生在 surge 峰值，被闪光盖住切换瞬间）
  holdMs: 480,     // 新卡亮相：停一拍让玩家看清新卡
  flyMs: 540,      // 收编：飞入牌库锚点 / 原地缩小淡出（同 CARD_GRANT_TIMING.flyMs）
});
const TOTAL_MS = CARD_UPGRADE_TIMING.gatherMs + CARD_UPGRADE_TIMING.surgeMs
  + CARD_UPGRADE_TIMING.swapMs + CARD_UPGRADE_TIMING.holdMs + CARD_UPGRADE_TIMING.flyMs;
// sequencer 指令保险丝：节拍卫生要求远宽于实际时长（≥2.5 倍），强杀只是防僵死兜底
const FUSE_MS = TOTAL_MS * 3;

/** 升级金闪的专属色（与战斗内 _cardPowerBeat 的威力提升同款金色，同一语言）。 */
export const UPGRADE_GOLD = 0xffd34c;

/**
 * 播「卡牌升级」演出。
 * @param {object} opts
 *   card: CardObject——演出**接管所有权**（演完移除 + dispose；选卡界面确认时经
 *         ScrollPickerObject.takeEntry 摘出后传入，其网格位即起飞位）
 *   toCard: 新卡的 defId 或完整 view 对象（setCard 换面）
 *   target: { x, y, z } 牌库锚点（战斗舞台 = 牌库图标；塔楼/房间 = 玩家状态栏旁）；
 *           null = 无锚点（headless/降级路径），收尾改原地缩小淡出
 *   center: { x, y, z } 亮相位（缺省 uiScene 原点 = 屏幕中央；全屏界面组都在原点）
 *   showcaseScale: 亮相位的卡缩放（缺省 0.95）
 *   sequencer: AnimationSequencer | null（有则指令化、与后续节拍串行；无则直接播）
 *   onDone: 结束回调，**恰好一次**（tween 完成或兜底计时器先到为准；sequencer 保险丝
 *           强杀不影响它——意图上行绝不会被吞）
 * @returns 是否受理（card/toCard 无效 = false 且已同步回调 onDone，调用方直接续走）
 */
export function playCardUpgradeFlight({
  card, toCard, target = null, center = null, showcaseScale = 0.95,
  sequencer = null, onDone = null,
} = {}) {
  if (!card || !toCard) { onDone?.(); return false; }
  const stage = center ?? { x: 0, y: 0, z: 0 };

  const run = (finishBeat = () => {}) => {
    let settled = false;
    const tweens = [];
    // fx 闪光层是时间驱动的：演出卡不在任何宿主帧循环里，自己用 ticker 喂
    const tickFx = (time, deltaMs) => card.updateFx(Math.min(deltaMs, 100) / 1000);
    gsap.ticker.add(tickFx);
    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(safety);
      gsap.ticker.remove(tickFx);
      for (const tw of tweens) tw.kill();
      card.removeFromParent?.();
      card.dispose();
      finishBeat();
      onDone?.();
    };
    // 兜底：tween 链断裂（异常/外部清场）也不吞上行——意图延迟可以，丢失不行
    const safety = setTimeout(settle, TOTAL_MS + 500);

    // ① 集中：从选中位飞到亮相位并放大（距离太近 = 已在台上，整拍跳过）
    const gatherFrom = {
      x: card.position.x, y: card.position.y, z: card.position.z, s: card.scale.x || 1,
    };
    const near = Math.hypot(stage.x - gatherFrom.x, stage.y - gatherFrom.y) < 2;
    if (near) { surge(); return; }
    const gs = { t: 0 };
    tweens.push(gsap.to(gs, {
      t: 1, duration: CARD_UPGRADE_TIMING.gatherMs / 1000, ease: 'power2.out',
      onUpdate: () => {
        const t = gs.t;
        card.position.set(
          gatherFrom.x + (stage.x - gatherFrom.x) * t,
          gatherFrom.y + (stage.y - gatherFrom.y) * t,
          gatherFrom.z + (stage.z - gatherFrom.z) * t,
        );
        const s = gatherFrom.s + (showcaseScale - gatherFrom.s) * t;
        card.scale.set(s, s, 1);
      },
      onComplete: surge,
    }));

    // ② 上冲蓄势：金闪（盖住接下来的换面瞬间）+ 放缩冲峰
    function surge() {
      card.fx.pulse({ color: UPGRADE_GOLD, durationMs: CARD_UPGRADE_TIMING.surgeMs + 160, scale: 1.5 });
      const s0 = card.scale.x || 1;
      tweens.push(gsap.to(card.scale, {
        x: s0 * 1.32, y: s0 * 1.32,
        duration: CARD_UPGRADE_TIMING.surgeMs / 1000, ease: 'back.out(2)',
        onComplete: swap,
      }));
    }

    // ③ 换面 + 回稳：峰值瞬间原卡变新卡（第二道金闪掩盖切换），下落回亮相缩放
    function swap() {
      card.setCard(toCard);
      card.fx.pulse({ color: UPGRADE_GOLD, durationMs: CARD_UPGRADE_TIMING.swapMs + 120, scale: 1.5 });
      const s0 = card.scale.x || 1;
      tweens.push(gsap.to(card.scale, {
        x: showcaseScale, y: showcaseScale,
        duration: CARD_UPGRADE_TIMING.swapMs / 1000, ease: 'power2.inOut',
        onComplete: hold,
      }));
    }

    // ④ 新卡亮相：静止停一拍（看清新卡）
    function hold() {
      tweens.push(gsap.to({}, { duration: CARD_UPGRADE_TIMING.holdMs / 1000, onComplete: finish }));
    }

    // ⑤ 收编：有牌库锚点 = 贝塞尔弧线飞入（同 playCardGrantFlight 的落袋语言）；
    //    无锚点 = 原地缩小淡出（降级路径）
    function finish() {
      if (!target) {
        const mat = card.faceMesh?.material ?? null;
        if (mat) mat.transparent = true;
        const s0 = card.scale.x || 1;
        const st = { t: 0 };
        tweens.push(gsap.to(st, {
          t: 1, duration: CARD_UPGRADE_TIMING.flyMs / 1000, ease: 'power1.in',
          onUpdate: () => {
            const s = s0 + (s0 * 0.45 - s0) * st.t;
            card.scale.set(s, s, 1);
            if (mat) mat.opacity = 1 - st.t;
          },
          onComplete: settle,
        }));
        return;
      }
      const from = {
        x: card.position.x, y: card.position.y, z: card.position.z,
        s: card.scale.x, rot: card.rotation.z,
      };
      const dist = Math.hypot(target.x - from.x, target.y - from.y);
      const arcH = Math.min(Math.max(dist * 0.25, 6), 18);
      const ctrl = { x: (from.x + target.x) / 2, y: (from.y + target.y) / 2 + arcH };
      const toS = 0.45;
      const mat = card.faceMesh?.material ?? null;
      const st = { t: 0 };
      tweens.push(gsap.to(st, {
        t: 1, duration: CARD_UPGRADE_TIMING.flyMs / 1000, ease: 'power1.in',
        onUpdate: () => {
          const t = st.t; const u = 1 - t;
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
    meta: { event: 'run:card-upgrade' },
    durationMs: FUSE_MS,
    start: ({ id, emit }) => run(() => emit(EventNames.ANIMATION_INSTRUCTION_FINISHED, { id })),
  });
  return true;
}
