// RelicScrollPickerObject：全屏**选遗物**界面（竖向滚动 + 滚动条 + 返回/确认）。
//
// 与选卡界面（CardScrollPickerObject）共用同一套骨架（ScrollPickerObject 基类）——
// 滚动/选中/确认/返回/背板/tooltip/拾取登记全在基类，本文件只回答"一件遗物长什么样"。
//
// 遗物目前**没有美术资源**（`src/assets/items/` 尚不存在），所以候选件是程序化的"藏品卡"：
// 稀有度色描边框 + 名字 + 描述（按 maxWidth 自动换行）+ 左上角稀有度徽标；hover 出遗物
// tooltip（`{ type:'relic' }`，与面板里的遗物条目同一套浮层）。素材到位后在这里换成
// 立绘 + 名字的排版即可，接口不变。

import * as THREE from 'three';
import { TextBlockObject } from './TextBlockObject.js';
import { ScrollPickerObject } from './ScrollPickerObject.js';

/** 稀有度色（遗物 UI 的唯一来源）：C 灰蓝 / B 青 / A 紫 / S 金。 */
export const RARITY_COLORS = Object.freeze({
  C: '#8d97b5', B: '#6fb3c8', A: '#a98ad8', S: '#ffd75e',
});
const rarityColor = (r) => RARITY_COLORS[r] ?? RARITY_COLORS.C;

// 尺寸对齐选卡界面（卡 26×35.1 世界单位 ×0.62 ≈ 16×22）：遗物卡略宽（要横排名字+描述），
// 5 列 ≈ 109 世界单位宽（UI 全宽 177.8）——第一版按 7.6×5.6 做，在 720p 下只有 55×40 px，太小。
const TILE = { w: 20, h: 24 };
const INNER = { color: 0x0d1018, highlight: 0x1b2436 };

/** 一件候选遗物的显示对象（自建材质；dispose 时随界面释放）。 */
class RelicTile extends THREE.Group {
  constructor({ bakeText, relic }) {
    super();
    const col = rarityColor(relic.rarity);
    this._frame = new THREE.Mesh(
      new THREE.PlaneGeometry(TILE.w, TILE.h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(col), transparent: true, opacity: 0.42 }),
    );
    this.add(this._frame);
    this._inner = new THREE.Mesh(
      new THREE.PlaneGeometry(TILE.w - 0.34, TILE.h - 0.34),
      new THREE.MeshBasicMaterial({ color: INNER.color, transparent: true, opacity: 0.95 }),
    );
    this._inner.position.z = 0.02;
    this.add(this._inner);
    // 左上角稀有度徽标 + 居中的名字（两者都用稀有度色）
    const badge = new TextBlockObject({ bakeText, fontPx: 22, tint: col });
    badge.setText(`[${relic.rarity ?? 'C'}]`);
    badge.placeLeftTop(-TILE.w / 2 + 1.0, TILE.h / 2 - 1.0);
    badge.position.z = 0.06;
    this.add(badge);
    const name = new TextBlockObject({ bakeText, fontPx: 30, tint: col });
    name.setText(relic.name ?? relic.id);
    name.placeCenterTop(0, TILE.h / 2 - 5.0);
    name.position.z = 0.06;
    this.add(name);
    this._desc = new TextBlockObject({ bakeText, fontPx: 20, tint: '#9aa3b8' });
    this._desc.setText(relic.desc ?? '', { maxWidth: (TILE.w - 2.0) * 10 });
    this._desc.placeLeftTop(-TILE.w / 2 + 1.0, TILE.h / 2 - 8.6);
    this._desc.position.z = 0.06;
    this.add(this._desc);
  }

  /** 视觉态（基类按 hover/选中/禁用调用）：描边与内底两级亮度。 */
  setVisualState(state) {
    const frame = this._frame.material;
    const inner = this._inner.material;
    if (state === 'disabled') { frame.opacity = 0.16; inner.color.setHex(INNER.color); inner.opacity = 0.6; return; }
    if (state === 'highlighted') { frame.opacity = 1; inner.color.setHex(INNER.highlight); inner.opacity = 1; return; }
    frame.opacity = 0.42; inner.color.setHex(INNER.color); inner.opacity = 0.95;
  }

  dispose() {
    this.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry?.dispose?.();
      o.material?.map?.dispose?.();
      o.material?.dispose?.();
    });
  }
}

export class RelicScrollPickerObject extends ScrollPickerObject {
  /**
   * @param {object} options
   *   bakeText / bakeButton: 文本与按钮烘焙
   *   bus: 事件总线（遗物 tooltip 出口）
   *   onConfirm(selectedRelicIds) / onCancel(): 宿主回调
   */
  constructor(opts = {}) {
    super(opts);
  }

  get selectedRelicIds() { return this.selectedKeys; }

  /**
   * 打开选遗物界面（幂等：先清场）。
   * @param {object} data
   *   title / hint: 文案
   *   relics: [{ id, name, rarity, desc }]（顺序即展示顺序，行优先；desc 由调用方补）
   *   confirmLabel: 确认键文案（如「确认粉碎」）
   */
  open({ title = '选择遗物', hint = '', relics = [], confirmLabel = '确认' } = {}) {
    return super.open({
      title, hint, items: relics, confirmLabel,
      cols: 5, itemW: TILE.w, itemH: TILE.h, gapX: 2.2, gapY: 2.6,
      buildItem: (r, i, { x, yTop }) => {
        const tile = new RelicTile({ bakeText: this._bakeText, relic: r });
        tile.position.set(x, yTop - TILE.h / 2, 0);
        return {
          obj: tile, key: r.id, id: `picker:relic:${r.id}`, enabled: true,
          tip: { type: 'relic', payload: { relicId: r.id } },
          setState: (s) => tile.setVisualState(s),
        };
      },
    });
  }
}
