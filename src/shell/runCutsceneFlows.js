// 「幕间流」域（从 runController 抽出的第三个域）——随机事件幕间 + 进阶幕间，
// 都是「切幕 → 对话 + 选项 → 同步结算 → 结果页 → 切幕出场」的同构流。
// 故事模式将来的章节剧情/古尔帕斯初见对话等新幕间也落在这里。
//
// 由 runController 构造（`createRunCutsceneFlows(ctx)`），ctx 里的引用一律**晚绑定**
// （与 runShowcase/runMachines 同律）：notify()/setRoomScenePending() 以及 lifecycle 里的
// 生命周期动作在构造之后才初始化（swapRoomToMap/exitSceneAfterCutscene 定义在下方），
// 箭头闭包捕获词法绑定，运行期才取值，初始化顺序安全。
// lifecycle 是 runController 注入的房间/舞台生命周期动作（黑幕中点的阶段迁移与换台）。
// 模块内的 core 调用（eventView/resolveEvent/chooseAscension/chooseSeedCards/rerollSeedOffering）
// 随函数一起搬进来。

import { eventView, resolveEvent } from '../core/run/rooms/event.js';
import {
  chooseAscension, LEINO_DIMENSIONS, ASCENSION_PLACEHOLDER,
  chooseSeedCards as chooseSeedCardsCore, rerollSeedOffering as rerollSeedOfferingCore,
} from '../core/run/ascension.js';
import { DIM_META } from '../stage/panels/index.js';
import { eventArtUrlNamed } from './overlay/eventArt.js';

export function createRunCutsceneFlows(ctx) {
  const { run, runCtx, runPresenter, cutscene, showcase, lifecycle } = ctx;
  // ctx.notify() 晚绑定；ctx.setRoomScenePending(v) 晚绑定

  // ---- 随机事件（用户定 2026-09-12：**不做 3D 场景，也不用旧 UI 面板**）----
  // 事件 = 对话 + 选项 + 逻辑：进房即播一段**幕间**——背景 CG（占位美术，见 overlay/eventArt.js）
  // + 普通对话 → 摆出选项（`cutscene` 的 dialogue step 原生支持 choices）→ 玩家选 → core 结算
  // → 接着播结果页 → **切幕**回塔楼（事件房没有场景舞台，一直在 MapStage 上）。
  // 进出都是幕间：进 = wipe step 后面的对话被"揭开"（切幕开始 → 事件画面就位 → 切幕结束，
  // 用户 2026-09-12 报的同层问题）；出 = sceneTransition（黑幕中点做阶段迁移 + 刷新塔楼）。
  // `triggerEvent` 保留为**幂等入口**（面板安全阀/测试可用）：已在播或已结算则什么都不做。
  let eventPlaying = false;
  async function playEventScene() {
    if (run.gameStage !== 'room' || run.currentRoom !== 'event') return false;
    if (eventPlaying || run.roomData?.eventResolved) return false;
    eventPlaying = true;
    try {
      const view = eventView(run, runCtx);      // 确定性抽事件（记进 roomData，重绘不重抽）
      const bg = eventArtUrlNamed(view.art ?? view.id, view.name);
      let res = null;
      await cutscene.play({
        steps: [
          { type: 'wipe' },                     // 幕间切幕：黑幕盖住 → 事件画面在幕后就位 → 揭开
          {
            type: 'dialogue', bg,
            pages: [
              ...view.pages,
              { speaker: view.name, text: '你要怎么做？', choices: view.choices },
            ],
            // 同步结算（选完即落账）：效果由事件内容**主动施加**（core/run/runEffects.js），
            // 这里拿到的只有结果页与一份"发生了什么"的流水——Shell 不解释效果。
            onChoice: (id) => { res = resolveEvent(run, id, runCtx); },
          },
        ],
      });
      ctx.notify();                             // 金币/生命变化先反映到塔楼状态栏
      if (!res) return false;                   // 没选就退出（异常路径：不结算也不离房）
      await cutscene.play({ steps: [{ type: 'dialogue', bg, pages: res.pages }] });
      // 退出切幕（用户定 2026-09-12：cutscene 回塔楼本质上和场景切换没区别）：
      // 黑幕盖住 → 阶段迁移 + 塔楼刷新 → 揭幕；获得演出排在揭幕之后（不然会被黑幕吞掉半截）。
      await lifecycle.exitSceneAfterCutscene(() => lifecycle.completeRoomAndNotify());
      showcase.flushRunPresentations();          // 揭幕后播"到手那一拍"（内容在选中的那一拍声明的）
      return true;
    } catch (err) {
      // 兜底：幕间出问题也不能把玩家卡在事件房里（用默认选项结算后离房）
      console.warn('[event]', err?.message ?? err);
      try {
        if (!run.roomData?.eventResolved) resolveEvent(run, eventView(run, runCtx).choices[0]?.id ?? null, runCtx);
        if (run.gameStage === 'room') lifecycle.completeRoom();
      } catch { /* 已经结算过/已离房：忽略 */ }
      runPresenter.clear();                     // 异常路径不补演出
      ctx.notify();
      return false;
    } finally {
      eventPlaying = false;
      ctx.setRoomScenePending(false);
      // 未结算就退出（异常/无选择）→ 事件房还在：把面板（安全阀）还给塔楼层，别让玩家卡死
      if (run.gameStage === 'room' && run.currentRoom === 'event') ctx.notify();
    }
  }
  /** 面板安全阀 / 测试入口（正常路径由进房自动触发）。 */
  function triggerEvent() { void playEventScene(); }
  function leaveEvent() {
    if (run.gameStage !== 'room') return;
    lifecycle.completeRoom();
    ctx.notify();
  }

  // ---- ascension（**进阶 = cutscene + dialogue**，用户定 2026-09-12）----
  // 形态：训练达标离开营地房 → 与房间迁移**同一段切幕**（黑幕中点迁移 + 换台，揭幕揭开的就是
  // 进阶对话）→ 旁白 + 「择维度」选项（对话选项，非面板）→ 结果页 → （首次 0→1）九选三面板收尾
  // → 结束时切幕回塔楼。美术：占位 CG，真素材丢 `src/assets/images/events/ascension.webp` 自动顶替。
  let ascensionPlaying = false;
  /** 进阶选项（对话 choices）：所有可选维度 + 跳过（改记 1 点体修等级）。 */
  const ascensionChoices = () => [
    ...LEINO_DIMENSIONS.map((id) => {
      const meta = DIM_META[id] ?? { label: id };
      return {
        id,
        label: `${meta.glyph ?? ''}${meta.label}（等级 ${run.player.leino?.[id] ?? 0}）`,
        hint: `突破${meta.label}`,
      };
    }),
    { id: 'skip', label: '跳过（体修等阶 +1，生命上限 +3，可删一张卡）', hint: '不选灵脉，精进体修' },
  ];
  /** 选择之后的结果页（一句话确认，数字读实时 run）。 */
  const ascensionResultPage = (id) => (id === 'skip'
    ? { speaker: '旁白', text: `（你压下了那点火种。体修的精进悄然累积——体修等阶 ${run.player.bodyLevel ?? 0}，生命上限 +3。此刻起，你还可以从牌库中删去一张卡。）` }
    : {
      speaker: '旁白',
      text: `（${(DIM_META[id] ?? {}).label ?? id} 突破至 ${run.player.leino?.[id] ?? 0} 级：`
        + `生命回复 ${ASCENSION_PLACEHOLDER.healAmount} 点，魏启上限 +${ASCENSION_PLACEHOLDER.manaGain}。）`,
    });

  /**
   * 播进阶幕间。
   * @param fromRoom true = 从营地房直接接棒（黑幕中点做 completeRoom + 换台）；
   *                 false = 已在 ascension 阶段（调试/兜底）只做转场。
   */
  async function playAscensionScene({ fromRoom = false } = {}) {
    // fromRoom：调用时阶段仍是 'room'（迁移在黑幕中点做）——所以守卫按来源分流
    if (ascensionPlaying) return false;
    if (!fromRoom && run.gameStage !== 'ascension') return false;
    ascensionPlaying = true;
    try {
      const bg = eventArtUrlNamed('ascension', '进阶');
      let picked = null;
      await cutscene.play({
        steps: [
          {
            type: 'wipe',
            // 从房间来：全黑中点做阶段迁移 + 换台（房间→塔楼），揭幕揭开的就是进阶对话
            atCover: fromRoom ? () => lifecycle.completeRoomSwapToMap() : undefined,
          },
          {
            type: 'dialogue', bg,
            pages: [
              { speaker: '旁白', text: '塔层的灵力在此汇聚，经脉里的火种轻轻跳动。' },
              { speaker: '旁白', text: '择一条主维度突破——或就此收手，把心思留给身体。', choices: ascensionChoices() },
            ],
            onChoice: (id) => {
              picked = id;
              chooseAscension(run, id === 'skip' ? null : id);   // 同步结算（恢复/魏启上限/首解锁赠礼）
              ctx.notify();   // 种子包挂起时把九选三面板推到幕后就位
            },
          },
        ],
      });
      if (!picked) return false;                      // 未选择（异常路径）：留在 ascension 阶段
      await cutscene.play({ steps: [{ type: 'dialogue', bg, pages: [ascensionResultPage(picked)] }] });
      if (run.cardOffering) return true;              // 九选三面板收尾（chooseSeedCards 里再切幕）
      await lifecycle.exitSceneAfterCutscene(() => ctx.notify());   // 进阶结束 → 切幕回塔楼（用户定 2026-09-12）
      // 跳过进阶的删卡反哺（用户定 2026-09-13）：揭幕后就地开全屏删卡界面（title「删一张卡」）。
      // 可跳过——「返回」只收起界面，机会经 prep 面板的「使用删卡机会」按钮长期保留。
      // 此时快照已是 prep（exit 中点 notify 过），cardRemoval 段在场。
      if (picked === 'skip') ctx.panelStage?.()?.openUpgradePicker?.('ascensionRemove');
      return true;
    } finally {
      ascensionPlaying = false;
    }
  }

  /** 面板兜底路径（正常由 playAscensionScene 的对话选项走）：选了维度后同样要"收尾切幕"。 */
  function chooseAscensionDimension(dimension) {
    if (run.gameStage !== 'ascension') return;
    chooseAscension(run, dimension);
    ctx.notify();
    if (!run.cardOffering) void lifecycle.exitSceneAfterCutscene(() => ctx.notify());
  }
  // 跳过进阶：不选灵脉，改记 1 点隐藏体修等级（故事模式暗线）
  function skipAscension() {
    if (run.gameStage !== 'ascension' || run.cardOffering) return;
    chooseAscension(run, null);
    ctx.notify();
    void lifecycle.exitSceneAfterCutscene(() => ctx.notify());
  }

  // 种子包：九选三 + 一次刷新（首次 0→1 时挂起）；确认后进阶结束 → 切幕回塔楼
  function chooseSeedCards(defIds) {
    if (run.gameStage !== 'ascension' || !run.cardOffering) return;
    chooseSeedCardsCore(run, defIds);
    ctx.notify();
    void lifecycle.exitSceneAfterCutscene(() => ctx.notify());
  }
  function rerollSeedOffering() {
    if (run.gameStage !== 'ascension' || !run.cardOffering) return;
    rerollSeedOfferingCore(run);
    ctx.notify();
  }

  return {
    playEventScene, triggerEvent, leaveEvent,
    playAscensionScene, chooseAscensionDimension, skipAscension, chooseSeedCards, rerollSeedOffering,
    intents: {
      triggerEvent: () => triggerEvent(),
      leaveEvent: () => leaveEvent(),
      chooseAscensionDimension: (i) => chooseAscensionDimension(i.dimension),
      skipAscension: () => skipAscension(),
      chooseSeedCards: (i) => chooseSeedCards(i.defIds),
      rerollSeedOffering: () => rerollSeedOffering(),
    },
  };
}
