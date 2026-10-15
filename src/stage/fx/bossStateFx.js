// Boss 常驻状态可视化（bossStateFx）：aura 系统按**效果 id**驱动，
// Boss 的「机制状态」（MEFM 装甲= defense 层数、卡达斯电弧= rage 层数、穿山甲热缝=
// momentum 层数……）需要按**单位 defId** 的导演钩——注册表与运行器集中在本文件，
// 内容（哪个 Boss 驱动哪些件）注册在各 bosses/*.js（内容归属原则）。
//   挂点① sync.js place()：aura 对账之后每同步拍调 syncBossStateFx(obj, unitProj)
//     ——director 只读投影、推 overlay/setLevel 目标值，收敛由件内部 tick 缓动完成；
//   挂点② units.js _damageHit：目标侧受击补充（boss 被打的主题反馈——装甲涟漪/
//     电弧噼啪/岩屑），registerBossHurtFx 注册，_fxRunScript fire-and-forget。
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  texture, uniform, uv, vec2, smoothstep, clamp, max, min,
} from 'three/tsl';

// —— 常驻导演：defId → (obj, unitProj) => void（每 sync 拍调用；必须幂等、廉价） ——
const STATE_DIRECTORS = new Map();
export function registerBossStateFx(defId, fn) { STATE_DIRECTORS.set(defId, fn); }

/** sync.js place() 的 aura 对账后调用。非 Boss（未注册）零成本直返。 */
export function syncBossStateFx(obj, unitProj) {
  const fn = STATE_DIRECTORS.get(unitProj?.defId);
  if (!fn) return;
  try { fn(obj, unitProj); } catch (err) { console.warn('[bossFx] state director 异常：', err); }
}

// —— 受击补充：defId → async (ctx, deps, {unit, dealt, absorbed, fromX}) ——
const HURT_BEATS = new Map();
export function registerBossHurtFx(defId, fn) { HURT_BEATS.set(defId, fn); }
export function bossHurtFxOf(defId) { return HURT_BEATS.get(defId) ?? null; }

// ---------------------------------------------------------------------------
// 剪影壳件基座（stasisShell 样板的通用化）：与本体贴立绘同几何同 UV、采样同一张
// map（剪影内才有壳），挂 _standee（随姿态通道），tick 自愈重绑（setArt 换图/几何）。
// 差异件只管：① 自己的 uniforms（makeUniforms）② 着色链（buildColor(t, u) → vec4）。
// level 口径：setLevel 只设**目标值**，tick 指数缓动逼近（director 每拍直推不闪跳）。
// ---------------------------------------------------------------------------

// 1x1 透明黑占位纹理（WebGPU 不许绑空纹理；立绘后到 syncMap 换真图）
const PLACEHOLDER = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
PLACEHOLDER.needsUpdate = true;

/**
 * @param {UnitFxLayer} layer
 * @param {object} o
 * @param {string} o.name        调试名（mesh/group 命名）
 * @param {number} [o.z]         standee 内 z 槽位（同层多件错开：stasis 0.8）
 * @param {(u:object)=>void} [o.makeUniforms]  往 u 里补自定义 uniform
 * @param {(t:TextureNode,u:object)=>Node} o.buildColor  着色链（vec4：rgb=色，a=透明度）
 * @param {(dt:number,h:object)=>void} [o.onTick] 件自推进（涟漪钟等；u.uLevel 写入之后调）
 * @returns 句柄 { group, mesh, u, setLevel(目标值), levelNow(), dispose } | null（headless）
 */
export function makeShellPiece(layer, o) {
  if (typeof document === 'undefined') return null;
  const unit = layer.unit;
  const bodyMesh = unit._body;
  const t = texture(PLACEHOLDER);
  const u = {
    uTexel: uniform(new THREE.Vector2(1 / 256, 1 / 256)),
    uLevel: uniform(0),
    uTime: layer.body.uTime, // 共享 L0 的钟（同源同帧）
    uHasBody: uniform(bodyMesh.material.map ? 1 : 0),
  };
  o.makeUniforms?.(u);
  const mat = new MeshBasicNodeMaterial();
  mat.colorNode = o.buildColor(t, u);
  mat.transparent = true;
  mat.depthWrite = false;
  mat.fog = false;
  const mesh = new THREE.Mesh(bodyMesh.geometry, mat); // 几何共享引用（dispose 不销）
  mesh.name = o.name;
  mesh.position.set(bodyMesh.position.x, bodyMesh.position.y, o.z ?? 0.82);
  mesh.renderOrder = 1; // 同 standee 内压过本体
  const group = new THREE.Group();
  group.name = `${o.name}Group`;
  group.add(mesh);
  unit._standee.add(group);
  const syncMap = () => {
    const map = bodyMesh.material.map;
    if (map?.image) {
      t.value = map;
      u.uHasBody.value = 1;
      u.uTexel.value.set(1 / map.image.width, 1 / map.image.height);
    }
  };
  syncMap();
  const st = { cur: 0, target: 0 };
  const h = {
    group, mesh, u,
    setLevel(l) { st.target = Math.max(0, Math.min(1, l)); },
    levelNow() { return st.cur; },
    dispose() {
      untick();
      group.parent?.remove(group);
      mat.dispose();
    },
  };
  const untick = unit.addTick((dt) => {
    // 指数缓动逼近目标（director 每 sync 拍直推目标值，帧间平滑由这里完成）
    const k = 1 - Math.exp(-dt * 5.5);
    st.cur += (st.target - st.cur) * k;
    if (Math.abs(st.target - st.cur) < 0.004) st.cur = st.target;
    u.uLevel.value = st.cur;
    group.visible = st.cur > 0.015 && !unit._dead;
    if (mesh.geometry !== bodyMesh.geometry) mesh.geometry = bodyMesh.geometry;
    mesh.position.set(bodyMesh.position.x, bodyMesh.position.y, o.z ?? 0.82);
    if (!u.uHasBody.value && bodyMesh.material.map) syncMap();
    o.onTick?.(dt, h);
  });
  return h;
}

// 立绘剪影内掩码 + 边缘线（stasisShell 剪影纪律的复用件）：sa = 剪影内 1，
// rim = 4 邻域 alpha 极差检出的边缘带。buildColor 里 `shellMask(t, u)` 一行接入。
export function shellMask(t, u) {
  const vUv = uv();
  const sa = smoothstep(0.3, 0.65, t.sample(vUv).a).mul(u.uHasBody).toVar();
  const aR = u.uTexel.x.mul(1.5), aT = u.uTexel.y.mul(1.5);
  const a0 = smoothstep(0.3, 0.65, t.sample(vUv.add(vec2(aR, 0.0))).a);
  const a1 = smoothstep(0.3, 0.65, t.sample(vUv.sub(vec2(aR, 0.0))).a);
  const a2 = smoothstep(0.3, 0.65, t.sample(vUv.add(vec2(0.0, aT))).a);
  const a3 = smoothstep(0.3, 0.65, t.sample(vUv.sub(vec2(0.0, aT))).a);
  const rim = clamp(max(max(a0, a1), max(a2, a3))
    .sub(min(min(a0, a1), min(a2, a3))).mul(1.8), 0.0, 1.0).mul(u.uHasBody).toVar();
  return { sa, rim };
}
