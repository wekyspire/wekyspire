// 售货机 rig（用户定 2026-09-12：把售货机放进场景后继续优化）——把 `props/vendingMachine.js`
// 的可动件驱动起来。反馈分层（沿用老虎机/银行机的原则）：
//   · 常驻：灯牌（marquee）缓慢呼吸 + 显示条微闪（读作"通着电的柜子"）
//   · hover：灯牌提亮（由交互层调用 setHover）
//   · **买到货**：柜门荡开 → 货位上的那件掉向出货口 → 出货翻板弹一下 → 柜门合上 → 灯牌爆闪
//     （演出由"快照里那件变成 sold"触发，见 setStock——购买只发生在面板里，场景侧只负责演）
//   · 库存：四格按货品种类换色；卖空/空位 → 该格缩到不可见
// 纯 Stage 层：不读 Core/Bridge，输入只有"库存与买入结果"（调用方从快照拿）。

import * as THREE from 'three';
import { P, shade } from '../kit/index.js';
import { bakeBoldText } from '../../objects/textBakers.js';

// 货品种类 → 货位颜色（与 shop.js 的 kind 口径一致：potion/apple/relic/pack）
const KIND_TINT = {
  potion: () => P.potionRed,
  apple: () => P.potionGreen,
  relic: () => P.potionBlue,
  pack: () => P.gold,
};
const tintOfKind = (kind) => (KIND_TINT[kind] ?? (() => shade(P.wax, -0.1)))();

const DOOR_OPEN = 0.3;      // 柜门荡开/合上时长（秒）
const DROP_T = 0.42;        // 货物落下时长
const SEQ_HOLD = 0.35;      // 掉落到翻板弹起之间的停顿

export function createVendingMachineRig({ object, parts, seed = 'vending' }) {
  const body = parts?.body ?? object;
  const door = parts?.doorPivot ?? null;
  const slots = parts?.slots ?? [];
  const flap = parts?.flap ?? null;
  const marquee = parts?.marquee ?? null;
  const display = parts?.display ?? null;

  // 逐帧改色的件由 rig 持独立材质（资产禁自建材质是契约）
  for (const s of slots) {
    s.mesh.material = new THREE.MeshBasicMaterial({ color: tintOfKind(null) });
    s.mesh.userData.__baseY = s.mesh.position.y;
  }
  if (marquee) marquee.material = new THREE.MeshBasicMaterial({ color: shade(P.wax, 0.35) });
  if (display) display.material = new THREE.MeshBasicMaterial({ color: shade(P.wax, 0.2) });
  const flapBaseZ = flap?.position.z ?? 0;
  const marqueeBase = marquee ? new THREE.Color(shade(P.wax, 0.35)) : null;

  const st = {
    t: 0,
    phase: Math.random() * 10,
    hover: 0,
    focus: 0,
    stock: [],        // 上一次的库存（{ index, kind, sold }）——用于检测"刚卖掉" 
    seq: null,        // 出货演出时序 { steps, i, t }
    flash: 0,         // 灯牌爆闪衰减
    displayText: '',
  };

  // ---- 显示条：烘字（余额），与银行机同一套（bakeBoldText 小字号 + 描边） ----
  function bakeDisplay(text) {
    if (!display || typeof document === 'undefined') return;
    const out = bakeBoldText(text || '', { fontPx: 26, tint: '#f4f8ff', stroke: 'rgba(6,10,16,0.85)' });
    display.material.map?.dispose?.();
    display.material.map = out.texture;
    display.material.needsUpdate = true;
  }
  /** 显示条文本（宿主给，如"余额 30"）。 */
  function setDisplay(text) {
    if (text === st.displayText) return false;
    st.displayText = text ?? '';
    bakeDisplay(st.displayText);
    return true;
  }

  /** 库存下行：`items = [{ index, kind, sold }]`（panelSnapshot 的 snap.shop.items）。
   *  **检测刚卖掉的格子并播出货演出**——购买只发生在面板里，场景侧只负责演。 */
  function setStock(items = []) {
    const prev = new Map(st.stock.map(it => [it.index, it]));
    for (const s of slots) {
      const it = items.find(x => x.index === s.index);
      const visible = !!it && !it.sold;
      if (it) s.mesh.material.color.set(tintOfKind(it.kind));
      // 刚卖掉 → 演出（演出期间网格由动画接管，见 _playDispense）
      const was = prev.get(s.index);
      if (was && !was.sold && it && it.sold) _playDispense(s);
      else if (!st.seq) _applySlotVisible(s, visible);
    }
    st.stock = items.map(it => ({ index: it.index, kind: it.kind, sold: !!it.sold }));
    return true;
  }

  function _applySlotVisible(s, visible) {
    s.mesh.visible = visible;
    s.mesh.scale.setScalar(visible ? 1 : 0.001);
    s.mesh.position.y = s.mesh.userData.__baseY;
  }

  // ---- 出货演出：门开 → 货掉落 → 翻板弹 → 门合 → 灯牌爆闪 ----
  function _playDispense(s) {
    const y0 = s.mesh.userData.__baseY;
    const yEnd = y0 - 2.1;                       // 掉到出货口一带
    st.seq = {
      i: 0, t: 0,
      steps: [
        { dur: DOOR_OPEN, fn: (k) => { if (door) door.rotation.y = -0.95 * k; } },
        { dur: DROP_T, fn: (k) => {
          s.mesh.visible = true;
          s.mesh.position.y = y0 + (yEnd - y0) * k;
          s.mesh.scale.setScalar(1 - 0.55 * k);
        } },
        { dur: 0.18, fn: () => { if (flap) flap.position.z = flapBaseZ + 0.22; st.flash = 1; } },
        { dur: 0.22, fn: (k) => { if (flap) flap.position.z = flapBaseZ + 0.22 * (1 - k); } },
        { dur: DOOR_OPEN, fn: (k) => { if (door) door.rotation.y = -0.95 * (1 - k); } },
        { dur: 0.1, fn: () => { _applySlotVisible(s, false); } },   // 落定后该格收掉
      ],
    };
  }

  function stepSeq(dt) {
    const q = st.seq;
    if (!q) return;
    q.t += dt;
    const step = q.steps[q.i];
    const k = step.dur > 0 ? Math.min(1, q.t / step.dur) : 1;
    step.fn(k);
    if (q.t >= step.dur) { q.i += 1; q.t = 0; if (q.i >= q.steps.length) st.seq = null; }
  }

  function update(dt) {
    st.t += dt;
    stepSeq(dt);
    st.hover += ((st.hoverTarget ?? 0) - st.hover) * Math.min(1, dt * 8);
    st.focus += ((st.focusTarget ?? 0) - st.focus) * Math.min(1, dt * 5);
    st.flash = Math.max(0, st.flash - dt * 2.6);

    // 灯牌：缓慢呼吸 + hover 提亮 + 出货爆闪（乘算保色相，同老虎机彩灯的口径）
    if (marquee) {
      const breathe = 1 + 0.12 * Math.sin(st.t * 1.5 + st.phase);
      const k = breathe * (1 + 0.25 * st.hover) + st.flash * 5;
      marquee.material.color.copy(marqueeBase).multiplyScalar(k);
    }
    // 显示条：微闪（通电感；出货时压一档亮度让灯牌抢眼）
    if (display) {
      const flick = 0.96 + 0.04 * Math.sin(st.t * 9.1 + st.phase);
      display.material.color.copy(new THREE.Color(shade(P.wax, 0.2)))
        .multiplyScalar(flick * (1 - 0.35 * st.flash));
    }
    // 货位：轻微呼吸（读作"柜里亮着、货在等你"）——不做出货演出时不干扰位置
    if (!st.seq) {
      for (const s of slots) {
        if (!s.mesh.visible) continue;
        const k = 1 + 0.02 * Math.sin(st.t * 2.2 + s.index);
        s.mesh.scale.setScalar(k);
      }
    }
  }

  return {
    update,
    setStock,
    setDisplay,
    setHover: (on) => { st.hoverTarget = on ? 1 : 0; },
    /** 追光（相机怼脸）开关：与其它机器同义（此处只影响灯牌呼吸幅度）。 */
    setFocus: (on) => { st.focusTarget = on ? 1 : 0; },
    /** 正忙（出货演出中）：宿主据此可暂缓其它演出。 */
    isBusy: () => !!st.seq,
    state: st,
  };
}
