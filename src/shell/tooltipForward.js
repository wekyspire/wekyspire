// 3D 源 tooltip 的常驻转发器：Picker 发 tooltip:* 事件 → tooltipHub。
//
// 为什么需要它：BattleHud.vue 里也有一份同样的转发（战斗阶段），但它只在
// `gameStage === 'battle'` 挂载；而塔楼/房间阶段的 Three 面板同样会发 tooltip
// （卡面 /named、/effect 热区等），那时**没有任何转发器**——这是本次 UI 迁移
// 之前就存在的链路缺口。
//
// 两份转发器在战斗阶段会同时挂载、同一条总线（bridge.frontendBus 就是 run 级
// animBus）上的同一事件会触发两次。**这是安全的**：tooltipHub 的状态机按 token
// 去重（tooltipShow 同 token 只跟随指针不重算模型，tooltipMove/tooltipHide 幂等），
// 同事件转发两次不产生任何视觉差异。保留 BattleHud 那一份是因为观战页依赖它
// （remoteBridge 的总线不是本模块订阅的 animBus）。
//
// 契约用例：test/uiPanels.test.js「同事件转发两次不改变 tooltip 状态」。

import { EventNames } from '../bridge/events.js';
import { tooltipShow, tooltipMove, tooltipHide } from './tooltipHub.js';

/**
 * 挂载常驻转发。返回 detach（摘订阅 + 兜底隐藏浮层）。
 * @param {object|null} bus mitt 总线（通常 runController.animBus）
 */
export function attachTooltipForwarding(bus) {
  if (!bus) return () => {};
  const onShow = ({ kind, payload, x, y }) => tooltipShow(kind, payload, x, y);
  const onMove = ({ x, y }) => tooltipMove(x, y);
  const onHide = () => tooltipHide();
  bus.on(EventNames.TOOLTIP_SHOW, onShow);
  bus.on(EventNames.TOOLTIP_MOVE, onMove);
  bus.on(EventNames.TOOLTIP_HIDE, onHide);
  return () => {
    bus.off(EventNames.TOOLTIP_SHOW, onShow);
    bus.off(EventNames.TOOLTIP_MOVE, onMove);
    bus.off(EventNames.TOOLTIP_HIDE, onHide);
    tooltipHide(); // 摘除即隐藏：防浮层滞留（换局/回主菜单）
  };
}
