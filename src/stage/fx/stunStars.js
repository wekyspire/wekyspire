// 眩晕星（L3 表意层首件，stun 主题件，VFX 结构大更新 Phase 2，2026-09-26）：
// 三颗金星绕头顶缓转 + 高频闪烁——表意件不追求物理感，读一次即懂「晕了」。
// additive 小件、微过 bloom 阈（×1.7 的亮黄边沿闪）；挂宿主层 L3 分组
// （billboard 子组：轨道在 billboard 局部 x/z 面内转，星点前后掠过头顶剪影）。
// 总控一个标量 setLevel(0..1)；逐帧走 unit.addTick；dispose 由宿主层统一调。
import * as THREE from 'three';
import { glowTexture } from './orbs.js';

const STAR_COUNT = 3;
const ORBIT_R = 0.32;   // 轨道半径（× 立牌高 H）
const ORBIT_Y = 0.86;   // 轨道高度（面部一圈——0.97 会撞进意图条/效果行的视觉区）
const STAR_S = 0.105;   // 星点体量

/**
 * 在宿主层的 L3 分组里建眩晕星。
 * @param {UnitFxLayer} layer 单位特效宿主（unitFxLayer.js）
 * @returns {{ group, setLevel(0..1), dispose } | null}（headless 无画布 → null）
 */
export function makeStunStars(layer, { color = 0xffd34c } = {}) {
  if (typeof document === 'undefined') return null;
  const unit = layer.unit;
  const H = unit._standeeHeight ?? 22;
  const group = new THREE.Group();
  group.name = 'stunStars';
  const tex = glowTexture(color);
  const col = new THREE.Color(color).multiplyScalar(1.7); // 表意件可微过阈（最上层的闪）
  const stars = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color: col, blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, opacity: 0, fog: false,
    }));
    group.add(s);
    stars.push(s);
  }
  layer.groups[3].add(group); // L3 表意层（z 0.95，见 unitFxLayer 约定）
  let level = 0;
  let t = Math.random() * Math.PI * 2;
  const untick = unit.addTick((dt) => {
    t += dt;
    group.visible = level > 0.02 && !unit._dead;
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      const a = t * 2.4 + (i * Math.PI * 2) / stars.length;
      const sc = STAR_S * H * (1 + 0.25 * Math.sin(t * 9 + i * 2.1)); // 闪烁胀缩
      s.position.set(
        Math.cos(a) * ORBIT_R * H,
        ORBIT_Y * H + 0.02 * H * Math.sin(t * 3.1 + i * 1.7),
        0.95 + Math.sin(a) * ORBIT_R * 0.55 * H, // 椭圆轨道：前后掠过头顶剪影
      );
      s.scale.set(sc, sc, 1);
      s.material.opacity = level * (0.55 + 0.45 * Math.sin(t * 8.7 + i * 2.3));
    }
  });
  const dispose = () => {
    untick();
    group.parent?.remove(group);
    for (const s of stars) s.material.dispose(); // 纹理是共享缓存，不销
  };
  return {
    group,
    setLevel(l) { level = Math.max(0, Math.min(1, l)); },
    dispose,
  };
}
