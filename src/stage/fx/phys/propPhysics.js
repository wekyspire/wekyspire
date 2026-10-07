// PCG 道具物理（冲击波响应，2026-10-06）：无物理引擎的简化刚体——只服务「被冲击
// 推动飞散」的演出观感，不做持续模拟。世界实例挂 scene.userData.propPhys，由
// composeRoom 产出的 update(dt) 驱动 step；behaviors（B.physBody）在 impact 事件里
// 向世界提交刚体 / 触发散架。
//
// 模型：刚体 = 包围球近似 { obj, vel, angVel, r, restitution }。每帧：
//   vel.y += g·dt → 位置积分 → 地板碰撞（terrain heightAt，弹跳 + 切向摩擦）→
//   墙 AABB 反弹（房间铁律边界）→ 低动能 rest（摘出活跃表，位移结果保留）。
// 散架两级：L1 整体强度突破 → 子部件 detach 各自成刚体；L2 部件强度突破 → 部件
// 内图元 mesh 再散。各级强度与阈值带随机（观感：同款桶堆每次炸开的样子都不一样）。
import * as THREE from 'three';
import { FLOOR_Y } from '../../scenes/dungeon3D.js';
import { LEFT_WALL_X, WALL_TH, FLOOR_X1, BACK_WALL_Z } from '../../scenes/rooms/walls.js';

const G = -95;              // 重力（世界单位/s²；视觉口径，落得比真实快一点读「脆」）
const REST_SPEED = 3.5;     // 低于此线速度判静止（u/s）
const RADIUS_FALL = 34;     // 冲击距离衰减尺度（世界单位）

/** 房间碰撞边界（内侧）：左墙内面 / 右缘 / 背墙内面 / 前缘（封画外） */
const BOUNDS = {
  xMin: LEFT_WALL_X + WALL_TH / 2,   // -89
  xMax: FLOOR_X1 - 4,
  zMin: BACK_WALL_Z + 2,
  zMax: 118,                         // 前缘在画外，只拦不撞画内飞出
};

/** 冲击强度：源烈度 × 距离衰减（x/z 平面距离；y 不衰减——爆炸都有高度）。
 * K=18 校准口径：大爆炸 power 1.6 贴脸 s≈29（炸碎 integrity 22 的桶堆），
 * 30u 外 s≈15（位移推动），60u 外 s≈8.6（震颤）。 */
export function impactAt({ power, at }, pos) {
  if (!at) return (power ?? 0) * 18;
  const d = Math.hypot(pos.x - at.x, pos.z - at.z);
  return (power ?? 0) * 18 * RADIUS_FALL / (RADIUS_FALL + d);
}

// Box3 包围（部件 Group 含孙件）：中心 + 半径（球近似；够用——碰撞只求观感）
function sphereOf(obj, sceneRoot) {
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) return null;
  const c = box.getCenter(new THREE.Vector3());
  const r = box.getSize(new THREE.Vector3()).length() * 0.5;
  return { c, r: Math.max(r, 0.4) };
}

/** detach 保持世界变换（部件从 prop 组脱离成场景独立件） */
function detachToScene(child, sceneRoot) {
  const m = child.matrixWorld.clone();
  child.parent.remove(child);
  sceneRoot.add(child);
  child.matrix.copy(m);
  child.matrix.decompose(child.position, child.quaternion, child.scale);
  child.updateMatrixWorld(true);
}

export function createPropPhysics({ heightAt = null } = {}) {
  // heightAt(x,z)：地形高（terrain 体素柱）；null = 平地 FLOOR_Y
  const ground = (x, z) => (heightAt ? FLOOR_Y + heightAt(x, z) : FLOOR_Y);
  let sceneRoot = null;
  const bodies = [];    // 活跃刚体
  const world = {
    bind(root) { sceneRoot = root; return world; },
    /** 部件/整体入世界成刚体（fire-and-forget：rest 即出表，无回调） */
    fling(obj, vel, angVel = null) {
      if (!sceneRoot) return;
      const s = sphereOf(obj, sceneRoot);
      if (!s) return;
      // 刚体锚在包围球心：offset 记录球心相对 obj 原点的世界偏移，积分写回
      obj.getWorldPosition(_v1);
      const off = new THREE.Vector3().copy(s.c).sub(_v1);
      bodies.push({
        obj, off,
        r: s.r, restitution: 0.32 + Math.random() * 0.14,
        vel: vel.clone(),
        angVel: new THREE.Vector3().copy(angVel ?? _v2.set(
          (Math.random() - 0.5) * 7, (Math.random() - 0.5) * 7, (Math.random() - 0.5) * 7,
        )),
      });
    },
    step(dt) {
      const k = Math.min(dt, 1 / 20);   // 钳帧长防穿地（tab 切回大 dt 不炸）
      for (let i = bodies.length - 1; i >= 0; i--) {
        const b = bodies[i];
        b.vel.y += G * k;
        // 角速度积分（欧拉；部件翻滚读感）
        b.obj.rotation.x += b.angVel.x * k;
        b.obj.rotation.y += b.angVel.y * k;
        b.obj.rotation.z += b.angVel.z * k;
        b.obj.position.addScaledVector(b.vel, k);
        // 球心世界位（off 未随旋转更新——短飞行窗口内误差可接受）
        _v1.copy(b.off).applyQuaternion(b.obj.quaternion).add(b.obj.position);
        // 地板
        const gy = ground(_v1.x, _v1.z) + b.r;
        if (_v1.y < gy) {
          b.obj.position.y += gy - _v1.y;
          if (b.vel.y < 0) {
            b.vel.y = -b.vel.y * b.restitution;
            b.vel.x *= 0.72; b.vel.z *= 0.72;          // 落地切向摩擦
            b.angVel.multiplyScalar(0.7);
            if (b.vel.y < REST_SPEED * 0.6) b.vel.y = 0;  // 微弹直接趴下
          }
        }
        // 墙（球对内边界反射）
        if (_v1.x < BOUNDS.xMin + b.r && b.vel.x < 0) { b.obj.position.x += BOUNDS.xMin + b.r - _v1.x; b.vel.x = -b.vel.x * b.restitution; }
        if (_v1.x > BOUNDS.xMax - b.r && b.vel.x > 0) { b.obj.position.x -= _v1.x - (BOUNDS.xMax - b.r); b.vel.x = -b.vel.x * b.restitution; }
        if (_v1.z < BOUNDS.zMin + b.r && b.vel.z < 0) { b.obj.position.z += BOUNDS.zMin + b.r - _v1.z; b.vel.z = -b.vel.z * b.restitution; }
        if (_v1.z > BOUNDS.zMax - b.r && b.vel.z > 0) { b.obj.position.z -= _v1.z - (BOUNDS.zMax - b.r); b.vel.z = -b.vel.z * b.restitution; }
        // 静止出表（位移结果保留在场景里）
        if (_v1.y <= gy + 0.05 && b.vel.lengthSq() < REST_SPEED * REST_SPEED) {
          bodies.splice(i, 1);
        }
      }
    },
    dispose() { bodies.length = 0; },
  };
  return world;
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

// ---- 散架（两级） ----

/** 部件结构强度随机档案：挂 mesh/group 的 userData._physPart（首次访问时惰性建） */
export function physProfile(node, rng, { integrity = 1, combustibility = null } = {}) {
  if (!node.userData._physPart) {
    node.userData._physPart = {
      // 坚固度乘子与散架阈值（0.7–1.3 浮动——同款道具每次炸开不一样）
      integrity: integrity * (0.7 + rng() * 0.6),
      // 耐火乘子（可燃阈值 × 此值；越大越难点燃）——仅可燃族用
      flameResist: combustibility != null ? 0.7 + rng() * 0.6 : null,
      broken: false,
    };
  }
  return node.userData._physPart;
}

/**
 * 散架：node 按层级拆解——children detach 到场景根各自成刚体。
 * 返回拆出的部件数组（供强冲击追加 L2：部件内图元再散）。
 */
export function shatter(node, s, dir, world, rng) {
  const root = sceneRootOf(node);
  if (!root) return [];
  const children = [...node.children].filter(c => c.isObject3D && c.visible);
  const out = [];
  for (const c of children) {
    const prof = physProfile(c, rng);
    if (prof.broken) continue;
    prof.broken = true;
    detachToScene(c, root);
    // 部件初速：冲击方向 × 剩余烈度 × 部件坚固度反比 + 随机上抛
    const k = (0.55 + rng() * 0.75) * Math.min(1.4, s / 26) / Math.max(0.6, prof.integrity);
    _v1.set(
      (dir ? dir.x : (rng() - 0.5)) * 26 * k,
      (12 + rng() * 16) * k + 4,
      (dir ? dir.z : (rng() - 0.5)) * 26 * k,
    );
    world.fling(c, _v1);
    out.push(c);
  }
  return out;
}

/** 上溯到挂物理世界的场景层（composeRoom 的 group——散架部件 detach 到该层，
 * 随场景一起销毁；找不到则退到真根） */
export function sceneRootOf(node) {
  let o = node;
  while (o && !o.userData?.propPhys && o.parent) o = o.parent;
  return o;
}
