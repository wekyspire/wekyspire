// 毒雾萦绕（L1 贴体层，poison 主题件，VFX 结构大更新 Phase 2，2026-09-26）：
// 青绿雾团沿立绘缓慢升腾——毒是浸润不是烧：低亮（不过 bloom 阈，毒不喧宾夺主）、
// 低对比、循环上升 + 中途淡入淡出。与叠火的「锚点猛火」读出区分。
// 颜色参数化：未来水系/酸雾/瘴气类主题可直接换色复用本件。
// 总控一个标量 setLevel(0..1)；逐帧走 unit.addTick；dispose 由宿主层统一调。
import * as THREE from 'three';
import { glowTexture } from './orbs.js';

// 三股雾团锚位（× 立牌高 H）：rise = 升腾行程（占 H 比例），period = 单轮周期（秒）
const PLUMES = [
  { x: -0.24, y: 0.04, s: 0.40, rise: 0.52, period: 3.1, ph: 0.0 },
  { x: 0.22, y: 0.08, s: 0.34, rise: 0.46, period: 2.6, ph: 0.45 },
  { x: 0.0, y: 0.02, s: 0.48, rise: 0.58, period: 3.7, ph: 0.72 },
];

/**
 * 在宿主层的 L1 分组里建毒雾萦绕。
 * @param {UnitFxLayer} layer 单位特效宿主（unitFxLayer.js）
 * @returns {{ group, setLevel(0..1), dispose } | null}（headless 无画布 → null）
 */
export function makeVaporPlumes(layer, { color = 0x7fe06a } = {}) {
  if (typeof document === 'undefined') return null;
  const unit = layer.unit;
  const H = unit._standeeHeight ?? 22;
  const group = new THREE.Group();
  group.name = 'vaporPlumes';
  const tex = glowTexture(color);
  // 压阈下（×1.15 的绿峰值 ~1.1 < 1.45）：毒雾是哑光弥漫，不是发光体
  const col = new THREE.Color(color).multiplyScalar(1.15);
  const plumes = [];
  for (const p of PLUMES) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color: col, blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, opacity: 0, fog: false,
    }));
    group.add(sprite);
    // 逐字段显式拷——不许 {...p, s: sprite}：PLUMES 自带的 s（体量）会把 sprite 顶掉
    plumes.push({ sprite, x: p.x, y: p.y, size: p.s, rise: p.rise, period: p.period, ph: p.ph });
  }
  layer.groups[1].add(group); // L1 贴体层（z 段 0.65~0.70，叠火之上，见 unitFxLayer 约定）
  let level = 0;
  let t = Math.random() * 10;
  const untick = unit.addTick((dt) => {
    t += dt;
    group.visible = level > 0.02 && !unit._dead;
    for (const p of plumes) {
      const cycle = (t / p.period + p.ph) % 1;             // 0→1 一轮升腾
      const fade = Math.sin(cycle * Math.PI);               // 起末淡入淡出
      const y = (p.y + cycle * p.rise) * H;
      const x = p.x * H + 0.05 * H * Math.sin(t * 1.3 + p.ph * 9.0);
      const sc = p.size * H * (0.7 + cycle * 0.9);          // 越升越散
      p.sprite.position.set(x, y, 0.68);
      p.sprite.scale.set(sc, sc * 1.25, 1);
      p.sprite.material.opacity = 0.5 * level * fade;
      p.sprite.material.rotation = 0.15 * Math.sin(t * 0.9 + p.ph * 7.0);
    }
  });
  const dispose = () => {
    untick();
    group.parent?.remove(group);
    for (const p of plumes) p.sprite.material.dispose(); // 纹理是共享缓存，不销
  };
  return {
    group,
    setLevel(l) { level = Math.max(0, Math.min(1, l)); },
    dispose,
  };
}
