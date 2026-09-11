// CardObject（§4.2）：场景内的一张牌。
// 结构：Group
//   ├─ face: PlaneGeometry(cardWidth, cardHeight)，材质 map = RichTextEngine 烘焙纹理
//   ├─ fx:   CardFxLayer（卡面特效层：veil 盖纱/ pulse 闪光/ edge 流光，时间驱动 updateFx）
//   └─ (燃尽时) embers: 局部 Points 余烬粒子（前沿喷发，加色混合）
// 牌面内容（名称/费用/描述文本）由注入的 bakeFace(cardData) 函数产出
// { texture, hitRegions, width, height } —— 纹理与 hit map 永远成对替换（§4.6 铁律）。
// 状态视觉（禁用/高亮…）先以材质颜色占位，shader 版本后续替换 setVisualState 内部实现。
// 焚毁离场走 startBurn/updateBurn：着色器自底向上吞蚀（噪声火线 + 辉光 + 炭化），
// 由宿主逐帧驱动，燃尽回调 onBurnt（BattleStage 届时瞬移落位牌库图标处并销毁）。

import * as THREE from 'three';
import { CardFxLayer } from './CardFxLayer.js';
import { hitTestRegions } from '../richtext/layout.js';

// 余烬色板（加色混合，r/g/b 0~1）：火线喷出的火星从深橙到亮黄
const EMBER_COLORS = [
  [1.0, 0.35, 0.08],
  [1.0, 0.60, 0.15],
  [1.0, 0.80, 0.35],
  [1.0, 0.95, 0.60],
];

export class CardObject extends THREE.Group {
  /**
   * @param {object} options
   *   uniqueID: string
   *   cardWidth/cardHeight: number   世界单位
   *   bakeFace: (cardData) => { texture, hitRegions, width, height }   默认纯色占位
   */
  constructor(options) {
    super();
    const { uniqueID, cardWidth = 20, cardHeight = 27, bakeFace = null } = options;
    this.uniqueID = uniqueID;
    this.cardWidth = cardWidth;
    this.cardHeight = cardHeight;
    this._bakeFace = bakeFace || defaultBakeFace;

    this._material = new THREE.MeshBasicMaterial({ transparent: true });
    this._face = new THREE.Mesh(new THREE.PlaneGeometry(cardWidth, cardHeight), this._material);
    this._face.name = 'face';
    this.add(this._face);

    // 卡面特效层：盖纱/闪光/流光统一在此（z 分层与扩层约定见 CardFxLayer 头注释）
    this.fx = new CardFxLayer({ width: cardWidth, height: cardHeight });
    this.add(this.fx);

    this._hitRegions = [];   // 烘焙布局坐标（见 setCard）
    this._layoutSize = { width: cardWidth, height: cardHeight };
    this._visualState = 'normal';
    this._altOn = false;     // Shift 详情态：以未应用描述（textAlt）渲染
  }

  /** 牌面内容更新：重烘纹理 + 成对替换 hit map（详情态保持，按新数据重出）。 */
  setCard(cardData) {
    this._cardData = cardData;
    if (this._altOn && cardData?.textAlt == null) this._altOn = false; // 新数据无双轨 → 回应用面
    this._applyFace();
  }

  /**
   * Shift 详情模式：临时切换为未应用描述渲染（altFace 标记 → 烘焙器画 S 方标）。
   * 无 textAlt 的纯机制卡无切换意义，静默忽略。纹理与 hit map 成对替换（同 setCard 铁律）。
   */
  setAltMode(on) {
    const next = !!on && this._cardData?.textAlt != null;
    if (next === this._altOn) return;
    this._altOn = next;
    this._applyFace();
  }

  get altMode() { return this._altOn; }

  // 烘焙当前牌面：详情态用 {...数据, text: textAlt, altFace: true} 派生视图
  _applyFace() {
    const data = this._altOn && this._cardData?.textAlt != null
      ? { ...this._cardData, text: this._cardData.textAlt, altFace: true }
      : this._cardData;
    const { texture, hitRegions, width, height } = this._bakeFace(data);
    const old = this._material.map;
    this._material.map = texture;
    this._material.needsUpdate = true;
    old?.dispose?.();
    this._hitRegions = hitRegions || [];
    // hit map 用烘焙布局坐标（与牌面世界尺寸无关），uv 反算时按此尺寸还原
    this._layoutSize = { width: width || this.cardWidth, height: height || this.cardHeight };
  }

  get cardData() { return this._cardData || null; }
  get hitRegions() { return this._hitRegions; }
  get faceMesh() { return this._face; }

  /**
   * raycast 命中牌面后的查询：uv → 牌面局部坐标 → hit map。
   * @param {{u:number, v:number}} uv  three raycast 交点 uv（v 向上）
   * @returns {{type:string, payload:object, rect:object}|null}
   */
  hitTestUV({ u, v }) {
    // 烘焙布局坐标：x 向右（与 u 同向），y 向下（与 v 反向）
    const lx = u * this._layoutSize.width;
    const ly = (1 - v) * this._layoutSize.height;
    return this.hitTestLocal(lx, ly);
  }

  hitTestLocal(lx, ly) {
    return hitTestRegions(this._hitRegions, lx, ly); // 与 DOM 预览同一实现（layout.js）
  }

  /** 状态视觉占位：normal | disabled（淡灰白=暂不可发动） | highlighted。shader 版实现时保持此接口。 */
  setVisualState(state) {
    this._visualState = state;
    switch (state) {
      case 'disabled': this._material.color.set(0xb8b8b8); break;
      case 'highlighted': this._material.color.set(0xffffcc); break;
      default: this._material.color.set(0xffffff);
    }
  }

  /** 激活态边缘流光（咏唱已激活）开关；轨道推进走 updateFx（门面：转发特效层）。 */
  setActiveGlow(on) { this.fx.setEdgeGlow(on); }

  get hasActiveGlow() { return this.fx.hasEdgeGlow; }

  /** 帧驱动卡面特效（脉冲回程/盖纱呼吸/流光轨道）。 */
  updateFx(dt) { this.fx.update(dt); }

  get visualState() { return this._visualState; }

  // ========== 焚毁燃烧（离场演出） ==========
  // 三层表达：① 着色器自底向上吞蚀（噪声咬边 + 火线辉光 + 上缘炭化预热）
  // ② 前沿余烬粒子（卡内局部 Points，随前沿上升喷发）③ 火起颤动（rotation.z 微振）。
  // startBurn 后由宿主逐帧调 updateBurn(dt)；燃尽（牌面全 discard，卡不可见）时
  // 回调 onBurnt 一次——宿主届时瞬移落位牌库图标处并销毁（玩家已看不见卡，无需飞行动画）。

  /**
   * 点燃此卡。durationMs 为总燃烧时长；onBurnt 在燃尽瞬间回调一次。
   * 幂等：已燃烧中的卡重复调用无效。
   */
  startBurn({ durationMs = 700, onBurnt = null } = {}) {
    if (this._burn) return;
    this.fx.clearTransient(); // 焚毁接管牌面：熄灭盖纱/闪光/流光
    this._burnUniforms = {
      uBurn: { value: 0 },                 // 0=完好 → 1=燃尽
      uSeed: { value: Math.random() * 100 }, // 噪声种子（每张卡的咬边形状不同）
    };
    // 注：燃烧牌必经 setCard 烘焙（有 map → USE_UV 已定义），uv 属性可用
    this._material.onBeforeCompile = (shader) => {
      shader.uniforms.uBurn = this._burnUniforms.uBurn;
      shader.uniforms.uSeed = this._burnUniforms.uSeed;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vBurnUv;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvBurnUv = uv;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec2 vBurnUv;
uniform float uBurn;
uniform float uSeed;
float bHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float bNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(bHash(i), bHash(i + vec2(1.0, 0.0)), u.x),
    mix(bHash(i + vec2(0.0, 1.0)), bHash(i + vec2(1.0, 1.0)), u.x), u.y);
}`)
        .replace('#include <map_fragment>', `#include <map_fragment>
{
  // 双频值噪声咬边：燃烧前沿不是直线而是火舌状锯齿
  float n = bNoise(vBurnUv * vec2(5.0, 8.0) + vec2(uSeed, uSeed * 0.7)) * 0.6
          + bNoise(vBurnUv * vec2(11.0, 17.0) - uSeed) * 0.4;
  float line = uBurn * 1.45 - 0.2;               // 前沿自底向上推进（两端留噪声余量）
  float d = vBurnUv.y - line + (n - 0.5) * 0.45; // 距前沿的有符号距离
  if (d < -0.05) {
    discard;                                      // 已燃尽区域
  } else if (d < 0.02) {
    float g = 1.0 - (d + 0.05) / 0.07;            // 火线辉光带（深橙→亮黄）
    vec3 ember = mix(vec3(0.55, 0.12, 0.01), vec3(1.0, 0.88, 0.42), g * g);
    diffuseColor.rgb = mix(diffuseColor.rgb * 0.3, ember * (1.15 + 0.9 * g), g);
  } else if (d < 0.16) {
    float c = 1.0 - (d - 0.02) / 0.14;            // 前沿上方炭化预热（焦黑泛红）
    diffuseColor.rgb = mix(diffuseColor.rgb,
      diffuseColor.rgb * vec3(0.4, 0.26, 0.2) + vec3(0.09, 0.015, 0.0), c * 0.85);
  }
}`);
    };
    this._material.customProgramCacheKey = () => 'weky-card-burn-v1';
    this._material.needsUpdate = true;
    this._ensureEmbers();
    this._burn = { t: 0, duration: Math.max(0.001, durationMs / 1000), onBurnt, done: false, emberAcc: 0 };
  }

  get burning() { return !!this._burn && !this._burn.done; }

  /** 逐帧驱动燃烧：推进 uBurn、前沿余烬、火起颤动；燃尽回调 onBurnt（仅一次）。 */
  updateBurn(dt) {
    if (!this._burn || this._burn.done) return;
    const b = this._burn;
    b.t = Math.min(b.t + dt, b.duration);
    const p = b.t / b.duration;
    this._burnUniforms.uBurn.value = p;
    this.rotation.z = Math.sin(b.t * 28) * 0.012 * (1 - p); // 火起颤动，随燃尽平息
    this._updateEmbers(dt, p);
    if (p >= 1) {
      b.done = true;
      this.rotation.z = 0;
      b.onBurnt?.();
    }
  }

  // 余烬粒子池：卡内局部坐标，加色混合下死粒子颜色归零即不可见（同 ParticleSystem 手法）
  _ensureEmbers() {
    if (this._embers) return;
    const n = 48;
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: 1.5, vertexColors: true,
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false,
    });
    this._embers = new THREE.Points(geometry, material);
    this._embers.frustumCulled = false;
    this._embers.position.z = 1.2;   // 牌面前方
    this._embers.renderOrder = 5;
    this.add(this._embers);
    this._emberPool = [];
    this._emberFree = Array.from({ length: n }, (_, i) => i);
  }

  _updateEmbers(dt, progress) {
    const b = this._burn;
    // 与着色器同式的前沿高度（v 单位 → 卡内局部 y）：前沿在牌面内才喷火星
    const line = progress * 1.45 - 0.2;
    if (line > 0.02 && line < 1.05) {
      b.emberAcc += dt * 90;
      const frontierY = (Math.min(line, 1) - 0.5) * this.cardHeight;
      while (b.emberAcc >= 1) {
        b.emberAcc -= 1;
        this._spawnEmber(frontierY);
      }
    }
    const pos = this._embers.geometry.attributes.position;
    const col = this._embers.geometry.attributes.color;
    for (let k = this._emberPool.length - 1; k >= 0; k--) {
      const e = this._emberPool[k];
      e.life += dt;
      if (e.life >= e.ttl) {
        col.setXYZ(e.i, 0, 0, 0);
        this._emberFree.push(e.i);
        this._emberPool.splice(k, 1);
        continue;
      }
      e.vy += -22 * dt; // 火星上抛后被"重力"拉回（上抛初速 12~26）
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      const fade = 1 - e.life / e.ttl;
      pos.setXYZ(e.i, e.x, e.y, 0);
      col.setXYZ(e.i, e.r * fade, e.g * fade, e.b * fade);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  _spawnEmber(frontierY) {
    const i = this._emberFree.pop();
    if (i == null) return; // 池满静默丢弃
    const c = EMBER_COLORS[(Math.random() * EMBER_COLORS.length) | 0];
    this._emberPool.push({
      i,
      x: (Math.random() - 0.5) * this.cardWidth * 0.92,
      y: frontierY + Math.random() * 2,
      vx: (Math.random() - 0.5) * 7,
      vy: 12 + Math.random() * 14,
      life: 0,
      ttl: 0.35 + Math.random() * 0.45,
      r: c[0], g: c[1], b: c[2],
    });
  }

  dispose() {
    this.fx.dispose();
    if (this._embers) {
      this.remove(this._embers);
      this._embers.geometry.dispose();
      this._embers.material.dispose();
      this._embers = null;
    }
    this._material.map?.dispose?.();
    this._material.dispose();
    this._face.geometry.dispose();
  }
}

// 占位烘焙：无 RichTextEngine 时的纯色 1x1 纹理（§8 风险条款允许的 placeholder 链路）
function defaultBakeFace() {
  const canvas = { width: 1, height: 1 };
  const texture = new THREE.Texture(canvas);
  texture.needsUpdate = true;
  return { texture, hitRegions: [], width: 1, height: 1 };
}
