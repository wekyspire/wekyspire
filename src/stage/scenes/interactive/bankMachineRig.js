// 银行机 rig：比老虎机克制得多（SLOT_MACHINE.md：老虎机很慷慨，银行机很吝啬）——没有
// 拉杆与转轮，反馈走「屏幕 + 指示灯」：
//   · 常驻：机体极轻微呼吸位移（"我能点击"的可交互暗示），**zoom-in 后完全取消**
//     （用户定 2026-09-11：银行机安静但不是死物；近景里那点位移只会显得晃）；
//     屏幕上是**粗体文本 + 不规则闪烁**（CRT 冷光感），指示灯错相位缓慢呼吸
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
  /** 屏幕正文烘焙（宿主可随时改文本，如按快照显示存款额）。 */
  function bakeScreen(text) {
    if (!screenText || typeof document === 'undefined') return;
    // 画布比例 = 屏面比例（1.25:0.72），文字居中；长了自动缩到 ~82% 屏宽内。
    const W = 1024, H = 590;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    let fontPx = H * 0.44;
    ctx.font = `bold ${fontPx}px sans-serif`;
    const tw = ctx.measureText(text).width;
    const maxW = W * 0.82;
    if (tw > maxW) fontPx = Math.max(24, fontPx * (maxW / tw));
    ctx.font = `bold ${fontPx}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(4, fontPx * 0.16);
    ctx.strokeStyle = 'rgba(6, 20, 30, 0.92)';
    ctx.strokeText(text, W / 2, H / 2);
    ctx.fillStyle = '#dff6ff';
    ctx.fillText(text, W / 2, H / 2);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const old = screenText.material.map;
    screenText.material.map = texture;
    screenText.material.needsUpdate = true;
    old?.dispose?.();
  }

  const body = parts?.body ?? object;
  const screen = parts?.screen ?? null;
  const scanline = parts?.scanline ?? null;
  const bulbs = parts?.bulbs ?? [];
  // 资产侧只有 kit 共享材质；屏幕/扫描线/指示灯的逐帧改色由 rig 持独立材质。
  //
  // 屏幕正文走**专用贴片**，不是把字烘在屏幕盒子上（用户 2026-09-13 报"zoom-out 字体
  // z-fighting、zoom-in 完全看不见余额"的成因）：屏幕是 BoxGeometry，同一张贴图会铺满
  // 六个面（侧面把字压成条纹、正反面在远景抢深度），且贴图背景透明而盒子材质不透明时
  // 整屏会被背景吃掉。改为：盒子只当发光底（呼吸/闪烁照旧），文字另挂一张与屏面同比例、
  // `transparent` 的 PlaneGeometry 贴片——项目里烘焙文本的通行做法（顶端栏/按钮同款）。
  let screenText = null;
  if (screen) {
    screen.material = new THREE.MeshBasicMaterial({ color: P.glowCyan });
    screen.material.color.setRGB(0.85, 0.95, 1.0);
    const p = screen.geometry.parameters;   // BoxGeometry 的 { width, height, depth }
    screenText = new THREE.Mesh(
      new THREE.PlaneGeometry(p.width * 0.94, p.height * 0.94),
      new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false }),
    );
    screenText.name = 'screenText';
    // 贴片只贴前表面一点点；depthTest 关掉后不参与深度竞争，扫描线扫过也不会把它切掉
    screenText.position.z = p.depth / 2 + 0.01;
    screenText.renderOrder = 3;
    screen.add(screenText);
    // 冷光由 unlit 材质 + 冷色灯池给；文本本身不发光，只随屏幕一起明灭。
    if (typeof document !== 'undefined') bakeScreen(screen.userData?.screenText ?? '');
  }
  if (scanline) scanline.material = new THREE.MeshBasicMaterial({ color: shade(P.glowCyan, -0.5) });
  for (const b of bulbs) b.material = new THREE.MeshBasicMaterial({ color: shade(P.silver, -0.4) });
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
    // 常驻：极轻微呼吸位移（用户定："我能点击"的可交互暗示——银行机安静但**不是死物**）。
    // zoom-in（focus）后**完全取消**：近景里这点位移只会显得晃，而且此时玩家已经点过了，
    // 不需要再勾引（与老虎机相反：那边是压到 16%，这边直接归零）。
    st.hover += ((st.hoverTarget ?? 0) - st.hover) * Math.min(1, dt * 8);
    st.focus += ((st.focusTarget ?? 0) - st.focus) * Math.min(1, dt * 5);
    const idle = 0.008 * (1 - st.focus);
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
        // **不规则闪烁**（不是平滑呼吸）：几个不同频率叠出"电子屏"的抖，偶尔压暗一下
        const f = 0.9
          + 0.06 * Math.sin(st.t * 11.3 + st.phase)
          + 0.04 * Math.sin(st.t * 27.7)
          + 0.05 * Math.sin(st.t * 3.1 + st.phase * 0.7);
        const blink = Math.sin(st.t * 0.9 + st.phase) > 0.985 ? 0.35 : 1;   // 偶发一次短暗
        const breathe = f * blink + 0.22 * st.hover;
        screen.material.color.copy(screenBase).multiplyScalar(breathe);
      }
      bulbs.forEach((b, i) => {
        const level = 0.3 + 0.4 * (0.5 + 0.5 * Math.sin(st.t * 1.3 + i * 2.1)) + 0.4 * st.hover;
        b.material.color.copy(new THREE.Color(shade(P.silver, -0.15))).multiplyScalar(0.3 + level * 0.6);
      });
    }
  }

  return {
    act,
    update,
    setScreen: bakeScreen,   // 屏幕文本（如「存款 12」）
    setHover: (on) => { st.hoverTarget = on ? 1 : 0; },
    setFocus: (on) => { st.focusTarget = on ? 1 : 0; },
    isBusy: () => !!st.action,
    state: st,
  };
}
