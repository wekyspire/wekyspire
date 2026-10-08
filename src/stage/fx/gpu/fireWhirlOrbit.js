// 火焰旋风环绕粒子（fireWhirl 施术拍爆发 + fireHeat 咏唱持续段，GPU 池 custom
// 类型）——2026-10-07 用户定「换粒子特效，类太极但更精致」（噪声+圆柱面片方案
// 废弃）。火龙卷运动学，在 qiOrbit 极坐标骨架上加五件手艺：
//   · 三族：火芯螺旋（密/快/贴轴/急升）、外缘火舌（疏/中速/大幅软点）、逆行余焰
//     （稀/暗红/反向缓带）；
//   · 涡剪：角速度随高度衰减（底快梢慢——火根甩得快、火梢拖着走）；
//   · 漏斗形：半径随高度扩张（底窄顶宽的龙卷体态）；
//   · 生命期外甩：life² 加权的半径外抛（根稳梢散——拔升途中向外甩火星，「散」
//     的主体；强度按出生时刻包络烘定——峰值期生的粒子不随包络回落回缩）；
//   · 螺旋臂读感：spawn 时角向 θ 与出生高度带关联（同角度的粒子聚在相近高度——
//     等值线成对角螺旋带，不是水平匀环）；
//   · 生命期色温：池 render color→colorEnd（白黄热根 → 橙 → 暗红梢）。
// 双实例：施术爆发（FIRE_WHIRL_ORBIT）与咏唱常驻（FIRE_WHIRL_ORBIT_CHANT）各占
// 一段——同一池类型只有一组 anchor/level uniform，两路同开会互相覆写。
// 链路：fireWhirlCast（爆发）/ chantSceneFx（fireHeat 主题常驻）
//   → createFireWhirlLink(pool, { type }).start/setAnchor/setLevel/stop。
import {
  Fn, If, uniform,
  int, float, vec3, vec4,
  fract, sin, cos, clamp, mix,
  select, instanceIndex,
} from 'three/tsl';
import { defineParticleType } from './particleTypes.js';

const hash1 = Fn(([n]) => fract(sin(n).mul(43758.5453123)));
const TAU = 3.14159265 * 2;

// custom build（两实例共用——每次调用拿自己的 ctx/uniform，互不串扰）
const buildWhirl = (ctx) => {
  const uAX = uniform(0), uAY = uniform(0), uAZ = uniform(0);
  const uH = uniform(22), uR = uniform(5.8), uLevel = uniform(0);

  const fn = Fn(() => {
    const li = int(instanceIndex);
    const idx = ctx.globalIdx(li);
    const A = ctx.stateS.element(idx.mul(int(2)));
    const B = ctx.stateS.element(idx.mul(int(2)).add(int(1)));
    const P0 = ctx.payloadS.element(idx.mul(int(2)));
    const P1 = ctx.payloadS.element(idx.mul(int(2)).add(int(1)));
    const hs = hash1(float(idx).mul(0.371)).toVar();

    If(ctx.spawnWindow(li), () => {
      const h1 = hash1(float(idx).mul(0.719).add(ctx.uFrame.mul(0.613))).toVar();
      const h2 = hash1(h1.mul(91.7).add(0.13));
      const h3 = hash1(h1.mul(47.3).add(0.37));
      const h4 = hash1(h1.mul(71.9).add(0.61));
      const h5 = hash1(h1.mul(33.1).add(0.83));
      const h6 = hash1(h1.mul(17.7).add(0.49));
      const h7 = hash1(h1.mul(53.9).add(0.29));
      const h8 = hash1(h1.mul(27.7).add(0.71));
      // 角向浓淡：双慢漂正弦乘积场（火带扇区随时间游走）
      const th = h3.mul(TAU).toVar();
      const dens = float(0.58)
        .add(float(0.42).mul(sin(th.mul(2.0).add(ctx.uTime.mul(0.55)))
          .mul(sin(th.mul(2.6).sub(ctx.uTime.mul(0.34)).add(1.7)))));
      If(h4.lessThan(dens), () => {
        const isF1 = h2.greaterThanEqual(0.55).and(h2.lessThan(0.88));
        const isF2 = h2.greaterThanEqual(0.88);
        const fam = select(isF2, float(2.0), select(isF1, float(1.0), float(0.0))).toVar();
        // 族形：半径分数（占 uR）/ 角速度（F2 逆行）/ 高度带（螺旋关联：θ 分数
        // 折算进出生高度——同角同带 = 对角螺旋臂）/ 外甩系数（生命期 r 外抛，
        // 「散」的主体——龙卷拔升途中向外甩火星）
        const spiral = th.div(TAU).mul(0.22);
        const r0 = select(isF2, float(0.85).add(h5.mul(0.55)),
          select(isF1, float(0.55).add(h5.mul(0.50)),
            float(0.18).add(h5.mul(0.37)))).toVar();
        const om = select(isF2, float(-0.60).sub(h6.mul(0.50)),
          select(isF1, float(1.10).add(h6.mul(0.80)),
            float(2.30).add(h6.mul(1.10)))).toVar();
        const h0 = select(isF2, float(0.10).add(h7.mul(0.18)),
          select(isF1, float(0.02).add(h7.mul(0.14)),
            float(-0.02).add(h7.mul(0.06)))).add(spiral).toVar();
        const hEnd = select(isF2, float(0.35).add(h1.mul(0.25)),
          select(isF1, float(0.50).add(h1.mul(0.40)),
            float(0.85).add(h1.mul(0.35)))).toVar();
        const ttlA = select(isF2, float(2.2).add(h5.mul(0.8)),
          select(isF1, float(1.7).add(h5.mul(0.7)),
            float(1.0).add(h5.mul(0.5)))).toVar();
        const fling = select(isF2, float(0.85).add(h8.mul(0.45)),
          select(isF1, float(0.50).add(h8.mul(0.40)),
            float(0.20).add(h8.mul(0.18))))
          .mul(float(0.35).add(uLevel.mul(0.65))).toVar();   // 出生时刻包络烘进外甩——
        // 峰值期生的粒子保持狂野（包络回落时已甩出的粒子不会被吸回来）
        const wasAlive = A.w.greaterThanEqual(0.0).and(A.w.lessThan(1.0));
        ctx.aliveAdd(wasAlive);
        const r = uR.mul(r0);
        A.assign(vec4(
          uAX.add(cos(th).mul(r)),
          uAY.add(uH.mul(h0)),
          uAZ.add(sin(th).mul(r).mul(0.75)),
          0.001));
        // B = (θ, ω, h0 分数, r0 分数)；P0 = (hEnd 分数, 外甩系数)；P1 = (progress, 族, ttl, 亮暗抖动)
        B.assign(vec4(th, om, h0, r0));
        P0.assign(vec4(hEnd, fling, 0.0, 0.0));
        P1.assign(vec4(0.0, fam, ttlA, float(0.55).add(h1.mul(0.45))));
      });
    }).Else(() => {
      // —— 积分：极坐标 + 涡剪 + 漏斗 + 生命期拔升 ——
      const age = A.w;
      If(age.greaterThanEqual(0.0).and(age.lessThan(1.0)), () => {
        const fam = P1.y;
        const isF1 = fam.greaterThanEqual(0.5).and(fam.lessThan(1.5));
        const isF2 = fam.greaterThanEqual(1.5);
        const brightFam = select(isF2, float(0.55), select(isF1, float(0.85), float(1.15)));
        const ttlA = P1.z;
        const ageN = age.add(ctx.uDt.div(ttlA)).toVar();
        const life = clamp(ageN, 0.0, 1.0).toVar();
        // 高度先行（剪与漏斗都随高度取）：生命期线性 h0→hEnd + 微浮
        const hp = mix(B.z, P0.x, life)
          .add(float(0.012).mul(sin(ctx.uTime.mul(1.3).add(hs.mul(6.28))))).toVar();
        // 涡剪：角速度随高度衰减（底 1.0 → 顶 0.55）；包络越高整体旋越快
        const shear = float(1.0).sub(hp.mul(0.45));
        const spin = float(0.60).add(uLevel.mul(0.55));
        const th = B.x.add(B.y.mul(shear).mul(spin).mul(ctx.uDt)).toVar();
        // 漏斗 × 生命期外甩 × 槽位呼吸：life² 让外抛集中在后半程（根稳梢散），
        // 外甩强度出生时已烘进 P0.y（不随包络回落回缩）
        const r = uR.mul(B.w).mul(float(1.0).add(hp.mul(0.65)))
          .mul(float(1.0).add(life.mul(life).mul(P0.y)))
          .mul(float(1.0).add(float(0.08).mul(sin(ctx.uTime.mul(1.6).add(hs.mul(6.28))))));
        const pos = vec3(
          uAX.add(cos(th).mul(r)),
          uAY.add(uH.mul(hp)),
          uAZ.add(sin(th).mul(r).mul(0.75)));
        If(ageN.greaterThanEqual(1.0), () => {
          A.assign(vec4(pos, 1.5));
          ctx.aliveSub();
        }).Else(() => {
          A.assign(vec4(pos, ageN));
          B.assign(vec4(th, B.y, B.z, B.w));
          // 亮暗包络：生命期正弦 × 族亮 × 逐粒抖动 × 火闪（双频）× 包络
          const env = sin(life.mul(3.14159265));
          const tw = float(0.72).add(float(0.28).mul(
            sin(ctx.uTime.mul(float(6.1).add(hs.mul(4.2))).add(hs.mul(6.28)))
              .mul(sin(ctx.uTime.mul(2.3).add(hs.mul(3.7))))));
          const prog = clamp(env.mul(P1.w).mul(brightFam).mul(tw)
            .mul(float(0.25).add(uLevel.mul(0.75))), 0.0, 1.0);
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
};

function defineFireWhirlType(name, cap, rate) {
  return defineParticleType({
    name, space: 'world', cap, kind: 'custom',
    // rate 是「spawn 尝试」口径：角向浓淡 rejection 平均放行 ~0.6
    spawn: { rate, ttl: 1.9, ttlJit: 0.4, vel: [0, 0, 0], velJit: 0, spread: 0, gravity: 0, drag: 0, windK: 0 },
    // 生命期色温：热根白黄 → 梢头暗红（单调上升 ⇒ 年龄 ≈ 高度）。
    // sizeMode 'age'：尺寸斜坡按年龄（progress 是亮度包络——族亮/火闪/level 不得
    // 泄漏进尺寸；火舌的「大软点」靠温和的 sizeEndK 年龄斜坡表达）
    render: { size: 0.46, sizeEndK: 1.5, sizeMode: 'age', color: [1.15, 0.72, 0.28], colorEnd: [0.72, 0.16, 0.04], alpha: 0.55, heat: 1.0, softness: 2.2 },
    custom: { build: buildWhirl },
  });
}

// 施术爆发段（密）/ 咏唱常驻段（疏）
export const FIRE_WHIRL_ORBIT = defineFireWhirlType('fireWhirlOrbit', 640, 280);
export const FIRE_WHIRL_ORBIT_CHANT = defineFireWhirlType('fireWhirlOrbitChant', 288, 150);

/**
 * 火旋风门面（fireWhirlCast 爆发 / chantSceneFx 常驻共用）：start/stop 控发射，
 * setLevel 推包络（密度走 rateScale、旋速/亮暗走 uLevel），setAnchor 每帧跟人。
 * 池缺位返回 null（与 qiOrbit 同口径——模板按 null 退化为只有地环/柱/火星）。
 * @param {object|null} pool 世界 GPU 池
 * @param {{ radiusK?: number, type?: object }} cfg radiusK = 旋涡半径占立牌高的比例；
 *   type = 池类型段（缺省爆发段；常驻件必须传 CHANT 段——两实例不抢 uniform）
 */
export function createFireWhirlLink(pool, { radiusK = 0.34, type = FIRE_WHIRL_ORBIT } = {}) {
  if (!pool) return null;
  return {
    start() { pool.setTypeActive(type, 1); },
    stop() { pool.setTypeActive(type, 0); },
    setLevel(k) {
      pool.typeApi(type)?.setLevel(k);
      pool.setTypeRateScale(type, 0.10 + 0.90 * k);
    },
    setAnchor(a) {
      if (!a) return;
      pool.typeApi(type)?.setAnchor(a.x, a.y, a.z, a.H, a.H * radiusK);
    },
    dispose() { this.stop(); },
  };
}
