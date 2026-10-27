// stageDirector —— 舞台路由一处派生（handoffs/RUN_FLOW_REFACTOR_RESEARCH §4.4）。
//
// runController 持有全部舞台实例（battle/room/end 闭包变量 + map 注入）的生命周期，
// 本模块只收「引用 getter 集 + gameStage」回答四个路由问题；不建/不拆舞台（那是
// transitionStage 与各 migrate 的事），只回答「现在谁在场、面板画哪、指针喂谁、
// 切幕时收谁的模态」。
//
// 引用一律晚绑定（getter 闭包捕获 runController 的 let 绑定，运行期才取值）。

export function createStageDirector(refs) {
  // refs: { battle, room, map, end } —— 舞台引用的 getter（可空）
  /** 面板/选卡/获得特写画在哪（battle ?? room ?? map；end 无面板面——终局只有结算屏）。 */
  const panelStage = () => refs.battle() ?? refs.room() ?? refs.map();
  return {
    panelStage,

    /** 'fx' step 的舞台服务来源（与 panelStage 同序）。 */
    fxServices: () => panelStage()?.fxServices() ?? null,

    /**
     * 指针喂谁（App.activeStage 的原序）：battle 存活期间由它接管（战斗 + 战后奖励）；
     * room 仅在 room/ascension 期喂（房内进阶时 RoomStage 仍是渲染中的舞台——种子包
     * 等阶段模态画在它的 uiScene 上，指针喂错层 = 操作看不见的副本）；end → 结算屏，
     * 缺席回落 map；其余 → map。
     */
    inputStage(gameStage) {
      const battle = refs.battle();
      if (battle) return battle;
      const room = refs.room();
      if (room && (gameStage === 'room' || gameStage === 'ascension')) return room;
      if (gameStage === 'end') return refs.end() ?? refs.map();
      return refs.map();
    },

    /** 切幕统一清算：所有在场舞台的全屏模态一键收起（收呈现不收账——defer 语义，
     *  尾款/问句由下一拍 notify 重呈现）。 */
    dismissModals() {
      for (const st of [refs.battle(), refs.room(), refs.map(), refs.end()]) st?.dismissModals();
    },
  };
}
