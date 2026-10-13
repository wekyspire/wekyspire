// 等离子电弧（rageArcs v2，卡达斯签名件，2026-10-09 重做）：真 3D 折线雷。
// v1 的 TSL 壳是画在剪影内的大贴图锯齿，实拍读成「身上一层粉纹」（用户验收判垃圾）。
// 机制：锚点池（双爪/双肩/头顶/胸口/地面）两两拉弧，几何带（ribbon，白热芯+暗红晕
// 双层）在 standee 局部空间生成——随姿态通道压扁/侧倾、z 向前后扰动穿出躯干
// （背后的弧被本体深度正确遮挡 = 绕体感）。雷的「闪」= 每 60~120ms 整条折线重抽
// （形状跳变），不是透明度抖。level = 活弧数/重抽率/亮度同涨；pulse() = 挨打炸亮；
// burst(n, ms) = 剧本点放 n 道齐鸣（起手蓄力/转段拍用）。
import * as THREE from 'three';

const SEG = 18;         // 单弧折线段数（多段小折角才「电」——少段大摆会读成波浪贴纸）
const MAX_BOLTS = 6;    // 弧槽上限

// 锚点池（standee 局部比例坐标：x/y 按体宽/体高、z 按体高 ×0.12 前后）——
// 横向收到 ±0.32：宽幅立绘（kardas 横版）下 ±0.45 的锚点悬在剪影外的空气里；
// z 全部取正（弧贴着身体**前方**走）——z 扰动把弧段送到本体平面后面会被深度裁成
// 碎段（四足兽剪影实测：弧读成几截悬空短线）
const ANCHORS = [
  [-0.32, 0.26, 0.30], [0.32, 0.26, 0.30],   // 双爪
  [-0.26, 0.66, 0.20], [0.26, 0.66, 0.20],   // 双肩
  [0.00, 0.90, 0.15],                        // 头顶
  [-0.24, 0.06, 0.38], [0.24, 0.06, 0.38],   // 地面（电弧入地）
  [0.00, 0.46, 0.45],                        // 胸口
];

function pickPair() {
  // 偏好近邻锚点：跨全身的长弧在宽幅立绘上读成一条平滑斜带（熔岩裂纹感），
  // 短弧+多道才读「电」。超长重抽（最多 4 次）。
  for (let tries = 0; tries < 4; tries++) {
    const i = Math.floor(Math.random() * ANCHORS.length);
    let j = Math.floor(Math.random() * (ANCHORS.length - 1));
    if (j >= i) j++;
    const a = ANCHORS[i], b = ANCHORS[j];
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (d < 0.55 || tries === 3) return [a, b];
  }
}

function makeRibbonGeo() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEG + 1) * 2 * 3), 3));
  const idx = [];
  for (let i = 0; i < SEG; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  geo.setIndex(idx);
  return geo;
}

// 折线重抽：两锚点间拉弧，中点抖动按 sin(πt) 包络（端点锚定）；带向 = 段方向在
// xy 面的垂直向（billboard 已 yaw 对相机，局部 z ≈ 视线方向）；宽度纺锤包络。
function strike(coreGeo, haloGeo, W, H) {
  const [a, b] = pickPair();
  const p0 = [a[0] * W, a[1] * H, a[2] * H * 0.12];
  const p1 = [b[0] * W, b[1] * H, b[2] * H * 0.12];
  const span = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
  const pts = [];
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG;
    const env = Math.pow(Math.sin(Math.PI * t), 0.8); // 端点锚定
    // 抖动按弧长比例（不是体高）：长弧也要有看得见的折角，否则读成平滑斜带。
    // 双八度：大弯（低频）+ 碎折（高频小幅度）——单层大摆会读成平滑波浪
    const big = (Math.random() - 0.5) * 2 * env * span * 0.085;
    const big2 = (Math.random() - 0.5) * 2 * env * span * 0.085;
    const kink = (Math.random() - 0.5) * 2 * env * span * 0.034;
    const kink2 = (Math.random() - 0.5) * 2 * env * span * 0.034;
    pts.push([
      p0[0] + (p1[0] - p0[0]) * t + big + kink,
      p0[1] + (p1[1] - p0[1]) * t + big2 + kink2,
      p0[2] + (p1[2] - p0[2]) * t + (Math.random() - 0.5) * env * H * 0.05,
    ]);
  }
  const core = coreGeo.attributes.position.array;
  const halo = haloGeo.attributes.position.array;
  for (let i = 0; i <= SEG; i++) {
    const [x, y, z] = pts[i];
    const nx = pts[Math.min(SEG, i + 1)][0] - pts[Math.max(0, i - 1)][0];
    const ny = pts[Math.min(SEG, i + 1)][1] - pts[Math.max(0, i - 1)][1];
    const dl = Math.hypot(nx, ny) || 1;
    const sx = ny / dl, sy = -nx / dl;
    const env = Math.pow(Math.sin(Math.PI * (i / SEG)), 0.8);
    // 远场口径：Boss 在 z≈-56（≈4px/wu）——芯宽 ~0.44wu（≈1.8px）保锋利，晕托体量
    const w = H * 0.02 * (0.3 + 0.7 * env); // 芯宽：中段最粗
    const hw = w * 1.9;                     // 晕宽（收窄：晕太宽会盖掉白芯读成橙色光带）
    const o = i * 6;
    core[o] = x - sx * w; core[o + 1] = y - sy * w; core[o + 2] = z;
    core[o + 3] = x + sx * w; core[o + 4] = y + sy * w; core[o + 5] = z;
    halo[o] = x - sx * hw; halo[o + 1] = y - sy * hw; halo[o + 2] = z - 0.02;
    halo[o + 3] = x + sx * hw; halo[o + 4] = y + sy * hw; halo[o + 5] = z - 0.02;
  }
  coreGeo.attributes.position.needsUpdate = true;
  haloGeo.attributes.position.needsUpdate = true;
}

/**
 * 在宿主单位上建等离子电弧（几何折线雷，挂 _standee 随姿态）。
 * @returns 句柄 { group, setLevel, levelNow, pulse, burst, dispose } | null（headless）
 */
export function makeRageArcs(layer) {
  if (typeof document === 'undefined') return null;
  const unit = layer.unit;
  const group = new THREE.Group();
  group.name = 'rageBolts';
  const bolts = [];
  for (let i = 0; i < MAX_BOLTS; i++) {
    const coreGeo = makeRibbonGeo();
    const haloGeo = makeRibbonGeo();
    const haloMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.5, 0.5, 0.35), transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    const coreMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(2.8, 2.1, 1.6), transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    const core = new THREE.Mesh(coreGeo, coreMat);
    halo.renderOrder = 1;   // 压过本体（默认 0）
    core.renderOrder = 2;
    halo.name = 'rageBoltHalo'; core.name = 'rageBoltCore';
    group.add(halo, core);
    bolts.push({ coreGeo, haloGeo, coreMat, haloMat, next: Math.random() * 0.12, flash: 0.8 });
  }
  unit._standee.add(group);
  const st = { cur: 0, target: 0, pulse: 0, burstN: 0, burstT: 0 };
  const untick = unit.addTick((dt) => {
    const k = 1 - Math.exp(-dt * 5.5); // level 指数缓动逼近（同壳件口径，director 直推不闪跳）
    st.cur += (st.target - st.cur) * k;
    if (Math.abs(st.target - st.cur) < 0.004) st.cur = st.target;
    st.pulse = Math.max(0, st.pulse - dt * 3.2);
    st.burstT = Math.max(0, st.burstT - dt);
    const lv = st.cur;
    group.visible = (lv > 0.02 || st.burstT > 0) && !unit._dead;
    if (!group.visible) return;
    const H = unit._standeeHeight ?? 22;
    const W = unit._body?.geometry?.parameters?.width ?? H * 0.62;
    const active = Math.min(MAX_BOLTS, Math.max(
      Math.round(lv * MAX_BOLTS), st.burstT > 0 ? st.burstN : 0));
    const bright = (0.7 + lv * 0.6) * (1 + st.pulse * 1.6) * (st.burstT > 0 ? 1.3 : 1);
    const regenS = Math.max(0.045, 0.12 - lv * 0.07) * (st.burstT > 0 ? 0.6 : 1);
    for (let i = 0; i < MAX_BOLTS; i++) {
      const b = bolts[i];
      const on = i < active;
      b.next -= dt;
      if (on && b.next <= 0) {
        strike(b.coreGeo, b.haloGeo, W, H);
        b.next = regenS * (0.7 + Math.random() * 0.6);
        b.flash = 0.75 + Math.random() * 0.45; // 本次形状的亮度签（同帧各弧不齐亮）
      }
      const op = on ? bright * b.flash : 0;
      b.coreMat.opacity = Math.min(1, op);
      b.haloMat.opacity = Math.min(0.4, op * 0.42);
    }
  });
  return {
    group,
    setLevel(l) { st.target = Math.max(0, Math.min(1, l)); },
    levelNow() { return st.cur; },
    /** 挨打炸亮（幅值 0..1.4，多次调用取 max 不叠加爆闪）。 */
    pulse(k = 1) { st.pulse = Math.min(1.4, Math.max(st.pulse, k)); },
    /** 剧本点放：n 道全体即刻重抽齐鸣 ms 毫秒（起手蓄力/转段拍用）。 */
    burst(n = 3, ms = 200) {
      st.burstN = Math.max(st.burstN, n);
      st.burstT = Math.max(st.burstT, ms / 1000);
      for (const b of bolts) b.next = 0;
    },
    dispose() {
      untick();
      group.parent?.remove(group);
      for (const b of bolts) {
        b.coreGeo.dispose(); b.haloGeo.dispose();
        b.coreMat.dispose(); b.haloMat.dispose();
      }
    },
  };
}
