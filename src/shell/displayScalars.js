// run 层显示标量通道（handoffs/RUN_FLOW_REFACTOR_RESEARCH §4.6）——「core 值即时结算，
// 显示值在队列节拍推进」（与战斗「卡牌飞进坟堆计数才 +1」同一条规则）。
//
// 形态：display = core + delta。方向约定——core 在结算拍就变（+N），演出起拍先
// `hold(-N)`（显示按住旧值），飞行指令在 apply-point 'end' 释放（+N），显示追平。
// 多奖励排队天然按序折叠（delta 累加、飞行 FIFO）。
//
// **空闲对账（自愈）**：队列排空时 delta 清零（显示贴回 core）——演出中断（切幕
// 强杀/流程中止）不留永久不同步。触发点：每次 notify（syncMapStatus 前查一次）+
// 世界拆除（dispose/调试硬重置，force 直贴）。
//
// 边界（§4.6 与 P4b 的分界）：本通道只管「叶子值 + HUD 计数类控件」（当前 money）；
// 面板/场景复合重建不进此通道（维持 notify + transitionStage）。按演出需求拉动逐个迁，
// 不预先全量铺。

/** 飞行拍时长（占位值——金币粒子演出落地后按观感调，旋钮在此单点）。 */
export const SCALAR_FLIGHT_MS = 450;

export function createDisplayScalars({ sequencer, onApplied }) {
  const delta = new Map();   // scalar -> 显示与 core 的偏离（无条目 = 同步态）
  const push = () => { if (typeof onApplied === 'function') onApplied(); };
  const api = {
    /** 显示值读取：无偏离直读 core（绝大多数时刻零开销零漂移）。 */
    read(scalar, coreValue) {
      return coreValue + (delta.get(scalar) ?? 0);
    },

    /** 按住显示（演出起拍：core 已 +N，显示等飞行落地才追）。amount 传正数。 */
    hold(scalar, amount) {
      if (!Number.isFinite(amount) || amount <= 0) return;
      delta.set(scalar, (delta.get(scalar) ?? 0) - amount);
      push();
    },

    /** 释放（飞行指令 'end' 落地拍）：显示追平。 */
    release(scalar, amount) {
      if (!Number.isFinite(amount) || amount <= 0) return;
      delta.set(scalar, (delta.get(scalar) ?? 0) + amount);
      push();
    },

    /** 对账：显示贴回 core。队列还有指令在队时不动（飞行可能还没落地）。 */
    reconcile(force = false) {
      if (!force && sequencer.pendingCount > 0) return;
      if (delta.size === 0) return;
      delta.clear();
      push();
    },
  };
  /**
   * 按住拍：把「特写播放窗」的按住挂进队列（§4.2.4 边界——payload 只管队列内指令：
   * 按住不在队 = 空闲对账会把它当场冲掉）。旁挂形态（tagAll:false + 不等任何人，
   * 也不被任何人等——特写是玩家节奏段，不能拦后续指令）；durationMs 保险丝 =
   * 特写异常没收时按住也不锁死（保险丝过后下一次空闲对账贴回）。
   * 返回收尾函数（特写 dismiss 回执拍调用，随后接 flight）；**返回值 = finish 回执**：
   * false = 指令已被保险丝收走（长 AFK 边界）——delta 已被空闲对账清零，
   * 调用方不得再排 flight（会在已贴平的基线上过冲 +N）。
   */
  api.holdBeat = ({ scalar, amount, ms = 30000 } = {}) => {
    api.hold(scalar, amount);
    const instrId = sequencer.enqueueInstruction({
      meta: { event: 'run:scalar-hold', scalar },
      tags: ['scalar-hold'], tagAll: false, waitTags: [],
      durationMs: ms,
    });
    return () => sequencer.finish(instrId, { reason: 'manual' });
  };
  /**
   * 飞行拍：定时指令携带显示增量，onEnd（apply-point 'end'）释放。**正常完成走
   * start 内的 manual 回执**（定时到点 finish），durationMs 放大成真保险丝——只兜
   * 卡死，不污染 timeoutCount/finishReasons（正常路径烧保险丝 = 最强回归信号失真，
   * P3 审查实证抓回）。返回 Promise（落地拍 resolve）。
   */
  api.flight = ({ scalar, amount, ms = SCALAR_FLIGHT_MS } = {}) => new Promise((resolve) => {
    sequencer.enqueueInstruction({
      meta: { event: 'run:scalar-flight', scalar },
      durationMs: ms + 2000,   // 真保险丝：manual 收尾之后的兜底
      start: ({ id }) => { setTimeout(() => sequencer.finish(id, { reason: 'manual' }), ms); },
      onEnd: () => { api.release(scalar, amount); resolve(true); },
    });
  });
  return api;
}
