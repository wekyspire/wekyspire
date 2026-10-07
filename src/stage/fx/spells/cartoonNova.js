// 卡通爆炸（爆裂术终止专属，2026-10-02 用户定艺术方向）：**2D 烟雾粒子爆散变色，
// 黑烟云朵是主体**——经典卡通画的「一团镶黑边的烟蓬 + 内里火光 + 火星四溅」。
//
// 为什么不在粒子池 v2 里：池材质全局 additiveLight，而黑烟需要**法线混合的暗色
// 不透明粒子**（加法混合出不了黑色）——用户点名的「自定义 size attribute 更新 &
// vertex/fragment shader 粒子系统」按 moonDust 先例自承载（InstancedBufferGeometry
// + PointsNodeMaterial），一次性效果、~140 实例、无逐帧 CPU。
//
// 无状态解析驱动：所有粒子属性出生即定（aOrigin/aVel/aParm/aKind 四个 instanced
// attribute），顶点着色器用 uTime 解析积分（阻尼弹道闭式解 + 尺寸生长曲线），
// 片元着色器按年龄三停变色 + 卡通描边 puff。CPU 只在 burst 时填一次数组。
//
// 三层组分（实例序即绘制序——法线混合画家算法，后画压先画）：
//   0 fire   火光团：HDR 白炽→橙→深红，小而快，被烟盖住前提供「炸开那一瞬」的亮度
//   1 smoke  烟云主体：灰→黑大 puff，带深色描边带（卡通轮廓），分两波——
//            地面环形烟（XZ 外向爆开 = 冲击波的卡通表达）+ 球冠主体烟（错帧出生滚卷）
//   2 spark  火星：高 HDR 小点抛物线外抛（bloom 拾取）
// 尺度基准：战场视深 ≈229 单位，1 世界单位 ≈ 7.4 css px（2026-10-02 实测校准）。
import * as THREE from 'three';
import { PointsNodeMaterial } from 'three/webgpu';
import {
  Fn, uniform, instancedBufferAttribute, uv, vec2, vec3, vec4, float,
  exp, sin, cos, clamp, mix, smoothstep, oneMinus, select, length, varying, dot,
} from 'three/tsl';
import { bloomPassFlag, setBloomWriter } from '../bloomOffset.js';

const MAX_TTL = 3.3;   // 全场寿命上限（秒）——驱动协程的持有时长

/**
 * 卡通爆炸块（与 blocks.js 同约：async 协程，at = 爆心世界点）。
 * scale = 伤害量缩放（密度/尺寸），width = 要吞没的阵型横展（世界单位，
 * 拉横向速度与出生散布），mini = 跟随拍小型版（AOE 次目标的命中读感）。
 */
export async function cartoonNova(ctx, deps, {
  at, scale = 1, width = 14, mini = false,
} = {}) {
  if (!at || !deps?.scene) return;
  // 场景交互广播（单向，大爆炸双事件）：冲击 + 高温 → PCG 道具物理响应与燃烧
  if (!mini) {
    deps.notify?.('impact', { at: { x: at.x, z: at.z ?? 0 }, power: 1.6 * scale });
    deps.notify?.('heat', { at: { x: at.x, z: at.z ?? 0 }, temp: 1.5 * scale });
  }
  const sK = (mini ? 0.34 : 1.0) * Math.min(1.5, Math.max(0.75, scale));
  const wK = Math.min(1.7, Math.max(0.75, width / 22));
  const cK = mini ? 0.25 : 1.0;   // 密度系数

  // ---- 粒子装配（CPU 一次成型）----
  const org = [], vel = [], parm = [], misc = [];
  const R = (a, b) => a + Math.random() * (b - a);
  /** kind 0 fire / 1 smoke / 2 spark */
  const add = (kind, o, v, size0, growK, delay, ttl, gravity, alpha0, fadeStart) => {
    org.push(o[0], o[1], o[2], Math.random());
    vel.push(v[0], v[1], v[2], 0);   // drag 在 push 处按类填（见下 0.25/2.x）
    parm.push(size0 * sK, growK, delay, ttl);
    misc.push(kind, gravity, alpha0, fadeStart);
  };
  const cx = at.x, cy = at.y, cz = (at.z ?? 0) + 4;   // 略偏向相机，盖住立牌

  // 0 火光团（先画 = 被烟压）——要读作「成团的亮橙火蓬」而非薄 wash：团大不透明
  const nFire = Math.round(20 * cK);
  for (let i = 0; i < nFire; i++) {
    const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
    const rr = Math.random() * 2.6 * wK;
    const o = [cx + Math.sin(ph) * Math.cos(th) * rr, cy + Math.cos(ph) * rr * 0.8, cz + Math.sin(ph) * Math.sin(th) * rr * 0.5];
    const sp = R(7, 17);
    const v = [Math.sin(ph) * Math.cos(th) * sp * wK, Math.cos(ph) * sp * 0.9 + 2, Math.sin(ph) * Math.sin(th) * sp * 0.5];
    add(0, o, v, R(4.5, 9.5), 1.6, R(0, 0.06), R(0.6, 0.9), 1.5, 1.0, 0.5);
    vel[vel.length - 1] = 2.4; // drag
  }
  // 1a 地面环形烟（冲击波）：XZ 外向
  const nRing = Math.round(22 * cK);
  for (let i = 0; i < nRing; i++) {
    const th = (i / nRing) * Math.PI * 2 + R(-0.15, 0.15);
    const rr = R(2.5, 4.5) * wK;
    const o = [cx + Math.cos(th) * rr, cy - 1.2 + R(-0.5, 0.5), cz + Math.sin(th) * rr * 0.45];
    const sp = R(15, 29);
    const v = [Math.cos(th) * sp * wK, R(0.5, 1.5), Math.sin(th) * sp * 0.45];
    add(1, o, v, R(1.9, 3.9), 1.8, R(0, 0.08), R(1.0, 1.4), 0.8, 0.85, 0.55);
    vel[vel.length - 1] = 2.8;
  }
  // 1b 主体烟（球冠滚卷，错帧出生）——少数大烟团（慢/厚/长命）把尺寸分布拉开
  const nSmoke = Math.round(70 * cK);
  for (let i = 0; i < nSmoke; i++) {
    const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
    const rr = Math.random() * 3.6 * wK;
    const o = [cx + Math.sin(ph) * Math.cos(th) * rr, cy + Math.cos(ph) * rr * 0.85, cz + Math.sin(ph) * Math.sin(th) * rr * 0.5];
    const big = Math.random() < 0.16;
    const sp = big ? R(4, 7.5) : R(5.5, 15.5);
    const v = [Math.sin(ph) * Math.cos(th) * sp * wK, Math.cos(ph) * sp * 0.9 + R(2, 9), Math.sin(ph) * Math.sin(th) * sp * 0.5];
    add(1, o, v, big ? R(4.6, 6.2) : R(2.0, 4.0), big ? 1.7 : 2.3, R(0.05, 0.35),
      big ? R(2.3, 3.1) : R(1.6, 2.7), 2.2, big ? 0.95 : 0.92, 0.62);
    vel[vel.length - 1] = 2.0;
  }
  // 2 火星（最后画 = 压全场）
  const nSpark = Math.round(34 * cK);
  for (let i = 0; i < nSpark; i++) {
    const th = Math.random() * Math.PI * 2;
    const sp = R(18, 40);
    const o = [cx + R(-1, 1), cy + R(-1, 1), cz + R(-0.5, 0.5)];
    const v = [Math.cos(th) * sp * wK, R(4, 8), Math.sin(th) * sp * 0.4];
    add(2, o, v, R(0.55, 1.25), -0.55, R(0, 0.1), R(0.9, 1.5), -22, 1.0, 0.35);
    vel[vel.length - 1] = 0.8;
  }

  const n = parm.length / 4;
  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  geo.setAttribute('uv', quad.attributes.uv);
  geo.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(new Float32Array(org), 4));
  geo.setAttribute('aVel', new THREE.InstancedBufferAttribute(new Float32Array(vel), 4));
  geo.setAttribute('aParm', new THREE.InstancedBufferAttribute(new Float32Array(parm), 4));
  geo.setAttribute('aKind', new THREE.InstancedBufferAttribute(new Float32Array(misc), 4));
  geo.instanceCount = n;

  const uTime = uniform(0.0);
  const uProj11 = uniform(1.8);

  // ---- 顶点侧：解析弹道（阻尼闭式解）+ 尺寸生长 ----
  const aOrigin = instancedBufferAttribute(geo.attributes.aOrigin, 'vec4');
  const aVel = instancedBufferAttribute(geo.attributes.aVel, 'vec4');
  const aParm = instancedBufferAttribute(geo.attributes.aParm, 'vec4');
  const aKind = instancedBufferAttribute(geo.attributes.aKind, 'vec4');
  const age = uTime.sub(aParm.z).toVar();                       // 出生延迟后的年龄
  const alive = age.greaterThan(0.0).and(age.lessThan(aParm.w)).toVar();
  const ageC = clamp(age, 0.0, aParm.w).toVar();
  const drag = aVel.w.max(0.05);
  const travel = oneMinus(exp(drag.negate().mul(ageC))).div(drag).toVar();
  const pos = aOrigin.xyz.add(aVel.xyz.mul(travel))
    .add(vec3(0.0, float(0.5).mul(aKind.y).mul(ageC).mul(ageC), 0.0)).toVar();
  const size = aParm.x.mul(float(1.0).add(aParm.y.mul(oneMinus(exp(ageC.mul(-2.6)))))).toVar();
  const t01 = clamp(age.div(aParm.w), 0.0, 1.0).toVar();

  // varying 桥：片元要用的逐粒量（顶点算一次，四角共享）
  const vT = varying(t01, 'novaT');
  const vSeed = varying(aOrigin.w, 'novaSeed');
  const vMisc = varying(vec3(aKind.x, aKind.z, aKind.w), 'novaMisc');  // kind/alpha0/fadeStart
  const vAlive = varying(select(alive, 1.0, 0.0), 'novaAlive');

  // ---- 片元：卡通 puff（硬边 + 深色描边带 + 块状边缘起伏）+ 三停变色 ----
  const shade = Fn(() => {
    const p = uv().sub(vec2(0.5));
    const d = length(p).mul(2.0).toVar();
    const t = vT.toVar();
    const kind = vMisc.x;
    // 自转：逐粒角速度（seed 哈希）——团块采样坐标随年龄滚转（烟蓬滚卷感；
    // length 旋转不变故只转 wob 坐标，轮廓圆度不受影响）
    const ang = vSeed.mul(6.2832).add(vSeed.mul(9.4).sub(4.7).mul(t));
    const cs = cos(ang), sn = sin(ang);
    const pr = vec2(p.x.mul(cs).sub(p.y.mul(sn)), p.x.mul(sn).add(p.y.mul(cs)));
    // 暴散：起伏幅度随年龄增强（烟越散边缘越毛糙）+ 高频碎边项（无 atan：
    // 双频 sin 哈希近似角向团块 + 斜向碎频；年龄渐入防出生抖）
    const wob = sin(pr.x.mul(17.0).add(vSeed.mul(37.0)))
      .add(sin(pr.y.mul(15.0).add(vSeed.mul(51.0))))
      .add(sin(pr.x.mul(29.0).sub(pr.y.mul(23.0)).add(vSeed.mul(73.0))).mul(0.6))
      .mul(0.055).mul(clamp(t.mul(2.0), 0.05, 1.0).add(t.mul(0.6)));
    const r = d.add(wob).toVar();
    const body = oneMinus(smoothstep(0.88, 1.0, r)).toVar();
    // 硬性边界保证：wob 为负会把 r 拉回不透明区（面片边缘 r≈0.77 → alpha=1 被
    // 几何边界截断 = 硬边）——rim 用**未扰动**的 d 收边，d→1 时 alpha 必为 0
    const rim = oneMinus(smoothstep(0.90, 1.0, d)).toVar();
    const outline = smoothstep(0.66, 0.82, r).mul(body).toVar();   // 卡通描边带
    // 烟三停：火照暖灰 → 中灰 → 近黑（卡通黑烟主体——首版中停 0.36 在暗场景
    // 反读成白雾，压到 0.26/0.095 才是「黑烟」）
    const smokeC = mix(
      mix(vec3(0.82, 0.52, 0.32), vec3(0.26, 0.235, 0.225), smoothstep(0.0, 0.18, t)),
      vec3(0.075, 0.07, 0.07), smoothstep(0.18, 0.8, t));
    const smoke = smokeC.mul(oneMinus(outline.mul(0.55)));
    // 火三停：白炽 → 橙 → 深红（HDR 供 bloom）+ 快衰核心
    const fireC = mix(
      mix(vec3(3.4, 2.7, 1.8), vec3(2.6, 1.0, 0.26), smoothstep(0.0, 0.35, t)),
      vec3(1.3, 0.32, 0.07), smoothstep(0.35, 1.0, t));
    const fire = fireC.add(vec3(3.0, 2.4, 1.5).mul(exp(d.mul(d).mul(-5.0))).mul(oneMinus(t)));
    // 火星：软点小圆
    const sparkBody = oneMinus(smoothstep(0.15, 0.5, d));
    const spark = mix(vec3(3.2, 1.9, 0.75), vec3(1.2, 0.3, 0.05), t);
    // 按类合色
    const isFire = kind.lessThan(0.5);
    const isSpark = kind.greaterThan(1.5);
    const rgb = select(isSpark, spark, select(isFire, fire, smoke)).toVar();
    const shape = select(isSpark, sparkBody, body).toVar();
    // 淡出：fadeStart 前满 alpha，之后线性收零
    const fade = oneMinus(smoothstep(vMisc.z, float(1.0), t)).toVar();
    const a = vMisc.y.mul(shape).mul(fade).mul(vAlive).mul(rim).toVar();
    return select(bloomPassFlag.greaterThan(0.5),
      vec4(dot(rgb, vec3(0.3, 0.5, 0.2)).mul(a).mul(0.7), 0.0, 0.0, 1.0),
      vec4(rgb, a));
  });

  const mat = new PointsNodeMaterial({
    transparent: true,
    blending: THREE.NormalBlending,   // 黑烟要「压住」下层——加法混合出不了深色
    depthWrite: false,
    depthTest: true,
    fog: false,
  });
  mat.positionNode = select(alive, pos, vec3(0.0, -100000.0, 0.0));
  mat.sizeNode = select(alive, size.mul(uProj11), float(0.0));
  mat.colorNode = shade();

  const points = new THREE.Sprite(mat);
  points.geometry = geo;
  points.name = 'spellFx:cartoonNova';
  points.frustumCulled = false;
  points.raycast = () => {};
  points.renderOrder = 6;
  setBloomWriter(points, true);
  points.onBeforeRender = (_r, _s, camera) => {
    const e = camera.projectionMatrix.elements;
    uProj11.value = camera.isOrthographicCamera ? e[5] * 450 : e[5];   // 世界场景恒透视
  };
  deps.scene.add(points);

  const dispose = () => { deps.scene.remove(points); geo.dispose(); mat.dispose(); };
  ctx.onKill(dispose);
  const st = { t: 0 };
  await ctx.tweenRaw(st, { t: 1 }, {
    durationMs: MAX_TTL * 1000, ease: 'none',
    onUpdate: () => { uTime.value = st.t * MAX_TTL; },
    onComplete: dispose,
  });
}
