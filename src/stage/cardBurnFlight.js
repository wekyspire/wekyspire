// 「卡牌焚毁」演出（公共组件）：run 层失去类烧卡的统一表演——恶魔词条·忘却/忘记
// 的随机焚毁、银行 offer 的自选焚毁。视觉与战斗同源（CardObject.startBurn：C0 uBurn
// 自底向上吞蚀 + 前沿余烬 + 火起颤动——battleBeats._burnOut 的 run 层版本）。
//
// 编排（cardUpgradeFlight 同款骨架）：集中（选中位飞亮相位，已在台上整拍跳过）
// → 亮相停一拍（看清烧的是什么）→ 燃尽（对象终结：燃罢即移除销毁，无落袋飞行
// ——焚毁不回流，与战斗语义一致）。
//
// 语言规范：焚毁是「失去」——不打金闪（金闪专属升级/power），红色火光是唯一的
// 强调色（来自 C0 燃烧补丁本体，不再另加 fx）。演出卡不在宿主帧循环里，本函数用
// gsap.ticker 自喂 updateFx/updateBurn（同 cardUpgradeFlight 的驱动口径）。

import gsap from 'gsap';
import { EventNames } from '../bridge/events.js';

export const CARD_BURN_FLIGHT_TIMING = Object.freeze({
  gatherMs: 320,   // 集中：从选中位飞到亮相位并放大（近距整拍跳过）
  holdMs: 420,     // 亮相：停一拍让玩家看清烧的是什么
  burnMs: 750,     // 燃尽（与战斗 CARD_BURN_MS 同拍）
});
const TOTAL_MS = CARD_BURN_FLIGHT_TIMING.gatherMs + CARD_BURN_FLIGHT_TIMING.holdMs
  + CARD_BURN_FLIGHT_TIMING.burnMs;
// sequencer 指令保险丝：节拍卫生 ≥2.5 倍，强杀只是防僵死兜底（不吞 onDone）
const FUSE_MS = TOTAL_MS * 3;

/**
 * 播「卡牌焚毁」演出。
 * @param {object} opts
 *   card: CardObject——演出**接管所有权**（燃尽后移除 + dispose；选卡界面确认时经
 *         takeEntry 摘出后传入 = **原地燃尽**；缺省 = 调用方自建卡在亮相位）
 *   center: { x, y, z } 亮相位（缺省屏幕中央 = uiScene 原点；全屏界面组都在原点）
 *   showcaseScale: 亮相缩放（缺省 0.95）
 *   sequencer: AnimationSequencer | null（有则指令化、与后续节拍串行；无则直接播）
 *   onDone: 结束回调，**恰好一次**（燃尽完成或兜底计时器先到为准）
 * @returns 是否受理（card 无效 = false 且已同步回调 onDone）
 */
export function playCardBurnFlight({
  card, center = null, showcaseScale = 0.95, sequencer = null, onDone = null,
} = {}) {
  if (!card) { onDone?.(); return false; }
  const stage = center ?? { x: 0, y: 0, z: 0 };

  const run = (finishBeat = () => {}) => {
    let settled = false;
    const tweens = [];
    // 燃烧/余烬逐帧驱动（startBurn 后宿主本应逐帧调 updateBurn）：演出卡不在
    // 宿主帧循环里，ticker 自喂（updateFx 顺带养卡面 fx，与升级演出同口径）
    const tick = (time, deltaMs) => {
      const dt = Math.min(deltaMs, 100) / 1000;
      card.updateFx?.(dt);
      card.updateBurn?.(dt);
    };
    gsap.ticker.add(tick);
    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(safety);
      gsap.ticker.remove(tick);
      for (const tw of tweens) tw.kill();
      card.removeFromParent?.();
      card.dispose();
      finishBeat();
      onDone?.();
    };
    // 兜底：tween/燃尽链断裂（异常/外部清场）也不吞回调
    const safety = setTimeout(settle, TOTAL_MS + 500);

    // ① 集中：选中位 → 亮相位（近距整拍跳过——「本来就在场景内」的原地烧）
    const gatherFrom = {
      x: card.position.x, y: card.position.y, z: card.position.z, s: card.scale.x || 1,
    };
    const near = Math.hypot(stage.x - gatherFrom.x, stage.y - gatherFrom.y) < 2;
    if (near) { hold(); return; }
    const gs = { t: 0 };
    tweens.push(gsap.to(gs, {
      t: 1, duration: CARD_BURN_FLIGHT_TIMING.gatherMs / 1000, ease: 'power2.out',
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
      onComplete: hold,
    }));

    // ② 亮相停一拍
    function hold() {
      tweens.push(gsap.to({}, { duration: CARD_BURN_FLIGHT_TIMING.holdMs / 1000, onComplete: ignite }));
    }

    // ③ 燃尽：C0 吞蚀推进到整卡消亡，燃罢 settle（onBurnt 只会来一次；兜底双保险）
    function ignite() {
      card.startBurn({
        durationMs: CARD_BURN_FLIGHT_TIMING.burnMs,
        onBurnt: settle,
      });
    }
  };

  if (!sequencer) { run(); return true; }
  sequencer.enqueueInstruction({
    meta: { event: 'run:card-burn' },
    durationMs: FUSE_MS,
    start: ({ id, emit }) => run(() => emit(EventNames.ANIMATION_INSTRUCTION_FINISHED, { id })),
  });
  return true;
}
