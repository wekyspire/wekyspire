// 燃烧火星（粒子池 v2 的首个 custom 类型实例，2026-09-28 自 gpuParticles.js 旧池迁入）——
// spawn 逻辑超 uber 参数化包络（燃烧条目表 rejection 采样），所以走 custom 通道：
// 独立编译 dispatch 只管自己的段；积分/寿命用与 uber 同式的参数（读类型行，调参仍在
// desc）；渲染外观走统一 present（ageHeat 复现旧「新鲜火星更亮」）。
// 链路：aura recipes（gpuEmit:'burn'）→ createBurnLink(pool).burnAddUnit(unit)
//   → emission 逐帧压缩火缘热纹素条目 → 本类型 spawn 随机取条目 + 强度门控。
import {
  Fn, If, Loop, Break, storage,
  uint, int, float, vec3, vec4,
  fract, sin, clamp, exp, max, instanceIndex,
} from 'three/tsl';
import { windField } from './wind.js';
import { createBurnEmission, MAX_BURN_ENTRIES, EMISSION_GATE } from './burnEmission.js';
import { defineParticleType } from './particleTypes.js';

const hash1 = Fn(([n]) => fract(sin(n).mul(43758.5453123)));

export const BURN_SPARKS = defineParticleType({
  name: 'burnSparks', space: 'world', cap: 2048, kind: 'custom',
  // rate 口径 = 每单位每秒 spawn 尝试次数（rateScale = 活跃燃烧单位数，CPU 侧乘）；
  // 数值与旧池内建燃烧发射器逐字段对齐
  spawn: { rate: 110, ttl: 1.4, ttlJit: 0.3, vel: [0, 5.2, 0], velJit: 1.8, spread: 0, gravity: 1.2, drag: 0.55, windK: 1.0 },
  render: { size: 0.9, sizeEndK: 0.5, color: [2.2, 0.85, 0.18], alpha: 1, heat: 0.6, ageHeat: 2.5 },
  custom: {
    build(ctx) {
      const emission = createBurnEmission();
      const burnUnits = []; // [{ unit }]
      const entriesS = storage(emission.entriesAttr, 'vec4', MAX_BURN_ENTRIES);
      const countS = storage(emission.countAttr, 'uint', 1); // 非 atomic 视图（只读计数）

      const fn = Fn(() => {
        const li = int(instanceIndex);
        const idx = ctx.globalIdx(li);
        const A = ctx.stateS.element(idx.mul(int(2)));
        const B = ctx.stateS.element(idx.mul(int(2)).add(int(1)));
        const P1 = ctx.payloadS.element(idx.mul(int(2)).add(int(1)));

        If(ctx.spawnWindow(li), () => {
          // —— spawn：随机条目 + 强度门控 rejection（8 次尝试；落空 = 本帧少发，
          //    槽位原粒子继续存活，alive 账目不动——只有真出生才记账）——
          const h1 = hash1(float(idx).mul(0.719).add(ctx.uFrame.mul(0.613))).toVar();
          const h2 = hash1(h1.mul(91.7).add(0.13));
          const h3 = hash1(h1.mul(47.3).add(0.37));
          const h4 = hash1(h1.mul(71.9).add(0.61));
          const h5 = hash1(h1.mul(33.1).add(0.83));
          const h6 = hash1(h1.mul(17.7).add(0.49));
          const live = float(countS.element(uint(0))).min(float(MAX_BURN_ENTRIES)).toVar();
          const wp = vec3(0.0).toVar();
          const found = uint(0).toVar();
          If(live.greaterThan(0.5), () => {
            Loop(8, ({ i: k }) => {
              If(found.equal(uint(0)), () => {
                const hk = hash1(h1.mul(57.1).add(float(k).mul(19.77)).add(ctx.uFrame.mul(0.377))).toVar();
                const em = entriesS.element(uint(hash1(hk.mul(13.1)).mul(live))).toVar();
                If(em.w.greaterThan(EMISSION_GATE)
                  .and(hash1(hk.mul(7.7).add(ctx.uFrame)).lessThan(em.w)), () => {
                  wp.assign(em.xyz);
                  found.assign(uint(1));
                  Break();
                });
              });
            });
          });
          If(found.greaterThan(uint(0)), () => {
            const wasAlive = A.w.greaterThanEqual(0.0).and(A.w.lessThan(1.0));
            ctx.aliveAdd(wasAlive);
            const r1 = ctx.row(1); // ttl 在 w
            const r3 = ctx.row(3); // vel.xyz + velJit
            const r7 = ctx.row(7); // ttlJit 在 y
            const v0 = r3.xyz.add(vec3(h3, h4, h5).sub(0.5).mul(2.0).mul(r3.w))
              .mul(float(0.7).add(h2.mul(0.6)));
            const ttlA = max(r1.w.mul(
              float(1.0).add(h6.sub(0.5).mul(2.0).mul(r7.y))), 0.05);
            A.assign(vec4(wp.add(vec3(h2, h3, h4).sub(0.5).mul(0.9)), 0.001));
            B.assign(vec4(v0, h1));
            P1.assign(vec4(0.0, 0.0, ttlA, 0.0));
          });
        }).Else(() => {
          // —— 积分（风/浮力/阻尼/寿命；与 uber 同式，参数读类型行）——
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
              A.assign(vec4(posNew, 1.5)); // ttl 终结 → 死区 + 计数减
              ctx.aliveSub();
            }).Else(() => {
              A.assign(vec4(posNew, ageNew));
              B.assign(vec4(vel, B.w));
              // present 的 progress 口径：ageProgress（distanceProgress 与本类型无关）
              P1.assign(vec4(clamp(ageNew, 0.0, 1.0), 0.0, ttlA, 0.0));
            });
          });
        });
      });

      return {
        update: fn().compute(ctx.segCap, [64]),
        // 前置节点：本帧燃烧条目压缩（reset → 逐活跃单位压缩；须排在 spawn 之前，
        // 同一 renderer.compute 提交内保序）
        tick: () => (burnUnits.length ? emission.update(burnUnits) : []),
        api: {
          addUnit(unit) {
            if (!unit || burnUnits.some(s => s.unit === unit)) return;
            if (burnUnits.length >= emission.maxUnits) return; // 槽满静默跳过（aura 本体不受影响）
            burnUnits.push({ unit });
          },
          removeUnit(unit) {
            const i = burnUnits.findIndex(s => s.unit === unit);
            if (i >= 0) burnUnits.splice(i, 1);
          },
          get count() { return burnUnits.length; },
          dispose: () => emission.dispose(),
        },
      };
    },
  },
});

/**
 * 燃烧联动门面（recipes.js 的 gpu 入参）：addUnit/removeUnit + 发射开关/速率倍率
 * （× 活跃单位数，与旧池口径一致）。类型首次 addUnit 时懒分配段。
 */
export function createBurnLink(pool) {
  if (!pool) return null;
  return {
    burnAddUnit(unit) {
      const api = pool.typeApi(BURN_SPARKS);
      if (!api) return;
      const before = api.count;
      api.addUnit(unit);
      if (api.count > 0) {
        pool.setTypeActive(BURN_SPARKS, 1);
        pool.setTypeRateScale(BURN_SPARKS, api.count);
      }
    },
    burnRemoveUnit(unit) {
      const api = pool.typeApi(BURN_SPARKS);
      if (!api) return;
      api.removeUnit(unit);
      if (api.count === 0) pool.setTypeActive(BURN_SPARKS, 0);
      else pool.setTypeRateScale(BURN_SPARKS, api.count);
    },
    get burnUnitCount() { return pool.typeApi(BURN_SPARKS)?.count ?? 0; },
  };
}
