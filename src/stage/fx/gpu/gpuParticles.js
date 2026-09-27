// GPU 粒子池（纯 GPU Driven 粒子系统）——WebGPU compute 版（2026-09-27，原 GPGPU
// 片元 ping-pong 全面重写；范式铁律见 quest_prompts/WEBGPU_MIGRATION.md）：
//   · 状态 = StorageBufferAttribute（pos.xyz+age01 / vel.xyz+emitterIdx+ttl抖动，
//     每粒子 2×vec4，与旧两张 RGBA32F 状态纹理逐字段对齐）；
//   · 推进 = 每帧两个 compute 派发（renderer.compute 一次提交，队列内保序）：
//     ① 粒子 spawn + 积分一体；② 渲染色回填（读本帧终态写 aColor，见渲染件注）；
//   · 游标 = **CPU 单线程元数据**（环形游标语义不变：cur += rate×active×dt，环回卷
//     覆盖最旧）——旧 GPU 侧 cursor 纹理是「WebGL2 无 compute」时代的妥协，compute 化
//     后游标只是 16 个标量，留在 CPU 省一个 pass 与 ping-pong（任务书口径：
//     atomic 或单线程元数据均可）；
//   · 发射源两种：kind 0 点源（位置/锥形初速）；kind 1 燃烧条目表（burnEmission.js
//     —— compute 压缩出的世界坐标+强度条目列表，spawn 随机取条目 + 强度门控 rejection）；
//   · 渲染 = Sprite + InstancedBufferGeometry + PointsNodeMaterial（moonDust 范式——
//     WebGPU point-list 恒 1 像素，sizeNode × DPR × (画布高/2) ÷ 视深重演旧
//     gl_PointSize 公式），顶点直读粒子状态与发射器参数 storage（WebGPU 顶点 stage
//     读 storage 合法；three 对非 compute stage 自动降 READ_ONLY）。
//     ⚠ 实测（2026-09-27 探针逐路判责）：fragment stage 直读 storage 与
//     varying(storage 派生节点) 都返回黑——per-instance 颜色/寿命到不了片元。
//     解法 = ② 号 pass 把渲染色 rgba 写进 StorageInstancedBufferAttribute
//     （STORAGE|VERTEX 双用途 buffer），片元按普通逐实例 attribute 读（实测正常）。
// 上限：compute 后没有纹理尺寸约束，池 4096（64×64）→ **16384**。
// 渲染纪律：additiveLight()（rgb 加算 alpha 不占地）+ bloom offset 通道
//   （bloomPassFlag 分支写起晕强度，颜色本体不拉爆）+ BLOOM_LAYER（setBloomWriter）。
// 降级：非 WebGPU 后端（forceWebGL 验收对照 / 假 renderer）→ create 返回 null
//   （调用方回退 CPU 粒子池）。
import * as THREE from 'three';
// r185 把 WebGPU 专属类拆在 three/webgpu 入口（three 与 three/webgpu 共享
// three.core.js 单例，混用 import 无 instanceof 分裂——迁移方案文档 §一）
import { StorageBufferAttribute, PointsNodeMaterial } from 'three/webgpu';
import {
  Fn, If, Loop, Break, uniform, storage, select, uv,
  float, int, uint, vec3, vec4,
  floor, fract, sin, clamp, exp, smoothstep, oneMinus, length, max,
  instanceIndex, instancedBufferAttribute,
} from 'three/tsl';
import { TSL_READY } from '../tslGate.js';
import { additiveLight } from '../../post/passes.js';
import { windField } from './wind.js';
import { createBurnEmission, MAX_BURN_ENTRIES, EMISSION_GATE } from './burnEmission.js';
import { bloomPassFlag, setBloomWriter } from '../bloomOffset.js';

const POOL_N = 16384; // 粒子上限（compute 后无纹理尺寸约束，旧 4096 = 64×64）
const MAX_E = 16;     // 发射器上限（参数表行数）
const E_STRIDE = 6;   // 每发射器 6 个 vec4（布局见 packEmitters）

const hash1 = Fn(([n]) => fract(sin(n).mul(43758.5453123)));

/**
 * 建全局 GPU 粒子池。非 WebGPU 后端返回 null——调用方回退 CPU 池。
 * @param {THREE.WebGPURenderer} renderer
 */
export function createGpuParticles(renderer) {
  // tslGate：W5 compute 化重写落地，翻 true 后本行保持原位（迁移编排负责）
  if (!TSL_READY.gpuParticles) return null;
  // compute 是 WebGPU 专属：forceWebGL（WebGL2 后端）与假 renderer 一律不建件
  if (renderer?.backend?.isWebGPUBackend !== true) return null;

  // ---- 粒子状态 buffer（每粒子 2×vec4：A = pos.xyz+age01，B = vel.xyz+emitterIdx+ttl抖动）----
  // 初始 age01 = -1（死槽）；B.w 打包与旧版逐字段一致：整数 = emitterIdx，小数 ×100 = ttl 抖动
  const stateArr = new Float32Array(POOL_N * 2 * 4);
  for (let i = 0; i < POOL_N; i++) { stateArr[i * 8 + 3] = -1; stateArr[i * 8 + 7] = -1; }
  const stateAttr = new StorageBufferAttribute(stateArr, 4);

  // ---- 发射器参数 buffer（MAX_E × 6 vec4，CPU 每帧回填——布局见 packEmitters）----
  const eArr = new Float32Array(MAX_E * E_STRIDE * 4);
  const eAttr = new StorageBufferAttribute(eArr, 4);

  // ---- 渲染色 attribute（InstancedBufferAttribute + storage() 双重身份）----
  // 粒子 compute 每帧写「渲染色 rgba」，片元按普通逐实例 attribute 读（经典 varying
  // 路径——本后端 fragment 直读 storage / varying(storage 派生) 均返回黑，见渲染件注）。
  // storage() 包裹会把 attribute 标记 isStorageInstancedBufferAttribute（r185 同款用法），
  // 后端据此建 STORAGE|VERTEX 双用途 GPUBuffer——compute 可写、顶点管线可读。
  const renderColorAttr = new THREE.InstancedBufferAttribute(new Float32Array(POOL_N * 4), 4);

  // CPU 侧发射器表（静态分段：池槽位 bump 分配，发射器少而常驻，不做回收）
  const emitters = Array.from({ length: MAX_E }, () => ({
    used: false, kind: 0, cap: 0, rate: 0, ttl: 0, windK: 0, gravity: 0, drag: 0,
    vel: new THREE.Vector3(), velJit: 0, spread: 0, size: 0,
    color: new THREE.Vector3(), pos: new THREE.Vector3(), active: 0, start: 0,
  }));
  // 环形游标（CPU 单线程元数据；spawn 判定 = 本帧 [prevCur, cur) 区间环回覆盖本槽）
  const cursor = new Float32Array(MAX_E);
  const prevCursor = new Float32Array(MAX_E);

  // ---- 燃烧条目表（burnEmission compute 压缩产物；spawn 侧只读绑定）----
  const emission = createBurnEmission();

  const stateS = storage(stateAttr, 'vec4', POOL_N * 2);
  const eS = storage(eAttr, 'vec4', MAX_E * E_STRIDE);
  const renderColorS = storage(renderColorAttr, 'vec4', POOL_N); // ② 号 pass 写入
  const entriesS = storage(emission.entriesAttr, 'vec4', MAX_BURN_ENTRIES);
  const countS = storage(emission.countAttr, 'uint', 1); // 非 atomic 视图（只读计数）

  const uDt = uniform(0);
  const uTime = uniform(0);
  const uFrame = uniform(0);

  // ---- 粒子 compute pass（spawn + 积分一体；If/Loop/Break 全在 Fn 栈内——铁律③）----
  const updateFn = Fn(() => {
    const idx = int(instanceIndex);
    const A = stateS.element(idx.mul(int(2)));
    const B = stateS.element(idx.mul(int(2)).add(int(1)));

    // —— 找归属发射器（静态分段线性扫描；MAX_E=16，每线程 16 步极廉价）——
    // 比较/减法在 float 域做（buffer 里 start/cap 是整值浮点；int/float 不可直接比）
    const idxF = float(idx).toVar();
    const se = int(-1).toVar();
    const local = float(0).toVar();
    Loop(MAX_E, ({ i }) => {
      const eRow = eS.element(i.mul(int(E_STRIDE)).add(int(2)));
      If(se.lessThan(int(0))
        .and(eRow.w.greaterThan(0.5))
        .and(idxF.greaterThanEqual(eRow.x))
        .and(idxF.lessThan(eRow.x.add(eRow.w))), () => {
        se.assign(i);
        local.assign(idxF.sub(eRow.x));
      });
    });

    If(se.greaterThanEqual(int(0)), () => {
      // 发射器参数（内联表达式；跨 If/Else 兄弟块的引用必须重新内联，不能带 toVar 过块）
      const eBase = se.mul(int(E_STRIDE));
      const active = eS.element(eBase).w;
      const kind = eS.element(eBase.add(int(1))).w;
      const eVel = eS.element(eBase.add(int(1))).xyz;
      const s0 = floor(eS.element(eBase.add(int(2))).y); // 旧游标（floor 后环回取模）
      const s1 = floor(eS.element(eBase.add(int(2))).z); // 新游标
      const cap = eS.element(eBase.add(int(2))).w;
      const eVelJit = eS.element(eBase.add(int(4))).x;
      const eSpread = eS.element(eBase.add(int(4))).y;

      // —— spawn 判定：本帧游标区间覆盖本槽即出生（环回卷覆盖最旧，语义同旧版）——
      const m0 = s0.mod(cap);
      const m1 = s1.mod(cap);
      const inRange = m0.lessThan(m1)
        .and(local.greaterThanEqual(m0)).and(local.lessThan(m1))
        .or(m0.greaterThanEqual(m1)
          .and(local.greaterThanEqual(m0).or(local.lessThan(m1))));
      const want = active.greaterThan(0.5).and(s1.greaterThan(s0))
        .and(s1.sub(s0).greaterThanEqual(cap).or(inRange));

      If(want, () => {
        // 逐粒 hash 链（种子 = 槽位 + 帧号；与旧版同式）
        const h1 = hash1(float(idx).mul(0.719).add(uFrame.mul(0.613))).toVar();
        const h2 = hash1(h1.mul(91.7).add(0.13));
        const h3 = hash1(h1.mul(47.3).add(0.37));
        const h4 = hash1(h1.mul(71.9).add(0.61));
        const h5 = hash1(h1.mul(33.1).add(0.83));
        // 初速：基准 × 锥形抖动 × 帧内速度扰动（与旧版同式）
        const v0 = eVel.add(vec3(h3, h4, h5).sub(0.5).mul(2.0).mul(eVelJit))
          .mul(float(0.7).add(h2.mul(0.6)));
        const ePack = float(se).add(h5.mul(0.009)).add(0.001); // emitterIdx + ttl 抖动小数

        If(kind.lessThan(0.5), () => {
          // kind 0 点源：出生位 = 发射点锥形散布
          A.assign(vec4(
            eS.element(eBase).xyz.add(vec3(h2, h3, h4).sub(0.5).mul(2.0).mul(eSpread)),
            0.001));
          B.assign(vec4(v0, ePack));
        }).Else(() => {
          // kind 1 燃烧条目表：随机条目 + 强度门控（rejection 8 次尝试；
          // 全落空 = 本帧少发，rate 口径是「尝试次数」，成功率由火缘密度决定）
          const live = float(countS.element(uint(0))).min(float(MAX_BURN_ENTRIES)).toVar();
          const wp = vec3(0.0).toVar();
          const found = uint(0).toVar();
          If(live.greaterThan(0.5), () => {
            Loop(8, ({ i: k }) => {
              If(found.equal(uint(0)), () => {
                const hk = hash1(h1.mul(57.1).add(float(k).mul(19.77)).add(uFrame.mul(0.377))).toVar();
                const em = entriesS.element(uint(hash1(hk.mul(13.1)).mul(live))).toVar();
                If(em.w.greaterThan(EMISSION_GATE)
                  .and(hash1(hk.mul(7.7).add(uFrame)).lessThan(em.w)), () => {
                  wp.assign(em.xyz);
                  found.assign(uint(1));
                  Break();
                });
              });
            });
          });
          If(found.greaterThan(uint(0)), () => {
            A.assign(vec4(wp.add(vec3(h2, h3, h4).sub(0.5).mul(0.9)), 0.001));
            B.assign(vec4(v0, ePack));
          });
        });
      }).Else(() => {
        // —— 非 spawn：存活则积分（风/浮力/阻尼/寿命）；死槽保持原状 ——
        const age = A.w;
        If(age.greaterThanEqual(0.0).and(age.lessThan(1.0)), () => {
          const eBase2 = se.mul(int(E_STRIDE)); // 兄弟块不可共享 toVar——重内联参数行
          const eTtl = eS.element(eBase2.add(int(3))).x;
          const eWindK = eS.element(eBase2.add(int(3))).y;
          const eGravity = eS.element(eBase2.add(int(3))).z;
          const eDrag = eS.element(eBase2.add(int(3))).w;
          const windV = windField(A.xyz, uTime).mul(eWindK).add(vec3(0.0, eGravity, 0.0));
          const vel = B.xyz.add(windV.mul(uDt)).toVar();
          vel.mulAssign(exp(eDrag.mul(uDt).negate()));
          const ttl = eTtl.mul(float(0.7).add(
            clamp(fract(B.w).mul(100.0), 0.0, 1.0).mul(0.6)));
          A.assign(vec4(A.xyz.add(vel.mul(uDt)), A.w.add(uDt.div(max(ttl, 0.05)))));
          B.assign(vec4(vel, B.w));
        });
      });
    });

  });
  const updateNode = updateFn().compute(POOL_N, [64]); // workgroupSize 是数组（X,Y,Z）

  // ---- 渲染色 compute pass（与粒子推进分离的独立 dispatch）----
  // ⚠ 为什么独立：渲染色需要读「本帧推进后」的状态，而同 dispatch 内跨分支块的
  // storage 读回（read-after-write）实测拿到的是派发前旧值（探针实证，WGSL 源序
  // 正确也无效）——拆成第二个 compute 派发后天然读到本帧终值（同队列派发间保序）。
  // rgb = 发射器色 × 热度(0.6+1.5×fade)（新鲜更亮），a = 活粒子年代淡出；死槽全 0。
  // ⚠ eS/eV 分工：同一 buffer 在同一 bind group 里以两个可写 storage 节点出现 =
  // 「writable storage aliasing」校验错——compute 侧一律用 eS。
  const colorFn = Fn(() => {
    const i2 = int(instanceIndex);
    const ageW = stateS.element(i2.add(i2)).w;
    const aliveK = select(ageW.greaterThanEqual(0.0).and(ageW.lessThan(1.0)), float(1.0), float(0.0));
    const fadeK = oneMinus(clamp(ageW, 0.0, 1.0));
    const eIdxW = uint(clamp(floor(stateS.element(i2.add(i2).add(int(1))).w), 0.0, float(MAX_E - 1)));
    const ec = eS.element(eIdxW.mul(int(E_STRIDE)).add(int(5))).rgb;
    renderColorS.element(i2).assign(
      vec4(ec.mul(float(0.6).add(fadeK.mul(1.5))).mul(aliveK), fadeK.mul(aliveK)));
  });
  const colorNode = colorFn().compute(POOL_N, [64]);

  // ---- 渲染件：Sprite + InstancedBufferGeometry + PointsNodeMaterial（moonDust 范式）----
  // 顶点直读状态与发射器参数 storage（独立只读节点实例，与 compute 的 rw 绑定
  // 各成管线；片元侧的 per-instance 数据走 aColor attribute，见下方 ⚠ 注）
  const stateV = storage(stateAttr, 'vec4', POOL_N * 2);
  const eV = storage(eAttr, 'vec4', MAX_E * E_STRIDE);

  // 旧 uPointScale = drawH×0.5×proj[1][1]；内建衰减已含 drawH/2（×DPR），此处只补
  // proj 因子（fov 相关；onBeforeRender 逐帧填）——旧像素径逐式复原
  const uProj11 = uniform(1.8);

  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  geo.setAttribute('uv', quad.attributes.uv);
  geo.instanceCount = POOL_N; // 一实例一粒
  geo.setAttribute('aColor', renderColorAttr); // compute 写、片元读（见上方 buffer 区注）

  // 顶点侧（无控制流 = 纯表达式；select 双边求值安全惯例）
  // ⚠ 实测（2026-09-27 探针逐路判责，记录在案）：本后端 storage buffer 读
  //   · 顶点 stage 直读 = 正常（位置/尺寸走此路）；
  //   · fragment stage 直读 = 返回黑；varying(storage 派生节点) = 同样黑——
  //     per-instance 颜色/寿命到不了片元。解法 = ② 号 pass 把渲染色
  //     rgba」写进 StorageInstancedBufferAttribute（STORAGE|VERTEX 双用途），
  //     片元按普通逐实例 attribute 读（经典 attribute→varying 路径，实测正常）。
  const pA = stateV.element(instanceIndex.mul(uint(2)));
  const pB = stateV.element(instanceIndex.mul(uint(2)).add(uint(1)));
  const alive = pA.w.greaterThanEqual(0.0).and(pA.w.lessThan(1.0));
  const age = clamp(pA.w, 0.0, 1.0);
  const eIdx = uint(clamp(floor(pB.w), 0.0, float(MAX_E - 1)));
  const eSize = eV.element(eIdx.mul(uint(E_STRIDE)).add(uint(4))).z;

  const pointsMat = new PointsNodeMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  // 位置：positionNode = 局部位（宿主 Sprite 挂场景根，矩阵恒等 → 局部 = 世界）；
  // 死粒子丢到世界深处（+sizeNode=0 双保险，角点偏移归零不产生像素）
  pointsMat.positionNode = select(alive, pA.xyz, vec3(0.0, -100000.0, 0.0));
  // 点径：旧 sz = uESize × (1-age×0.5) × uPointScale ÷ 视深——内建衰减重演（见头注）
  pointsMat.sizeNode = select(alive, eSize.mul(oneMinus(age.mul(0.5))).mul(uProj11), float(0.0));
  // 片元：soft 圆点 + 逐实例渲染色（compute 写 aColor：rgb 已乘热度、a = 年代淡出）
  // + bloom offset 通道（起晕强度主动声明，颜色本体不拉爆）
  const d = length(uv().sub(0.5)); // 旧 gl_PointCoord ≡ 底四边形 uv()
  const m = oneMinus(smoothstep(0.10, 0.5, d)); // WGSL 正向边改写（GLSL smoothstep(0.5,0.10,·)）
  const aColor = instancedBufferAttribute(geo.attributes.aColor, 'vec4'); // compute 写、片元读
  pointsMat.colorNode = select(
    bloomPassFlag.greaterThan(0.5),
    vec4(m.mul(aColor.a).mul(0.7), 0.0, 0.0, 1.0), // 偏移 pass：偏移量进 R 通道
    vec4(aColor.rgb, m.mul(aColor.a)));            // 新鲜火星更热更亮（热度已在 compute 乘好）
  additiveLight(pointsMat); // rgb 加算、alpha 不占地（RT 合成铁律②）

  const points = new THREE.Sprite(pointsMat);
  points.geometry = geo;
  points.name = 'gpuParticles';
  points.frustumCulled = false; // 粒子满世界飞，包围盒无意义
  points.raycast = () => {};    // 纯装饰件：不参与指针拾取（防挡战场点击）
  points.renderOrder = 5;
  setBloomWriter(points, true); // 进 bloom offset pass（火星声明起晕）
  points.onBeforeRender = (_rend, _scene, camera) => {
    uProj11.value = camera.projectionMatrix.elements[5];
  };

  // ---- 发射器参数回填（每帧整表重写：16×6 vec4 极廉价，省脏标记账）----
  function packEmitters() {
    const burnCount = burnUnits.length;
    for (let e = 0; e < MAX_E; e++) {
      const em = emitters[e];
      const o = e * E_STRIDE * 4;
      eArr[o] = em.pos.x; eArr[o + 1] = em.pos.y; eArr[o + 2] = em.pos.z; eArr[o + 3] = em.active;
      eArr[o + 4] = em.vel.x; eArr[o + 5] = em.vel.y; eArr[o + 6] = em.vel.z; eArr[o + 7] = em.kind;
      eArr[o + 8] = em.start; eArr[o + 9] = prevCursor[e]; eArr[o + 10] = cursor[e]; eArr[o + 11] = em.cap;
      eArr[o + 12] = em.ttl; eArr[o + 13] = em.windK; eArr[o + 14] = em.gravity; eArr[o + 15] = em.drag;
      eArr[o + 16] = em.velJit; eArr[o + 17] = em.spread; eArr[o + 18] = em.size; eArr[o + 19] = burnCount;
      eArr[o + 20] = em.color.x; eArr[o + 21] = em.color.y; eArr[o + 22] = em.color.z; eArr[o + 23] = 1; // Vector3 用 xyz（.r 是 Color 的）
    }
    eAttr.needsUpdate = true;
  }

  let nextSlot = 0;
  function registerEmitter({
    kind = 0, cap = 256, rate = 20, ttl = 1.2, windK = 1, gravity = 2.5, drag = 0.5,
    vel = [0, 4, 0], velJit = 1.5, spread = 0.5, size = 0.5, color = [2.0, 0.8, 0.2],
    pos = [0, 0, 0], active = 0,
  } = {}) {
    const id = emitters.findIndex(em => !em.used);
    if (id < 0 || nextSlot + cap > POOL_N) return -1;
    const em = emitters[id];
    em.used = true;
    em.kind = kind; em.cap = cap; em.rate = rate; em.ttl = ttl;
    em.windK = windK; em.gravity = gravity; em.drag = drag;
    em.vel.set(...vel); em.velJit = velJit; em.spread = spread; em.size = size;
    em.color.set(...color); em.pos.set(...pos); em.active = active;
    em.start = nextSlot;
    nextSlot += cap;
    return id;
  }
  function setEmitterActive(id, on) { if (id >= 0) emitters[id].active = on ? 1 : 0; }
  function setEmitterPos(id, x, y, z) { if (id >= 0) emitters[id].pos.set(x, y, z); }

  // ---- 燃烧联动（id 0 = 内建燃烧发射器；活跃单位列表下标 = 压缩 pass 槽位）----
  // rate 口径 = 每单位每秒 spawn 尝试次数（rejection 约 0.12~1 强度门控 + 火缘密度，
  // 实测稳态存活 ≈ rate×成功率×ttl——与旧图集同源口径）
  const burnId = registerEmitter({
    kind: 1, cap: 2048, rate: 110, ttl: 1.4, windK: 1.0, gravity: 1.2, drag: 0.55,
    vel: [0, 5.2, 0], velJit: 1.8, size: 0.9, color: [2.2, 0.85, 0.18],
  });
  const burnUnits = []; // [{ unit }]
  function burnAddUnit(unit) {
    if (!unit || burnUnits.some(s => s.unit === unit)) return;
    if (burnUnits.length >= emission.maxUnits) return; // 槽满：静默跳过（aura 本体不受影响）
    burnUnits.push({ unit });
    setEmitterActive(burnId, 1);
  }
  function burnRemoveUnit(unit) {
    const i = burnUnits.findIndex(s => s.unit === unit);
    if (i >= 0) burnUnits.splice(i, 1);
    if (!burnUnits.length) setEmitterActive(burnId, 0);
  }

  // ---- 帧推进（BattleStage tick 调）：游标(CPU) → 发射参数回填 → 燃烧条目压缩 →
  //      粒子 compute（spawn+积分一体），全 GPU，CPU 零粒子读回 ----
  let t = 0, frame = 0;
  function update(dt) {
    t += dt; frame += 1;
    // 环形游标推进（燃烧发射器按活跃单位数扩量——旧 cursor pass 同式）
    for (let e = 0; e < MAX_E; e++) {
      const em = emitters[e];
      if (!em.used) continue;
      prevCursor[e] = cursor[e];
      let rate = em.rate;
      if (em.kind === 1) rate *= Math.max(burnUnits.length, 0);
      cursor[e] += rate * em.active * dt;
    }
    packEmitters();
    // 单次提交保序：reset（计数归零）→ 逐活跃单位条目压缩 → 粒子 spawn+积分
    const nodes = [];
    if (burnUnits.length) nodes.push(...emission.update(burnUnits));
    uDt.value = dt; uTime.value = t; uFrame.value = frame;
    nodes.push(updateNode);
    nodes.push(colorNode); // ② 渲染色回填（读本帧终态；派发序 = 队列序）
    renderer.compute(nodes);
  }

  /** 探针用：读环形游标（现在是 CPU 元数据，同步即得；生产路径不读回）。 */
  function debugReadCursor() {
    return [cursor[0], prevCursor[0], cursor[1], prevCursor[1]];
  }

  /** 探针用：读粒子状态 buffer（getArrayBufferAsync 读回），数活粒子 + 采位置样本。
   *  ⚠ compute 版为 async（r185 无同步读回；生产路径不读回）。 */
  async function debugReadState() {
    const buf = new Float32Array(await renderer.getArrayBufferAsync(stateAttr));
    let alive = 0; const sample = [];
    for (let i = 0; i < POOL_N; i++) {
      const age = buf[i * 8 + 3];
      if (age >= 0 && age < 1) {
        alive++;
        if (sample.length < 4) {
          sample.push([
            +buf[i * 8].toFixed(1), +buf[i * 8 + 1].toFixed(1),
            +buf[i * 8 + 2].toFixed(1), +age.toFixed(2)]);
        }
      }
    }
    return { alive, sample };
  }

  /** 探针用：读燃烧条目表（计数 + 条目强度），验压缩 pass 是否产出。
   *  ⚠ async（同上）；旧版 perCol（图集逐列统计）随图集一起退役。 */
  async function debugReadEmission() {
    const c = new Uint32Array(await renderer.getArrayBufferAsync(emission.countAttr));
    const buf = new Float32Array(await renderer.getArrayBufferAsync(emission.entriesAttr));
    const n = Math.min(c[0] ?? 0, MAX_BURN_ENTRIES);
    let maxW = 0; const sample = [];
    for (let i = 0; i < n; i++) {
      const w = buf[i * 4 + 3];
      if (w > maxW) maxW = w;
      if (sample.length < 3) {
        sample.push([
          +buf[i * 4].toFixed(1), +buf[i * 4 + 1].toFixed(1),
          +buf[i * 4 + 2].toFixed(1), +w.toFixed(2)]);
      }
    }
    return { hot: n, max: +maxW.toFixed(3), sample };
  }

  function dispose() {
    stateAttr.dispose();
    eAttr.dispose();
    geo.dispose();
    quad.dispose();
    pointsMat.dispose();
    emission.dispose();
    points.parent?.remove(points);
  }

  return {
    points, update, dispose,
    registerEmitter, setEmitterActive, setEmitterPos,
    burnAddUnit, burnRemoveUnit,
    debugReadCursor, debugReadState, debugReadEmission,
    get burnUnitCount() { return burnUnits.length; },
  };
}
