// CardScrollPickerObject：全屏**选卡**界面（竖向滚动 + 滚动条 + 返回/确认）。
//
// 用途：营地/训练场「免费升级一张卡」、老虎机粉碎选卡、银行焚毁、古尔帕斯/Boss 删卡。
// 用户定的形态：
//   · 进入**全屏**界面，把候选卡渲染出来（不可用的置灰、不可选）
//   · hover 展示该卡的**预览**（tooltip 走 card 整卡预览：发 tooltip 事件给总线，与卡面热区
//     同一套浮层）；升级入口传的是**升级后**的 defId，所以预览的就是升阶后的卡面
//   · 可返回、可确认；确认后才真正落地
//   · 需要滚动（牌组 20+ 张时一屏放不下）
//
// 滚动/选中/确认/返回/背板/拾取登记等**全部在 ScrollPickerObject 基类**（与遗物选择界面
// 共用同一套骨架）；本文件只回答"一张卡长什么样"。

import { CardObject } from './CardObject.js';
import { CARD_WIDTH, CARD_HEIGHT } from './cardMetrics.js';
import { ScrollPickerObject } from './ScrollPickerObject.js';
import { withLabels } from '../panels/shared.js';

const SCALE = 0.62;
const CARD_ID = (uniqueID) => `picker:card:${uniqueID}`;

export class CardScrollPickerObject extends ScrollPickerObject {
  /**
   * @param {object} options
   *   bakeFace: 卡面烘焙（与战场同源）
   *   bakeText / bakeButton: 文本与按钮烘焙
   *   bus: 事件总线（tooltip 出口；缺省不发 tooltip）
   *   onConfirm(selectedIds) / onCancel(): 宿主回调（确认/返回）
   */
  constructor({ bakeFace = null, bakeText = null, bakeButton = null, bus = null, onConfirm = null, onCancel = null } = {}) {
    super({ bakeText, bakeButton, bus, onConfirm, onCancel });
    this._bakeFace = bakeFace;
  }

  get selectedIds() { return this.selectedKeys; }
  get cardCount() { return this.itemCount; }

  /**
   * 打开选卡界面（幂等：先清场）。
   * @param {object} data
   *   title / hint: 文案
   *   cards: [{ uniqueID, defId, view, enabled, tipDefId }]（顺序即展示顺序，行优先）
   *   multi/picks: 多选与目标张数（缺省单选 1 张）
   *   confirmLabel: 确认键文案
   */
  open({ title = '选择卡牌', hint = '', cards = [], multi = false, picks = 1, confirmLabel = '确认' } = {}) {
    return super.open({
      title, hint, items: cards, multi, picks, confirmLabel,
      cols: 6, itemW: CARD_WIDTH * SCALE, itemH: CARD_HEIGHT * SCALE, gapX: 2, gapY: 2.4,
      buildItem: (c, i, { x, yTop }) => {
        const id = CARD_ID(c.uniqueID);
        const obj = new CardObject({
          uniqueID: id, cardWidth: CARD_WIDTH, cardHeight: CARD_HEIGHT, bakeFace: this._bakeFace,
        });
        // 关键词 id → 页脚中文标签（标签表在 bridge，快照 view 是 core 产的原始 id——
        // 与奖励面板的 withLabels 同口径，升级演出摘下的卡也走这里，口径一致）
        obj.setCard(c.view ? withLabels({ ...c.view, uniqueID: id, defId: c.defId }) : c.defId);
        obj.position.set(x, yTop - (CARD_HEIGHT * SCALE) / 2, 0);
        obj.scale.set(SCALE, SCALE, 1);
        return {
          obj, key: c.uniqueID, id, enabled: c.enabled,
          meta: { uniqueID: c.uniqueID, defId: c.defId, view: c.view, tipDefId: c.tipDefId },
          // 预览用 `tipDefId ?? defId`（升级入口传的是升阶后的卡；无目标时预览自身，hover 不落空）；
          // 升级分叉（tipDefIds 多张）→ 多卡并列预览（「可升方向全摆出来」，用户定 2026-09-13）
          tip: (c.tipDefIds?.length > 1)
            ? { type: 'cards', payload: { cardIds: c.tipDefIds } }
            : { type: 'card', payload: { cardId: c.tipDefId ?? c.defId } },
          setState: (s) => obj.setVisualState(s),
        };
      },
    });
  }
}
