// GiftChoiceObject：老虎机**离房安慰奖**的"两件货摆在出料口前、点选其一"演出件
// （用户定 2026-09-12）。规格：进房后拉了 ≥2 次杆且一次没中奖时，离开房间前老虎机会吐出
// 「可乐 / 鸡腿」让玩家自选；美术未到位 → **纯色块 billboard + 白字黑边标签占位**。
//
// 放在**世界空间**（贴着机身出料口）而不是 UI 空间：演出是"从机器嘴里吐出来"，要跟着机器
// 的位置/尺度走；两件面向相机（billboard，每帧对齐），带轻微上下浮动与自转。
// 选中后：选中件向镜头放大飞出（淡出），另一件缩没；播完回调宿主（宿主再上行领取意图）。
//
// 只做"长什么样 + 被点了"——结算与获得物特写都在宿主/编排器侧。

import * as THREE from 'three';
import { P, shade } from '../scenes/kit/index.js';
import { bakeBoldText } from './textBakers.js';

/** 占位色（美术到位后换成卡面/立绘；这里只求"一眼分辨"）。 */
const GIFT_TINT = {
  cola: shade(P.machineRed, -0.06),
  chicken: shade(P.copper, 0.08),
};

export class GiftChoiceObject extends THREE.Group {
  /**
   * @param {object} options
   *   items: [{ id, name, effect }]（core 的 SLOT_GIFTS 下行文本）
   *   size:  色块边长（世界单位）
   *   onPick: (id) => void（选中并播完"飞出"动画后回调）
   */
  constructor({ items = [], size = 3.4, onPick = null } = {}) {
    super();
    this._items = [];
    this._onPick = onPick;
    this._hover = null;
    this._t = 0;
    this._take = null;   // { id, t }：选中件的飞出动画
    this._done = 0;
    items.forEach((it, i) => {
      const tint = GIFT_TINT[it.id] ?? shade(P.wax, -0.1);
      const g = new THREE.Group();
      // ① 纯色块（占位美术）
      const block = new THREE.Mesh(
        new THREE.PlaneGeometry(size, size),
        new THREE.MeshBasicMaterial({ color: tint, transparent: true }),
      );
      // ② 边框（读作"一件可点的货"）
      const frame = new THREE.Mesh(
        new THREE.PlaneGeometry(size * 1.12, size * 1.12),
        new THREE.MeshBasicMaterial({ color: shade(P.gold, -0.1), transparent: true, opacity: 0.85 }),
      );
      frame.position.z = -0.02;
      g.add(frame, block);
      // ③ 名称（白字黑边，与操纵条同一口径）
      if (typeof document !== 'undefined') {
        const label = bakeBoldText(it.name, { fontPx: 44, tint: '#ffffff', stroke: 'rgba(0,0,0,0.95)' });
        const text = new THREE.Mesh(
          new THREE.PlaneGeometry(label.width / 10, label.height / 10),
          new THREE.MeshBasicMaterial({ map: label.texture, transparent: true }),
        );
        text.position.set(0, -size * 0.78, 0.01);
        g.add(text);
      }
      g.userData.item = it;
      g.userData.block = block;
      this.add(g);
      this._items.push({ id: it.id, group: g, block, baseX: 0, index: i });
    });
    // 两件在出料口前左右排开（本件原点 = 出料口锚点）
    const gap = size * 1.45;
    this._items.forEach((it, i) => {
      it.baseX = (i - (this._items.length - 1) / 2) * gap;
      it.group.position.set(it.baseX, 0, 0);
    });
  }

  get active() { return this._items.length > 0 && !this._done; }

  /** Picker 登记：每件一个 id。 */
  attachPicker(picker) {
    this._picker = picker ?? null;
    if (!picker) return;
    for (const it of this._items) picker.addPickable(`gift:${it.id}`, it.group, { kind: 'button' });
  }

  pickIndexOf(hit) {
    if (hit?.kind !== 'button' || !hit.id?.startsWith('gift:')) return null;
    const id = hit.id.slice(5);
    return this._items.some(it => it.id === id) ? id : null;
  }

  onHover(hit) {
    const id = this.pickIndexOf(hit);
    if (id === this._hover) return;
    this._hover = id;
    for (const it of this._items) it.block.material.color.set(GIFT_TINT[it.id] ?? shade(P.wax, -0.1));
  }

  /** 点选：返回是否受理（已受理则开始"飞出"动画，播完回调 onPick）。 */
  choose(id) {
    if (!this.active || this._take || !this._items.some(it => it.id === id)) return false;
    this._take = { id, t: 0 };
    return true;
  }

  /** 逐帧：面向相机 + 浮动 + 选中动画推进。@returns 是否仍在播 */
  update(dt, camera = null) {
    this._t += dt;
    if (camera) this.quaternion.copy(camera.quaternion);   // billboard（世界空间里正对观者）
    for (const it of this._items) {
      const chosen = this._take?.id === it.id;
      const other = this._take && !chosen;
      const bob = Math.sin(this._t * 1.8 + it.index * 2.1) * 0.12;
      if (!this._take) {
        const lift = this._hover === it.id ? 0.35 : 0;
        it.group.position.set(it.baseX, bob + lift, 0);
        it.group.scale.setScalar(1 + (this._hover === it.id ? 0.06 : 0));
        it.block.material.opacity = 1;
      } else if (chosen) {
        const k = Math.min(1, this._take.t / 0.55);
        it.group.position.set(it.baseX * (1 - k), bob + k * 2.4, k * 6);   // 向镜头方向飞出
        it.group.scale.setScalar(1 + k * 0.9);
        it.block.material.opacity = 1 - k * 0.85;
      } else if (other) {
        const k = Math.min(1, this._take.t / 0.35);
        it.group.scale.setScalar(1 - 0.9 * k);
        it.block.material.opacity = 1 - k;
      }
    }
    if (this._take) this._take.t += dt;   // ⚠ 必须在循环外推进（在循环里每帧会按件数翻倍）
    if (this._take && this._take.t >= 0.6) {
      const id = this._take.id;
      this._take = null;
      this._done = 1;
      this._onPick?.(id);
      return false;
    }
    return true;
  }

  dispose() {
    for (const it of this._items) {
      this._picker?.removePickable(`gift:${it.id}`);
      it.group.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry?.dispose?.();
        o.material?.map?.dispose?.();
        o.material?.dispose?.();
      });
    }
    this._items = [];
  }
}
