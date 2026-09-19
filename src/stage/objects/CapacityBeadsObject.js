// CapacityBeadsObject：手牌容量指示条（批次 13，用户定 2026-09-13；2026-09-18 改版）。
// 手牌扇上方一排小圆角方片（轮廓呼应卡牌，比旧圆珠更小更紧凑），与 headless 文本/
// 投影 handCapacity 同口径：
//   最左 chantCap 颗 = 咏唱容量珠（蓝系）：激活咏唱的权重（共鸣石折扣后）先占它——点亮=占用，暗=空。
//   其余 max 颗 = 手牌珠：绿 = 普通卡占用，黄 = 溢出容量的激活咏唱占用，灰 = 空。
// 超载状态无指示器（铁律）。
// 纯展示件：只读投影 setValue，不挂拾取、不进动画注册表；珠数签名不变不重建网格。
// 摆放/层级由宿主（BattleStage）决定——必须放在手牌扇覆盖区之外的可见带，
// z 压过静息手牌（≤15）但低于悬浮/瞄准牌（30.5+），见 BattleStage 装配处注释。

import * as THREE from 'three';

const BEAD_W = 1.7;        // 方片宽（世界单位）
const BEAD_H = 2.3;        // 方片高（宽高比 ≈ 卡牌 26:35.1 的轮廓回声）
const BEAD_R = 0.5;        // 圆角半径
const BEAD_STEP = 2.15;    // 组内珠距（间隙 0.45——紧凑排）
const GROUP_GAP = 1.1;     // 咏唱组与手牌组之间的额外间隔

// 扁平配色（无发光，与 UI 铁律一致）：内容语义色不受「金色=金钱」约束
const COLORS = {
  chantLit: 0x6db3ff,   // 咏唱容量·占用
  chantIdle: 0x2c3a52,  // 咏唱容量·空
  handLit: 0x4ad06e,    // 普通卡占用
  chantOverflow: 0xe8c85a, // 溢出容量的激活咏唱占用
  empty: 0x363d4d,      // 手牌位·空
};

// 圆角方形 Shape（中心在原点）
function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

const BEAD_GEO = new THREE.ShapeGeometry(roundedRectShape(BEAD_W, BEAD_H, BEAD_R));

export class CapacityBeadsObject extends THREE.Group {
  constructor() {
    super();
    this._beads = [];       // { mesh, slot: 'chant'|'hand' }
    this._layoutKey = null; // `${chantCap}|${max}`：珠数布局签名
    this._sig = null;       // 全量签名（含占用数）：不变则不动材质
  }

  /** 按投影 handCapacity 刷新。hc = { max, chantCap, normalUsed, chantCapUsed, chantOverflowUsed } */
  setValue(hc) {
    if (!hc) return;
    const chantCap = Math.max(0, hc.chantCap ?? 0);
    const max = Math.max(0, hc.max ?? 0);
    const normalUsed = Math.max(0, hc.normalUsed ?? 0);
    const chantCapUsed = Math.max(0, hc.chantCapUsed ?? 0);
    const chantOverflowUsed = Math.max(0, hc.chantOverflowUsed ?? 0);
    const sig = `${chantCap}|${max}|${normalUsed}|${chantCapUsed}|${chantOverflowUsed}`;
    if (sig === this._sig) return;
    this._sig = sig;

    const layoutKey = `${chantCap}|${max}`;
    if (layoutKey !== this._layoutKey) this._rebuild(chantCap, max);

    let ci = 0, hi = 0;
    for (const bead of this._beads) {
      let color;
      if (bead.slot === 'chant') {
        color = ci < chantCapUsed ? COLORS.chantLit : COLORS.chantIdle;
        ci++;
      } else {
        // 手牌珠从左向右填充：先普通占用（绿），再溢出咏唱占用（黄），余者空（灰）
        color = hi < normalUsed ? COLORS.handLit
          : hi < normalUsed + chantOverflowUsed ? COLORS.chantOverflow
            : COLORS.empty;
        hi++;
      }
      bead.mesh.material.color.setHex(color);
    }
  }

  _rebuild(chantCap, max) {
    for (const bead of this._beads) {
      this.remove(bead.mesh);
      bead.mesh.geometry.dispose();
      bead.mesh.material.dispose();
    }
    this._beads = [];
    this._layoutKey = `${chantCap}|${max}`;

    const total = chantCap + max;
    if (total <= 0) return;
    // 行宽 = 组内珠距 + 组间额外间隔；原点 = 行中心
    const width = (total - 1) * BEAD_STEP + (chantCap > 0 && max > 0 ? GROUP_GAP : 0);
    let x = -width / 2;
    for (let i = 0; i < total; i++) {
      const isChant = i < chantCap;
      if (i === chantCap && chantCap > 0 && max > 0) x += GROUP_GAP;
      const mesh = new THREE.Mesh(
        BEAD_GEO,
        new THREE.MeshBasicMaterial({ color: COLORS.empty, transparent: true, opacity: 0.95 }),
      );
      mesh.position.set(x, 0, 0);
      x += BEAD_STEP;
      this.add(mesh);
      this._beads.push({ mesh, slot: isChant ? 'chant' : 'hand' });
    }
  }

  dispose() {
    for (const bead of this._beads) {
      this.remove(bead.mesh);
      bead.mesh.material.dispose();
    }
    this._beads = [];
    this._layoutKey = null;
    this._sig = null;
  }
}
