// LayoutEngine：牌桌布局计算（§4.4）。
// 手牌 = 扇形排布：卡沿圆弧做弧长参数化摆放（圆心在手牌下方、切线朝向），
// 允许相互重叠、下缘允许越出屏幕底线（uiCamera 视野 y ∈ [-65, 35]），
// 悬浮/瞄准牌提拉出完整牌面并向两侧三环挤开邻牌。
// 设计动机：手牌上限 10 张，水平硬约束在 [minX, maxX] 避开左下状态栏面板
// 与右侧牌库图标；卡面保持原尺寸不缩小，重叠度随张数自适应收紧。
//
// 坐标系（StageManager 约定）：z=0 平面屏幕高 ≈ 100 世界单位，y 向上。
//
// 寻址契约不变：对外仍是 updateAnchors(containerKey, Map<uniqueID,{x,y,scale,rotation,z}>)；
// StageAnimator 通过 getAnchor(uniqueID) 查询静息锚点，不关心锚点由谁算出。

const DEFAULT_GAP = 1.5; // 纵列布局（咏唱槽等）默认间隙

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// 扇形手牌交互机制常量（与场景无关的纯力学参数）
export const HAND_FAN_MECHANICS = Object.freeze({
  push: 12,              // 悬浮牌对紧邻间隙的撑开量（≈45% 卡宽，随卡面放大同步调整）
  pushRings: [1, .45, .2], // 撑开量按环距衰减（d=0 紧邻 / 1 / 2）
  liftScale: 1.22,       // 悬浮牌放大
  liftRotDamp: 0.3,      // 悬浮牌残余倾角系数（趋直，保留一点扇感）
  liftZBoost: 20,        // 悬浮牌 z 抬升量：压过全场手牌层（低于箭头 45 / viewer 80）
});

export class LayoutEngine {
  constructor() {
    // containerKey -> 配置（layoutHand 用 minX/maxX/baseY/minStep/maxStep/radius/liftY；
    // layoutColumn 用 centerX/topY/cardHeight/gap/zBase）
    this._containers = new Map();
    // uniqueID -> { x, y, scale, rotation, z, containerKey }
    this._anchors = new Map();
    // 场景级命名锚点（center / deck / restDeck ...）
    this._namedAnchors = new Map();
  }

  registerContainer(key, config) {
    this._containers.set(key, { ...config });
  }

  unregisterContainer(key) {
    this._containers.delete(key);
    for (const [id, a] of this._anchors) {
      if (a.containerKey === key) this._anchors.delete(id);
    }
  }

  setNamedAnchor(name, point) { this._namedAnchors.set(name, point); }
  getNamedAnchor(name) { return this._namedAnchors.get(name) || null; }

  getAnchor(uniqueID) { return this._anchors.get(uniqueID) || null; }

  /** 契约接口：外部直接给锚点表（§4.4 签名保留）。 */
  updateAnchors(containerKey, anchorsMap) {
    for (const [id, a] of this._anchors) {
      if (a.containerKey === containerKey) this._anchors.delete(id);
    }
    for (const [id, anchor] of anchorsMap) {
      this._anchors.set(id, { rotation: 0, scale: 1, ...anchor, containerKey });
    }
  }

  /**
   * 手牌扇形布局：给一串 uniqueID 计算圆弧锚点并登记。
   *
   * 几何：卡牌中心沿圆弧排布，圆心在 (centerX, baseY - R)；弧长坐标 l∈[-L/2, L/2]
   * 映射为圆心角 θ = l / R，位置 = 圆心 + R·(sinθ, cosθ)，卡旋转取切线方向 -θ
   * （左倾为正）。边缘卡随 |θ| 下垂并外倾——重叠+下垂+外倾三者共同压缩空间。
   *
   * 曲率两段控制：radius 是最平基线；总弧角超过 arcDegMin（≤arcGrowFrom 张的平台值，
   * 近乎放平）→ arcDegFull（10 张）的增长曲线时改用更大的等效半径 R 压平扇形
   * （调"弧度"就动这三个度数/张数 + radius 基线）。
   *
   * @param {string} containerKey  容器需含 minX/maxX/baseY/minStep/maxStep/radius/liftY/arcDeg*
   * @param {Array<string>} ids  手牌 uniqueID（从左到右）
   * @param {string|null} hoveredId  悬浮/瞄准牌 uniqueID（提拉 + 撑开两侧）
   * @returns {Map<string, {x,y,scale,rotation,z}>} 本次锚点表（同时已登记入内部）
   */
  layoutHand(containerKey, ids, hoveredId = null) {
    const c = this._containers.get(containerKey);
    if (!c) throw new Error(`LayoutEngine: container '${containerKey}' not registered`);
    const n = ids.length;
    const result = new Map();
    if (n === 0) {
      this.updateAnchors(containerKey, result);
      return result;
    }
    const M = HAND_FAN_MECHANICS;

    const cx = c.centerX ?? (c.minX + c.maxX) / 2;
    const span = c.maxX - c.minX;

    // 步长自适应：≤5 张全松 → 10 张全紧线性过渡；护栏防超容越界
    // （极限角对应的可用弧长上限，40 张等病态输入也压不出区间）
    const tightness = clamp((n - 5) / 5, 0, 1);
    const targetStep = c.maxStep + (c.minStep - c.maxStep) * tightness;
    const arcCapacity = n > 1 ? 2 * c.radius * Math.asin(clamp(span / 2 / c.radius, 0, 1)) : Infinity;
    const step = Math.min(targetStep, arcCapacity / (n - 1));

    // 相邻步长注入悬浮撑开量：紧邻全额，向外两环衰减
    const i0 = hoveredId != null ? ids.indexOf(hoveredId) : -1;
    const steps = new Array(n - 1).fill(step);
    if (i0 >= 0 && n > 1) {
      for (let d = 0; d < M.pushRings.length; d++) {
        const inc = M.push * M.pushRings[d];
        for (const p of [i0 - 1 - d, i0 + d]) {
          if (p >= 0 && p < steps.length) steps[p] += inc;
        }
      }
    }

    // 弧长坐标（中心链式累积：首卡 -L/2、末卡 +L/2，天然绕扇心对称）
    // → 圆心角（总弧角超过上限即用更大等效半径压平：R = max(radius, L/Θcap)）
    // → 弧上位置（单牌时 pos=0 正落于扇心）
    const L = steps.reduce((a, b) => a + b, 0);
    // 总弧角随张数增长：≤arcGrowFrom 张维持 arcDegMin 平台（极平），此后线性增至 arcDegFull
    const arcGrowT = clamp((n - c.arcGrowFrom) / (10 - c.arcGrowFrom), 0, 1);
    const arcDegCap = c.arcDegMin + (c.arcDegFull - c.arcDegMin) * arcGrowT;
    const radiusEff = Math.max(c.radius, L / ((arcDegCap * Math.PI) / 180));
    const thetaCap = Math.asin(clamp(span / 2 / radiusEff, 0, 1));
    let acc = -L / 2;
    for (let i = 0; i < n; i++) {
      const theta = clamp(acc / radiusEff, -thetaCap, thetaCap);
      acc += i < steps.length ? steps[i] : 0;
      result.set(ids[i], {
        x: cx + radiusEff * Math.sin(theta),
        y: c.baseY - radiusEff * (1 - Math.cos(theta)), // 边缘下垂（出屏方向的免费纵深）
        scale: 1,
        rotation: -theta, // 切线朝向：右倾为负（three.js z 轴正旋 = 逆时针）
        z: 10 + i * 0.5,
      });
    }

    // 悬浮/瞄准牌提拉：整牌入屏的绝对高度（不随静息位浮动），微残余倾角保扇感
    if (i0 >= 0) {
      const a = result.get(ids[i0]);
      a.y = c.liftY;
      a.scale = M.liftScale;
      a.rotation *= M.liftRotDamp;
      a.z = 10 + n * 0.5 + M.liftZBoost;
    }

    this.updateAnchors(containerKey, result);
    return result;
  }

  /**
   * 纵列布局：从 topY 向下等距排（咏唱槽等固定侧栏）。
   * z 用独立低区间（zBase，默认 4 + i*0.5 < 手牌 10+），不与手牌争层级。
   * 容器配置：{ centerX, topY, cardHeight, gap?, zBase? }
   */
  layoutColumn(containerKey, ids) {
    const c = this._containers.get(containerKey);
    if (!c) throw new Error(`LayoutEngine: container '${containerKey}' not registered`);
    const gap = c.gap ?? DEFAULT_GAP;
    const zBase = c.zBase ?? 4;
    const result = new Map();
    ids.forEach((id, i) => {
      result.set(id, {
        x: c.centerX,
        y: c.topY - i * (c.cardHeight + gap),
        scale: 1,
        rotation: 0,
        z: zBase + i * 0.5,
      });
    });
    this.updateAnchors(containerKey, result);
    return result;
  }
}
