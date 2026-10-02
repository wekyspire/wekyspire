// CapacityBeadsObject：手牌容量指示条（批次 13，用户定；2026-09-30 改序列驱动）。
// 一排小圆角方片（轮廓呼应卡牌），按投影 handCapacity.slots（core handCapacitySlots
// 唯一事实源）**从左到右排成三段**：
//   [空咏唱容量] + 组间隙 + [手牌序占用] + 组间隙 + [空手牌容量 | 超载红珠]。
// 手牌序段与手牌内卡牌一一对应（相对顺序 = 手牌从左到右）：普通卡 = 绿珠、
// 激活咏唱 = 权重颗蓝珠（容量吃满的溢出颗黄）、迷你卡 = 淡紫细竖线；超载红珠
// **归属将弃卡本尊的序列位**（hover 超载卡即亮它自己的红珠——无主聚合红珠
// 曾致「hover 无高亮」报障）。
// 迷你幻影槽（计 0 容量）：独立的小步进槽（宽度 ≈ 1/3 颗珠，左右空位极少）——
// 「插在两张卡中间的竖线」，不占手牌容量的形态即由此而来。
// hover 联动：指针压着的卡 → 它占用的珠/竖线改 HDR 色（基色 ×5，越过 bloom
// 阈值 1.45 自然曝出光晕）；slot 带 card（uniqueID）直接匹配，非手牌卡不亮。
// 纯展示件：只读投影 setValue / setHover，不挂拾取、不进动画注册表；结构签名
// （类型序列）不变不重建网格，hover 只重涂色。

import * as THREE from 'three';

const BEAD_W = 1.7;        // 方片宽（世界单位）
const BEAD_H = 2.3;        // 方片高（宽高比 ≈ 卡牌 26:35.1 的轮廓回声）
const BEAD_R = 0.5;        // 圆角半径
const BEAD_STEP = 2.15;    // 珠距（间隙 0.45——紧凑排）
const GROUP_GAP = 1.1;     // 三段之间的额外间隔（空咏唱|手牌序|空容量）
const TICK_W = 0.3;        // 竖线宽（首版 0.16 在屏上仅 ~2px 不可见）
const TICK_H = 1.7;        // 竖线高（珠高的 ~0.74，小一号读作「记号」而非「占用」）
const TICK_EDGE = 0.14;    // 竖线与相邻珠的边距（极窄——迷你槽总宽 ≈ 0.58，不足珠宽 1/3）

// 扁平配色（无发光，与 UI 铁律一致）：内容语义色不受「金色=金钱」约束。
// hover 的 HDR 走乘算（×5 过 bloom 阈值），同 rig 灯组的 brighten 口径。
const COLORS = {
  chantLit: 0x6db3ff,   // 咏唱容量·占用（手牌序中的激活咏唱）
  chantIdle: 0x2c3a52,  // 咏唱容量·空（首段）
  handLit: 0x4ad06e,    // 普通卡占用
  chantOverflow: 0xe8c85a, // 溢出容量的激活咏唱占用
  empty: 0x363d4d,      // 手牌位·空（尾段）
  overflow: 0xe85a5a,   // 超载溢出（尾弃预告）
  mini: 0xc7b3f7,       // 迷你幻影槽竖线（淡紫——与卡面点缀色同源）
};
const SLOT_COLOR = {
  chant: COLORS.chantLit,
  chantIdle: COLORS.chantIdle,
  hand: COLORS.handLit,
  chantOverflow: COLORS.chantOverflow,
  empty: COLORS.empty,
  overflow: COLORS.overflow,
  mini: COLORS.mini,
};
// 结构签名用单字符（类型序列相同 = 网格与摆位不变，只补涂色/卡主）
const TYPE_CHAR = { chantIdle: 'c', chant: 'C', chantOverflow: 'Y', hand: 'h', mini: 'm', empty: 'e', overflow: 'r' };
const ZONE_OF = (t) => (t === 'chantIdle' ? 0 : (t === 'empty' || t === 'overflow') ? 2 : 1);

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
const HDR_K = 5;

export class CapacityBeadsObject extends THREE.Group {
  constructor() {
    super();
    this._items = [];      // { mesh, type, card }（card = 手牌卡 uniqueID，填充行无主）
    this._struct = null;   // 类型序列签名（网格/摆位是否重建的判据）
    this._hover = null;    // hover 中的手牌卡 uniqueID
  }

  /** 按投影 handCapacity 刷新（slots 见 core handCapacitySlots）。 */
  setValue(hc) {
    if (!hc || !Array.isArray(hc.slots)) return;   // 旧快照无序列：静默跳过
    const slots = hc.slots;
    const struct = slots.map(s => TYPE_CHAR[s?.type] ?? '?').join('');
    if (struct !== this._struct) {
      this._rebuild(slots);
      this._struct = struct;
      this._layout();
    } else {
      for (let i = 0; i < this._items.length; i++) {
        this._items[i].card = slots[i]?.card ?? null;
        this._items[i].doom = !!slots[i]?.doom;
      }
    }
    this._paint();
  }

  /**
   * hover 联动：指针压着的手牌卡 → 它占用的珠/竖线改 HDR 色（bloom 自然起晕）。
   * 直接传卡 uniqueID（slot 自带 card 主匹配）；不在手牌（查看器画廊等）自然无命中。
   */
  setHover(cardId) {
    if (cardId === this._hover) return;
    this._hover = cardId ?? null;
    this._paint();
  }

  _rebuild(slots) {
    for (const it of this._items) {
      this.remove(it.mesh);
      it.mesh.material.dispose();
    }
    this._items = slots.map(s => {
      const isTick = s?.type === 'mini';
      const mesh = new THREE.Mesh(
        isTick ? TICK_GEO : BEAD_GEO,
        new THREE.MeshBasicMaterial({ color: COLORS.empty, transparent: true, opacity: 0.95 }),
      );
      this.add(mesh);
      return { mesh, type: s?.type ?? 'empty', card: s?.card ?? null, doom: !!s?.doom };
    });
  }

  /**
   * 摆位：单行从左到右排 slot。行进量 = 前件半宽 + 边距 + 后件半宽（**不是**统一
   * 步进——竖线半宽远小于珠，tick 后按固定步进推进会叫下一颗珠的半宽反向吃掉
   * 整条竖线，「珠盖线」实报过）；竖线两侧边距用极窄的 TICK_EDGE（「插在两张卡
   * 中间的细线」形态），跨段（空咏唱|手牌序|尾段）边距加 GROUP_GAP。
   * 行宽取包围盒口径（首末件半宽计入），组自身居中于挂点。
   */
  _layout() {
    const items = this._items;
    if (!items.length) return;
    const halfW = (it) => (it.type === 'mini' ? TICK_W / 2 : BEAD_W / 2);
    const gapBetween = (a, b) => {
      const edge = (a.type === 'mini' || b.type === 'mini') ? TICK_EDGE : BEAD_STEP - BEAD_W;
      return edge + (ZONE_OF(a.type) !== ZONE_OF(b.type) ? GROUP_GAP : 0);
    };
    const advance = (i) => halfW(items[i - 1]) + gapBetween(items[i - 1], items[i]) + halfW(items[i]);
    let width = halfW(items[0]) + halfW(items[items.length - 1]);
    for (let i = 1; i < items.length; i++) width += advance(i);
    let x = -width / 2 + halfW(items[0]);
    items[0].mesh.position.set(x, 0, 0);
    for (let i = 1; i < items.length; i++) {
      x += advance(i);
      items[i].mesh.position.set(x, 0, 0);
    }
  }

  _paint() {
    for (const it of this._items) {
      // doom = 将弃标记（超载红珠归属将弃卡本尊；迷你被尾弃时竖线转红）
      const color = it.doom ? COLORS.overflow : (SLOT_COLOR[it.type] ?? COLORS.empty);
      setColor(it.mesh.material, color, it.card != null && it.card === this._hover);
    }
  }

  dispose() {
    for (const it of this._items) {
      this.remove(it.mesh);
      it.mesh.material.dispose();
    }
    this._items = [];
    this._struct = null;
    this._hover = null;
  }
}
