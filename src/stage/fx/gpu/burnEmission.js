// 燃烧发射条目表（GPU 粒子系统的「GPU 侧生成粒子 metadata」环节）：
// WebGPU compute 化重写——旧版是 64px/格 的 RT 图集片元 pass（每活跃单位一列，
// 全场 4096 纹素/单位全量驻留，spawn pass 再随机纹素 rejection 采样）；compute 后
// **不再是纹理**：每帧一个压缩 pass 把「热纹素」紧缩成 storage buffer 条目列表
// （vec4 = 世界坐标 xyz + 发射强度 w），spawn 侧（burnSparks custom 类型的粒子 compute）
// 随机取条目 + 强度门控即可。语义与旧图集一一对应：
//   · 数据源以旧实现为准——立绘 alpha（body.material.map，剪影门控）×
//     **本体着色同一份燃烧场函数**（unitBodyFx.js 的 ubfBurnEmission TSL 件，
//     碳化场单一事实源）× bodyMesh.matrixWorld（含姿态链，悬挂点铁律同源）；
//   · 每单位仍采样 64×64 = 4096 点（TILE 保留），强度 > 0.12 的才入表
//     （= 旧「图集纹素强度门控」，只是不再存冷纹素）；
//   · 世界坐标照旧沿立牌 z（billboard 朝镜头方向）抬 1.6——出生点贴平面会被
//     本体深度裁掉半截（旧版同一理由）。
// 结构：条目表 entries（vec4×MAX_ENTRIES）+ atomic 计数 count（uint×1）。
// 每帧：① reset（1 线程，计数归零）→ ② 逐活跃单位一个 compute 派发（atomicAdd
// 抢条目槽）。同队列提交天然保序，spawn 侧读到的计数必然是本帧终值。
// ⚠ 每单位一个派发而非单 dispatch 循环 6 单位：WGSL 不能按下标动态选纹理绑定，
// 且逐单位换挂 uniform/纹理与旧「逐列渲染」的值拷贝纪律一一对应（纹理经
// TextureNode.value 换挂——RT ping-pong 同款机制）。
import * as THREE from 'three';
// r185 把 WebGPU 专属类拆在 three/webgpu 入口（共享 three.core.js 单例，混用无分裂）
import { StorageBufferAttribute } from 'three/webgpu';
import {
  Fn, If, atomicStore, atomicAdd, uniform, texture, storage,
  uint, float, vec2, vec3, vec4, ivec2, clamp, smoothstep, normalize, instanceIndex,
} from 'three/tsl';
import { ubfBurnEmission } from '../unitBodyFx.js';

const TILE = 64; // 每单位采样网格边长（旧图集每格 64×64 纹素，口径不变）
export const MAX_BURN_ENTRIES = 4096; // 条目表容量（≈6 单位 × 火缘热纹素均值，溢出静默丢）
export const EMISSION_GATE = 0.12; // 强度门控阈值（旧 spawn 侧 rejection 阈值上移到压缩侧）

// 1×1 白色占位纹理：未挂立绘/异步未到图时保证纹理绑定合法（uHasBody=0 门控静默）
const FALLBACK_TEX = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
FALLBACK_TEX.needsUpdate = true;

/**
 * 建燃烧发射条目表（compute 版）。
 * @param {object} options
 * @param {number} options.maxUnits 同时活跃上限（一场战斗敌我单位数内）
 */
export function createBurnEmission({ maxUnits = 6 } = {}) {
  // ---- GPU 缓冲：条目表（vec4 × N）+ atomic 计数（uint × 1）----
  const entriesAttr = new StorageBufferAttribute(new Float32Array(MAX_BURN_ENTRIES * 4), 4);
  const countAttr = new StorageBufferAttribute(new Uint32Array(1), 1);
  const entriesS = storage(entriesAttr, 'vec4', MAX_BURN_ENTRIES);
  const countS = storage(countAttr, 'uint', 1).setAtomic(true); // 本模块内以 atomic 语义绑定

  // ---- reset pass：计数归零（1 线程；每帧发射压缩前先行）----
  const resetFn = Fn(() => {
    atomicStore(countS.element(uint(0)), uint(0));
  });
  const resetNode = resetFn().compute(1);

  // ---- 逐单位压缩 pass（每槽一套节点：纹理 + 逐单位 uniform）----
  const slots = [];
  for (let i = 0; i < maxUnits; i++) {
    // 每槽独立 uniform 节点：同帧多派发各自取各自值，不共享（共享节点在多派发间
    // 的上传时序不可靠——沿用旧「逐列拷 uniform 值」纪律）
    const s = {
      bodyTex: texture(FALLBACK_TEX),     // TextureNode：每帧 .value 换挂该单位立绘
      uBurn: uniform(0),
      uTime: uniform(0),
      uCalm: uniform(0),
      uHasBody: uniform(0),
      uModel: uniform(new THREE.Matrix4()), // bodyMesh.matrixWorld（含姿态链）
      uQuadSize: uniform(new THREE.Vector2(16, 22)), // 立牌几何（宽, 高）
    };
    const fn = Fn(() => {
      const li = instanceIndex; // uint 0..4095
      const lx = li.mod(uint(TILE));
      const ly = li.div(uint(TILE));
      const fxUv = vec2(float(lx).add(0.5), float(ly).add(0.5)).div(float(TILE)); // y=0 行 = 脚底（与立绘 uv 同向）
      // WGSL textureLoad 的 coords 是 vec2<i32>——整型纹素坐标走 ivec2 截断
      const texel = ivec2(clamp(fxUv, 0.0, 0.9999).mul(vec2(s.bodyTex.size())));
      const alpha = s.bodyTex.load(texel).a; // compute 内只能 textureLoad（铁律）
      // 剪影门控：与旧图集同阈值（smoothstep(0.3, 0.65)，与 stasisShell 同口径），
      // 透明区不发射（矩形板火星病灶）
      const sil = smoothstep(0.3, 0.65, alpha).mul(s.uHasBody);
      const str = ubfBurnEmission(fxUv, s.uBurn, s.uTime, s.uCalm).mul(sil);
      If(str.greaterThan(EMISSION_GATE), () => {
        // 世界坐标：立绘局部平面 → matrixWorld → 沿 billboard z 抬 1.6（旧版同式）
        const local = vec3(
          fxUv.x.sub(0.5).mul(s.uQuadSize.x),
          fxUv.y.sub(0.5).mul(s.uQuadSize.y),
          float(0.0));
        const wp = s.uModel.mul(vec4(local, 1.0)).xyz
          .add(normalize(s.uModel.mul(vec4(0.0, 0.0, 1.0, 0.0)).xyz).mul(1.6));
        const ei = atomicAdd(countS.element(uint(0)), uint(1)); // 抢槽（返回旧值）
        If(ei.lessThan(uint(MAX_BURN_ENTRIES)), () => {
          entriesS.element(ei).assign(vec4(wp, str));
        });
        // 表满静默丢（旧图集无此限，实际火缘热纹素远低于容量；丢 = 本帧少发几颗）
      });
    });
    s.node = fn().compute(TILE * TILE, [64]);
    slots.push(s);
  }

  /**
   * 本帧压缩的 compute 节点列表（不直接派发——粒子池 v2 把它与粒子 pass 合并成
   * **一次** renderer.compute 提交，保证 reset → 压缩 → spawn 的队列内顺序）。
   * 仅活跃燃烧单位列表非空时被调。
   * @param {Array<{unit: *}>} burnUnits 活跃燃烧单位列表（burnSparks custom 类型持有）
   * @returns {Array} 本帧要派发的 ComputeNode 列表（reset + 逐活跃单位压缩）
   */
  function update(burnUnits) {
    const nodes = [resetNode];
    const n = Math.min(burnUnits.length, maxUnits);
    for (let i = 0; i < n; i++) {
      const { unit } = burnUnits[i];
      const body = unit._body;
      const rec = unit._fxLayer?.body;
      if (!body || !rec) continue; // 本体/特效层未就绪：本帧该单位不发射（旧 continue 同义）
      const s = slots[i];
      // 逐单位拷 uniform 值（uBurn/uTime/uCalm 来自该单位 _fxLayer.body 的 uniform 节点值）
      s.uBurn.value = rec.uBurn.value;
      s.uTime.value = rec.uTime.value;
      s.uCalm.value = rec.uCalm.value;
      s.uModel.value.copy(body.matrixWorld); // 上一帧矩阵（1 帧滞后无感，旧版同口径）
      const gp = body.geometry.parameters;
      s.uQuadSize.value.set(gp?.width ?? 16, gp?.height ?? 22);
      s.bodyTex.value = body.material.map ?? FALLBACK_TEX;
      s.uHasBody.value = body.material.map ? 1 : 0;
      nodes.push(s.node);
    }
    return nodes;
  }

  function dispose() {
    entriesAttr.dispose();
    countAttr.dispose();
    // FALLBACK_TEX 是模块级单例（可能被下一局复用），不随实例销毁
  }

  return { entriesAttr, countAttr, update, dispose, maxUnits, MAX_ENTRIES: MAX_BURN_ENTRIES };
}
