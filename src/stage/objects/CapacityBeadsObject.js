// CapacityBeadsObject：手牌容量指示条（批次 13，用户定 ；改版）。
// 手牌扇上方一排小圆角方片（轮廓呼应卡牌，比旧圆珠更小更紧凑），与 headless 文本/
// 投影 handCapacity 同口径：
//   最左 chantCap 颗 = 咏唱容量珠（蓝系）：激活咏唱的权重（共鸣石折扣后）先占它——点亮=占用，暗=空。
//   其余 max 颗 = 手牌珠：绿 = 普通卡占用，黄 = 溢出容量的激活咏唱占用，灰 = 空。
//   超载时（占用合计 > max）末尾追加红珠 = 溢出张数（尾弃预告）。
// 迷你幻影槽：迷你卡计 0 容量——在它「本应占用」的槽位（普通占用
//   之后）的相邻两珠之间画一条淡紫小竖线，多张迷你多条竖线（所在间隙局部加宽容线）。
// hover 联动：指针压着的卡 → 它占用的珠/竖线改 HDR 色（基色 ×5，
//   越过 bloom 阈值 1.45 自然曝出光晕）；迷你卡高亮自己的竖线。
// 纯展示件：只读投影 setValue / setHover，不挂拾取、不进动画注册表；件数签名不变不重建网格。

import * as THREE from 'three';

const BEAD_W = 1.7;        // 方片宽（世界单位）
const BEAD_H = 2.3;        // 方片高（宽高比 ≈ 卡牌 26:35.1 的轮廓回声）
const BEAD_R = 0.5;        // 圆角半径
const BEAD_STEP = 2.15;    // 组内珠距（间隙 0.45——紧凑排）
const GROUP_GAP = 1.1;     // 咏唱组与手牌组之间的额外间隔
const TICK_GAP = 1.5;      // 幻影槽所在间隙的加宽后宽度（容下竖线）
const TICK_W = 0.32;       // 竖线宽（首版 0.16 在屏上仅 ~2px，验收不可见——加宽）
const TICK_H = 1.7;        // 竖线高（珠高的 ~0.74，小一号读作「记号」而非「占用」）

// 扁平配色（无发光，与 UI 铁律一致）：内容语义色不受「金色=金钱」约束。
// hover 的 HDR 走乘算（×5 过 bloom 阈值），同 rig 灯组的 brighten 口径。
const COLORS = {
  chantLit: 0x6db3ff,   // 咏唱容量·占用
  chantIdle: 0x2c3a52,  // 咏唱容量·空
  handLit: 0x4ad06e,    // 普通卡占用
  chantOverflow: 0xe8c85a, // 溢出容量的激活咏唱占用
  empty: 0x363d4d,      // 手牌位·空
  overflow: 0xe85a5a,   // 超载溢出（尾弃预告）
  mini: 0xc7b3f7,       // 迷你幻影槽竖线（淡紫——与卡面点缀色同源）
};
const HDR_K = 5;

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
const TICK_GEO = new THREE.PlaneGeometry(TICK_W, TICK_H);

const setColor = (mat, hex, hdr = false) => {
  if (!hdr) { mat.color.setHex(hex); return; }
  const c = new THREE.Color(hex).multiplyScalar(HDR_K);
  mat.color.copy(c);
};

export class CapacityBeadsObject extends THREE.Group {
  constructor() {
    super();
    this._beads = [];       // { mesh, slot: 'chant'|'hand'|'overflow' }
    this._ticks = [];       // { mesh }（迷你幻影槽竖线）
    this._layoutKey = null; // 珠数布局签名
    this._sig = null;       // 全量签名（含占用数）
    this._hc = null;        // 最近一次 setValue 的 hc（setHover 重画用）
    this._hover = null;     // hover 足迹 { kind:'hand'|'chant'|'mini', index, count? }
  }

  /** 按投影 handCapacity 刷新。hc = { max, chantCap, normalUsed, chantCapUsed, chantOverflowUsed, miniUsed } */
  setValue(hc) {
    if (!hc) return;
    this._hc = hc;
    const chantCap = Math.max(0, hc.chantCap ?? 0);
    const max = Math.max(0, hc.max ?? 0);
    const normalUsed = Math.max(0, hc.normalUsed ?? 0);
    const chantCapUsed = Math.max(0, hc.chantCapUsed ?? 0);
    const chantOverflowUsed = Math.max(0, hc.chantOverflowUsed ?? 0);
    const miniUsed = Math.max(0, hc.miniUsed ?? 0);
    // 超载：占用合计超出手牌容量的部分以红珠追加在末尾（此刻结束回合会被尾弃的张数）
    const overflow = Math.max(0, normalUsed + chantOverflowUsed - max);
    const sig = `${chantCap}|${max}|${normalUsed}|${chantCapUsed}|${chantOverflowUsed}|${miniUsed}`;
    if (sig === this._sig) return;
    this._sig = sig;

    const layoutKey = `${chantCap}|${max}|${overflow}|${miniUsed}`;
    if (layoutKey !== this._layoutKey) this._rebuild(chantCap, max, overflow, miniUsed);
    this._layout(normalUsed, miniUsed, chantCap, max);
    this._paint(normalUsed, chantCapUsed, chantOverflowUsed);
  }

  /**
   * hover 联动：指针压着的卡 → 它占用的珠改 HDR 色（bloom 自然起晕）。
   * fp = { kind: 'hand'|'mini', index } | { kind: 'chant', from, count } | null。
   * 咏唱按权重占多颗：from 起连续 count 颗（容量内蓝、溢出黄，由 _paint 分段）。
   */
  setHover(fp) {
    if (fp === this._hover
      || (fp && this._hover && fp.kind === this._hover.kind && fp.index === this._hover.index
        && (fp.count ?? 1) === (this._hover.count ?? 1))) return;
    this._hover = fp ?? null;
    if (!this._hc) return;
    this._paint(Math.max(0, this._hc.normalUsed ?? 0),
      Math.max(0, this._hc.chantCapUsed ?? 0),
      Math.max(0, this._hc.chantOverflowUsed ?? 0));
  }

  _rebuild(chantCap, max, overflow, miniUsed) {
    for (const bead of this._beads) {
      this.remove(bead.mesh);
      bead.mesh.material.dispose();
    }
    for (const t of this._ticks) {
      this.remove(t.mesh);
      t.mesh.material.dispose();
    }
    this._beads = [];
    this._ticks = [];
    this._layoutKey = `${chantCap}|${max}|${overflow}|${miniUsed}`;

    const total = chantCap + max + overflow;
    for (let i = 0; i < total; i++) {
      const isChant = i < chantCap;
      const isOverflow = i >= chantCap + max;
      const mesh = new THREE.Mesh(
        BEAD_GEO,
        new THREE.MeshBasicMaterial({ color: COLORS.empty, transparent: true, opacity: 0.95 }),
      );
      this.add(mesh);
      this._beads.push({ mesh, slot: isChant ? 'chant' : (isOverflow ? 'overflow' : 'hand') });
    }
    for (let j = 0; j < miniUsed; j++) {
      const mesh = new THREE.Mesh(
        TICK_GEO,
        new THREE.MeshBasicMaterial({ color: COLORS.mini }),
      );
      this.add(mesh);
      this._ticks.push({ mesh });
    }
  }

  /**
   * 摆位（占用数变化时重排，不重建网格）。行 = [咏唱组 chantCap 颗] + 组间隙 +
   * [手牌组]；幻影槽竖线 j 嵌在「第 normalUsed+j 颗手牌珠之前」的间隙里，该间隙
   * 加宽到 TICK_GAP 容线（相邻两珠被挤开）；normalUsed=0 时首线嵌在组间隙处。
   */
  _layout(normalUsed, miniUsed, chantCap, max) {
    if (!this._beads.length) return;
    const handBeads = this._beads.filter(b => b.slot !== 'chant');
    const handCount = handBeads.length;
    const widen = (idx) => idx >= normalUsed + 1 && idx <= normalUsed + miniUsed;  // 该珠前间隙是幻影槽
    const gapBefore = (idx) => {
      if (idx <= 0) return chantCap > 0 ? (widen(0) ? TICK_GAP : GROUP_GAP) : 0;
      return widen(idx) ? TICK_GAP : BEAD_STEP;
    };
    // 能嵌进珠间间隙的幻影线数（间隙属第 normalUsed+1..normalUsed+miniUsed 颗珠之前，
    // 需该珠存在）；其余（手满 + 迷你，幻影槽已越过末珠）作**行尾追加段**排开——
    // 与超载红珠的追加语义同构。首版曾把它们塞进末珠右侧窄缝，第二条与空珠同位叠没
    // （视觉验收实报）。
    const inlineTicks = Math.max(0, Math.min(miniUsed, handCount - 1 - normalUsed));
    const tailTicks = this._ticks.length - inlineTicks;
    const TAIL = { lead: 0.9, step: 0.8 };
    let width = chantCap > 0 ? chantCap * BEAD_STEP : 0;
    for (let i = 0; i < handCount; i++) width += BEAD_STEP + gapBefore(i);
    width -= BEAD_STEP;   // 末珠只占间隙不占尾距（行宽 = 首末珠中心距）
    if (tailTicks > 0) width += TAIL.lead + (tailTicks - 1) * TAIL.step + TICK_W;
    let x = -width / 2;
    for (let i = 0; i < chantCap; i++) {
      this._beads[i].mesh.position.set(x, 0, 0);
      x += BEAD_STEP;
    }
    let tickJ = 0;
    for (let hIdx = 0; hIdx < handCount; hIdx++) {
      const gap = gapBefore(hIdx);
      x += gap;
      handBeads[hIdx].mesh.position.set(x, 0, 0);
      if (widen(hIdx) && tickJ < inlineTicks) {
        this._ticks[tickJ++].mesh.position.set(x - gap / 2, 0, 0);
      }
      x += BEAD_STEP;
    }
    // 行尾追加段：末珠右侧起，与珠带留出 lead 间距、线间 step 排开
    for (let j = 0; tickJ < this._ticks.length; tickJ++, j++) {
      this._ticks[tickJ].mesh.position.set(x + TAIL.lead + j * TAIL.step, 0, 0);
    }
  }

  _paint(normalUsed, chantCapUsed, chantOverflowUsed) {
    const hov = this._hover;
    let ci = 0, hi = 0;
    for (const bead of this._beads) {
      let color, hdr = false;
      if (bead.slot === 'chant') {
        color = ci < chantCapUsed ? COLORS.chantLit : COLORS.chantIdle;
        hdr = hov?.kind === 'chant' && ci >= hov.from && ci < hov.from + (hov.count ?? 1);
        ci++;
      } else if (bead.slot === 'overflow') {
        color = COLORS.overflow;
        hdr = hov?.kind === 'chant' && ci >= hov.from && ci < hov.from + (hov.count ?? 1);
        ci++;   // 溢出咏唱珠与容量珠同属咏唱占用段（连续编号）
      } else {
        // 手牌珠从左向右填充：先普通占用（绿），再溢出咏唱占用（黄），余者空（灰）
        color = hi < normalUsed ? COLORS.handLit
          : hi < normalUsed + chantOverflowUsed ? COLORS.chantOverflow
            : COLORS.empty;
        hdr = hov?.kind === 'hand' && hi === hov.index;
        hi++;
      }
      setColor(bead.mesh.material, color, hdr);
    }
    this._ticks.forEach((t, j) => setColor(t.mesh.material, COLORS.mini, hov?.kind === 'mini' && j === hov.index));
  }

  dispose() {
    for (const bead of this._beads) {
      this.remove(bead.mesh);
      bead.mesh.material.dispose();
    }
    for (const t of this._ticks) {
      this.remove(t.mesh);
      t.mesh.material.dispose();
    }
    this._beads = [];
    this._ticks = [];
    this._layoutKey = null;
    this._sig = null;
    this._hc = null;
    this._hover = null;
  }
}
