// 问句协议（handoffs/RUN_FLOW_REFACTOR_RESEARCH §4.3，P2：shop → slot 已接）。
//
// 问句 = run 上挂起的「等玩家一个大决策」的状态。状态本体仍是各房间的既有 pending
// 字段（shopPending/slotPending 等——它们本就是半成品问句）；本模块把它们统一成一个
// **派生视图** + 一条应答通道：
//   · currentQuestion(run)：一次只问一个（正常流程同时至多一个——离房义务门保证
//     清账；真出现多个时按登记序取先）；
//   · answerQuestion(run, answer)：分发到对应 core 收尾原语（null = 放弃）。
// 呈现是差分驱动的（shell/runQuestions.js 在 notify 拍 diff 本视图）——「读档恢复
// 即重发问句」「切幕 cancel 只收呈现（defer），下一拍 notify 自动重新呈现」由此
// 免费获得，core 不需要发事件。headless 直调收尾原语的旧路径不受影响（engine.mjs）。
//
// 迁移登记：shop（P2-1）、slot 的 slotPrize/slotGift（P2-2）、training 的
// trainingUpgrade/trainingDraw（P2-4）、bank 的 demonRoll/bankOffer（P2-5）。
//
// demonRoll（恶魔词条三选一）**必答**：钱已到手，abandon = forbidden。浏览器应答经
// bankDemonPick（runShowcase：chooseDemonDebuff 的结果驱动两拍演出）——answerQuestion
// 这条只服务 headless/协议直答。呈现 = 老虎机恶魔形态（快照 diff 驱动）+ 占位面板按钮，
// 驱动不自动弹。bankOffer（词条附赠）可放弃：null = takeBankOffer 弃置（呈现入口的
// 放弃/无候选弃置走 answerQuestion(run, null, {kind:'bankOffer'}) 定向应答，不直调原语）；
// 非 null 应答走选卡意图链（bankUpgradeOffer/bankBurnOffer），不经单发通道。
//
// trainingUpgrade 是**必答问句**（abandon = forbidden，欠升级态没有跳过出口）且答案
// 是多步的（twoC 升两张、分叉带 targetId）——不经 answerQuestion 单发通道，应答走
// 升级选卡意图链（trainingUpgrade 意图逐张 trainUpgrade，扣尽自然清问句）。
//
// slotPrize 的 answer 口径：null = 放弃；'take' = 收下（无需挑选的奖项）；
// 其余值 = 挑选结果（卡的 defId / 遗物的 relicId，core 校验候选）。
// slotGift 的 answer = 礼物 id（可乐/鸡腿）；不可放弃（离房义务门要求必须亲手领），
// 呈现时机 = 点「继续前进」时机器拦截演出（RoomStage），驱动不自动弹。

import { takeShopCard, takeShopRelic } from './rooms/shop.js';
import {
  declineSlotPrize, takeSlotPrize, takeSlotGift, slotGiftDue, SLOT_GIFTS,
} from './rooms/slotMachine.js';
import { trainDraw } from './rooms/training.js';
import { chooseDemonDebuff, takeBankOffer } from './rooms/bank.js';

/** 当前待答问句（无则 null）。载荷全标量（可进快照/可序列化）。 */
export function currentQuestion(run) {
  const p = run?.shopPending;
  if (p) {
    if (p.kind === 'relic') return { kind: 'shopRelicPack', rarity: p.rarity, choices: [...p.choices] };
    return { kind: 'shopPack', packId: p.packId, choices: [...p.choices] };
  }
  const pr = run?.bank?.pendingRoll;
  if (pr) return { kind: 'demonRoll', options: [...pr.options], gold: pr.gold ?? null };
  const sp = run?.slotPending;
  if (sp) {
    return {
      kind: 'slotPrize',
      tier: sp.tier,
      relicId: sp.relicId ?? null,
      hasChoices: (sp.choices?.length ?? 0) > 0,
      hasRelicChoices: (sp.relicChoices?.length ?? 0) > 0,
      freeUpgrade: sp.upgrade?.kind === 'free',
      // 免费指定升级的选卡阶段（takeSlotPrize 挂起 slotUpgradePending、pending 不清）：
      // 呈现权在选卡链手上，驱动据此让位
      pickingUpgrade: !!run?.slotUpgradePending,
    };
  }
  const tu = run?.roomData?.pendingUpgrade;
  if (tu) {
    return {
      kind: 'trainingUpgrade',
      mode: typeof tu === 'object' ? tu.mode : null,
      remaining: typeof tu === 'object' ? tu.remaining : null,
    };
  }
  const td = run?.roomData?.drawChoices;
  if (td) return { kind: 'trainingDraw', choices: [...td] };
  if (run?.bank?.offers?.length) return { kind: 'bankOffer', offers: [...run.bank.offers] };
  if (slotGiftDue(run)) return { kind: 'slotGift', choices: Object.keys(SLOT_GIFTS) };
  return null;
}

/**
 * 应答：answer = 卡 defId / 遗物 id / 礼物 id / 'take'（收下）/ null（放弃）。
 * **分发单源自 currentQuestion**——取值序与应答序由同一段代码定义，共存态
 * （如拉杆产出未领 + 恶魔 roll 同开）不会答错对象；kind 特例（必答拒 null /
 * 多步应答走意图链）在各分支内声明。返回是否真的答上了。
 * opts.kind = 定向应答（如 bankOffer 的弃置：呈现入口在共存态下必须点名答哪一问，
 * 缺省会按 currentQuestion 优先序答错对象）——kind 与当前问句不符时返回 false 不落账。
 */
export function answerQuestion(run, answer, { kind } = {}) {
  const q = currentQuestion(run);
  if (kind && q?.kind !== kind) return false;
  switch (q?.kind) {
    case 'shopPack': takeShopCard(run, answer); return true;
    case 'shopRelicPack': takeShopRelic(run, answer); return true;
    case 'demonRoll':
      if (answer == null) return false;   // 必答：不给放弃通道
      chooseDemonDebuff(run, answer);
      return true;
    case 'slotPrize':
      if (answer == null) declineSlotPrize(run);
      else takeSlotPrize(run, answer === 'take' ? null : answer);
      return true;
    case 'trainingUpgrade':
      return false;   // 多步应答（twoC 两张/分叉 targetId）走升级选卡意图链，不经单发通道
    case 'trainingDraw':
      trainDraw(run, answer);   // answer = defId（领取）/ null（放弃整段可选）
      return true;
    case 'bankOffer':
      if (answer != null) return false;   // 非 null 应答走选卡意图链（bankUpgradeOffer/bankBurnOffer）
      takeBankOffer(run);   // null = 放弃这份附赠
      return true;
    case 'slotGift':
      if (answer == null) return false;   // 不可放弃：义务门要求亲手领
      takeSlotGift(run, answer);
      return true;
    default:
      return false;
  }
}

/** 离房义务门的统一判据：还有未答问句不许走（答案可以是放弃，但必须玩家亲手给）。 */
export const hasOpenQuestion = (run) => currentQuestion(run) != null;
