// qi 气流环绕粒子（qiFlow 咏唱持续段的环绕件，GPU 池 custom 类型）——
// 三族流形交织：内升螺旋（密/暗/快）、外缘缓带（疏/中/慢）、逆行游丝（稀/亮/中速）
// ——每粒独立极坐标运动（θ 积分 + 半径呼吸 + 高度带按生命线性爬升：终点钉在头肩
// 带内，升腾永不过头顶），角向密度由慢漂移的正弦
// 乘积场做 rejection 采样（环带没有均匀圈感，只有流动的浓淡），亮暗走
// present 的 progress 通道（生命期正弦包络 × 逐粒抖动 × 闪烁 × 包络 k），
// 尺寸按年龄斜坡（sizeMode 'age'——与亮度解耦）。
// 链路：chantSceneFx（qiFlow 主题）→ createQiOrbitLink(pool).start/setAnchor/setLevel。
import {
  Fn, If, uniform,
  uint, int, float, vec3, vec4,
  fract, sin, cos, clamp, mix,
  select, instanceIndex,
} from 'three/tsl';
import { defineParticleType } from './particleTypes.js';

const hash1 = Fn(([n]) => fract(sin(n).mul(43758.5453123)));
const TAU = 3.14159265 * 2;

export const QI_ORBIT = defineParticleType({
  name: 'qiOrbit', space: 'world', cap: 320, kind: 'custom',
  // rate 是「spawn 尝试」口径：角向密度 rejection 平均放行 ~0.62，稳态存活 ≈ rate×0.62×ttl
  spawn: { rate: 140, ttl: 2.6, ttlJit: 0.55, vel: [0, 0, 0], velJit: 0, spread: 0, gravity: 0, drag: 0, windK: 0 },
  // sizeMode 'age'：尺寸斜坡按年龄走——progress 通道承载的是亮度包络（族亮/闪烁/
  // level 都在里面），不能当尺寸驱动（亮族会变大、尺寸随火闪脉动）
  render: { size: 0.30, sizeEndK: 1.35, sizeMode: 'age', color: [0.58, 0.68, 0.92], colorEnd: [1.0, 1.05, 1.2], alpha: 0.45, heat: 0.6, softness: 2.6 },
  custom: {
    build(ctx) {
      // JS 侧逐帧推的运行参数（api 写、shader 读）：锚点三分量/立牌高/环绕半径/包络
      const uAX = uniform(0), uAY = uniform(0), uAZ = uniform(0);
      const uH = uniform(22), uR = uniform(6.6), uLevel = uniform(0);

      const fn = Fn(() => {
        const li = int(instanceIndex);
        const idx = ctx.globalIdx(li);
        const A = ctx.stateS.element(idx.mul(int(2)));
        const B = ctx.stateS.element(idx.mul(int(2)).add(int(1)));
        const P0 = ctx.payloadS.element(idx.mul(int(2)));
        const P1 = ctx.payloadS.element(idx.mul(int(2)).add(int(1)));
        // 槽位稳定哈希（生命期内恒定）：呼吸相位/闪烁频率用；重 spawned 后换值无妨
        const hs = hash1(float(idx).mul(0.371)).toVar();

        If(ctx.spawnWindow(li), () => {
          // —— spawn：族抽样（55/33/12）→ 角向浓淡 rejection → 极参数落账 ——
          const h1 = hash1(float(idx).mul(0.719).add(ctx.uFrame.mul(0.613))).toVar();
          const h2 = hash1(h1.mul(91.7).add(0.13));
          const h3 = hash1(h1.mul(47.3).add(0.37));
          const h4 = hash1(h1.mul(71.9).add(0.61));
          const h5 = hash1(h1.mul(33.1).add(0.83));
          const h6 = hash1(h1.mul(17.7).add(0.49));
          const h7 = hash1(h1.mul(53.9).add(0.29));
          // 角向密度：两个慢漂移正弦的乘积场（0.2~1.0）——浓淡扇区随时间游走
          const th = h3.mul(TAU).toVar();
          const dens = float(0.60)
            .add(float(0.40).mul(sin(th.mul(3.0).add(ctx.uTime.mul(0.35)))
              .mul(sin(th.mul(3.4).sub(ctx.uTime.mul(0.22)).add(2.1)))));
          If(h4.lessThan(dens), () => {
            const isF1 = h2.greaterThanEqual(0.55).and(h2.lessThan(0.88));
            const isF2 = h2.greaterThanEqual(0.88);
            const fam = select(isF2, float(2.0), select(isF1, float(1.0), float(0.0))).toVar();
            // 族形：半径分数带（占 uR）/ 角速度（f2 逆行）/ 高度带（h0→hEnd 按
            // 生命线性，整簇压在下 ~1/3 身位带内——纵扁横阔的气场，不窜天）
            const r0 = select(isF2, float(0.70).add(h5.mul(0.20)),
              select(isF1, float(0.85).add(h5.mul(0.20)),
                float(0.55).add(h5.mul(0.20)))).toVar();
            const om = select(isF2, float(-0.70).sub(h6.mul(0.50)),
              select(isF1, float(0.45).add(h6.mul(0.40)),
                float(1.50).add(h6.mul(0.80)))).toVar();
            const h0 = select(isF2, float(0.06).add(h7.mul(0.14)),
              select(isF1, float(0.04).add(h7.mul(0.22)),
                float(-0.03).add(h7.mul(0.08)))).toVar();
            const hEnd = select(isF2, float(0.24).add(h1.mul(0.12)),
              select(isF1, h0.add(float(0.02).add(h1.mul(0.03))),
                float(0.16).add(h1.mul(0.14)))).toVar();
            const r1 = ctx.row(1); // ttl 在 w
            const r7 = ctx.row(7); // ttlJit 在 y
            const ttlA = r1.w.mul(float(1.0).add(h6.sub(0.5).mul(2.0).mul(r7.y))).max(0.05).toVar();
            const wasAlive = A.w.greaterThanEqual(0.0).and(A.w.lessThan(1.0));
            ctx.aliveAdd(wasAlive);
            const r = uR.mul(r0);
            A.assign(vec4(
              uAX.add(cos(th).mul(r)),
              uAY.add(uH.mul(h0)),
              uAZ.add(sin(th).mul(r).mul(0.55)),
              0.001));
            // B = (θ, ω, h0 分数, r0 分数)；P0.x = hEnd 分数；P1 = (progress, 族, ttl, 亮暗抖动)
            B.assign(vec4(th, om, h0, r0));
            P0.assign(vec4(hEnd, 0.0, 0.0, 0.0));
            P1.assign(vec4(0.0, fam, ttlA, float(0.55).add(h1.mul(0.45))));
          });
        }).Else(() => {
          // —— 积分：极坐标运动（θ 推进/半径呼吸/族内升速），位置由锚点现算 ——
          const age = A.w;
          If(age.greaterThanEqual(0.0).and(age.lessThan(1.0)), () => {
            const fam = P1.y;
            const isF1 = fam.greaterThanEqual(0.5).and(fam.lessThan(1.5));
            const isF2 = fam.greaterThanEqual(1.5);
            const brightFam = select(isF2, float(1.0), select(isF1, float(0.78), float(0.58)));
            const ttlA = P1.z;
            const ageN = age.add(ctx.uDt.div(ttlA)).toVar();
            // θ 推进（包络越高旋越快）
            const spin = float(0.55).add(uLevel.mul(0.45));
            const th = B.x.add(B.y.mul(spin).mul(ctx.uDt)).toVar();
            // 高度：生命期线性 h0→hEnd（终点即头肩界）+ 慢浮动
            const hp = mix(B.z, P0.x, clamp(ageN, 0.0, 1.0))
              .add(float(0.015).mul(sin(ctx.uTime.mul(1.1).add(hs.mul(6.28)))));
            // 半径呼吸（槽位相位）
            const r = uR.mul(B.w).mul(float(1.0).add(float(0.10).mul(sin(ctx.uTime.mul(1.4).add(hs.mul(6.28))))));
            const pos = vec3(
              uAX.add(cos(th).mul(r)),
              uAY.add(uH.mul(hp)),
              uAZ.add(sin(th).mul(r).mul(0.55)));
            If(ageN.greaterThanEqual(1.0), () => {
              A.assign(vec4(pos, 1.5));
              ctx.aliveSub();
            }).Else(() => {
              A.assign(vec4(pos, ageN));
              B.assign(vec4(th, B.y, B.z, B.w));
              // 亮暗包络（present 的 progress）：生命期正弦 × 族亮 × 逐粒抖动 × 慢闪烁 × 包络
              const env = sin(clamp(ageN, 0.0, 1.0).mul(3.14159265));
              const tw = float(0.82).add(float(0.18).mul(
                sin(ctx.uTime.mul(float(2.3).add(hs.mul(2.6))).add(hs.mul(6.28)))));
              const prog = clamp(env.mul(P1.w).mul(brightFam).mul(tw)
                .mul(float(0.30).add(uLevel.mul(0.70))), 0.0, 1.0);
              P1.assign(vec4(prog, P1.y, P1.z, P1.w));
            });
          });
        });
      });

      return {
        update: fn().compute(ctx.segCap, [64]),
        api: {
          setAnchor(x, y, z, H, R) {
            uAX.value = x; uAY.value = y; uAZ.value = z;
            uH.value = H; uR.value = R;
          },
          setLevel(k) { uLevel.value = k; },
        },
      };
    },
  },
});

/**
 * qiFlow 环绕门面（chantSceneFx 用）：start/stop 控持续发射，setAnchor 每帧跟人，
 * setLevel 推包络（密度走 rateScale、速度/亮暗走 uLevel）。池缺位（非 WebGPU）返回 null。
 * @param {object|null} pool 世界 GPU 池
 * @param {{ radiusK?: number }} cfg radiusK = 环绕半径占立牌高的比例
 */
export function createQiOrbitLink(pool, { radiusK = 0.30 } = {}) {
  if (!pool) return null;
  return {
    start() { pool.setTypeActive(QI_ORBIT, 1); },
    stop() { pool.setTypeActive(QI_ORBIT, 0); },
    setLevel(k) {
      // typeApi 每次现取（池 reset 后行重建，缓存句柄会指旧闭包）
      pool.typeApi(QI_ORBIT)?.setLevel(k);
      pool.setTypeRateScale(QI_ORBIT, 0.15 + 0.85 * k);
    },
    setAnchor(a) {
      if (!a) return;
      pool.typeApi(QI_ORBIT)?.setAnchor(a.x, a.y, a.z, a.H, a.H * radiusK);
    },
    dispose() { this.stop(); },
  };
}
