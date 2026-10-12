// 楼层通过灰烬（「楼层通过」演出的粒子半边）：刚清掉的楼层敌人残影崩解时，
// 灰从**正在碎裂的位置**剥落——发射面 = 立绘纹理剪影 × 侵蚀前锋带（ashErodeField
// 与消散面片 shader 同一份场函数，粒子出生点必然贴着面片上的缺口前沿）。
// 单源槽纪律：驱动侧保证同一时刻至多一只敌在侵蚀段（逐个崩解的 stagger ≥ 侵蚀窗），
// 于是逐帧换挂一套 uniform（纹理/模型阵/进度）即可，不开槽位表。
// 发射闸 = rateScale（0 冻结 spawn 游标，恢复不补发）——池行 active 只做段分配。
import * as THREE from 'three';
import {
  Fn, If, Loop, Break, uniform, texture,
  uint, int, float, vec2, vec3, vec4, ivec2,
  fract, sin, clamp, exp, max, instanceIndex,
} from 'three/tsl';
import { windField } from './wind.js';
import { defineParticleType } from './particleTypes.js';
import { ubfFbm } from '../unitBodyFx.js';

const hash1 = Fn(([n]) => fract(sin(n).mul(43758.5453123)));

/** 侵蚀场（面片 shader 与粒子 spawn 共用的单一事实源）：uv + 逐敌种子 → 0..1 碎裂值。 */
export const ashErodeField = Fn(([vUv, uSeed]) =>
  ubfFbm(vUv.mul(7.0).add(uSeed.mul(13.7))));

// 1×1 白占位：未挂立绘时保证纹理绑定合法（发射闸 0 时不会真采样）
const FALLBACK_TEX = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
FALLBACK_TEX.needsUpdate = true;

export const FLOOR_ASH = defineParticleType({
  name: 'floorAsh', space: 'world', cap: 640, kind: 'custom',
  // 灰：微浮力上飘 + 强风响应（随风消散是语义主体）；rate 见 spawnWindow 游标口径
  spawn: { rate: 380, ttl: 1.7, ttlJit: 0.5, vel: [0, 0.9, 0], velJit: 0.7, spread: 0, gravity: 0.35, drag: 0.8, windK: 1.6 },
  // 生时灰白（碎裂闪）→ 死前暗灰；淡入 20% 防满尺寸弹入
  render: { size: 0.15, sizeEndK: 0.55, color: [0.82, 0.84, 0.90], colorEnd: [0.36, 0.36, 0.40], alpha: 0.9, heat: 1.0, softness: 1.6, alphaMode: 'in' },
  custom: {
    build(ctx) {
      const uTex = texture(FALLBACK_TEX);          // TextureNode：驱动侧逐帧 .value 换挂
      const uModel = uniform(new THREE.Matrix4()); // 残影立牌 matrixWorld（含 billboard）
      const uQuad = uniform(new THREE.Vector2(1, 1)); // 立牌几何（宽, 高，本地单位）
      const uFront = uniform(0);                   // 侵蚀前沿（ashErodeField 阈值口径）
      const uSeed = uniform(0);

      const fn = Fn(() => {
        const li = int(instanceIndex);
        const idx = ctx.globalIdx(li);
        const A = ctx.stateS.element(idx.mul(int(2)));
        const B = ctx.stateS.element(idx.mul(int(2)).add(int(1)));
        const P1 = ctx.payloadS.element(idx.mul(int(2)).add(int(1)));

        If(ctx.spawnWindow(li), () => {
          // —— spawn：剪影 × 前锋带 rejection 采样（8 次尝试；落空 = 本帧少发）——
          const h1 = hash1(float(idx).mul(0.719).add(ctx.uFrame.mul(0.613))).toVar();
          const h2 = hash1(h1.mul(91.7).add(0.13));
          const h3 = hash1(h1.mul(47.3).add(0.37));
          const h4 = hash1(h1.mul(71.9).add(0.61));
          const h5 = hash1(h1.mul(33.1).add(0.83));
          const h6 = hash1(h1.mul(17.7).add(0.49));
          const wp = vec3(0.0).toVar();
          const found = uint(0).toVar();
          Loop(8, ({ i: k }) => {
            If(found.equal(uint(0)), () => {
              const hk = hash1(h1.mul(57.1).add(float(k).mul(19.77)).add(ctx.uFrame.mul(0.377))).toVar();
              const su = hash1(hk.mul(13.1));
              const sv = hash1(hk.mul(29.7).add(0.41));
              const uvP = vec2(su, sv);
              const texel = ivec2(clamp(uvP, 0.0, 0.9999).mul(vec2(uTex.size())));
              const alpha = uTex.load(texel).a; // compute 内只能 textureLoad（铁律）
              const n = ashErodeField(uvP, uSeed);
              // 前锋带：刚碎（n≈front）与将碎（n 略大于 front）的窄带内才剥落
              If(alpha.greaterThan(0.45)
                .and(n.lessThan(uFront.add(0.02)))
                .and(n.greaterThan(uFront.sub(0.22))), () => {
                const local = vec3(
                  uvP.x.sub(0.5).mul(uQuad.x),
                  uvP.y.sub(0.5).mul(uQuad.y),
                  float(0.0));
                wp.assign(uModel.mul(vec4(local, 1.0)).xyz);
                found.assign(uint(1));
                Break();
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
            A.assign(vec4(wp.add(vec3(h2, h3, h4).sub(0.5).mul(0.06)), 0.001));
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
              P1.assign(vec4(clamp(ageNew, 0.0, 1.0), 0.0, ttlA, 0.0));
            });
          });
        });
      });

      return {
        update: fn().compute(ctx.segCap, [64]),
        api: {
          /** 逐帧驱动唯一发射源（残影立牌）。tex 为 null 等价关闸。 */
          drive({ tex = null, model = null, quadW = 1, quadH = 1, front = 0, seed = 0 } = {}) {
            if (tex) uTex.value = tex;
            if (model) uModel.value.copy(model);
            uQuad.value.set(quadW, quadH);
            uFront.value = front;
            uSeed.value = seed;
          },
        },
      };
    },
  },
});
