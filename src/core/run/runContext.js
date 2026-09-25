// run 级表现上下文：run 层内容（事件 / 后续剧情剧本）与表现层之间的**唯一通道**。
//
// 与战斗侧同构：core 只声明表现意图、不 import 上层——战斗里指令调 `ctx.presenter.xxx()`，
// run 层内容调 `ctx.presenter.showcase(intent)`（经 `run/runEffects.js` 的效果原语间接调用）。
// headless（RunDriver / 试玩引擎）不传 presenter，落到 `createNullPresenter()` 的 noop。
//
// presenter 契约（run 层，按需扩展）：
//   showcase({ kind, title, desc, effect?, amount?, defId?, relicId? })
//     = "请把这次获得物特写演出来"（金币/卡牌/遗物/道具…）。**怎么演是表现层的事**：
//     artKey/tint/时长/是否可跳过都由 Shell 决定，core 只给语义（kind + 文案 + 数量）。
//   unitCommand({ unit, op, ... })                    （2026-09-25 加入）
//     = "请让房间里的单位动一下"（op = moveTo/pose/face/wander；描述符可序列化，
//       直播回放可直接重放指令流）。经 runEffects.unitAction 间接调用，别手调。
//
// ⚠ `ctx` **不进存档、不进 run 状态树**：run 只存 id 与数字（§6.4），presenter/log 都是
// 内存态，由调用方（Shell / headless）持有并逐次传入。这也是为什么内容函数签名是
// `resolve(run, choiceId, ctx)` 而不是把 ctx 挂在 run 上。
import { createNullPresenter } from '../presenter.js';

export function createRunContext(run, { presenter = null } = {}) {
  return {
    run,
    /** 表现意图出口（缺省 noop：headless 无表现层）。 */
    presenter: presenter ?? createNullPresenter(),
    /** 本次交互已施加的效果流水（纯描述，文本前端/调试/日志用；不参与游戏逻辑）。 */
    log: [],
  };
}

/** 效果原语统一走这里记账：描述一条已施加的效果（不含表现，表现由原语自己声明）。 */
export function recordEffect(ctx, entry) {
  ctx.log.push(entry);
  return entry;
}
