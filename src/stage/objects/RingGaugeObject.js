// RingGaugeObject：环绕头像的环形量条（角色/瑞米血条）。
// 结构：Group（原点 = 头像中心）
//   ├─ track: 全环暗底（量槽背景，恒整圆）
//   ├─ fill:  弧段 mesh——顶点自建 BufferGeometry（12 点方向起、顺时针占 frac 比例），
//   │         setValue 设目标比例，update(dt) 平滑趋近（弧长与颜色同步渐变）
//   └─ label: 可选数值行（血量数字，挂在环正下方；签名不变不重烘）
// 低血量（<LOW_FRAC）时目标色向警示色过渡并白色脉动（语言同资源徽章高亮脉动）。
//
// node 无 bakeLabel 时数值行退化为 1x1 占位（与其他状态件一致）。

import * as THREE from 'three';

const SEGMENTS = 48;          // 整圆弧段细分
const RATE = 7;               // 显示值趋近速率（/s）
const SNAP_EPS = 0.002;       // 距目标小于此值吸附（停止逐帧重建几何）
const LOW_FRAC = 0.3;         // 低量阈值：以下渐入警示色
const CRITICAL_FRAC = 0.15;   // 危急阈值：以下额外白脉动（急救提示，目标持续移动）
const PULSE_FREQ = 6;         // 警示脉动角频率
const PULSE_MIX = [0.2, 0.65];// 脉动混白区间
const SEAM_APEX_DEG = 8;      // 接缝指针三角的角向长度（度）

const _base = new THREE.Color();
const _pulse = new THREE.Color();
const _white = new THREE.Color(0xffffff);

export class RingGaugeObject extends THREE.Group {
  /**
   * @param {object} options
   *   radius:       头像半径（fill 从 radius 到 radius+thickness 环绕）
   *   thickness:    环厚（世界单位）
   *   color:        充盈色（低量时向 lowColor 过渡）
   *   lowColor:     低量警示色
   *   trackColor:   尾段（未充能弧）颜色——压暗的量槽色（缺省近黑）
   *   startAngleDeg: 充能起点方位角（度，标准数学角：90=12 点方向，120=11 点方向）
   *   seamGapDeg:   头尾分离缺口（度，缺口中心在起点方位角上逆时针偏 halfGap；
   *                 0 = 无缺口满环）
   *   showLabel: 是否在环下挂当前/上限数值行
   *   bakeLabel: (text) => { texture, width, height }（缺省 1x1 占位）
   */
  constructor({
    radius, thickness = 0.55, color = 0x4ad06e, lowColor = 0xe85a5a,
    trackColor = 0x10131d, startAngleDeg = 90, seamGapDeg = 0,
    trackWidth = null, // 细轨道模式：缺省 = 全带宽量槽
    seamArrow = false, // 接缝箭头：充能弧末端长出三角形指针（基边与弧末端共边）
    seamFadeDeg = 0,   // 尾端亮度渐变角宽（度）：缺口侧充能弧向压暗尾色渐变（软分割）
    showLabel = false, bakeLabel = null, pixelsPerWorld = 10,
  } = {}) {
    super();
    this._radius = radius;
    this._thickness = thickness;
    this._color = new THREE.Color(color);
    this._lowColor = new THREE.Color(lowColor);
    this._startAngle = (startAngleDeg * Math.PI) / 180; // 缺口中心方位角（顺时针方向端语义见 fillStart）
    const gap = (seamGapDeg * Math.PI) / 180;
    this._sweepMax = Math.PI * 2 - gap;   // 可充能总弧角（扣除缺口）
    this._fillStart = this._startAngle - gap / 2; // 充能起点：缺口中心顺时针偏半缺口（满弧时缺口恰骑跨在中心上）
    // 指针三角：基边与圆环末端径向边完全共边，尖端沿充能方向再延伸 APEX_DEG
    this._seamApex = seamArrow && gap > 0
      ? (SEAM_APEX_DEG * Math.PI) / 180
      : 0;
    // 尾端亮度梯度占可充能弧的比例（t=0 缺口侧最暗 → 头部全亮）
    this._fadeFrac = seamFadeDeg > 0
      ? Math.min(0.45, (seamFadeDeg * Math.PI) / 180 / this._sweepMax)
      : 0;
    this._ppw = pixelsPerWorld;

    // 尾段量槽：自充能起点顺时针 sweepMax 的暗弧（缺口处天然断开）。trackWidth 给定时
    // 为带内居中的细环；否则为全带宽（压暗的血色带 = 未充能段）
    const tInner = trackWidth != null ? radius + (thickness - trackWidth) / 2 : radius - 0.12;
    const tOuter = trackWidth != null ? tInner + trackWidth : radius + thickness + 0.12;
    const track = new THREE.Mesh(
      new THREE.RingGeometry(
        tInner, tOuter, SEGMENTS, 1,
        this._fillStart - this._sweepMax, this._sweepMax,
      ),
      new THREE.MeshBasicMaterial({ color: trackColor, transparent: true, opacity: 0.9 }),
    );
    track.name = 'track';
    track.position.z = 0.62;
    this.add(track);

    // vertexColors（3 分量）：尾端亮度梯度走顶点色，与材质 tint（低血警示）相乘；
    // 无渐变配置时全 1 无副作用
    this._fillMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      vertexColors: true,
      side: THREE.DoubleSide, // 双面保险：绕序即使出错也只是冗余渲染，不再整环消失
    });
    this._fillMaterial.color.copy(this._color);
    this._fill = new THREE.Mesh(new THREE.BufferGeometry(), this._fillMaterial);
    this._fill.name = 'fill';
    this._fill.position.z = 0.66;
    this._fill.visible = false;
    this._fill.frustumCulled = false; // 常驻 UI 量条不做视锥剔除：几何每帧重建，剔除只添风险不省成本
    this.add(this._fill);

    // 数值行（可选）：挂在环带正下方
    if (showLabel) {
      this._bakeLabel = bakeLabel || defaultBakeLabel;
      this._labelMaterial = new THREE.MeshBasicMaterial({ transparent: true });
      this._label = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this._labelMaterial);
      this._label.name = 'label';
      this._label.position.set(0, -(radius + thickness / 2 + 0.95), 0.8);
      this.add(this._label);
    }

    this._frac = 0;        // 当前显示比例（缓动跟随 target）
    this._targetFrac = 0;
    this._builtFrac = -1;  // 已烘焙进几何的比例（避免重复重建）
    this._initialized = false; // 首次 setValue 直接吸附到位（新建面板不播充能动画）
    this._time = 0;
    this._sig = null;
  }

  /** 设目标量。签名不变直接跳过（重烘纪律同资源点）。 */
  setValue(current, max) {
    const sig = `${current}/${max}`;
    if (sig === this._sig) return false;
    const first = !this._initialized;
    this._initialized = true;
    this._sig = sig;
    this._targetFrac = max > 0 ? Math.min(1, Math.max(0, current / max)) : 0;
    if (first) {
      // 首帧吸附：弧长与颜色直接落位，不播入场渐变
      this._frac = this._targetFrac;
      this._snapColor();
    }
    if (this._label) {
      const { texture, width, height } = this._bakeLabel(sig);
      const old = this._labelMaterial.map;
      this._labelMaterial.map = texture;
      this._labelMaterial.color.set(0xffffff);
      this._labelMaterial.needsUpdate = true;
      old?.dispose?.();
      this._label.geometry.dispose();
      this._label.geometry = new THREE.PlaneGeometry(width / this._ppw, height / this._ppw);
    }
    return true;
  }

  /** 首帧不缓动地落到目标位（settle 兜底用；setValue 首调已内含吸附）。 */
  settle() {
    this._frac = this._targetFrac;
    this._snapColor();
    this._rebuildFill(true);
  }

  get displayFraction() { return this._frac; }
  fillColorHex() { return this._fillMaterial.color.getHex(); }

  // 当前目标比例对应的静态色（低量→警示色线性过渡）
  _snapColor() {
    const warn = Math.max(0, Math.min(1, (LOW_FRAC - this._targetFrac) / LOW_FRAC));
    this._fillMaterial.color.copy(this._color).lerp(this._lowColor, warn);
  }

  /** 帧推进：弧长/颜色同步向目标渐变；低量白脉冲。 */
  update(dt) {
    if (!this._initialized) return; // 尚无数据：不重建几何、不走色
    this._time += dt;

    // 弧长：显示比例缓动到目标
    const k = Math.min(1, dt * RATE);
    this._frac += (this._targetFrac - this._frac) * k;
    if (Math.abs(this._targetFrac - this._frac) < SNAP_EPS) this._frac = this._targetFrac;

    // 颜色：目标 = 静态基准（充盈↔警示随比例过渡）；危急（<CRITICAL_FRAC）且未空时
    // 基准向白脉动——脉动目标持续移动不吸附，静态目标渐变后吸附精确值（测试可断言）
    const warn = Math.max(0, Math.min(1, (LOW_FRAC - this._targetFrac) / LOW_FRAC));
    _base.copy(this._color).lerp(this._lowColor, warn);
    let target = _base;
    const pulsing = this._targetFrac > 0 && this._targetFrac <= CRITICAL_FRAC;
    if (pulsing) {
      const w = 0.5 + 0.5 * Math.sin(this._time * PULSE_FREQ);
      target = _pulse.copy(_base).lerp(_white, PULSE_MIX[0] + (PULSE_MIX[1] - PULSE_MIX[0]) * w);
    }
    this._fillMaterial.color.lerp(target, k);
    if (!pulsing) {
      if (Math.abs(this._fillMaterial.color.r - target.r) < 0.004
        && Math.abs(this._fillMaterial.color.g - target.g) < 0.004
        && Math.abs(this._fillMaterial.color.b - target.b) < 0.004) {
        this._fillMaterial.color.copy(target);
      }
    }

    this._rebuildFill(false);
  }

  // 弧段重建：显示比例或颜色基准变化时才动几何（静止零开销）
  _rebuildFill(force) {
    if (!force && Math.abs(this._frac - this._builtFrac) < 0.0015) return;
    this._builtFrac = this._frac;
    const geo = makeArcGeometry(
      this._radius, this._radius + this._thickness, this._frac, SEGMENTS,
      this._fillStart, this._sweepMax, this._seamApex, this._fadeFrac,
    );
    this._fill.geometry?.dispose?.();
    this._fill.geometry = geo;
    this._fill.visible = this._frac > 0;
  }

  dispose() {
    for (const child of [...this.children]) {
      child.geometry?.dispose?.();
      child.material?.map?.dispose?.();
      child.material?.dispose?.();
    }
    this.clear();
  }
}

// 顶点自建弧段：起点角（默认 12 点方向）起顺时针扫过 frac×sweepMax。每段内外两顶点
// 成四边形；索引按逆时针绕序（angle 递减时必须如此）保证 +z 正面朝外——默认 FrontSide
// 下反向面会被整体剔除（曾致填充弧不可见，只剩暗轨道）。frac=0 时最小占位几何。
// apexRad>0（接缝指针）：充能末端补一个三角形——基边 = 弧末端的径向边（与环体完全
// 共边、同材质无缝），尖端沿充能方向延伸 apexRad。随 frac 移动即"当前值指针"。
// fadeFrac>0 时带 3 分量顶点色亮度梯度：缺口侧（t=0）最暗（×TAIL_DIM），线性恢复全亮——
// 概念图"渐变分割"；低血警示 tint 在材质色上相乘互不干扰。
const TAIL_DIM = 0.34; // 渐暗尾色的亮度系数
function makeArcGeometry(innerR, outerR, frac, segments, startAngle = Math.PI / 2, sweepMax = Math.PI * 2, apexRad = 0, fadeFrac = 0) {
  const n = Math.max(1, Math.round(segments * Math.min(1, frac)));
  const sweep = frac * sweepMax;
  const positions = [];
  const colors = [];
  const indices = [];
  for (let i = 0; i <= n; i++) {
    const a = startAngle - (sweep * i) / n; // 起点始，顺时针（角度递减；步进按实际段数 n 归一）
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    positions.push(innerR * cos, innerR * sin, 0, outerR * cos, outerR * sin, 0);
    const k = fadeFrac > 0 ? TAIL_DIM + (1 - TAIL_DIM) * Math.min(1, (i / n) / fadeFrac) : 1;
    colors.push(k, k, k, k, k, k); // 内外两顶点同色：每段 2 顶点，颜色与顶点一一对应
  }
  for (let i = 0; i < n; i++) {
    const b = i * 2;
    // (b, b+2, b+1) 与 (b+1, b+2, b+3)：沿角度递减方向的正确逆时针绕序
    indices.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
  }
  if (apexRad > 0) {
    // 指针三角：基边复用末端径向边的两个顶点（inner_n/outer_n），尖端在带中径上
    // 沿充能方向继续延伸 apexRad 角。绕序沿用同一手性保证正面可见。
    const headA = startAngle - sweep;
    const apexA = headA - apexRad;
    const rMid = (innerR + outerR) / 2;
    positions.push(rMid * Math.cos(apexA), rMid * Math.sin(apexA), 0);
    if (fadeFrac > 0) colors.push(1, 1, 1); // 指针尖端在头部端：全亮，勿留越界缺色
    const innerN = n * 2;
    indices.push(innerN, positions.length / 3 - 1, innerN + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  if (fadeFrac > 0) geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
  geo.setIndex(indices);
  geo.computeBoundingSphere(); // 显式落定包围球：不留懒计算时序给渲染端
  return geo;
}

function defaultBakeLabel() {
  return () => {
    const texture = new THREE.Texture({ width: 1, height: 1 });
    texture.needsUpdate = true;
    return { texture, width: 1, height: 1 };
  };
}
