// 银行机 rig：比老虎机克制得多（SLOT_MACHINE.md：老虎机很慷慨，银行机很吝啬）——没有
// 拉杆与转轮，反馈走「屏幕 + 指示灯」：
//   · 常驻：指示灯缓慢呼吸（三灯错相位）、屏幕极轻微亮度浮动
//   · hover：指示灯提亮 + 机体轻微上浮（交互层调用 setHover）
//   · 存/取款：屏幕闪亮 + 扫描线上下扫一次、指示灯快速追逐（存=冷青，取=偏暖金）
//   · 处理中（后端已定结果，动画只是揭示）：可用 hold() 挂起在"闪烁"态直到调用方给结果
// 纯 Stage 层：不读 Core/Bridge。

import * as THREE from 'three';
import { P, shade } from '../kit/index.js';

const TINT = {
  deposit: P.glowCyan,
  withdraw: P.gold,
  overdraft: P.potionRed,   // 超额取款：偏危险的红（后续接恶魔 roll 时用）
};

export function createBankMachineRig({ object, parts, seed = 'bank' }) {
  const body = parts?.body ?? object;
  const screen = parts?.screen ?? null;
  const scanline = parts?.scanline ?? null;
  const bulbs = parts?.bulbs ?? [];
  // 资产侧只有 kit 共享材质；屏幕/扫描线/指示灯的逐帧改色由 rig 持独立材质
  if (screen) screen.material = new THREE.MeshBasicMaterial({ color: P.glowCyan });
  if (scanline) scanline.material = new THREE.MeshBasicMaterial({ color: shade(P.glowCyan, -0.5) });
  for (const b of bulbs) b.material = new THREE.MeshBasicMaterial({ color: shade(P.potionRed, -0.35) });
  const basePos = body.position.clone();
  const baseScale = body.scale.x || 1;
  const scanBaseY = scanline?.position.y ?? 0;
  const screenBase = new THREE.Color(screen?.material.color.getHex() ?? P.glowCyan);

  const st = {
    t: 0,
    phase: Math.random() * 10,
    hover: 0,
    focus: 0,       // 0..1 追光权重（相机怼脸时抑制常驻浮动）
    action: null,   // { kind, t, seconds }
  };

  /** 播放一次存取款反馈。kind: 'deposit' | 'withdraw' | 'overdraft'。 */
  function act(kind = 'deposit', { seconds = 1.1 } = {}) {
    st.action = { kind, t: 0, seconds };
    return true;
  }

  function update(dt) {
    st.t += dt;
    // 常驻：机体极轻微浮动 + 灯呼吸（追光怼脸时再压一档：近景里同样的位移看起来更大）
    st.hover += ((st.hoverTarget ?? 0) - st.hover) * Math.min(1, dt * 8);
    st.focus += ((st.focusTarget ?? 0) - st.focus) * Math.min(1, dt * 5);
    const idle = 0.008 * (1 - 0.6 * st.focus);
    body.position.set(
      basePos.x + Math.sin(st.t * 6.1 + st.phase) * idle,
      basePos.y + Math.abs(Math.sin(st.t * 4.3 + st.phase)) * idle * 0.5,
      basePos.z + Math.cos(st.t * 5.2 + st.phase) * idle * 0.4,
    );
    body.scale.setScalar(baseScale * (1 + 0.02 * st.hover));

    const a = st.action;
    const tint = a ? new THREE.Color(TINT[a.kind] ?? P.glowCyan) : null;
    if (a) {
      a.t += dt;
      const k = Math.max(0, 1 - a.t / a.seconds);
      // 屏幕：闪亮（越靠前越亮）+ 扫描线自上而下扫一次
      const flicker = 0.55 + 0.45 * Math.abs(Math.sin(a.t * 26));
      if (screen) screen.material.color.copy(screenBase).lerp(tint, flicker * k);
      if (scanline) {
        scanline.position.y = scanBaseY + (0.5 - k) * 0.7;
        scanline.material.color.copy(screenBase).lerp(new THREE.Color(P.flameCore), k);
      }
      // 指示灯：快速追逐（存/取同速，颜色区分）
      bulbs.forEach((b, i) => {
        const on = (i + Math.floor(a.t * 14)) % 3 === 0;
        b.material.color.copy(on ? tint : new THREE.Color(shade(P.iron, -0.1)));
      });
      if (a.t >= a.seconds) {
        st.action = null;
        if (screen) screen.material.color.copy(screenBase);
        if (scanline) { scanline.position.y = scanBaseY; scanline.material.color.set(shade(P.glowCyan, -0.5)); }
      }
    } else {
      // 常态：屏幕轻微浮动 + 指示灯错相位呼吸（提亮程度随 hover）
      if (screen) {
        const breathe = 0.86 + 0.14 * Math.sin(st.t * 1.1 + st.phase) + 0.25 * st.hover;
        screen.material.color.copy(screenBase).multiplyScalar(breathe);
      }
      bulbs.forEach((b, i) => {
        const level = 0.3 + 0.4 * (0.5 + 0.5 * Math.sin(st.t * 1.3 + i * 2.1)) + 0.4 * st.hover;
        b.material.color.copy(new THREE.Color(P.potionRed)).multiplyScalar(0.35 + level * 0.65);
      });
    }
  }

  return {
    act,
    update,
    setHover: (on) => { st.hoverTarget = on ? 1 : 0; },
    setFocus: (on) => { st.focusTarget = on ? 1 : 0; },
    isBusy: () => !!st.action,
    state: st,
  };
}
