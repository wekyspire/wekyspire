// ChoiceBillboardObject：休息房里"几件东西摆在机器前、点选其一"的通用演出件
// （通用化自 GiftChoiceObject：老虎机离房安慰奖「可乐 / 鸡腿」二选一 → 银行机恶魔 roll
// 「三个词条」三选一，两个使用者共用同一份"色块 billboard + 点选 + 飞出"的骨架）。
//
// 规格：一件 = 色块 billboard（`tint`）+ 边框 + 名称（白字黑边，印在色块上）+ 可选的副标题
// （如恶魔词条的「黑色级」）；整组面向相机（billboard，每帧对齐）、轻微浮动与自转；
// hover 抬起放大；选中后：选中件朝镜头放大飞出（淡出）、其余缩没，播完回调宿主。
//
// 美术未到位 → 纯色块占位（用户定 2026-09-11：先占位纯色块）。结算与获得物特写都在宿主侧。

import * as THREE from 'three';
import { P, shade } from '../scenes/kit/index.js';
import { bakeBoldText } from './textBakers.js';

/** 无名色（缺省占位）：暖白压一档。 */
const DEFAULT_TINT = shade(P.wax, -0.1);

export class ChoiceBillboardObject extends THREE.Group {
  /**
   * @param {object} options
   *   items: [{ id, name, sub?, tint? }]（tint 为 number hex；缺省用 DEFAULT_TINT）
   *   size:  色块边长（世界单位）
   *   gap:   件间距（缺省 size × 1.45）
   *   onPick: (id) => void（选中并播完"飞出"动画后回调）
   */
  constructor({ items = [], size = 3.0, gap = null, onPick = null } = {}) {
    super();
    this._items = [];
    this._onPick = onPick;
    this._hover = null;
    this._t = 0;
    this._take = null;   // { id, t }：选中件的飞出动画
    this._done = 0;
    items.forEach((it, i) => {
      const tint = it.tint ?? DEFAULT_TINT;
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
      // ③ 名称（白字黑边，与操纵条同一口径）+ 可选副标题
      // ⚠ 名字长度不定（「可乐」两字 vs「浑浑噩噩」四字），固定缩放会让长名字溢出卡片
      //   甚至盖到隔壁卡上——按卡片宽度**自动收缩放**（等比，居中不变形）
      if (typeof document !== 'undefined') {
        const inner = size * 0.88;   // 卡片可用宽度（留边）
        const fit = (baked, baseScale, capH) => Math.min(
          baseScale,
          inner / Math.max(0.001, baked.width / 10),
          (size * capH) / Math.max(0.001, baked.height / 10),
        );
        const label = bakeBoldText(it.name ?? '', { fontPx: 64, tint: '#ffffff', stroke: 'rgba(0,0,0,0.95)' });
        const text = new THREE.Mesh(
          new THREE.PlaneGeometry(label.width / 10, label.height / 10),
          new THREE.MeshBasicMaterial({ map: label.texture, transparent: true }),
        );
        // ⚠ 烘 64px 再**缩到 ~0.22**（不是把烘焙逻辑像素直接当世界尺寸：那样 44px 的字
        // 有 4.4wu 高，比货块还大，整块屏被字糊住）
        text.scale.setScalar(fit(label, 0.22, 0.34));
        text.position.set(0, size * (it.sub ? 0.06 : -0.06), 0.01);
        g.add(text);
        if (it.sub) {
          const sub = bakeBoldText(it.sub, { fontPx: 44, tint: '#ffe6ad', stroke: 'rgba(0,0,0,0.95)' });
          const subMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(sub.width / 10, sub.height / 10),
            new THREE.MeshBasicMaterial({ map: sub.texture, transparent: true }),
          );
          subMesh.scale.setScalar(fit(sub, 0.15, 0.24));
          subMesh.position.set(0, -size * 0.2, 0.01);
          g.add(subMesh);
        }
      }
      g.userData.item = it;
      g.userData.block = block;
      this.add(g);
      this._items.push({ id: it.id, group: g, block, tint, baseX: 0, index: i });
    });
    // 排列：整体居中（本件原点 = 组中心）
    const step = gap ?? size * 1.45;
    this._items.forEach((it, i) => {
      it.baseX = (i - (this._items.length - 1) / 2) * step;
      it.group.position.set(it.baseX, 0, 0);
    });
    /** 整组占位宽（宿主取景用：镜头距离要装得下全部卡片）。 */
    this.totalWidth = this._items.length
      ? (this._items.length - 1) * step + size * 1.12 : 0;
  }

  get active() { return this._items.length > 0 && !this._done; }

  /** Picker 登记：每件一个 id。 */
  attachPicker(picker) {
    this._picker = picker ?? null;
    if (!picker) return;
    for (const it of this._items) picker.addPickable(`choice:${it.id}`, it.group, { kind: 'button' });
  }

  pickIndexOf(hit) {
    if (hit?.kind !== 'button' || !hit.id?.startsWith('choice:')) return null;
    const id = hit.id.slice('choice:'.length);
    return this._items.some(it => it.id === id) ? id : null;
  }

  onHover(hit) {
    const id = this.pickIndexOf(hit);
    if (id === this._hover) return;
    this._hover = id;
    for (const it of this._items) it.block.material.color.set(it.tint);
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
      this._picker?.removePickable(`choice:${it.id}`);
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
