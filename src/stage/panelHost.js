// panelHost.js —— 三舞台（Map/Room/Battle）面板宿主共享层。
// 收：pickerKit 转发族（三家逐字相同）与 _onPanelAction 分流骨架（local 动作表按舞台配置）。
// 不收：setPanel/_renderPanel/_removePanel —— 三家的模态压暗 / dock+stagePanel 双轨 /
// shopOpen 视图重映射是本质分叉（评审 A5），留在各舞台。新 kit 能力在这里加一个转发即可，
// 不必三舞台各抄一遍（BattleStage 漏 handleWheel / 漏 showcaseItem 的实报 bug 均出自手工三份）。
//
// 装上后舞台须自带：_pickerKit / _snap / _panel / _grantBusy / _runSequencer / _onIntent /
// uiScene / _deckAnchor() / _removePanel()（隐式契约，缺了即抛——与拆封前同一批字段）。
import { grantCardFlight } from './cardGrantFlight.js';

/**
 * @param StageClass 舞台类（方法装在 prototype 上，描述符拷贝保 getter 惰性）
 * @param localActions 面板本地动作表：{ 动作名(action, info) }，this = 舞台实例
 * @param allowSource  openUpgradePicker 来源白名单谓词（null = 不限）
 * @param onCardPickerOpened 卡阵全屏界面打开成功后的钩子（MapStage 续卡图晚到订阅）
 */
export function installPanelHost(StageClass, { localActions = {}, allowSource = null, onCardPickerOpened = null } = {}) {
  const proto = {
    // ---- 注入口 ----
    /** 意图上行出口（runController 注入：Stage 只上报「谁被点了」，不解释语义）。 */
    setPanelIntentHandler(fn) { this._onIntent = fn; },
    /** run 级动画队列注入（「择卡得卡」演出指令化的挂点，与切幕/清层串行）。 */
    setRunSequencer(seq) { this._runSequencer = seq ?? null; },

    // ---- pickerKit 转发族 ----
    showcaseItem(item) { return this._pickerKit.showcaseItem(item); },
    /** 切幕清算转发（wipe preStage）：收起本舞台特写与全屏选卡/选遗物。 */
    dismissModals() { this._pickerKit?.dismissModals(); },
    playCardUpgrade(payload) { return this._pickerKit.playCardUpgrade(payload); },
    playCardBurn(payload) { return this._pickerKit.playCardBurn(payload); },
    get showcasing() { return this._pickerKit.showcasing; },
    /** 套件级模态占用（特写/升级演出/全屏界面开着）——宿主编排器据此避让自动演出。 */
    get uiBusy() { return this._pickerKit.uiBusy; },
    get cardPicker() { return this._pickerKit.cardPicker; },
    get relicPicker() { return this._pickerKit.relicPicker; },
    /** 滚轮：选卡界面优先消费（全屏界面，滚轮只作用于它）。 */
    handleWheel(deltaY) { return this._pickerKit.handleWheel(deltaY); },

    openUpgradePicker(source, opts) {
      if (allowSource && !allowSource(source)) return false;
      const ok = this._pickerKit.openUpgradePicker(source, this._snap, opts);
      if (ok) onCardPickerOpened?.(this);
      return ok;
    },
    /** 卡包三选一（买到即开）：全屏 overlay，可放弃（返回 = 放弃卡包）。 */
    openShopPackPicker() {
      const ok = this._pickerKit.openShopPackPicker(this._snap);
      if (ok) onCardPickerOpened?.(this);
      return ok;
    },
    /** 遗物包三选一（售货机稀有度遗物包）：全屏 overlay，可放弃。 */
    openShopRelicPackPicker() { return this._pickerKit.openShopRelicPackPicker(this._snap); },
    /** 老虎机中奖产出的多选一（获得演出 dismiss 后接这里）。 */
    openSlotPrizePicker() { return this._pickerKit.openSlotPrizePicker(this._snap); },
    /** 训练抓牌四选一（全屏 overlay；候选取自当前快照）。 */
    openTrainingDrawPicker() {
      const ok = this._pickerKit.openTrainingDrawPicker(this._snap);
      if (ok) onCardPickerOpened?.(this);
      return ok;
    },
    /** 「粉碎物品」选择界面（老虎机吞噬入口；候选由编排器给，Stage 不读 run）。 */
    openDevourPicker(opts) { return this._pickerKit.openDevourPicker(opts); },

    // ---- 面板动作分流骨架 ----
    // local = 面板本地交互态（开选卡界面…）：舞台自己消化，不惊动 core；
    // grantCard = 得卡标记：摘下被点的卡 → 拆面板 → 播「择卡得卡」飞行（sequencer
    // 指令化）→ 落袋才上行意图；其余（含 slotAnimDone 这类舞台演出回执）原样上行。
    // overlay 整体拆除而非藏起：隐形面板会被随后的同 kind 快照重绘但仍隐形
    // （PanelObject 只在 kind 变化时重建）。
    _onPanelAction(action, info) {
      if (!action || this._grantBusy) return;
      if (action.local) { localActions[action.action]?.call(this, action, info); return; }
      if (action.grantCard && info?.pickId && this._panel) {
        const entry = this._panel.takeCard(info.pickId);
        if (entry) {
          grantCardFlight({
            entry, add: (c) => { this.uiScene.add(c); this._removePanel(); },   // 面板组在原点：局部即世界
            target: this._deckAnchor(), sequencer: this._runSequencer,
            onBusy: (b) => { this._grantBusy = b; },
            onDone: () => this._onIntent?.(action),
          });
          return;
        }
      }
      this._onIntent?.(action);
    },
  };
  // 描述符拷贝：直接 Object.assign 会把 getter 求值固化成普通属性
  for (const key of Object.keys(proto)) {
    Object.defineProperty(StageClass.prototype, key, Object.getOwnPropertyDescriptor(proto, key));
  }
}
