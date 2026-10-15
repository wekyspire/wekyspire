// 问句呈现驱动（P3 声明表形态；问句协议见 core/run/questions.js）。
//
// notify 拍 diff core 问句（currentQuestion 派生视图），两个方向都管：
//   · 问句出现 + 屏幕空闲（uiBusy）+ 不在售货机出货演出中 → 查表 present；
//   · 问句已清（或已换成别的问句）而呈现还开着 → 查表 close 定向收口（答案可经
//     面板重入/调试等旁路上行——协议化之后应答与呈现解耦，「应答 ⇒ 呈现收口」由
//     本驱动兜底；正常路径 picker 自己的确认/取消链会先关再上行，此处只是旁路清扫）。
// 差分驱动意味着：读档恢复带出的 pending 在第一次 notify 就重新呈现（恢复即重发）；
// 切幕 dismissModals 只收呈现不收账（defer）——下一拍 notify 自动再呈现（在播呈现
// 会让 uiBusy 置位，重入即空转，不会叠开）。应答不走本模块：picker 确认/放弃上行
// 意图 → runMachines → answerQuestion。
//
// **声明表（§9.13 吸收项）**：kind → { present, close }。加新问句种类 = 加一行表项，
// ctx 钩子面不再随种类增长。demonRoll / slotGift 不自动呈现（恶魔形态快照 diff 即
// 呈现、slotGift = 点「继续前进」时机器拦截演出——呈现权在场景端，见表尾注释行）。

import { currentQuestion, answerQuestion } from '../core/run/questions.js';

/** 选卡器收口（cardPicker 同基类三种问句共用；幂等——只在还开着时收）。 */
const closeCardPicker = (ctx, stage) => { if (stage.cardPicker?.opened) stage.cardPicker.close(); };

const KINDS = {
  shopRelicPack: {
    present: (ctx, stage) => stage.openShopRelicPackPicker?.(),
    close: (ctx, stage) => { if (stage.relicPicker?.opened) stage.relicPicker.close(); },
  },
  shopPack: {
    present: (ctx, stage) => stage.openShopPackPicker?.(),
    close: closeCardPicker,
  },
  trainingDraw: {
    present: (ctx, stage) => stage.openTrainingDrawPicker?.(),
    close: closeCardPicker,
  },
  // 尾款升级：呈现 = 自动链流程指令（runController openTrainingUpgradeFlow），指令自收
  trainingUpgrade: { present: (ctx) => ctx.startTrainingUpgrade?.(), close: () => {} },
  // 词条附赠选卡（upgrade/burn offer；无候选时入口自弃）
  bankOffer: { present: (ctx) => ctx.startBankOffer?.(), close: closeCardPicker },
  slotPrize: {
    present: (ctx, stage, q) => {
      // 免费指定升级的选卡链已接管呈现（onDismiss 链开的 picker），这里让位
      if (q.pickingUpgrade) return;
      // 转轮未落定：等揭示拍（onEnd 载荷）的 notify 再弹，否则特写盖住转轮
      if (ctx.slotSpinning?.()) return;
      // 单件遗物奖不做「奖品箱」中转特写：直接收下，遗物特写即获得演出。
      // 直答也是状态迁移：补一拍 notify（面板重绘）+ 授予源特写（q.relicId 即授予物）
      if (q.relicId && !q.hasChoices && !q.hasRelicChoices && !q.freeUpgrade) {
        answerQuestion(ctx.run, 'take');
        ctx.presentRelic?.(q.relicId);
        ctx.notify?.();
        return;
      }
      stage.openSlotPrizeShowcase?.();
    },
    // 揭示横幅（slot.lastSpin）的生命周期 = 问句生命周期
    close: (ctx) => { if (ctx.slot) ctx.slot.lastSpin = null; },
  },
  // demonRoll：呈现 = 老虎机恶魔形态（场景快照 diff），选词条走转盘热区——不自动弹
  // slotGift：呈现 = 点「继续前进」时机器拦截演出（SLOT_MACHINE.md 安慰奖链）——不自动弹
};

export function createRunQuestions(ctx) {
  // ctx: { run, panelStage(): 舞台, notify(), shopDispensing(): 售货机出货演出在播,
  //        slotSpinning(): 转轮指令在播, slot: 老虎机揭示横幅瞬态,
  //        startTrainingUpgrade(), startBankOffer(), presentRelic(id): 遗物授予源特写
  //        （单件遗物直答路径） } —— 引用晚绑定
  let presented = null; // 本驱动开过的呈现（kind 名）；用于收口定向
  return {
    drive() {
      const stage = ctx.panelStage();
      if (!stage) return;
      const q = currentQuestion(ctx.run);
      if (presented && presented !== q?.kind) {
        KINDS[presented]?.close?.(ctx, stage);
        presented = null;
      }
      if (!q) return;
      if (stage.uiBusy || ctx.shopDispensing()) return;
      const kind = KINDS[q.kind];
      if (!kind) return;
      presented = q.kind;   // 记名在 present 之前：present 内可能同步 notify 重入（直答
                            // 分支），重入的收口定向不能看旧名；让位分支下拍 diff 重入同呈现
      kind.present(ctx, stage, q);
    },
  };
}
