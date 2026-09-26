// 眩晕星（L3 表意层首件，stun 主题件，VFX 结构大更新 Phase 2，2026-09-26）：
// 三颗五角星绕头缓转 + 轨迹拖影（每颗带 2 颗滞后淡影）——表意件读一次即懂「晕了」。
// 形制（2026-09-26 用户验收定）：五角星（程序化烘焙纹理，非光球）；
// 轨道按单位 AABB 抬升加宽——y 过头顶（1.04H）、半径取体半宽外扩（_groundRadius），
// 不穿模（旧版 0.86H 轨道嵌进史莱姆圆顶）。
// 纵深读法：星在 billboard 局部 x/z 面绕椭圆，近端大亮、远端小暗（模拟绕后）；
// additive 微过 bloom 阈（×1.9 的亮黄闪烁）；挂宿主层 L3 分组。
// 总控一个标量 setLevel(0..1)；逐帧走 unit.addTick；dispose 由宿主层统一调。
import * as THREE from 'three';

let _starTex = null; // 五角星纹理缓存（全体件共享，dispose 不销）
function starTexture() {
  if (_starTex) return _starTex;
  const S = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d');
  const R = S * 0.44, r = R * 0.42;
  c.translate(S / 2, S / 2);
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? R : r;
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    c[i === 0 ? 'moveTo' : 'lineTo'](Math.cos(a) * rad, Math.sin(a) * rad);
  }
  c.closePath();
  c.shadowColor = '#ffffff'; // 轻微羽化软边（不依赖 HDR bloom 才看得出星形）
  c.shadowBlur = S * 0.08;
  c.fillStyle = '#ffffff';
  c.fill();
  _starTex = new THREE.CanvasTexture(cv);
  return _starTex;
}

const STAR_COUNT = 3;
const TRAILS = 2;              // 每颗拖影数（滞后 0.24/0.48 rad，不透明度递减）
const STAR_S = 0.105;          // 星点体量（× 立牌高 H）
const SPIN = 2.2;              // 公转角速度 rad/s

/**
 * 在宿主层的 L3 分组里建眩晕星（五角星 + 拖影）。
 * @param {UnitFxLayer} layer 单位特效宿主（unitFxLayer.js）
 * @returns {{ group, setLevel(0..1), dispose } | null}（headless 无画布 → null）
 */
export function makeStunStars(layer, { color = 0xffd34c } = {}) {
  if (typeof document === 'undefined') return null;
  const unit = layer.unit;
  const H = unit._standeeHeight ?? 22;
  // AABB 轨道（用户验收：不穿模）——高过头顶，横向半径随体半宽外扩
  const orbitY = H * 1.04;
  const orbitRx = Math.max(H * 0.30, (unit._groundRadius ?? H * 0.35) * 0.9);
  const group = new THREE.Group();
  group.name = 'stunStars';
  const tex = starTexture();
  const colMain = new THREE.Color(color).multiplyScalar(1.9); // 表意件可微过阈
  const colTrail = new THREE.Color(color).multiplyScalar(1.2);
  const mk = (col) => new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, color: col, blending: THREE.AdditiveBlending,
    depthWrite: false, transparent: true, opacity: 0, fog: false,
  }));
  const stars = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    const main = mk(colMain);
    const trail = [mk(colTrail), mk(colTrail)];
    group.add(main, ...trail);
    stars.push({ main, trail });
  }
  layer.groups[3].add(group); // L3 表意层（z 0.95，见 unitFxLayer 约定）
  let level = 0;
  let t = Math.random() * Math.PI * 2;
  const place = (s, a, i, k) => {
    // k=0 主星，k>0 拖影——滞后相位 + 体量/亮度递减
    const depthK = 0.78 + 0.22 * Math.sin(a); // 近端大、远端小（绕后读法）
    const sc = STAR_S * H * depthK * (1 - k * 0.18) * (1 + 0.2 * Math.sin(t * 9 + i * 2.1));
    s.position.set(
      Math.cos(a) * orbitRx,
      orbitY + 0.02 * H * Math.sin(t * 3.1 + i * 1.7),
      0.95 + Math.sin(a) * orbitRx * 0.35, // 椭圆纵深：前后掠过头顶两侧
    );
    s.scale.set(sc, sc, 1);
    const tw = 0.55 + 0.45 * Math.sin(t * 8.7 + i * 2.3);
    s.material.opacity = level * tw * (k === 0 ? 1 : 0.38 / k) * (0.55 + 0.45 * depthK);
    s.material.rotation = k === 0 ? 0.25 * Math.sin(t * 3.3 + i * 1.9) : 0; // 主星慢摇
  };
  const untick = unit.addTick((dt) => {
    t += dt;
    group.visible = level > 0.02 && !unit._dead;
    for (let i = 0; i < stars.length; i++) {
      const a = t * SPIN + (i * Math.PI * 2) / stars.length;
      place(stars[i].main, a, i, 0);
      for (let k = 0; k < TRAILS; k++) place(stars[i].trail[k], a - 0.24 * (k + 1), i, k + 1);
    }
  });
  const dispose = () => {
    untick();
    group.parent?.remove(group);
    for (const s of stars) for (const p of [s.main, ...s.trail]) p.material.dispose(); // 纹理共享缓存，不销
  };
  return {
    group,
    setLevel(l) { level = Math.max(0, Math.min(1, l)); },
    dispose,
  };
}
