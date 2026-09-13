// 「房间机器流」域（从 runController 抽出的第二个域，用户定 2026-09-12 的原则）：
// 老虎机 / 银行机 / 古尔帕斯之店 / 售货机收尾 / 吞噬 这几台机器的**交互编排**。
//
// 分工：core 结算与各房间 API 在 `core/run/rooms/*`（纯逻辑、可 headless）；这里管
// 「意图 → core 调用 → notify → 附带演出触发」——时序归 Shell，机器语义归 core。
//
// 由 runController 构造（`createRunMachines(ctx)`），ctx 里的引用一律**晚绑定**（与 runShowcase 同律）：
//   · notify()/panelStage()/roomStage() —— runController 里这些在构造之后才初始化；
//     箭头闭包捕获词法绑定，运行期才取值，初始化顺序安全。
//   · slot —— 同一对象引用（房间层舞台侧瞬态：老虎机演出播放态）。
// 模块内的 core 调用随函数一起搬进来（见下方 import）。

import { EventNames } from '../bridge/index.js';
import {
  bankDeposit, bankWithdraw, bankOverdraft, bankUpgrade, bankBurn,
} from '../core/run/rooms/bank.js';
import {
  buyGurpas, takeGurpasCard, sellGurpasRelic, removeCardAtGurpas,
} from '../core/run/rooms/gurpas.js';
import {
  spinSlot, takeSlotPrize, declineSlotPrize, slotUpgrade,
  devourSlot, devourableRelics, devourableCards, devourReady, slotView,
} from '../core/run/rooms/slotMachine.js';
import { takeShopCard, takeShopRelic } from '../core/run/rooms/shop.js';
import { getRelicDefinition } from '../core/relics/registry.js';

export function createRunMachines(ctx) {
  const { run, slot, runSequencer, cutscene, showcase } = ctx;

  // ---- 银行机（与老虎机成对；SLOT_MACHINE.md §银行机）----
  function bankDo(kind, arg) {
    if (run.gameStage !== 'room' || run.currentRoom !== 'slot') return;
    try {
      if (kind === 'deposit') bankDeposit(run, arg ?? null);       // 缺省 = 全部存入
      else if (kind === 'withdraw') bankWithdraw(run);
      else if (kind === 'overdraft') bankOverdraft(run, arg);
      else if (kind === 'pick') showcase.bankDemonPick(arg);
      else if (kind === 'upgradeOffer') bankUpgrade(run, arg);
      else if (kind === 'burnOffer') bankBurn(run, arg);
    } catch (err) {
      console.warn('[bank]', err.message);
    }
    ctx.notify();
  }

  // Boss 奖励的删卡机会（§2.1）：与古尔帕斯删卡服务同一套能力
  function bossRemoveCard(uniqueID) {
    if (run.pendingCardRemoval <= 0) return;
    try {
      removeCardAtGurpas(run, uniqueID);
      run.pendingCardRemoval -= 1;
    } catch (err) {
      console.warn('[removeCard]', err.message);
    }
    ctx.notify();
  }

  // ---- 古尔帕斯之店（35 层固定房；SHOP.md §二）----
  function gurpasDo(kind, arg, arg2) {
    if (run.gameStage !== 'room' || run.currentRoom !== 'gurpas') return;
    try {
      if (kind === 'buy') buyGurpas(run, arg);
      else if (kind === 'take') takeGurpasCard(run, arg);
      else if (kind === 'sell') sellGurpasRelic(run, arg);
      else if (kind === 'remove') removeCardAtGurpas(run, arg2 ?? arg);
    } catch (err) {
      console.warn('[gurpas]', err.message);
    }
    ctx.notify();
  }

  let slotFinish = null; // 当前 roll 指令回执句柄（UI animationend → reportSlotAnimDone）
  // 中奖落定的获得演出（含"收下/跳过"两个出口）在 runShowcase.js（maybeShowSlotPrize）。
  function spin() { // 可重复消费（每次扣费/消耗免费 roll）；roll 动画经 run sequencer 串行编排
    if (run.gameStage !== 'room' || run.currentRoom !== 'slot') return;
    if (run.slotPending) return; // 上一次产出还没处理
    const prize = spinSlot(run); // 逻辑先行：扣费与定奖立即结算，演出随后揭示产出
    runSequencer.enqueueInstruction({
      meta: { event: 'room:slot-spin', prize: prize.kind },
      durationMs: 4000, // 前端卡死保险丝（UI 未回执时兜底推进）
      start: ({ id, emit }) => {
        slot.anim = { id, prize };
        slotFinish = (reportId) => {
          if (reportId !== id) return false;
          slot.anim = null;
          slot.lastSpin = prize; // 结果在动画落定后揭示（渐进揭示语义）
          slotFinish = null;
          // 揭示后必须重推面板快照：面板是**快照驱动**的（漏掉它的症状＝永远停在「转动中」）
          ctx.notify();
          showcase.maybeShowSlotPrize();   // 中奖即唤起获得演出（放弃/收下都在那个演出里）
          emit(EventNames.ANIMATION_INSTRUCTION_FINISHED, { id });
          return true;
        };
      },
    });
    ctx.notify();
  }
  // 产出结算（可放弃——文档：这些产出总是可以放弃不要的）
  function slotTake(choice = null) {
    if (run.gameStage !== 'room' || !run.slotPending) return;
    takeSlotPrize(run, choice);
    slot.lastSpin = null; // 结算完收起揭示横幅
    ctx.notify();
  }
  function slotDecline() {
    if (run.gameStage !== 'room' || !run.slotPending) return;
    declineSlotPrize(run);
    slot.lastSpin = null;
    ctx.notify();
  }
  // 大奖「免费指定升级」：选卡界面确认后落地
  function slotPickUpgrade(uniqueID) {
    if (run.gameStage !== 'room' || !run.slotUpgradePending) return;
    slotUpgrade(run, uniqueID);
    ctx.notify();
  }
  // 吞噬（粉碎换金币）
  function slotDevour(target) {
    if (run.gameStage !== 'room' || run.currentRoom !== 'slot') return;
    devourSlot(run, target);
    ctx.notify();
  }
  function reportSlotAnimDone(reportId) { return slotFinish?.(reportId) ?? false; }

  // 离房安慰奖（可乐/鸡腿二选一 + 获得演出 + 自动续上离房）在 runShowcase.js（slotTakeGift）。

  // ---- 粉碎物品（老虎机吞噬，用户定 2026-09-11）----
  // 链条：入口（面板按钮；机身投料口将来走同一意图）→ **dialogue 层**问「粉碎什么？」
  // （选项按可粉碎内容动态隐藏）→ 全屏选卡 / 选遗物 → 提交 core → 金币获得特写。
  // 对话是 Shell 层的东西（CutsceneOverlay），所以这条链只能编排在这里——Stage 只负责
  // 「谁被点了」和「把候选画出来」，不做游戏判定。
  async function openDevourFlow() {
    if (run.gameStage !== 'room' || run.currentRoom !== 'slot') return false;
    if (run.slotPending || !devourReady(run)) return false;
    const relics = devourableRelics(run);
    const cards = devourableCards(run);
    if (!relics.length && !cards.length) return false;
    const choices = [];
    if (cards.length) choices.push({ id: 'card', label: '粉碎一张卡牌', hint: `${cards.length} 张可选` });
    if (relics.length) choices.push({ id: 'relic', label: '粉碎一件遗物', hint: `${relics.length} 件可选` });
    choices.push({ id: 'cancel', label: '算了' });
    let picked = null;
    await cutscene.play({
      steps: [{
        type: 'dialogue',
        pages: [{
          speaker: '老虎机',
          text: '机器张开了嘴，齿间漏出金币碰撞的响声。\n「粉碎什么？」',
          choices,
        }],
        onChoice: (id) => { picked = id; },
      }],
    });
    if (picked !== 'card' && picked !== 'relic') return false;
    return !!ctx.panelStage()?.openDevourPicker({
      kind: picked,
      cards: cards.map(c => ({ uniqueID: c.uniqueID, defId: c.defId })),
      relics: relics.map(r => ({
        id: r.id, name: r.name, rarity: r.rarity,
        desc: getRelicDefinition(r.id)?.description ?? '',
      })),
      onPick: (key) => {
        const res = picked === 'card'
          ? devourSlot(run, { kind: 'card', uniqueID: key })
          : devourSlot(run, { kind: 'relic', relicId: key });
        ctx.notify();
        ctx.roomStage()?.playCrush?.();   // 机器端的"咬合 + 迸币"演出（结算已完成，这里只是表现）
        // 金币获得特写（通用组件：有素材用素材，没有就拿色块代替）
        ctx.panelStage()?.showcaseItem({
          title: `+${res.gold} 金币`,
          desc: picked === 'card' ? '老虎机满意地嚼碎了那张卡' : '老虎机满意地嚼碎了那件遗物',
          effect: res.freeRoll ? '它还额外吐了一次免费拉杆' : '金币已经落进你的钱袋',
          artKey: 'gold',
          tint: 0xffd75e,
        });
      },
    });
  }
  // ---- 商店（售货机，SHOP.md §一）----
  // 购货的出货演出与获得特写（含"买到即自动开包"）在 runShowcase.js（shopBuy/shopAnimDone）。
  function shopTakeCard(defId) {
    if (run.gameStage !== 'room' || !run.shopPending) return;
    takeShopCard(run, defId);   // defId = null → 放弃这个卡包（choice 不够好时的出口）
    ctx.notify();
  }
  function shopTakeRelic(relicId) {
    if (run.gameStage !== 'room' || !run.shopPending) return;
    takeShopRelic(run, relicId);   // relicId = null → 放弃这个遗物包（与卡包同口径）
    ctx.notify();                 // 获得特写由拥有集差分自动兜（runShowcase）
  }

  return {
    bankDo, bossRemoveCard, gurpasDo,
    spin, slotTake, slotDecline, slotPickUpgrade, slotDevour, reportSlotAnimDone,
    openDevourFlow, shopTakeCard, shopTakeRelic,
    slotView: () => slotView(run),
    devourableRelics: () => devourableRelics(run),
    devourableCards: () => devourableCards(run),
    intents: {
      spin: () => spin(),
      slotAnimDone: (i) => reportSlotAnimDone(i.id),
      bankDeposit: (i) => bankDo('deposit', i.amount ?? null),
      bankWithdraw: () => bankDo('withdraw'),
      bankOverdraft: (i) => bankDo('overdraft', i.tier),
      bankPick: (i) => bankDo('pick', i.id),
      bankUpgradeOffer: (i) => bankDo('upgradeOffer', i.uniqueID),
      bankBurnOffer: (i) => bankDo('burnOffer', i.uniqueID),
      bossRemoveCard: (i) => bossRemoveCard(i.uniqueID),
      gurpasBuy: (i) => gurpasDo('buy', i.index),
      gurpasTake: (i) => gurpasDo('take', i.defId),
      gurpasSell: (i) => gurpasDo('sell', i.relicId),
      gurpasRemove: (i) => gurpasDo('remove', i.uniqueID, i.uniqueID),
      slotTake: (i) => slotTake(i.choice ?? null),
      slotDecline: () => slotDecline(),
      slotPickUpgrade: (i) => slotPickUpgrade(i.uniqueID),
      requestDevour: () => openDevourFlow(),
      slotDevourRelic: (i) => slotDevour({ kind: 'relic', relicId: i.relicId }),
      slotDevourCard: (i) => slotDevour({ kind: 'card', uniqueID: i.uniqueID }),
      takeShopCard: (i) => shopTakeCard(i.defId),
      takeShopRelic: (i) => shopTakeRelic(i.relicId),
    },
  };
}
