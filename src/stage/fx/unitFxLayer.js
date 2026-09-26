// 单位特效统一宿主（L0–L3 固定层级的落点，VFX 结构大更新 Phase 2，2026-09-26）：
// 每单位一件，UnitObject 构造时自建（对位 CardFxLayer——卡牌侧同款收口）。
// 职责：
//   · 持有 L0 本体补丁记录（unitBodyFx：uBurn/uPoison/uTime 单 program 多 uniform）；
//   · L1/L2/L3 三个分组挂 billboard（贴体铁律：挂 unit 根的件不随立绘转身）；
//   · overlay 槽位池：key→句柄，惰性创建、幂等重取，aura 配方只管「推 level」，
//     建件/收件的活全在这里；
//   · uTime 常驻推进（多 uniform 共用一钟——不许单个 aura 占钟，毒无火时也要走）；
//   · 统一 dispose（UnitObject.dispose 首行调它，再吃既有部件自检链）。
// 层级职责与 z 槽位约定（billboard 局部空间，同层多件按 z 段错开）：
//   L0 本体层：材质补丁（无几何件，片元内顺序合成 = 上层天然读下层输出）
//   L1 贴体层：sprite 叠层   z 0.50~0.70（flames 0.50~0.60 / vapor 0.65~0.70）
//   L2 笼罩层：壳/罩件       z 0.80      （默认同源重算——共享 GLSL 件+同 uniforms 零 RT）
//   L3 表意层：表意小件      z 0.95      （眩晕星等最上 additive 件）
import * as THREE from 'three';
import { attachUnitBodyFx } from './unitBodyFx.js';

export class UnitFxLayer {
  /** @param {UnitObject} unit */
  constructor(unit) {
    this.unit = unit;
    // L0：本体补丁记录（幂等；占位色块材质照挂——效果包在 #ifdef USE_MAP 内不生效，
    // 立绘挂上时 three 自动重编即活）
    this.body = attachUnitBodyFx(unit._body.material);
    this.groups = {};
    for (const [layer, name] of [[1, 'fxL1'], [2, 'fxL2'], [3, 'fxL3']]) {
      const g = new THREE.Group();
      g.name = name;
      unit._billboard.add(g);
      this.groups[layer] = g;
    }
    this._slots = new Map(); // key → { layer, handle:{setLevel?,dispose?}|null }
    // L0 的钟：常驻推进（每帧一个 float，~免费；orbs 常驻 tick 同惯例）
    this._untick = unit.addTick((dt) => { this.body.uTime.value += dt; });
  }

  /**
   * 槽位建件（幂等）：已有同 key 存活件直接取回。
   * @param {string} key     槽位键（aura 侧用 effectId——一效果一槽位）
   * @param {1|2|3} layer    目标层级
   * @param {(layer:UnitFxLayer)=>{setLevel?,dispose?}|null} builder 建件器（headless 返回 null）
   * @returns 句柄（headless 为 null）
   */
  overlay(key, layer, builder) {
    const existing = this._slots.get(key);
    if (existing) return existing.handle;
    const handle = builder(this) ?? null;
    this._slots.set(key, { layer, handle });
    return handle;
  }

  /** 推槽位强度（aura 配方的唯一落笔口；件缺席/headless 静默）。 */
  setLevel(key, l) {
    this._slots.get(key)?.handle?.setLevel?.(l);
  }

  /** 槽位收件（dispose 句柄并摘槽）。 */
  clear(key) {
    const slot = this._slots.get(key);
    if (!slot) return;
    try { slot.handle?.dispose?.(); } catch (_) {}
    this._slots.delete(key);
  }

  /** 全清：槽位全收 + L0 uniform 归零 + 分组摘出（材质随单位本体材质消亡）。 */
  dispose() {
    for (const key of [...this._slots.keys()]) this.clear(key);
    this._untick?.();
    this._untick = null;
    this.body.uBurn.value = 0;
    this.body.uPoison.value = 0;
    for (const g of Object.values(this.groups)) this.unit._billboard?.remove(g);
  }
}
