// run 层 Shell 事件枚举（唯一事实源）。
// STAGE_CHANGED 是剧情/cutscene 等 Shell 子系统的统一订阅点（run core 不感知）。
export const RunEvents = {
  STAGE_CHANGED: 'run:stage-changed',   // { stage, floor }
};
