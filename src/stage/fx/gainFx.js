// 单位「获得」反馈三件（2026-10-15 重做，取代旧色彩mask+放缩）：
//   · playGainSweep   获得效果——剪影扫描光带（上行=增益提振 / 下行=减益压顶），
//                     光随体走（采样本体纹理的剪影掩码），230ms 一次性自清
//   · playShieldRings 获得护盾——脚下双环错峰扩散（假透视水平件，挂 rig 层），
//                     220ms；罩体脉冲仍由 shieldDome.pulse 承担（setUnit 差分）
//   · playCastConverge 施法起手（AI 增益/治疗类）——光点环收束进胸口，200ms
// 纪律：不再整面染色立牌（色彩mask）、不用裸放缩脉冲——反馈一律「结构化光」；
// 颜色烘常量（每次调用建新材质，构造期字面量进节点图）；件挂 _standee / _rig
// （姿态通道安全）；headless（无 document）一律返回 false 零成本。
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { texture, uniform, uv as uvOf, smoothstep, vec3, vec4 } from 'three/tsl';
import { glowTexture } from './orbs.js';

// 1x1 透明黑占位（WebGPU 不许绑空纹理；立绘后到换真图——同 bossStateFx 口径）
const PLACEHOLDER = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
PLACEHOLDER.needsUpdate = true;

/**
 * 获得效果：剪影扫描光带一次性播放（fire-and-forget，自带生命周期与自清）。
 * @param {UnitObject} unit
 * @param {number} colorHex 特征色（buff 绿 / debuff 紫，调用方定）
 * @param {object} opts  dir: +1 上行（提振）/ -1 下行（压顶）；durMs 缺省 230
 * @returns 是否受理（headless / 尸体 = false）
 */
export function playGainSweep(unit, colorHex, { dir = 1, durMs = 230 } = {}) {
  if (typeof document === 'undefined' || !unit || unit._dead) return false;
  const bodyMesh = unit._body;
  const t = texture(PLACEHOLDER);
  const uHasBody = uniform(bodyMesh.material.map ? 1 : 0);
  if (bodyMesh.material.map?.image) t.value = bodyMesh.material.map;
  const P = uniform(-0.15); // 扫描进度（-0.15→1.15：带在体缘外亮入亮出，端点无顿挫）
  const c = new THREE.Color(colorHex).multiplyScalar(1.3);   // 发光件微过阈（同星点口径）

  const mat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false });
  mat.blending = THREE.AdditiveBlending;
  mat.colorNode = (() => {
    const vUv = uvOf();
    const bandY = dir > 0 ? P : P.oneMinus();
    const d = vUv.y.sub(bandY);
    const gauss = d.mul(d).mul(-90.0).exp();   // 高斯带宽 ≈ ±0.15（UV）
    const sil = smoothstep(0.3, 0.65, t.sample(vUv).a).mul(uHasBody);
    const mask = sil.max(uHasBody.oneMinus().mul(0.35)); // 无立绘退化为整面弱带
    const fadeOut = P.sub(0.75).mul(4.0).clamp(0.0, 1.0).oneMinus();
    const fadeIn = P.mul(10.0).clamp(0.0, 1.0);
    const a = gauss.mul(mask).mul(fadeOut).mul(fadeIn).clamp(0.0, 1.0);
    return vec4(vec3(c.r, c.g, c.b).mul(a), a);
  })();
  const mesh = new THREE.Mesh(bodyMesh.geometry, mat);
  mesh.name = 'gainSweep';
  mesh.position.set(bodyMesh.position.x, bodyMesh.position.y, 0.86);
  mesh.renderOrder = 1;
  unit._standee.add(mesh);
  let el = 0;
  const untick = unit.addTick((dt) => {
    el += dt;
    const p = Math.min(1, el / (durMs / 1000));
    const eased = 1 - (1 - p) ** 2;             // power2.out：起步快、临尾减速
    P.value = eased * 1.3 - 0.15;
    if (p >= 1 || unit._dead) {
      untick();
      mesh.parent?.remove(mesh);
      mat.dispose();
    }
  });
  return true;
}

// 脚下环纹理（厚描边软环——读作「地面光圈」；方角语言归 UI 铬件，地面光是氛围件用圆）
let _ringTex = null;
function ringTexture() {
  if (_ringTex) return _ringTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(255,255,255,1)';
  g.lineWidth = 10;
  g.beginPath();
  g.arc(64, 64, 48, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.45)';
  g.lineWidth = 4;
  g.beginPath();
  g.arc(64, 64, 38, 0, Math.PI * 2);
  g.stroke();
  _ringTex = new THREE.CanvasTexture(c);
  _ringTex.colorSpace = THREE.SRGBColorSpace;
  return _ringTex;
}

/**
 * 获得护盾：脚下双环错峰扩散（fire-and-forget）。挂 rig 层（yaw 对准，地面件铁律：
 * 水平假透视椭圆）。罩体的凝实脉冲由 shieldDome 在 sync 差分时自播，此处不重复。
 * @returns 是否受理
 */
export function playShieldRings(unit, colorHex = 0x8fc3ff) {
  if (typeof document === 'undefined' || !unit || unit._dead) return false;
  const R = (unit._groundRadius ?? unit._standeeHeight * 0.32) * 2.1;
  const mk = (delay) => {
    const mat = new THREE.MeshBasicMaterial({
      map: ringTexture(), color: colorHex, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(R * 2, R * 2 * 0.5), mat); // 假透视：y 压半
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, 0.15, 0.4);
    mesh.name = 'shieldRing';
    unit._rig.add(mesh);
    let el = -delay;
    const untick = unit.addTick((dt) => {
      el += dt;
      if (el < 0) return;
      const p = Math.min(1, el / 0.22);
      const s = 0.55 + p * 0.85;
      mesh.scale.set(s, s * 0.9, 1);
      mat.opacity = 0.85 * (1 - p) ** 1.5;
      if (p >= 1 || unit._dead) {
        untick();
        mesh.parent?.remove(mesh);
        mat.dispose();
        mesh.geometry.dispose();
      }
    });
  };
  mk(0);
  mk(0.07);
  return true;
}

/**
 * 施法起手（AI 增益/治疗类的聚能）：一圈光点向胸口收束后即散（读「聚力」，
 * payoff 在后续节拍）。世界向 sprite（挂舞台粒子门面，非单位子件——光点独立于姿态）。
 * @param {object} particles 舞台粒子门面（spawnSprite 所在）
 * @returns 是否受理
 */
export function playCastConverge(unit, particles, colorHex = 0xffe0a0) {
  if (typeof document === 'undefined' || !unit || !particles?.spawnSprite) return false;
  const H = unit._standeeHeight ?? 22;
  const cx = unit.position.x;
  const cy = unit.position.y + H * 0.55;
  const tint = '#' + colorHex.toString(16).padStart(6, '0');
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.3;
    const r = H * 0.42;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r * 0.6;
    const d = Math.hypot(cx - x, cy - y) || 1;
    const speed = 5.5 + Math.random() * 1.5;
    particles.spawnSprite(x, y, {
      texture: glowTexture(tint),
      width: 1.5, height: 1.5,
      vx: ((cx - x) / d) * speed, vy: ((cy - y) / d) * speed,
      gravity: 0, drag: 6.5, ttl: 0.26, scalePop: 0.3, fadeIn: true,
      z: (unit.position.z ?? 0) + 0.6,
    });
  }
  return true;
}
