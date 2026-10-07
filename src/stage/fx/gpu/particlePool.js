// 粒子池 v2（PARTICLE_SYSTEM_V2 定稿的 P0 落地）——模块化 compute 粒子底座。
// 旧池（gpuParticles.js）已随燃烧火星迁入 custom 类型通道（burnSparks.js）
// 而删除，本池是唯一 GPU 粒子底座。
//
// 结构（文档 §一-§六）：
//   · L0 运行时壳：每粒子 state 2×vec4（pos.xyz+age01 / vel.xyz+seed）
//     + payload 2×vec4（anchorIdx+domainU+domainV+dist0 / progress+arrived+ttlActual+speed0）
//     三个 storage buffer；渲染色/尺寸走 STORAGE|VERTEX 双用途 attribute
//     （aColor/aMisc——fragment 直读 storage 返回黑的后端怪癖已定案，旧池同法）。
//   · L2 pass 链：uber update（spawn+积分+目的地转向一体，一条 dispatch 罩全部 uber 段）
//     → custom 类型各自 dispatch（kind 标志排除在 uber 扫描外）→ present（渲染色回填，
//     统一一条）。renderer.compute 单次提交保序（跨 dispatch 才有可靠 RAW）。
//   · 类型表：32 行 × 12 vec4（布局见 T_STRIDE 注释），CPU 每帧整表重写（6KB，不做脏账）。
//   · 锚点表：32 槽 × 2 vec4（线段/实心矩形/实心圆，求值器见 anchorPoint），
//     CPU 管理器增删改，每帧整表重写。粒子存域内参数不存世界点——锚点移动 = 行更新，
//     目标点每帧现算，平滑追踪零跳变。
//   · alive 计数：u32 × 32 atomic buffer（spike-atomic.mjs 已验证语义）——
//     出生 atomicAdd(count, wasAlive?0:1)（环形覆盖净零）、死亡跃迁 atomicSub(count,1)；
//     onDrained 经 getArrayBufferAsync 节流读回驱动效果生命周期。
// 渲染件同旧池范式：Sprite + InstancedBufferGeometry + PointsNodeMaterial
//   （sizeNode × uProj11 重演旧点径公式）+ additiveLight + bloom offset + BLOOM_LAYER。
// custom 类型契约（复杂粒子通道；首个实例 = burnSparks.js 燃烧火星）：
//   desc.custom.build(ctx) → { update: ComputeNode, tick?: () => 前置节点[],
//   api?: 运行期 API（可带 dispose()，池 reset/dispose 时调） }。
//   ctx = { globalIdx, segCap, row(vec4Idx), stateS, payloadS, tS, anchorsS, aliveS,
//   uDt, uTime, uFrame, rowIdx, anchorPoint, spawnWindow, aliveAdd, aliveSub }。
//   池 dispatch 序 = [...各 customTick() 前置节点, uberUpdate, ...customPasses, present]；
//   custom 段被 uber 扫描排除（r0.z kind=1），present 仍统一罩染（aColor/aMisc 照回填）。
// 降级：非 WebGPU 后端一律返回 null（compute 是 WebGPU 专属；UI/世界 = 同类两实例）。
import * as THREE from 'three';
import { StorageBufferAttribute, PointsNodeMaterial } from 'three/webgpu';
import {
  Fn, If, Loop, uniform, storage, select, uv,
  float, int, uint, vec3, vec4,
  floor, fract, sin, cos, clamp, exp, smoothstep, oneMinus, length, max, min, mix, sqrt, pow,
  instanceIndex, instancedBufferAttribute, atomicAdd, atomicSub,
} from 'three/tsl';
import { additiveLight } from '../../post/passes.js';
import { windField } from './wind.js';
import { bloomPassFlag, setBloomWriter } from '../bloomOffset.js';
import { getParticleType } from './particleTypes.js';

const POOL_N = 16384; // 粒子上限（Σ 类型 cap 超此值 = 分配时报错，容量账摆明处）
const MAX_T = 64;     // 类型表行数 / alive 计数槽数（2026-10-02 32→64：Boss 长战多种爆发组合打满过，夜测 1002 [r2路8]）
const MAX_ANCHOR = 32; // 锚点槽数
const T_STRIDE = 12;  // 每类型行 12 vec4：
//  r0: start, cap, kind(0 uber/1 custom), used（shader 归属判据；spawnActive 纯 CPU 侧）
//  r1: cursorPrev, cursorCur, rate, ttlBase
//  r2: spawnPos.xyz, spawnAnchorIdx（-1 = 用 spawnPos）
//  r3: vel.xyz, velJit
//  r4: spread, gravity, drag, windK
//  r5: destAnchorIdx（-1 = 目的地模块关）, domainMode, steerDelay, steerRamp
//  r6: steerK, arriveR, curveK, endMode
//  r7: progressMode, ttlJit, size, sizeEndK
//  r8: color.rgb, alpha
//  r9: colorEnd.rgb, heat
//  r10: radial（径向爆散初速）, ageHeat（随年龄衰减的亮度增益）, —, —
//  r11: softness（sprite 径向衰减指数）, —, —（只许尾部追加——L1 分块纪律）
const A_STRIDE = 2;   // 每锚点 2 vec4：
//  a0: type(0 线段/1 矩形/2 圆), alive, p0.x, p0.y
//  a1: p0.z, p1.x, p1.y, p1.z
//  线段 = p0→p1；矩形 = center(p0)+half(p1.xy)；圆 = center(p0)+radius(p1.x)

const hash1 = Fn(([n]) => fract(sin(n).mul(43758.5453123)));

/**
 * 锚点求值器（JS 函数返回 TSL 节点；update/spawn 多处内联复用）。
 * @param anchorsS 锚点表 storage 节点
 * @param aIdx     int 节点（调用方保证已 clamp 到合法槽；死活由调用方另行判定）
 * @param u, v     域内参数（出生即定，永不重抽）
 * @param domainMode float 节点：0 随机填充 / 1 出生序均布填充 / 2 随机边缘 / 3 出生序均布边缘
 */
function anchorPoint(anchorsS, aIdx, u, v, domainMode) {
  const b = aIdx.mul(int(A_STRIDE));
  const a0 = anchorsS.element(b);
  const a1 = anchorsS.element(b.add(int(1)));
  const p0 = vec3(a0.z, a0.w, a1.x);
  const p1 = vec3(a1.y, a1.z, a1.w);
  const aType = a0.x;
  const edge = domainMode.greaterThan(1.5);
  // 线段：mix(p0, p1, u)（域模式无差异）
  const linePt = mix(p0, p1, clamp(u, 0, 1));
  // 矩形：填充 = 中心 + (u,v) 映射半尺寸；边缘 = 周长参数 u 四边行走
  const rectFill = p0.add(vec3(
    u.sub(0.5).mul(2.0).mul(p1.x), v.sub(0.5).mul(2.0).mul(p1.y), 0));
  const per = fract(u).mul(4.0);
  const side = floor(per);
  const f = fract(per);
  const ex = select(side.lessThan(0.5), f.mul(2.0).sub(1.0),
    select(side.lessThan(1.5), float(1.0),
      select(side.lessThan(2.5), oneMinus(f).mul(2.0).sub(1.0), float(-1.0))));
  const ey = select(side.lessThan(0.5), float(1.0),
    select(side.lessThan(1.5), oneMinus(f).mul(2.0).sub(1.0),
      select(side.lessThan(2.5), float(-1.0), f.mul(2.0).sub(1.0))));
  const rectEdge = p0.add(vec3(ex.mul(p1.x), ey.mul(p1.y), 0));
  // 圆：填充 = r·√u 半径 + v·2π 角度；边缘 = 满半径 + u·2π 角度
  const thF = v.mul(6.2831853);
  const rr = p1.x.mul(sqrt(clamp(u, 0, 1)));
  const circleFill = p0.add(vec3(cos(thF).mul(rr), sin(thF).mul(rr), 0));
  const thE = u.mul(6.2831853);
  const circleEdge = p0.add(vec3(cos(thE).mul(p1.x), sin(thE).mul(p1.x), 0));
  const rectPt = select(edge, rectEdge, rectFill);
  const circlePt = select(edge, circleEdge, circleFill);
  return select(aType.lessThan(0.5), linePt,
    select(aType.lessThan(1.5), rectPt, circlePt));
}

/**
 * 建粒子池。非 WebGPU 后端返回 null。
 * @param {THREE.WebGPURenderer} renderer
 * @param {{ space?: 'world'|'ui', name?: string }} opts
 *   space 只是登记守卫（类型 desc 的 space 必须匹配池），坐标口径由挂载场景决定。
 */
export function createParticlePool(renderer, { space = 'world', name = 'particlePoolV2' } = {}) {
  if (renderer?.backend?.isWebGPUBackend !== true) return null;

  // ---- 状态 buffer（每粒子 2×vec4；初始 age01 = -1 死槽）----
  const stateArr = new Float32Array(POOL_N * 2 * 4);
  for (let i = 0; i < POOL_N; i++) { stateArr[i * 8 + 3] = -1; stateArr[i * 8 + 7] = -1; }
  const stateAttr = new StorageBufferAttribute(stateArr, 4);

  // ---- payload buffer（每粒子 2×vec4：P0 = anchorIdx+domainU+domainV+dist0，
  //      P1 = progress+arrived+ttlActual+speed0；出生帧盖定，域内参数永不重抽）----
  const payloadArr = new Float32Array(POOL_N * 2 * 4);
  for (let i = 0; i < POOL_N; i++) payloadArr[i * 8] = -1; // anchorIdx 缺省关
  const payloadAttr = new StorageBufferAttribute(payloadArr, 4);

  // ---- 类型表 / 锚点表 / alive 计数 ----
  const tArr = new Float32Array(MAX_T * T_STRIDE * 4);
  const tAttr = new StorageBufferAttribute(tArr, 4);
  const anchorArr = new Float32Array(MAX_ANCHOR * A_STRIDE * 4);
  const anchorAttr = new StorageBufferAttribute(anchorArr, 4);
  const aliveArr = new Uint32Array(MAX_T);
  const aliveAttr = new StorageBufferAttribute(aliveArr, 1);

  // ---- 渲染 attribute（present pass 写、顶点/片元读，STORAGE|VERTEX 双用途）----
  const renderColorAttr = new THREE.InstancedBufferAttribute(new Float32Array(POOL_N * 4), 4);
  const renderMiscAttr = new THREE.InstancedBufferAttribute(new Float32Array(POOL_N * 4), 4);

  const stateS = storage(stateAttr, 'vec4', POOL_N * 2);
  const payloadS = storage(payloadAttr, 'vec4', POOL_N * 2);
  const tS = storage(tAttr, 'vec4', MAX_T * T_STRIDE);
  const anchorsS = storage(anchorAttr, 'vec4', MAX_ANCHOR * A_STRIDE);
  const aliveS = storage(aliveAttr, 'uint', MAX_T).toAtomic();
  const renderColorS = storage(renderColorAttr, 'vec4', POOL_N);
  const renderMiscS = storage(renderMiscAttr, 'vec4', POOL_N);

  const uDt = uniform(0);
  const uTime = uniform(0);
  const uFrame = uniform(0);

  // ---- uber update pass（spawn + 积分 + 目的地转向一体）----
  // 纪律（旧池踩坑沉淀）：If/Loop 全在 Fn 栈内；跨 If/Else 兄弟块的 storage 读一律
  // 重新内联；需要跨块携带的可变量一律在 Fn 根部 toVar 声明（根部声明的 var 任意嵌套
  // 块内读写合法，块内声明的 var 跨兄弟块引用会静默错位）。
  const updateFn = Fn(() => {
    const idx = int(instanceIndex);
    const A = stateS.element(idx.mul(int(2)));
    const B = stateS.element(idx.mul(int(2)).add(int(1)));
    const P0 = payloadS.element(idx.mul(int(2)));
    const P1 = payloadS.element(idx.mul(int(2)).add(int(1)));

    // —— 找归属类型行（静态分段线性扫描；只收 active 且 uber 的段——custom 段由
    //    各类型自己的 dispatch 管，两通道互不越界）——
    const idxF = float(idx).toVar();
    const tIdx = int(-1).toVar();
    const tLocal = float(0).toVar();
    Loop(MAX_T, ({ i }) => {
      const r0 = tS.element(i.mul(int(T_STRIDE)));
      If(tIdx.lessThan(int(0))
        .and(r0.w.greaterThan(0.5))
        .and(r0.z.lessThan(0.5))
        .and(idxF.greaterThanEqual(r0.x))
        .and(idxF.lessThan(r0.x.add(r0.y))), () => {
        tIdx.assign(i);
        tLocal.assign(idxF.sub(r0.x));
      });
    });

    // 存活分支携带量（根部声明，见纪律注）
    const velV = vec3(0).toVar();
    const posV = vec3(0).toVar();
    const ageV = float(0).toVar();
    const distV = float(1e9).toVar();
    const killV = int(0).toVar();
    const arrivedN = float(0).toVar();
    const progressN = float(0).toVar();

    If(tIdx.greaterThanEqual(int(0)), () => {
      // spawn 窗口（环形游标区间覆盖本槽即出生；跳变 ≥ cap = 全段出生）
      const base = tIdx.mul(int(T_STRIDE));
      const r1 = tS.element(base.add(int(1)));
      const cap = tS.element(base).y;
      const s0 = floor(r1.x);
      const s1 = floor(r1.y);
      const m0 = s0.mod(cap);
      const m1 = s1.mod(cap);
      const inRange = m0.lessThan(m1)
        .and(tLocal.greaterThanEqual(m0)).and(tLocal.lessThan(m1))
        .or(m0.greaterThanEqual(m1)
          .and(tLocal.greaterThanEqual(m0).or(tLocal.lessThan(m1))));
      const want = s1.greaterThan(s0)
        .and(s1.sub(s0).greaterThanEqual(cap).or(inRange));

      If(want, () => {
        // —— spawn ——
        const wasAlive = A.w.greaterThanEqual(0.0).and(A.w.lessThan(1.0));
        atomicAdd(aliveS.element(uint(tIdx)), select(wasAlive, uint(0), uint(1)));
        const h1 = hash1(float(idx).mul(0.719).add(uFrame.mul(0.613))).toVar();
        const h2 = hash1(h1.mul(91.7).add(0.13));
        const h3 = hash1(h1.mul(47.3).add(0.37));
        const h4 = hash1(h1.mul(71.9).add(0.61));
        const h5 = hash1(h1.mul(33.1).add(0.83));
        const h6 = hash1(h1.mul(17.7).add(0.49));
        // 行参数（本块内联读，不带过 Else）
        const r2 = tS.element(base.add(int(2)));
        const r3 = tS.element(base.add(int(3)));
        const r4 = tS.element(base.add(int(4)));
        const r5 = tS.element(base.add(int(5)));
        const r7s = tS.element(base.add(int(7)));
        // 域内参数：mode 1/3 = 出生序均布（序号/本帧出生数），mode 0/2 = 随机；
        // mode ≥ 2 = 边缘解释（矩形=周长、圆=圆环，在 anchorPoint 内分流）
        const cnt = max(s1.sub(s0), 1.0);
        const ord = tLocal.sub(m0).add(cap).mod(cap);
        const uSeq = clamp(ord.add(0.5).div(cnt), 0.0, 1.0);
        const dMode = r5.y;
        const useSeq = dMode.greaterThan(0.5).and(dMode.lessThan(1.5))
          .or(dMode.greaterThan(2.5));
        const domU = select(useSeq, uSeq, h4);
        const domV = h5;
        // ttl（保险丝口径；目的地模式下 ttl ≈ 最长飞行/驻留硬上限）
        const ttlA = max(r1.w.mul(
          float(1.0).add(h6.sub(0.5).mul(2.0).mul(r7s.y))), 0.05);
        // 出生位：出生锚（活）优先，否则 spawnPos；均加 spread 抖动
        const spawnAnch = int(r2.w);
        const spawnAnchC = max(spawnAnch, int(0));
        const spawnAnchAlive = anchorsS.element(spawnAnchC.mul(int(A_STRIDE))).y;
        const posFromAnchor = anchorPoint(anchorsS, spawnAnchC, h2, h3, float(0));
        const posBase = select(
          spawnAnch.greaterThanEqual(int(0)).and(spawnAnchAlive.greaterThan(0.5)),
          posFromAnchor, r2.xyz);
        const pos = posBase.add(
          vec3(h2, h3, h4).sub(0.5).mul(2.0).mul(r4.x));
        // 初速：基准 × 锥形抖动 + 径向爆散分量（radial>0 时随机方向匀速爆开，
        // 资源消耗「爆散相位」靠它）× 帧内扰动
        const radDir = vec3(h3, h4, h5).sub(0.5).mul(2.0);
        const radN = radDir.div(max(length(radDir), 1e-3));
        const radial = tS.element(base.add(int(10))).x;
        const v0 = r3.xyz.add(radDir.mul(r3.w))
          .add(radN.mul(radial).mul(float(0.6).add(h5.mul(0.4))))
          .mul(float(0.7).add(h2.mul(0.6)));
        // 目的锚：盖进 payload（多 burst 指向不同锚点互不惊扰）；dist0 供距离进度
        const destAnch = int(r5.x);
        const destAnchC = max(destAnch, int(0));
        const destAlive = anchorsS.element(destAnchC.mul(int(A_STRIDE))).y;
        const destOn = destAnch.greaterThanEqual(int(0)).and(destAlive.greaterThan(0.5));
        const t0 = anchorPoint(anchorsS, destAnchC, domU, domV, dMode);
        const dist0 = max(select(destOn, length(t0.sub(pos)), float(1.0)), 0.001);
        A.assign(vec4(pos, 0.001));
        B.assign(vec4(v0, h1));
        P0.assign(vec4(float(destAnch), domU, domV, dist0));
        P1.assign(vec4(0.0, 0.0, ttlA, length(v0)));
      }).Else(() => {
        // —— 非 spawn：存活则积分；死槽保持 ——
        const age = A.w;
        If(age.greaterThanEqual(0.0).and(age.lessThan(1.0)), () => {
          const r4 = tS.element(base.add(int(4)));
          const r5 = tS.element(base.add(int(5)));
          const r6 = tS.element(base.add(int(6)));
          const ttlA = P1.z;
          velV.assign(B.xyz);
          posV.assign(A.xyz);
          ageV.assign(age);
          arrivedN.assign(P1.y);
          // 风场 + 重力 + 阻尼
          velV.addAssign(windField(posV, uTime).mul(r4.w)
            .add(vec3(0.0, r4.y, 0.0)).mul(uDt));
          velV.mulAssign(exp(r4.z.negate().mul(uDt)));
          // 目的地模块（payload 内的锚 idx；-1 = 关。锚死 → 退化纯 ttl）
          const anchIdx = int(P0.x);
          const anchIdxC = max(anchIdx, int(0));
          If(anchIdx.greaterThanEqual(int(0)), () => {
            const aAlive = anchorsS.element(anchIdxC.mul(int(A_STRIDE))).y;
            If(aAlive.greaterThan(0.5), () => {
              const target = anchorPoint(anchorsS, anchIdxC, P0.y, P0.z, r5.y);
              const toT = target.sub(posV);
              distV.assign(length(toT));
              If(P1.y.lessThan(0.5), () => {
                // 汇聚：steerDelay 后 ramp 渐入。arrival 行为——目标速度取
                // min(steerK, dist×8)：远端恒 steerK 巡航，近端线性减速指数收敛，
                // 根治「恒定速率冲过目标点再被拉回」的绕目标震荡（// 验收：粒子在卡缘反复抖动——60fps 下 steerK120 一帧 2 单位，
                // arriveR 2.4 的死亡球被一步跨过）。gain 8 = 收敛时间常数 ~0.13s。
                const dirN = toT.div(max(distV, 1e-4));
                const ageSec = age.mul(ttlA);
                const ramp = clamp(ageSec.sub(r5.z).div(max(r5.w, 0.001)), 0.0, 1.0);
                const targetSpeed = min(r6.x, distV.mul(8.0));
                velV.assign(mix(velV, dirN.mul(targetSpeed), clamp(ramp.mul(3.0), 0.0, 1.0)));
                // 侧向弯曲：垂直分量随汇聚进度衰减（弧线轨迹；平面近似，
                // 目的地特效主战场是 UI/面板平面，z 向弯曲留给后续 3D 化）
                const perp = vec3(dirN.y.negate(), dirN.x, 0.0);
                velV.addAssign(perp.mul(r6.z).mul(oneMinus(ramp)).mul(P1.w).mul(uDt).mul(8.0));
              });
              // 到达判定（移动前距离，一帧滞后无妨——arriveR 即缓冲）
              const isArrive = distV.lessThan(r6.y);
              If(isArrive.and(r6.w.greaterThan(0.5)).and(r6.w.lessThan(2.5)), () => {
                killV.assign(int(1)); // endMode 1/2：到达即终结
              });
              If(isArrive.and(r6.w.greaterThan(2.5)), () => {
                arrivedN.assign(1.0); // endMode 3：驻留（贴锚点跟随）
              });
            });
          });
          // 驻留：钉在锚点上（锚死则原地悬停等 ttl）
          If(arrivedN.greaterThan(0.5), () => {
            const anchIdx2 = int(P0.x);
            const anchIdx2C = max(anchIdx2, int(0));
            const aAlive2 = anchorsS.element(anchIdx2C.mul(int(A_STRIDE))).y;
            If(anchIdx2.greaterThanEqual(int(0)).and(aAlive2.greaterThan(0.5)), () => {
              posV.assign(anchorPoint(anchorsS, anchIdx2C, P0.y, P0.z,
                tS.element(base.add(int(5))).y));
              velV.assign(vec3(0.0, 0.0, 0.0));
            });
          });
          // 积分 + 寿命
          posV.addAssign(velV.mul(uDt));
          ageV.addAssign(uDt.div(ttlA));
          If(ageV.greaterThanEqual(1.0), () => killV.assign(int(1))); // ttl 保险丝
          // 进度：mode 0 = ageProgress；mode 1 = distanceProgress（1 - dist/dist0）
          const ageProg = clamp(ageV, 0.0, 1.0);
          const distProg = oneMinus(clamp(distV.div(max(P0.w, 0.001)), 0.0, 1.0));
          progressN.assign(select(
            tS.element(base.add(int(7))).x.greaterThan(0.5).and(P0.x.greaterThanEqual(0.0)),
            distProg, ageProg));
          // 落地（死亡 = age 置 1.5 死区 + atomicSub；每粒子恰在死亡帧扣一次）
          If(killV.greaterThan(int(0)), () => {
            A.assign(vec4(posV, 1.5));
            atomicSub(aliveS.element(uint(tIdx)), uint(1));
          }).Else(() => {
            A.assign(vec4(posV, ageV));
            B.assign(vec4(velV, B.w));
            P1.assign(vec4(progressN, arrivedN, P1.z, P1.w));
          });
        });
      });
    });
  });
  const updateNode = updateFn().compute(POOL_N, [64]);

  // ---- present pass（统一渲染色/尺寸回填；custom 段同罩——custom 类型要自定义
  //      外观时后续加「自写 present」开关，本期统一公式）----
  // rgb = mix(color, colorEnd, progress) × heat；a = alpha × (1 - ageProgress)
  // （透明度淡出恒走 age 口径——distanceProgress 下驻留粒子 progress=1 不该隐形）。
  const presentFn = Fn(() => {
    const idx = int(instanceIndex);
    const idxF = float(idx).toVar();
    const tIdx = int(-1).toVar();
    Loop(MAX_T, ({ i }) => {
      const r0 = tS.element(i.mul(int(T_STRIDE)));
      If(tIdx.lessThan(int(0))
        .and(r0.w.greaterThan(0.5))
        .and(idxF.greaterThanEqual(r0.x))
        .and(idxF.lessThan(r0.x.add(r0.y))), () => {
        tIdx.assign(i);
      });
    });
    const col = vec4(0).toVar();
    const misc = vec4(0).toVar();
    const age = stateS.element(idx.mul(int(2))).w;
    If(tIdx.greaterThanEqual(int(0))
      .and(age.greaterThanEqual(0.0)).and(age.lessThan(1.0)), () => {
      const base = tIdx.mul(int(T_STRIDE));
      const r7 = tS.element(base.add(int(7)));
      const r8 = tS.element(base.add(int(8)));
      const r9 = tS.element(base.add(int(9)));
      const r10 = tS.element(base.add(int(10)));
      const prog = clamp(payloadS.element(idx.mul(int(2)).add(int(1))).x, 0.0, 1.0);
      const ageP = clamp(age, 0.0, 1.0);
      const sz = r7.z.mul(mix(float(1.0), r7.w, prog));
      const soft = tS.element(base.add(int(11))).x;
      // ageHeat：随年龄衰减的亮度增益（燃烧火星「新鲜更亮」口径 = heat×(1+ageHeat×(1-age))）
      const rgb = mix(r8.rgb, r9.rgb, prog)
        .mul(r9.w.mul(float(1.0).add(r10.y.mul(oneMinus(ageP)))));
      col.assign(vec4(rgb, r8.w.mul(oneMinus(ageP))));
      misc.assign(vec4(sz, prog, soft, 0.0));
    });
    renderColorS.element(idx).assign(col);
    renderMiscS.element(idx).assign(misc);
  });
  const presentNode = presentFn().compute(POOL_N, [64]);

  // ---- 渲染件（旧池范式：Sprite + InstancedBufferGeometry + PointsNodeMaterial）----
  const stateV = storage(stateAttr, 'vec4', POOL_N * 2);
  const uProj11 = uniform(1.8);

  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  geo.setAttribute('uv', quad.attributes.uv);
  geo.instanceCount = POOL_N;
  geo.setAttribute('aColor', renderColorAttr);
  geo.setAttribute('aMisc', renderMiscAttr);

  const pA = stateV.element(instanceIndex.mul(uint(2)));
  const aliveV = pA.w.greaterThanEqual(0.0).and(pA.w.lessThan(1.0));
  const aMiscV = instancedBufferAttribute(geo.attributes.aMisc, 'vec4');

  const pointsMat = new PointsNodeMaterial({
    transparent: true,
    depthWrite: false,
    // UI 池关深度测试：粒子 z 取自卡牌锚点（与卡面同平面），深度相等被卡面
    // 恰好挡住（验收：汇聚粒子总被压在卡牌下）。uiScene 全是
    // 屏幕空间件，关深度由 renderOrder 定序即可；世界池保留（要被场景正确遮挡）。
    depthTest: space !== 'ui',
    fog: false,
  });
  pointsMat.positionNode = select(aliveV, pA.xyz, vec3(0.0, -100000.0, 0.0));
  pointsMat.sizeNode = select(aliveV, aMiscV.x.mul(uProj11), float(0.0));
  const d = length(uv().sub(0.5));
  // 径向衰减指数逐类型（misc.z，缺省 1 = 平底+边沿衰减；>1 = 中心亮缘虚的软光点）
  const m = pow(oneMinus(smoothstep(0.10, 0.5, d)), aMiscV.z);
  const aColor = instancedBufferAttribute(geo.attributes.aColor, 'vec4');
  pointsMat.colorNode = select(
    bloomPassFlag.greaterThan(0.5),
    vec4(m.mul(aColor.a).mul(0.7), 0.0, 0.0, 1.0),
    vec4(aColor.rgb, m.mul(aColor.a)));
  additiveLight(pointsMat);

  const points = new THREE.Sprite(pointsMat);
  points.geometry = geo;
  points.name = name;
  points.frustumCulled = false;
  points.raycast = () => {}; // 纯装饰件：不参与指针拾取
  points.renderOrder = 5;
  setBloomWriter(points, true);
  const _projSizeV = new THREE.Vector2();
  points.onBeforeRender = (_rend, _scene, camera) => {
    const e = camera.projectionMatrix.elements;
    // 点径公式分相机（PointsNodeMaterial 源码实读）：透视机 = sizeNode × DPR ×
    // (drawH逻辑/2) ÷ 视深（衰减内建），uProj11 只补 proj[1][1]（同旧池）；
    // 正交机（UI 池）**无任何衰减**——sizeNode 直接是像素口径，要补
    // 「世界单位 → 像素」换算 = (drawH逻辑/2) × proj[5]（正交 NDC.y = y×proj[5]）。
    uProj11.value = camera.isOrthographicCamera
      ? e[5] * renderer.getSize(_projSizeV).y * 0.5
      : e[5];
  };

  // ================= CPU 侧：类型行 / 锚点 / burst / alive 读回 =================

  // 类型行 CPU 镜像（used=false = 空槽；静态参数来自 desc，动态参数运行时改）
  const rows = Array.from({ length: MAX_T }, () => ({
    used: false, typeId: -1, start: 0, cap: 0, kind: 0,
    cursor: 0, prevCursor: 0, spawnActive: 0, rateScale: 1,
    spawnPos: [0, 0, 0], spawnAnchorIdx: -1, destAnchorIdx: -1,
    desc: null, customTick: null, api: null,
  }));
  let nextSlot = 0;
  const customPasses = []; // 复杂类型各自 dispatch（allocate 时 build 产出）

  function allocate(typeId) {
    const desc = getParticleType(typeId);
    if (!desc) throw new Error(`粒子类型未登记：${typeId}`);
    if (desc.space !== space) {
      throw new Error(`粒子类型 ${desc.name}（space=${desc.space}）与池 space=${space} 不符`);
    }
    const t = rows.findIndex(r => !r.used);
    if (t < 0) throw new Error(`粒子类型表满（${MAX_T} 行/池）`);
    if (nextSlot + desc.cap > POOL_N) {
      throw new Error(`粒子池容量超限：Σcap ${nextSlot}+${desc.cap} > ${POOL_N}（${desc.name}）`);
    }
    const r = rows[t];
    r.used = true; r.typeId = typeId; r.desc = desc;
    r.start = nextSlot; r.cap = desc.cap;
    r.kind = desc.kind === 'custom' ? 1 : 0;
    r.cursor = 0; r.prevCursor = 0; r.spawnActive = 0; r.rateScale = 1;
    r.customTick = null; r.api = null;
    r.spawnPos = [0, 0, 0]; r.spawnAnchorIdx = -1; r.destAnchorIdx = -1;
    nextSlot += desc.cap;
    if (r.kind === 1) {
      // 复杂类型：独立编译 dispatch（只管自己段；spawn+update 一体，行为栈自写）。
      // build 返回 { update: ComputeNode, tick?: () => 本帧前置节点（如燃烧条目压缩）,
      //              api?: 任意（池侧经 typeApi 取用；dispose?.() 由 reset/dispose 调） }
      const uSegStart = uniform(r.start);
      const ctx = {
        // 段落内 local 下标 → 全局粒子下标
        globalIdx: (localIdxNode) => int(uSegStart).add(int(localIdxNode)),
        segCap: desc.cap,
        // 类型行读取（vec4 下标 0..T_STRIDE-1，布局见 T_STRIDE 注释）
        row: (vec4Idx) => tS.element(int(t).mul(int(T_STRIDE)).add(int(vec4Idx))),
        stateS, payloadS, tS, anchorsS, aliveS,
        uDt, uTime, uFrame,
        rowIdx: t,
        anchorPoint: (aIdx, u, v, dm) => anchorPoint(anchorsS, aIdx, u, v, dm),
        // spawn 窗口判定（与 uber 同式；cursor 区间覆盖 local 即出生）
        spawnWindow: (localIdxNode) => {
          const r1 = tS.element(int(t).mul(int(T_STRIDE)).add(int(1)));
          const cap = tS.element(int(t).mul(int(T_STRIDE))).y;
          const s0 = floor(r1.x); const s1 = floor(r1.y);
          const m0 = s0.mod(cap); const m1 = s1.mod(cap);
          const lf = float(localIdxNode);
          return s1.greaterThan(s0).and(s1.sub(s0).greaterThanEqual(cap)
            .or(m0.lessThan(m1).and(lf.greaterThanEqual(m0)).and(lf.lessThan(m1))
              .or(m0.greaterThanEqual(m1).and(lf.greaterThanEqual(m0).or(lf.lessThan(m1))))));
        },
        // alive 记账（只在真出生/真死亡时调：出生 = wasAlive?0:+1，死亡 = -1）
        aliveAdd: (wasAliveNode) => atomicAdd(aliveS.element(uint(t)),
          select(wasAliveNode, uint(0), uint(1))),
        aliveSub: () => atomicSub(aliveS.element(uint(t)), uint(1)),
      };
      const built = desc.custom.build(ctx);
      if (built?.update) customPasses.push(built.update);
      if (built?.tick) r.customTick = built.tick;
      r.api = built?.api ?? null;
    }
    return t;
  }

  /** 懒分配入口：类型首次使用才占段；返回池内行号。 */
  function useType(typeId) {
    const exist = rows.findIndex(r => r.used && r.typeId === typeId);
    return exist >= 0 ? exist : allocate(typeId);
  }

  /**
   * burst helper（过渡件——GPU 化 spawn 请求队列排下期，届时本函数整体替换，
   * 行为栈无感）。opts.at = 出生点 [x,y,z]；opts.spawnAnchor = 出生锚 idx（优先于 at）；
   * opts.to = 目的锚 idx（undefined = 保持，-1 = 关闭）。
   */
  function burst(typeId, n, { at = null, spawnAnchor = undefined, to = undefined } = {}) {
    const t = useType(typeId);
    const r = rows[t];
    r.cursor += Math.max(0, n | 0);
    if (at) { r.spawnPos = [at[0], at[1], at[2]]; }
    if (spawnAnchor !== undefined) r.spawnAnchorIdx = spawnAnchor;
    if (to !== undefined) r.destAnchorIdx = to;
    return t;
  }

  /** 持续发射开关（rate 走类型 desc）。 */
  function setTypeActive(typeId, on) {
    rows[useType(typeId)].spawnActive = on ? 1 : 0;
  }
  /** 持续发射速率倍率（如燃烧 × 活跃单位数）。 */
  function setTypeRateScale(typeId, k) {
    rows[useType(typeId)].rateScale = k;
  }
  /** 复杂类型的运行期 API（custom.build 返回的 api；首次调用触发懒分配）。 */
  function typeApi(typeId) {
    return rows[useType(typeId)].api;
  }
  function setTypeSpawnPos(typeId, x, y, z) {
    const r = rows[useType(typeId)];
    r.spawnPos = [x, y, z]; r.spawnAnchorIdx = -1;
  }
  function setTypeSpawnAnchor(typeId, anchorIdx) {
    rows[useType(typeId)].spawnAnchorIdx = anchorIdx;
  }
  function setTypeDestination(typeId, anchorIdx) {
    rows[useType(typeId)].destAnchorIdx = anchorIdx;
  }

  // ---- 锚点管理器（32 槽；desc：{type:'line',p0,p1} | {type:'rect',center,half}
  //      | {type:'circle',center,radius}；坐标 = 池所在空间）----
  const anchors = Array.from({ length: MAX_ANCHOR }, () => ({
    used: false, type: 0, p0: [0, 0, 0], p1: [0, 0, 0],
  }));

  function addAnchor(desc) {
    const i = anchors.findIndex(a => !a.used);
    if (i < 0) throw new Error(`锚点表满（${MAX_ANCHOR} 槽/池）`);
    const a = anchors[i];
    a.used = true;
    writeAnchor(a, desc);
    return i;
  }
  function writeAnchor(a, desc) {
    if (desc.type !== undefined) {
      a.type = { line: 0, rect: 1, circle: 2 }[desc.type] ?? 0;
    }
    if (desc.p0) a.p0 = [...desc.p0];
    if (desc.p1) a.p1 = [...desc.p1];
    if (desc.center) a.p0 = [...desc.center];
    if (desc.half) { a.p1[0] = desc.half[0]; a.p1[1] = desc.half[1]; }
    if (desc.radius !== undefined) a.p1[0] = desc.radius;
  }
  function moveAnchor(idx, desc) {
    const a = anchors[idx];
    if (a?.used) writeAnchor(a, desc);
  }
  function removeAnchor(idx) {
    if (anchors[idx]) anchors[idx].used = false; // 行 alive=0 → 粒子退化纯 ttl
  }

  // ---- onDrained（alive==0 生命周期回调；节流读回 ~8Hz，武装语义防 burst 前误触发）----
  const watchers = []; // { row, cb, armed }
  let drainTimer = 0, drainReading = false;
  function onDrained(typeId, cb) {
    watchers.push({ row: useType(typeId), cb, armed: false });
  }
  function pollDrained(dt) {
    if (!watchers.length || drainReading) return;
    drainTimer += dt;
    if (drainTimer < 0.12) return;
    drainTimer = 0;
    drainReading = true;
    renderer.getArrayBufferAsync(aliveAttr).then(ab => {
      const c = new Uint32Array(ab);
      for (let i = watchers.length - 1; i >= 0; i--) {
        const w = watchers[i];
        const n = c[w.row] | 0;
        if (!w.armed) { if (n > 0) w.armed = true; continue; }
        if (n === 0) {
          watchers.splice(i, 1);
          try { w.cb(); } catch (e) { console.error('[particlePool] onDrained 回调异常', e); }
        }
      }
    }).catch(() => {}).finally(() => { drainReading = false; });
  }

  // ---- 表回填（每帧整表重写：32×12 + 32×2 vec4 ≈ 7KB，不做脏标记账）----
  function packTypes() {
    for (let t = 0; t < MAX_T; t++) {
      const r = rows[t];
      const o = t * T_STRIDE * 4;
      if (!r.used) { tArr.fill(0, o, o + T_STRIDE * 4); continue; }
      const s = r.desc.spawn;
      const dst = r.desc.destination;
      const rd = r.desc.render;
      const put = (row, a, b, c, d) => {
        const p = o + row * 4;
        tArr[p] = a; tArr[p + 1] = b; tArr[p + 2] = c; tArr[p + 3] = d;
      };
      // r0.w = 「本行已分配」标志（shader 归属判据）。spawnActive 只是 CPU 侧持续发射
      // 开关（控制游标是否随 dt 推进），不进 shader——burst 游标跳变本身就是出生信号。
      put(0, r.start, r.cap, r.kind, 1);
      put(1, r.prevCursor, r.cursor, s.rate, s.ttl);
      put(2, r.spawnPos[0], r.spawnPos[1], r.spawnPos[2], r.spawnAnchorIdx);
      put(3, s.vel[0], s.vel[1], s.vel[2], s.velJit);
      put(4, s.spread, s.gravity, s.drag, s.windK);
      put(5, r.destAnchorIdx, dst?.domainMode ?? 0, dst?.steerDelay ?? 0, dst?.steerRamp ?? 0.2);
      put(6, dst?.steerK ?? 0, dst?.arriveR ?? 1, dst?.curveK ?? 0, r.desc.endMode);
      put(7, r.desc.progressMode, s.ttlJit, rd.size, rd.sizeEndK);
      put(8, rd.color[0], rd.color[1], rd.color[2], rd.alpha);
      put(9, rd.colorEnd[0], rd.colorEnd[1], rd.colorEnd[2], rd.heat);
      put(10, s.radial, rd.ageHeat ?? 0, 0, 0);
      put(11, rd.softness ?? 1, 0, 0, 0);
    }
    tAttr.needsUpdate = true;
  }
  function packAnchors() {
    for (let i = 0; i < MAX_ANCHOR; i++) {
      const a = anchors[i];
      const o = i * A_STRIDE * 4;
      anchorArr[o] = a.type;
      anchorArr[o + 1] = a.used ? 1 : 0;
      anchorArr[o + 2] = a.p0[0]; anchorArr[o + 3] = a.p0[1];
      anchorArr[o + 4] = a.p0[2];
      anchorArr[o + 5] = a.p1[0]; anchorArr[o + 6] = a.p1[1]; anchorArr[o + 7] = a.p1[2];
    }
    anchorAttr.needsUpdate = true;
  }

  let t = 0, frame = 0;
  let drawAll = true;   // 空转藏绘状态（无注册类型 = 无 FX 可出生 → drawRange 归零）
  function update(dt) {
    t += dt; frame += 1;
    let anyRows = false;
    for (const r of rows) {
      if (!r.used) continue;
      anyRows = true;
      // prevCursor = 上次 update 结尾的游标（burst 在两帧之间累加进 cursor，
      // 窗口 [prevCursor, cursor) 天然含 burst——若在此刻同步 prevCursor=cursor
      // 会把 burst 跳变整个吞掉，spike-particles2 实测全灭）
      if (r.spawnActive && r.desc.spawn.rate > 0) {
        r.cursor += r.desc.spawn.rate * r.rateScale * dt;
      }
    }
    // 空转藏绘：无任何注册类型时 drawRange 归零——死粒子虽被 shader 挪出视锥且
    // size=0，主渲/两条偏移链仍各付 16K 顶点的空转着色；compute 模拟与
    // onBeforeRender 不受影响（drawRange 只裁 draw），类型一注册即恢复。
    if (anyRows !== drawAll) {
      drawAll = anyRows;
      points.geometry.setDrawRange(0, anyRows ? Infinity : 0);
    }
    packTypes();
    packAnchors();
    for (const r of rows) { if (r.used) r.prevCursor = r.cursor; }
    uDt.value = dt; uTime.value = t; uFrame.value = frame;
    // 单次提交保序：复杂类型前置（如燃烧条目压缩）→ uber update → 复杂类型
    // 各自 dispatch → present（读本帧终态）→ 尾钩子（场景火焰提案清零——
    // 读后清，渲染期物体材质再写新提案，下帧 spawn 读到的是本帧写入）
    const pre = [];
    for (const r of rows) {
      if (r.used && r.kind === 1 && r.customTick) {
        const ns = r.customTick();
        if (ns?.length) pre.push(...ns);
      }
    }
    const tails = [];
    for (const fn of tailNodes) { const n = fn(); if (n) tails.push(n); }
    renderer.compute([...pre, updateNode, ...customPasses, presentNode, ...tails]);
    pollDrained(dt);
  }

  // 尾节点注册（fn → compute node | null，每帧求值）：场景火焰提案清零用
  const tailNodes = [];
  function registerTail(fn) { tailNodes.push(fn); }

  /** 场景切换清预算：段全释放、游标/锚点/计数归零、粒子全灭（类型登记不受影响）。 */
  function reset() {
    for (const r of rows) { r.api?.dispose?.(); r.used = false; }
    nextSlot = 0;
    customPasses.length = 0;
    watchers.length = 0;
    for (const a of anchors) a.used = false;
    for (let i = 0; i < POOL_N; i++) {
      stateArr[i * 8 + 3] = -1; stateArr[i * 8 + 7] = -1;
      payloadArr[i * 8] = -1;
    }
    stateAttr.needsUpdate = true;
    payloadAttr.needsUpdate = true;
    aliveArr.fill(0);
    aliveAttr.needsUpdate = true;
  }

  // ---- 探针（异步读回；生产路径不读回）----
  async function debugReadCounts() {
    return Array.from(new Uint32Array(await renderer.getArrayBufferAsync(aliveAttr)));
  }
  async function debugReadState() {
    const buf = new Float32Array(await renderer.getArrayBufferAsync(stateAttr));
    const pay = new Float32Array(await renderer.getArrayBufferAsync(payloadAttr));
    let alive = 0; const sample = [];
    for (let i = 0; i < POOL_N; i++) {
      const age = buf[i * 8 + 3];
      if (age >= 0 && age < 1) {
        alive++;
        if (sample.length < 6) {
          sample.push({
            pos: [+buf[i * 8].toFixed(2), +buf[i * 8 + 1].toFixed(2), +buf[i * 8 + 2].toFixed(2)],
            age: +age.toFixed(3),
            anchorIdx: +pay[i * 8].toFixed(0),
            progress: +pay[i * 8 + 4].toFixed(3),
          });
        }
      }
    }
    return { alive, sample };
  }

  function dispose() {
    for (const r of rows) r.api?.dispose?.();
    stateAttr.dispose();
    payloadAttr.dispose();
    tAttr.dispose();
    anchorAttr.dispose();
    aliveAttr.dispose();
    geo.dispose();
    quad.dispose();
    pointsMat.dispose();
    points.parent?.remove(points);
  }

  return {
    points, update, dispose, reset,
    burst, setTypeActive, setTypeRateScale, setTypeSpawnPos, setTypeSpawnAnchor, setTypeDestination,
    useType, typeApi, addAnchor, moveAnchor, removeAnchor, onDrained, registerTail,
    debugReadCounts, debugReadState,
    get allocatedSlots() { return nextSlot; },
    space,
  };
}
