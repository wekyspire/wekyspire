import { promoteCard, canPromoteRuntime } from '../promotion.js';
import { rollTrainingChoices } from '../rewards.js';
import { createSkillRuntime } from '../../state/skillRuntime.js';
import { getSkillDefinition } from '../../skills/registry.js';
import { ascensionReady } from '../ascension.js';

// 训练场（RUN_DESIGN §4.1）：进阶主途径，固定出现在 4N-2 层（2/6/10…42，楼层表见 runFlow）。
// 2026-09-18 用户定改版：训练 = **必做阶段**且先于篝火（篝火门见 camp.js）。访问节拍：
//   1) beginTraining（必做）——记一次训练（升阶）；此刻训练次数达标 → gameStage 当场切
//      'ascension'，进阶事件**在房内先行播完**（ascension.completeAscension 见 currentRoom
//      未清会切回 'room'）——保证随后的抓牌池看得到刚点亮的维度（旧版进阶排在离房时，
//      里程碑那次的抓牌永远吃不到新维度卡池）；
//   2) 可选段（整段可放弃）：4 选 1 抓一张（trainDrawChoices/trainDraw）→ 抓了卡就欠
//      一次升级（pendingUpgrade 尾款；抓时无任何可升级卡则免）；
//   3) 训练收束（trained 且无尾款）后篝火才解锁：回 35% 最大生命（营地升级已随
//      2026-09-21 D4 移除——升级全部收进本房尾款新制）。
// 离房硬门（completeRoom）：未训练不许走；pendingUpgrade 未清不许走。
// 计次：每次到访恰 +1 trainingCount（beginTraining 统一记，与段内收益结构解耦）。
//
// 尾款新制（2026-09-21 D4「训练房新制」）：**升 2 张 C→B，或升 1 张 B→A**——替代原
// 单卡升一阶。两拍式：先 trainUpgradeStart 选模式（两模式按牌组实况给门禁：2C 模式需
// 牌组有 ≥2 张可升 C，1B 模式需 ≥1 张可升 B），再逐张 trainUpgrade 晋升（C 模式只收
// C 阶卡、B 模式只收 B 阶卡，逐张递减剩余次数）。模式在未晋升任何一张前可换
// （trainUpgradeStart 幂等重选）。两模式都不可用 = 牌组升无可升 → 尾款在抓牌时自然免除
// （D4-f 兜底维持旧口径：无可升级 → 等于只抓牌）。

// 某等阶内可升级的 deck 卡（过等阶门禁；拳/盾填充卡的体修路线门禁也在 canPromoteRuntime 里）
function promotableAtTier(run, tier) {
  return run.player.deck.filter(rt =>
    getSkillDefinition(rt.defId)?.tier === tier && canPromoteRuntime(rt, run));
}

// 旧口径导出（runDriver/工具链用）：任何等阶可升级的卡
export function upgradableCards(run) {
  return run.player.deck.filter(rt => canPromoteRuntime(rt, run));
}

// 尾款升级两模式的实况候选（面板按钮门禁与抓牌尾款免除判定的共同事实源）
export function trainUpgradeModes(run) {
  return { twoC: promotableAtTier(run, 'C'), oneB: promotableAtTier(run, 'B') };
}

const MODE_PICKS = { twoC: 2, oneB: 1 };
const MODE_TIER = { twoC: 'C', oneB: 'B' };

/**
 * 开始训练（必做）：记一次训练（升阶）。
 * @returns {boolean} true = 训练次数达标，进阶事件已当场挂起（gameStage 已切 'ascension'，
 *                    currentRoom/roomData 原地保留——编排层播完进阶自动回房继续）。
 */
export function beginTraining(run) {
  if (run.roomData?.trained) throw new Error('本房的训练已经开始了');
  // 保留合并房的营地记账字段（campUsed 等）——合并房里营地与训练是两个独立部分
  run.roomData = { ...(run.roomData ?? {}), trained: true };
  run.player.trainingCount += 1;
  if (ascensionReady(run)) {
    run.gameStage = 'ascension'; // 房内升阶：completeAscension 见 currentRoom 未清会切回 'room'
    return true;
  }
  return false;
}

// 可选段开局：掷 4 选 1 候选（可整段放弃；候选 pending 时不许重 roll——防刷到满意为止；
// 已收束（optionalDone）不再开——可选抓牌每房一次）
export function trainDrawChoices(run) {
  if (!run.roomData?.trained) throw new Error('还没开始训练（先 beginTraining）');
  if (run.roomData?.pendingUpgrade) throw new Error('训练尾款未清：先完成欠下的升级');
  if (run.roomData?.optionalDone) throw new Error('本房的可选抓牌已收束');
  if (run.roomData?.drawChoices) throw new Error('抓牌候选已生成，先领取或放弃当前候选');
  run.roomData = { ...(run.roomData ?? {}), drawChoices: rollTrainingChoices(run) };
  return run.roomData.drawChoices;
}

// 领取候选中一张，或放弃整段可选（defId = null）。领卡 → 若还有可升级卡则欠一次升级；
// 抓时无任何可升级卡（牌组升无可升：2C 模式不够 2 张、1B 模式没有 B）则尾款自然免除。
// 两种收束都记 optionalDone（可选段每房一次，面板据此收起抓牌入口）。
export function trainDraw(run, defId = null) {
  if (!run.roomData?.trained) throw new Error('还没开始训练（先 beginTraining）');
  const choices = run.roomData?.drawChoices;
  if (!choices) throw new Error('尚未生成抓牌候选（先 trainDrawChoices）');
  if (defId !== null) {
    if (!choices.includes(defId)) throw new Error(`技能不在抓牌候选中：${defId}`);
    run.player.deck.push(createSkillRuntime(defId));
  }
  const modes = trainUpgradeModes(run);
  const owesUpgrade = defId !== null && (modes.twoC.length >= 2 || modes.oneB.length >= 1);
  run.roomData = { ...run.roomData, drawChoices: null, optionalDone: true, pendingUpgrade: owesUpgrade || undefined };
  return run;
}

// 尾款第一拍：选升级模式（'twoC' = 升 2 张 C→B ｜ 'oneB' = 升 1 张 B→A）。
// 未晋升任何一张前可换模式（幂等重选）；晋升过即锁死。
export function trainUpgradeStart(run, mode) {
  const pending = run.roomData?.pendingUpgrade;
  if (!pending) throw new Error('当前没有待完成的训练升级');
  if (!MODE_PICKS[mode]) throw new Error(`未知的训练升级模式：${mode}`);
  if (typeof pending === 'object' && pending.remaining < MODE_PICKS[pending.mode]) {
    throw new Error('已经晋升过一张，不能再换模式');
  }
  const pool = trainUpgradeModes(run)[mode];
  if (pool.length < MODE_PICKS[mode]) {
    throw new Error(mode === 'twoC' ? '牌组里没有 2 张可升级的 C 阶卡' : '牌组里没有可升级的 B 阶卡');
  }
  run.roomData = { ...run.roomData, pendingUpgrade: { mode, remaining: MODE_PICKS[mode] } };
  return run;
}

// 尾款第二拍：晋升一张（模式等阶限定；分叉目标由 targetId 传入）。
// 剩余次数扣尽即清尾款（pendingUpgrade 挂着时 completeRoom 硬拦）。
export function trainUpgrade(run, uniqueID, targetId = null) {
  const pending = run.roomData?.pendingUpgrade;
  if (!pending) throw new Error('当前没有待完成的训练升级');
  if (typeof pending !== 'object' || !pending.mode) throw new Error('先选升级模式（trainUpgradeStart）');
  const runtime = run.player.deck.find(s => s.uniqueID === uniqueID);
  if (!runtime) throw new Error(`卡组中不存在该卡：${uniqueID}`);
  const tier = getSkillDefinition(runtime.defId)?.tier;
  if (tier !== MODE_TIER[pending.mode]) {
    throw new Error(`当前模式只收 ${MODE_TIER[pending.mode]} 阶卡（该卡是 ${tier} 阶）`);
  }
  const result = promoteCard(run, uniqueID, targetId);
  if (!result) throw new Error('该卡暂无可用晋升目标，无法升级');
  const remaining = pending.remaining - 1;
  run.roomData = { ...run.roomData, pendingUpgrade: remaining > 0 ? { ...pending, remaining } : undefined };
  return run;
}
