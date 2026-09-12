// RelicScrollPickerObject：全屏**选遗物**界面（竖向滚动 + 滚动条 + 返回/确认）。
//
// 与选卡界面（CardScrollPickerObject）共用同一套骨架（ScrollPickerObject 基类）——
// 滚动/选中/确认/返回/背板/tooltip/拾取登记全在基类，本文件只回答"一件遗物长什么样"。
//
// 候选件形态（2026-09-12 接上立绘）：**立绘 + 名字 + 描述**——
//   上半是 `assets/relics/<遗物名>` 的立绘（透明底、白描边，直接贴即可），
//   下方依次是稀有度色的名字与灰字描述；稀有度徽标仍在左上角。
//   素材未落盘的遗物（内容先行、美术未到）自动退化为原来的**纯文字藏品卡**，
//   所以内容侧照常能加新遗物，不必等图。
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
// 5 列 ≈ 109 世界单位宽（UI 全宽 177.8）——第一版按 7.6×5.6 做，在 720p 下只有 55×40 px，太小。
// 2026-09-12 接立绘后加高到 32：立绘占满上方 19 见方（不拉伸，素材是方形构图），
// 下方留白带放名字 + 描述（描述 3 行以内放得下）。
const TILE = { w: 20, h: 32 };
const ART = { size: 19, top: 0.4 };      // 立绘：边长 19 的正方形，顶边距卡顶 0.4
const INNER = { color: 0x0d1018, highlight: 0x1b2436 };

/** 一件候选遗物的显示对象（自建材质；dispose 时随界面释放）。 */
class RelicTile extends THREE.Group {
  constructor({ bakeText, relic }) {
    super();
    this._relic = relic;
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
    // 立绘（key = 遗物显示名）：素材未就绪先留空，贴图晚到再补（订阅见下）
    const artY = TILE.h / 2 - ART.top - ART.size / 2;
    this._art = new THREE.Mesh(
      new THREE.PlaneGeometry(ART.size, ART.size),
      new THREE.MeshBasicMaterial({ transparent: true }),
    );
    this._art.position.set(0, artY, 0.04);
    this._art.visible = false;
    this.add(this._art);
    // 左上角稀有度徽标 + 名字（两者都用稀有度色）
    const badge = new TextBlockObject({ bakeText, fontPx: 22, tint: col });
    badge.setText(`[${relic.rarity ?? 'C'}]`);
    badge.placeLeftTop(-TILE.w / 2 + 1.0, TILE.h / 2 - 1.0);
    badge.position.z = 0.06;
    this.add(badge);
    const name = new TextBlockObject({ bakeText, fontPx: 30, tint: col });
    name.setText(relic.name ?? relic.id);
    name.placeCenterTop(0, TILE.h / 2 - ART.top - ART.size - 0.8);
    name.position.z = 0.06;
    this.add(name);
    this._desc = new TextBlockObject({ bakeText, fontPx: 20, tint: '#9aa3b8' });
    this._desc.setText(relic.desc ?? '', { maxWidth: (TILE.w - 2.0) * 10 });
    this._desc.placeLeftTop(-TILE.w / 2 + 1.0, TILE.h / 2 - ART.top - ART.size - 3.4);
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

  /** 视觉态（基类按 hover/选中/禁用调用）：描边与内底两级亮度。 */
  setVisualState(state) {
    const frame = this._frame.material;
    const inner = this._inner.material;
    if (state === 'disabled') { frame.opacity = 0.16; inner.color.setHex(INNER.color); inner.opacity = 0.6; return; }
    if (state === 'highlighted') { frame.opacity = 1; inner.color.setHex(INNER.highlight); inner.opacity = 1; return; }
    frame.opacity = 0.42; inner.color.setHex(INNER.color); inner.opacity = 0.95;
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
