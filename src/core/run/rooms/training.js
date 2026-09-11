import { promoteCard, canPromoteRuntime } from '../promotion.js';
import { rollTrainingChoices } from '../rewards.js';
import { createSkillRuntime } from '../../state/skillRuntime.js';

// 训练场（RUN_DESIGN §4.1）：进阶主途径，固定出现在 4N-2 层（2/6/10…42，楼层表见 runFlow）。
// 访问流程（「先升后抓」强绑，每房至多一次）：
//   1) 免费升级一张卡（可跳过）；一旦升级，强制三选一抓一张（不可跳过——升级必须换来一张新卡）；
//   2) 无可升级卡牌时，整房退化为一次可选抓牌（可跳过）。
// 计次：每次到访恰 +1 trainingCount（终端动作统一记；房内收益结构调整不扰动进阶节奏）。
// 离开训练房时达标 → 直接进入进阶事件（runFlow.completeRoom 接线 §5.3）。

export const TRAINING_PLACEHOLDER = {
  paidRepeatMax: 3,  // 消费训练：花钱 3选1 D级卡 + 升级一张，最多重复次数（占位未实现，§9）
};

export function upgradableCards(run) {
  return run.player.deck.filter(rt => canPromoteRuntime(rt, run));
}

// 本次训练的首个交互形态：有可升级卡 → 'upgrade'；否则 → 'draw'（退化抓牌）
export function trainingMode(run) {
  return upgradableCards(run).length ? 'upgrade' : 'draw';
}

// 免费升级一张卡（晋升 defId）。不计次、不离房——升级完成后立即 roll 抓牌候选
// 挂入 roomData（forced 标记「强绑尾款」状态），UI 据此只给三选一、不给跳过。
export function trainUpgrade(run, uniqueID, targetId = null) {
  const result = promoteCard(run, uniqueID, targetId);
  if (!result) throw new Error('该卡暂无可用晋升目标，无法升级');
  // 保留合并房的其他记账字段（campUsed 等）——合并房里营地与训练是两个独立部分
  run.roomData = { ...(run.roomData ?? {}), drawChoices: rollTrainingChoices(run), forced: true };
  return run;
}

// 退化模式手动开局：roll 三选一候选待抉择（可领取也可跳过）
export function trainDrawChoices(run) {
  if (run.roomData?.trained) throw new Error('本房的训练已经完成了');
  run.roomData = { ...(run.roomData ?? {}), drawChoices: rollTrainingChoices(run) };
  return run.roomData.drawChoices;
}

// 终端动作：领取候选中一张或跳过（defId=null），+1 训练并清瞬态。
// 强绑抓牌（trainUpgrade 开局）不允许 null 跳过。
export function trainDraw(run, defId = null) {
  const choices = run.roomData?.drawChoices;
  if (defId !== null) {
    if (!choices) throw new Error('尚未生成抓牌候选（先调用 trainDrawChoices/trainUpgrade）');
    if (!choices.includes(defId)) throw new Error(`技能不在抓牌候选中：${defId}`);
    run.player.deck.push(createSkillRuntime(defId));
  } else if (run.roomData?.forced) {
    throw new Error('升级后的抓牌不可跳过');
  }
  run.roomData = { campUsed: run.roomData?.campUsed ?? false, trained: true }; // 清瞬态、留营地记账
  run.player.trainingCount += 1;
  return run;
}

// 阶段一「免费升一」的跳过（或退化房未开局直接离开）：同样记一次训练
export function skipTraining(run) {
  if (run.roomData?.trained) throw new Error('本房的训练已经完成了');
  run.roomData = { campUsed: run.roomData?.campUsed ?? false, trained: true };
  run.player.trainingCount += 1;
  return run;
}
