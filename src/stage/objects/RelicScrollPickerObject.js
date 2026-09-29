// RelicScrollPickerObject：全屏**选遗物**界面（竖向滚动 + 滚动条 + 返回/确认）。
//
// 与选卡界面（CardScrollPickerObject）共用同一套骨架（ScrollPickerObject 基类）——
// 滚动/选中/确认/返回/背板/tooltip/拾取登记全在基类，本文件只回答"一件遗物长什么样"。
//
// 候选件形态（2026-09-29 用户定：**无底板**——立绘 + 名字 + 描述直接摆在背板上，
// 点击盒是隐形面）：上半是 `assets/relics/<遗物名>` 的立绘，下方依次是稀有度徽标、
// 稀有度色的名字与灰字描述（三者统一**左对齐**）。素材未落盘的遗物自动退化为纯文字卡。
// hover/选中的反馈 = 整件轻微放大 + 立绘提亮（不再画 rect 背景）。
//
// hover 出遗物 tooltip（`{ type:'relic' }`，与面板里的遗物条目同一套浮层）。

import * as THREE from 'three';
import { TextBlockObject } from './TextBlockObject.js';
import { ScrollPickerObject } from './ScrollPickerObject.js';
import { sharedRelicArtCache } from '../art/relicArt.js';

/** 稀有度色（遗物 UI 的唯一来源）：C 灰蓝 / B 青 / A 紫 / S 金。 */
export const RARITY_COLORS = Object.freeze({
  C: '#8d97b5', B: '#6fb3c8', A: '#a98ad8', S: '#ffd75e',
});
const rarityColor = (r) => RARITY_COLORS[r] ?? RARITY_COLORS.C;

// 尺寸对齐选卡界面（卡 26×35.1 世界单位 ×0.62 ≈ 16×22）：遗物卡略宽（要横排名字+描述），
// 5 列 ≈ 109 世界单位宽（UI 全宽 177.8）。立绘占上方 19 见方（不拉伸，素材是方形构图），
// 下方留白带放徽标/名字/描述（描述 3 行以内放得下）。
const TILE = { w: 20, h: 32 };
const ART = { size: 19, top: 0.4 };      // 立绘：边长 19 的正方形，顶边距卡顶 0.4
const TEXT_X = -TILE.w / 2 + 1.0;        // 徽标/名字/描述统一左缘

/** 一件候选遗物的显示对象（自建材质；dispose 时随界面释放）。 */
class RelicTile extends THREE.Group {
  constructor({ bakeText, relic }) {
    super();
    this._relic = relic;
    const col = rarityColor(relic.rarity);
    // 隐形点击盒：拾取面必须 visible（Picker 会滤掉 invisible 对象），用 opacity 0 代替
    const clickBox = new THREE.Mesh(
      new THREE.PlaneGeometry(TILE.w, TILE.h),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    this.add(clickBox);
    // 立绘（key = 遗物显示名）：素材未就绪先留空，贴图晚到再补（订阅见下）
    const artY = TILE.h / 2 - ART.top - ART.size / 2;
    this._art = new THREE.Mesh(
      new THREE.PlaneGeometry(ART.size, ART.size),
      new THREE.MeshBasicMaterial({ transparent: true }),
    );
    this._art.position.set(0, artY, 0.04);
    this._art.visible = false;
    this.add(this._art);
    // 左上角稀有度徽标 + 名字 + 描述：三者同一左缘（2026-09-29 对齐修正）
    const badge = new TextBlockObject({ bakeText, fontPx: 22, tint: col });
    badge.setText(`[${relic.rarity ?? 'C'}]`);
    badge.placeLeftTop(TEXT_X, TILE.h / 2 - 1.0);
    badge.position.z = 0.06;
    this.add(badge);
    const name = new TextBlockObject({ bakeText, fontPx: 30, tint: col });
    name.setText(relic.name ?? relic.id);
    name.placeLeftTop(TEXT_X, TILE.h / 2 - ART.top - ART.size - 1.2);
    name.position.z = 0.06;
    this.add(name);
    this._desc = new TextBlockObject({ bakeText, fontPx: 20, tint: '#9aa3b8' });
    this._desc.setText(relic.desc ?? '', { maxWidth: (TILE.w - 2.0) * 10 });
    this._desc.placeLeftTop(TEXT_X, TILE.h / 2 - ART.top - ART.size - 3.8);
    this._desc.position.z = 0.06;
    this.add(this._desc);
    // 立绘惰性套用：先试一次；未命中就订阅加载完成（贴成即退订，dispose 兜底）
    this._unsub = null;
    if (!this._applyArt()) {
      this._unsub = sharedRelicArtCache.addOnLoad(() => { if (this._applyArt()) this._unsub?.(); });
    }
  }

  /** 有图就贴上（返回是否已贴成）。无素材的遗物永远返回 false → 退化为纯文字卡。 */
  _applyArt() {
    if (this._art.material.map) return true;
    const tex = sharedRelicArtCache.getTexture(this._relic.name ?? this._relic.id);
    if (!tex) return false;
    this._art.material.map = tex;
    this._art.material.needsUpdate = true;
    this._art.visible = true;
    return true;
  }

  /** 视觉态（基类按 hover/选中/禁用调用）：整件缩放 + 立绘提亮（无底板可调）。 */
  setVisualState(state) {
    if (state === 'disabled') { this.scale.setScalar(0.94); this._art.material?.color?.setScalar(0.6); return; }
    if (state === 'highlighted') { this.scale.setScalar(1.06); this._art.material?.color?.setScalar(1.25); return; }
    this.scale.setScalar(1);
    this._art.material?.color?.setScalar(1);
  }

  dispose() {
    this._unsub?.();
    this._unsub = null;
    this.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry?.dispose?.();
      // ⚠ 不 dispose material.map：立绘图取自 sharedRelicArtCache（进程级共享纹理，
      // 关掉一次界面就释放会把别的舞台/下次打开全打成黑块）。
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
   *   multi/picks/minPicks: 多选与目标件数（缺省单选 1 件；minPicks 传入即 M..N 区间）
   *   confirmLabel: 确认键文案（如「确认粉碎」）
   */
  open({ title = '选择遗物', hint = '', relics = [], multi = false, picks = 1, minPicks = null, confirmLabel = '确认' } = {}) {
    return super.open({
      title, hint, items: relics, multi, picks, minPicks, confirmLabel,
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
