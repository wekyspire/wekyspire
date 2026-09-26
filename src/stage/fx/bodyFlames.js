// 贴体叠火（L1 贴体层首件，VFX 结构大更新 Phase 1，2026-09-26）：
// orbs.js 同款多层 sprite 火的**贴体版**——不绕轨，3 团锚在立绘下半身
// （体宽错开、体高下半分布），让燃烧单位「身上着火」而不是「身边飘火星」。
// 挂 billboard 子组（与立绘同 yaw 面向相机——贴体铁律：挂 unit 根的件不会跟随
// billboard 转身，身体侧对相机时火会飘离剪影）。
// HDR 纪律：sprite 材质 color 乘算推过世界 bloom 阈 1.45（火是发光体——焰身 ×2.6 /
// 内芯 ×2.2 / 光晕 ×1.3）；本体（L0）压阈下，发光的活全在这层，分工防糊白。
// 混合：世界场景内 additive 即可（世界链终段不透明，无 uiScene RT 的 alpha 占地问题）。
// 总控一个标量：setLevel(0..1)（enter 渐升 / stacks 强弱 / exit 渐熄全推它）；
// 逐帧抖焰走 unit.addTick（orbs 同惯例），dispose 摘钩收尸。
import * as THREE from 'three';
import { glowTexture, flameTexture } from './orbs.js';

// 三团锚位（× 立牌高 H）：左右腿侧两团大 + 腹前一团小——火苗集中在下半身，
// 上半身留给表情/意图条可读
const ANCHORS = [
  { x: -0.30, y: 0.10, s: 0.34 },
  { x: 0.26, y: 0.05, s: 0.30 },
  { x: -0.02, y: 0.30, s: 0.25 },
];

/**
 * 给单位视图挂贴体叠火。
 * @returns {{ group, setLevel(0..1), dispose } | null}（headless 无画布 → null）
 */
export function attachBodyFlames(unit, { color = 0xff8a3a } = {}) {
  if (typeof document === 'undefined') return null;
  const H = unit._standeeHeight ?? 22;
  const group = new THREE.Group();
  group.name = 'bodyFlames';
  const glowTex = glowTexture(color);
  const flameTex = flameTexture(color);
  // HDR 乘算：焰身/内芯过 bloom 阈，光晕贴阈下（焰身必须比光晕亮——orbs 红色气球教训）
  const colFlame = new THREE.Color(color).multiplyScalar(2.6);
  const colCore = new THREE.Color(0xffd9a0).multiplyScalar(2.2);
  const colGlow = new THREE.Color(color).multiplyScalar(1.3);
  const mk = (tex, col, opacity) => new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, color: col, blending: THREE.AdditiveBlending,
    depthWrite: false, transparent: true, opacity, fog: false,
  }));
  const flames = [];
  for (let i = 0; i < ANCHORS.length; i++) {
    const a = ANCHORS[i];
    const glow = mk(glowTex, colGlow, 0);
    const flame = mk(flameTex, colFlame, 0);
    const core = mk(glowTex, colCore, 0);
    for (const s of [glow, flame, core]) group.add(s);
    flames.push({
      glow, flame, core,
      ax: a.x * H, ay: a.y * H, as: a.s * H,
      ph: i * 1.93, // 各团去同步初相
    });
  }
  unit._billboard.add(group); // 贴体铁律：与立绘同 billboard（见文件头）
  let level = 0;
  let t = Math.random() * Math.PI * 2;
  const untick = unit.addTick((dt) => {
    t += dt;
    group.visible = level > 0.02 && !unit._dead; // 尸体上不放火（orbs 同律）
    for (const f of flames) {
      // 双正弦 ≈ 伪噪声抖焰 + 慢速体量呼吸
      const fl = 1 + 0.13 * Math.sin(t * 15.7 + f.ph * 9.1) + 0.08 * Math.sin(t * 27.3 + f.ph * 5.3);
      const sc = f.as * fl * (0.72 + 0.4 * level) * (1 + 0.1 * Math.sin(t * 3.1 + f.ph * 2.2));
      const bob = 0.06 * f.as * Math.sin(t * 2.3 + f.ph * 3.7);
      f.glow.position.set(f.ax, f.ay + sc * 0.12 + bob, 0.5);
      f.glow.scale.set(sc * 2.1, sc * 2.1, 1);
      f.glow.material.opacity = 0.3 * level;
      f.flame.position.set(f.ax, f.ay + sc * 0.34 + bob, 0.55);
      f.flame.scale.set(sc * 0.95, sc * 1.85, 1);
      f.flame.material.opacity = level;
      f.flame.material.rotation = 0.12 * Math.sin(t * 11 + f.ph * 7); // 摆尾
      f.core.position.set(f.ax, f.ay + sc * 0.14 + bob, 0.6);
      f.core.scale.set(sc * 0.44, sc * 0.44, 1);
      f.core.material.opacity = 0.55 * level;
    }
  });
  const dispose = () => {
    untick();
    unit._billboard.remove(group);
    for (const f of flames) { // 每单位独立材质要销；纹理是 orbs 共享缓存，不销
      for (const s of [f.glow, f.flame, f.core]) s.material.dispose();
    }
  };
  return {
    group,
    /** 总控标量 0..1：不透明度与体量全由它推（enter 渐升 / stacks 强弱 / exit 渐熄）。 */
    setLevel(l) { level = Math.max(0, Math.min(1, l)); },
    dispose,
  };
}
