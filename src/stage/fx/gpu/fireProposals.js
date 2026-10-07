// 场景火焰发射提案（2026-10-06 燃烧系统的 GPU↔GPU 零 CPU 通路）：
// 写端 = 燃烧部件材质的 fragment shader（combustion.js 挂的 modifier 尾部）——
// 按火势逐像素概率抢槽，把世界坐标 + 强度写进提案表；读端 = sceneFire 粒子类型
// 的 spawn 段（custom dispatch）。清零 = 池 update 序列尾一条 1-invocation compute
// （时序：本帧 spawn 读 → 尾清 → 渲染期物体写新提案 → 下帧 spawn 读，序内无竞态）。
// 与 burnEmission（单位燃烧）的区别：那边是 compute 压缩条目，这边按需求**在物体
// fragment 上算生成位置**——表面积自动加权（大件火多、远件像素少粒子少，天然 LOD）。
import * as THREE from 'three';
import { StorageBufferAttribute } from 'three/webgpu';
import {
  Fn, If, Loop, storage, uniform, uint, int, float, vec3, vec4, min, max, clamp, exp, fract, sin,
  atomicAdd, atomicStore, instanceIndex,
} from 'three/tsl';
import { windField } from './wind.js';
import { defineParticleType } from './particleTypes.js';

export const MAX_FIRE_PROPOSALS = 1536;   // 每帧提案容量（多物同烧溢出静默丢）

let _P = null;
/** 提交通路单例（storage 节点跨材质/粒子管线共享同一 GPUBuffer） */
export function fireProposals() {
  if (_P) return _P;
  const attr = new StorageBufferAttribute(new Float32Array(MAX_FIRE_PROPOSALS * 4), 4);
  const countAttr = new StorageBufferAttribute(new Uint32Array(1), 1);
  const slotsS = storage(attr, 'vec4', MAX_FIRE_PROPOSALS);
  const counterS = storage(countAttr, 'uint', 1).setAtomic(true);      // 写端（atomic 抢槽）
  const counterRO = storage(countAttr, 'uint', 1);                     // 读端（spawn 计数）
  const clearNode = Fn(() => {
    atomicStore(counterS.element(uint(0)), uint(0));
  })().compute(1);
  _P = { attr, countAttr, slotsS, counterS, counterRO, clearNode };
  return _P;
}

/** 池尾清零节点（particlePool.update 的 compute 序列 append；读后清，序内安全） */
export function fireProposalClearNode() { return fireProposals().clearNode; }

/**
 * 写端语句（须在 compute Fn 栈内）：过门 invocation atomicAdd 抢槽，写
 * [posWorld, intensity]。⚠ 写端必须走 compute——Three 的 WGSL 构建器对非
 * compute 阶段的 storage 一律降 read-only（getNodeAccess 硬编码），材质
 * fragment 直写提案在实现层被封死；位置计算改由 proposer（部件几何表面
 * 采样 compute）承担，语义等价：零 CPU 读回、一次提交。
 */
export function fireEmitAssign(posWorld, intensity) {
  const slot = atomicAdd(fireProposals().counterS.element(uint(0)), uint(1)).toVar();
  If(slot.lessThan(uint(MAX_FIRE_PROPOSALS)), () => {
    fireProposals().slotsS.element(slot).assign(vec4(posWorld, intensity));
  });
}

// ---- 燃烧部件 proposer（每部件一个：几何表面采样 → 提案） -----------------------
// proposerSet 由 combustion.ignitePart 注册；sceneFire 的 custom.tick 每帧把
// 活跃 proposer 的 dispatch 排进池 update 序列（burnEmission 逐单位压缩同款）。
const proposerSet = new Set();
let _proposerFrame = 0;

/** 每帧驱动：推矩阵/帧号 → 返回本帧 proposer dispatch 列表（sceneFire 的 tick） */
export function tickFireProposers() {
  _proposerFrame += 1;
  const ns = [];
  for (const p of proposerSet) {
    p.tick(_proposerFrame);
    ns.push(p.node);
  }
  return ns;
}

const phash = Fn(([n]) => fract(sin(n).mul(43758.5453123)));

/**
 * 建一个燃烧部件的发射采样器：读部件几何 position（一次性上传 storage），
 * 每 dispatch 256 个 invocation 各随机取三顶点重心插值出表面点，按火势概率
 * 抢槽写提案。世界矩阵由 CPU 侧每帧拷进 uniform（单向推值，非读回——部件
 * 会被物理撞飞，矩阵必须逐帧新鲜）。
 */
export function createFireProposer(mesh, uFire, uTime) {
  const geo = mesh.geometry;
  const pos = geo?.attributes?.position;
  if (!pos) return null;
  // ---- CPU 一次性预处理（着火时）：三角形顶点表 + 面积前缀和（CDF）——
  // per-area uniform 采样的根基：大三角形按面积等概率密度采中（随机顶点法
  // 会过采样小三角形）。共享顶点展开存（几何几百三角形，几十 KB 无所谓）
  const idx = geo.index;
  const nTri = Math.floor((idx ? idx.count : pos.count) / 3);
  if (nTri < 1) return null;
  const triArr = new Float32Array(nTri * 9);
  const cdfArr = new Float32Array(nTri);
  let acc = 0;
  const vx = (t) => pos.getX(t), vy = (t) => pos.getY(t), vz = (t) => pos.getZ(t);
  for (let t = 0; t < nTri; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    const ax = vx(i0), ay = vy(i0), az = vz(i0);
    const e1x = vx(i1) - ax, e1y = vy(i1) - ay, e1z = vz(i1) - az;
    const e2x = vx(i2) - ax, e2y = vy(i2) - ay, e2z = vz(i2) - az;
    // 叉积模的一半 = 三角形面积
    acc += 0.5 * Math.hypot(
      e1y * e2z - e1z * e2y,
      e1z * e2x - e1x * e2z,
      e1x * e2y - e1y * e2x,
    );
    const o = t * 9;
    triArr[o] = ax; triArr[o + 1] = ay; triArr[o + 2] = az;
    triArr[o + 3] = vx(i1); triArr[o + 4] = vy(i1); triArr[o + 5] = vz(i1);
    triArr[o + 6] = vx(i2); triArr[o + 7] = vy(i2); triArr[o + 8] = vz(i2);
    cdfArr[t] = acc;
  }
  const totalArea = acc;
  const triAttr = new StorageBufferAttribute(triArr, 3);
  const cdfAttr = new StorageBufferAttribute(cdfArr, 1);
  const triS = storage(triAttr, 'vec3', nTri * 3);
  const cdfS = storage(cdfAttr, 'float', nTri);
  const uModel = uniform(new THREE.Matrix4());
  const uFrame = uniform(0);
  const BIN_STEPS = Math.ceil(Math.log2(nTri)) + 1;
  const fn = Fn(() => {
    const i = float(instanceIndex);
    const h1 = phash(i.mul(0.719).add(uFrame.mul(0.613))).toVar();
    const h2 = phash(h1.mul(91.7).add(0.13)).toVar();
    const h3 = phash(h1.mul(47.3).add(0.37)).toVar();
    const h4 = phash(h1.mul(71.9).add(0.61)).toVar();
    // ① 面积加权选三角形：r ∈ [0, totalArea) 二分查 CDF（固定步数循环；
    //    [tri, hi) 收敛到单元素——面积退化三角形（acc 平坦段）天然被跳过或
    //    命中同一槽，无副作用）
    const r = h1.mul(float(totalArea));
    const tri = int(0).toVar();
    const hi = int(nTri).toVar();
    Loop(BIN_STEPS, () => {
      const mid = tri.add(hi).div(int(2));
      If(mid.lessThan(int(nTri)).and(cdfS.element(mid).greaterThanEqual(r)), () => {
        hi.assign(mid);
      }).Else(() => {
        tri.assign(max(mid, tri.add(int(1))));
      });
    });
    const base = tri.mul(int(3));
    const a = triS.element(base).toVar();
    const b = triS.element(base.add(int(1))).toVar();
    const c = triS.element(base.add(int(2))).toVar();
    // ② 三角形内均匀采样：u+v>1 时折返（平行四边形对折回三角形）
    const u = h2.toVar();
    const v = h3.toVar();
    If(u.add(v).greaterThan(1.0), () => {
      u.assign(u.oneMinus());
      v.assign(v.oneMinus());
    });
    const p = a.add(b.sub(a).mul(u)).add(c.sub(a).mul(v));
    If(h4.lessThan(uFire.mul(0.6)), () => {
      fireEmitAssign(uModel.mul(vec4(p, 1.0)).xyz, uFire);
    });
  });
  const proposer = {
    node: fn().compute(256, [64]),
    tick(frame) {
      uFrame.value = frame;
      mesh.updateWorldMatrix(true, false);
      uModel.value.copy(mesh.matrixWorld);
    },
    dispose() { proposerSet.delete(proposer); },
  };
  proposerSet.add(proposer);
  return proposer;
}

// ---- sceneFire 粒子类型：spawn 读提案，积分上飘 + 风 + drag ---------------------
const hash1 = Fn(([n]) => fract(sin(n).mul(43758.5453123)));

export const SCENE_FIRE = defineParticleType({
  name: 'sceneFire', space: 'world', cap: 2048, kind: 'custom',
  // rate 是 spawn 窗口推进率（真实出生还须提案表非空）；rateScale 由 combustion
  // 按燃烧部件火势总量推（火越多窗口越大——粒子数随火势缩放）
  spawn: { rate: 900, ttl: 0.85, ttlJit: 0.35, vel: [0, 10.5, 0], velJit: 2.4, spread: 0, gravity: 3.4, drag: 1.15, windK: 0.8 },
  render: { size: 1.7, sizeEndK: 0.12, color: [1.9, 0.78, 0.22], alpha: 0.9, heat: 0.5, ageHeat: 2.2 },
  custom: {
    build(ctx) {
      const P = fireProposals();
      const fn = Fn(() => {
        const li = int(instanceIndex);
        const idx = ctx.globalIdx(li);
        const A = ctx.stateS.element(idx.mul(int(2)));
        const B = ctx.stateS.element(idx.mul(int(2)).add(int(1)));
        const P1 = ctx.payloadS.element(idx.mul(int(2)).add(int(1)));

        If(ctx.spawnWindow(li), () => {
          const h1 = hash1(float(idx).mul(0.719).add(ctx.uFrame.mul(0.613))).toVar();
          const h2 = hash1(h1.mul(91.7).add(0.13)).toVar();
          const h3 = hash1(h1.mul(47.3).add(0.37)).toVar();
          const h4 = hash1(h1.mul(71.9).add(0.61)).toVar();
          const h6 = hash1(h1.mul(33.1).add(0.83)).toVar();
          // 提案表非空才出生：随机槽位取条目（hash 均匀覆盖）
          const live = min(float(P.counterRO.element(uint(0))), float(MAX_FIRE_PROPOSALS)).toVar();
          If(live.greaterThan(0.5), () => {
            const e = P.slotsS.element(uint(h2.mul(live))).toVar();
            const wasAlive = A.w.greaterThanEqual(0.0).and(A.w.lessThan(1.0));
            ctx.aliveAdd(wasAlive);
            const r1 = ctx.row(1); // ttl w
            const r3 = ctx.row(3); // vel + velJit
            const r7 = ctx.row(7); // ttlJit y
            const v0 = r3.xyz.add(vec3(h3, h4, h6).sub(0.5).mul(2.0).mul(r3.w))
              .mul(float(0.7).add(h2.mul(0.6)));
            const ttlA = max(r1.w.mul(float(1.0).add(h6.sub(0.5).mul(2.0).mul(r7.y))), 0.05);
            A.assign(vec4(e.xyz.add(vec3(h2, h3, h4).sub(0.5).mul(1.1)), 0.001));
            B.assign(vec4(v0, h1));
            // payload.w 携带提案强度（旺火偏白——present 色温调制预留）
            P1.assign(vec4(0.0, 0.0, ttlA, e.w));
          });
        }).Else(() => {
          // —— 积分（风/浮力/阻尼；与 burnSparks 同式）——
          const age = A.w;
          If(age.greaterThanEqual(0.0).and(age.lessThan(1.0)), () => {
            const r4 = ctx.row(4); // spread, gravity, drag, windK
            const ttlA = P1.z;
            const vel = B.xyz.add(windField(A.xyz, ctx.uTime).mul(r4.w)
              .add(vec3(0.0, r4.y, 0.0)).mul(ctx.uDt))
              .mul(exp(r4.z.negate().mul(ctx.uDt)));
            const ageNew = age.add(ctx.uDt.div(ttlA));
            const posNew = A.xyz.add(vel.mul(ctx.uDt));
            If(ageNew.greaterThanEqual(1.0), () => {
              A.assign(vec4(posNew, 1.5));
              ctx.aliveSub();
            }).Else(() => {
              A.assign(vec4(posNew, ageNew));
              B.assign(vec4(vel, B.w));
              P1.assign(vec4(clamp(ageNew, 0.0, 1.0), 0.0, ttlA, P1.w));
            });
          });
        });
      });
      return {
        update: fn().compute(ctx.segCap, [64]),
        tick: () => tickFireProposers(),   // 燃烧部件表面采样 → 提案（排在 spawn 前）
        api: null,
      };
    },
  },
});
