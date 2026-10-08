// PCG 道具燃烧（2026-10-06 场景交互大活·燃烧侧）：部件级状态机 + 材质接线。
// 世界实例挂 scene.userData.combust（composeRoom 创建、update 驱动 step、BattleStage
// 装配后 bindPool 接世界粒子池）。B.combustible 的 heat 事件把外温打进部件热量，
// 点燃/火势/燃尽全部在 step 演化；火焰粒子走 fireProposals 的 GPU 提交通路
// （材质 fragment 抢槽写位置——本文件只推 uniform，零 CPU 读回）。
//
// 部件状态：heat（热量，事件注入 + 邻近辐射累积、随时间冷却）→ tier 0..3
// （未燃/阴燃/明火/烈焰）。tier≥1 材质着火（uFire 火光 + 提案写端）+ uChar/uBurn
// 缓慢碳化侵蚀；heat 破 burnoutAt → uGone 快速灰飞 + mesh.visible=false。
// 点燃/烈焰/燃尽阈值 = 族系数 × 部件耐火随机（physProfile.flameResist）——
// 「本不可燃物品在持续高热下也开始燃烧」：metal/stone 的 igniteAt 是 wood 的 ~3.5 倍。
import * as THREE from 'three';
import {
  Fn, If, Discard, uniform, positionLocal, positionWorld, materialColor,
  vec2, vec3, vec4, mix, sin, dot, floor, fract, smoothstep,
} from 'three/tsl';
import { M } from '../../scenes/kit/materials.js';
import { createFireProposer, fireProposalClearNode, SCENE_FIRE, SCENE_EMBER } from '../gpu/fireProposals.js';

// 族燃烧系数：ignite 点燃 / blaze 明火 / inferno 烈焰 / burnout 燃尽（热量单位）
//（不可燃族门槛整体抬高 3.5 倍——持续高热仍可点燃，观感即「烧红了的铁」）
const FAM = {
  wood:  { ignite: 26, blaze: 58, inferno: 120, burnout: 210, charMs: 3200 },
  cloth: { ignite: 16, blaze: 40, inferno: 90,  burnout: 160, charMs: 2200 },
  _hard: { ignite: 91, blaze: 150, inferno: 260, burnout: 420, charMs: 5200 },
};
export function famCoeff(family) {
  return FAM[family] ?? FAM._hard;
}

/** 材质 → kit 族名（familyMaterial 的 kitFamily 标记 → 族单例反查，双路径） */
export function familyOf(material) {
  if (!material) return null;
  if (material.userData?.kitFamily) return material.userData.kitFamily;
  for (const [fam, m] of Object.entries(M)) {
    if (m === material) return fam;
  }
  return null;
}

// 碳化格块 hash（charBurn 同款口径：0.63u 格 + 细频第二层）
const cbHash = Fn(([pos]) => {
  const cell = floor(pos.mul(1.6));
  return fract(sin(dot(cell.xy.add(cell.z.mul(7.13)), vec2(12.9898, 78.233))).mul(43758.5453));
});
const cbHash2 = Fn(([pos]) => {
  const cell = floor(pos.mul(5.7).add(13.7));
  return fract(sin(dot(cell.xy.add(cell.z.mul(3.71)), vec2(39.721, 91.177))).mul(24634.6345));
});

const COMBUST_KEY = '_sceneCombust';

/**
 * 着火时挂部件材质（材质已 clone——只有真烧起来的部件付独立材质的代价）。
 * 返回 per-part uniforms { uFire, uChar, uBurn, uGone, uTime }。
 * colorNode 语义与族单例 charBurn 同口径（碳化 mix + 格块侵蚀 discard + 余烬），
 * 增补：uFire 火光脉动 + 燃尽 uGone 灰飞。火焰粒子发射在 compute proposer
 * （fireProposals.createFireProposer——材质 fragment 写 storage 被 Three 降
 * read-only，位置计算改由几何表面采样 compute 承担，零 CPU 语义不变）。
 */
function attachCombust(material) {
  if (material.userData[COMBUST_KEY]) return material.userData[COMBUST_KEY];
  const rec = {
    uFire: uniform(0), uChar: uniform(0), uBurn: uniform(0),
    uGone: uniform(0), uTime: uniform(0),
  };
  material.userData[COMBUST_KEY] = rec;
  material.colorNode = Fn(() => {
    const pos = positionLocal;
    const h = cbHash(pos);
    const h2 = cbHash2(pos);
    // 侵蚀（uBurn）：格块逐格 discard，前沿犬牙交错；燃尽（uGone）：细频格灰飞
    const frontier = rec.uBurn.mul(1.35).sub(h2.mul(0.35));
    If(h.lessThan(frontier), () => { Discard(); });
    If(h2.lessThan(rec.uGone), () => { Discard(); });
    // 碳化（uChar）：albedo 混向炭黑（细频斑驳）
    const charCol = vec3(0.045, 0.028, 0.02).add(h2.sub(0.5).mul(0.035));
    const col = mix(materialColor.rgb, charCol, rec.uChar.mul(h2.mul(0.25).add(0.75)));
    // 火苗簇（大格低频场圈「烧到哪一块」）：火势越低簇越稀——阴燃 = 零星几处
    // 暗红火点，明火起连片，烈焰全覆盖（防「整件物体发光」读感）
    const cellH = cbHash(pos.mul(0.25).add(7.7));
    const cluster = smoothstep(
      float(1.0).sub(rec.uFire.mul(0.85)),
      float(1.06).sub(rec.uFire.mul(0.85)), cellH);
    // 火光：双 sin flicker 脉动 × 簇掩码；火色分档（阴燃暗红 → 明火橙 → 烈焰橙白）
    const flick = sin(rec.uTime.mul(9.3).add(h.mul(47.0))).mul(sin(rec.uTime.mul(3.1).add(h.mul(11.0)))).mul(0.28).add(0.72);
    const fireCol = mix(vec3(0.55, 0.10, 0.02), vec3(1.15, 0.45, 0.12), smoothstep(0.3, 0.75, rec.uFire))
      .add(vec3(0.6, 0.5, 0.35).mul(smoothstep(0.8, 1.05, rec.uFire)));
    const glow = smoothstep(0.25, 0.95, rec.uFire.mul(flick).mul(h2.mul(0.6).add(0.4))).mul(cluster);
    const fired = mix(col, fireCol, glow.mul(0.6));
    return vec4(fired, materialColor.a);
  })();
  return rec;
}

const _wp = new THREE.Vector3();
const _burningPos = [];

/**
 * 场景燃烧世界（composeRoom 创建挂 userData.combust；step 由场景 update 驱动）。
 */
export function createCombustion() {
  const parts = [];   // { mesh, uni|null, prof, fam, igniteAt…, heat, tier, burnT, gone, dead }
  let pool = null;
  const world = {
    bindPool(p) {
      pool = p;
      // 提案清零尾钩子（池 update 序列尾：spawn 读 → 清 → 渲染期物体写）
      if (p?.registerTail) p.registerTail(fireProposalClearNode);
      return world;
    },
    /** B.combustible 注册：traverse prop 收集 mesh 部件（耐火随机档案惰性建） */
    collect(propObj, rng = Math.random) {
      propObj.traverse(o => {
        if (!o.isMesh || !o.material || o.userData._combPart) return;
        const fam = familyOf(o.material);
        if (!fam) return;
        const coeff = famCoeff(fam);
        if (!o.userData._physPart) {
          o.userData._physPart = {
            integrity: 0.7 + rng() * 0.6,
            flameResist: 0.7 + rng() * 0.6,
            broken: false,
          };
        }
        const prof = o.userData._physPart;
        o.userData._combPart = true;
        parts.push({
          mesh: o, uni: null, prof, fam,
          igniteAt: coeff.ignite * prof.flameResist,
          blazeAt: coeff.blaze * prof.flameResist,
          infernoAt: coeff.inferno * prof.flameResist,
          burnoutAt: coeff.burnout * prof.flameResist,
          charMs: coeff.charMs,
          heat: 0, tier: 0, burnT: 0, gone: -1, dead: false,
        });
      });
    },
    /** heat 事件注入（B.combustible 的 respond 委托）：温度 × 距离衰减打进部件热量。
     * ×34 / 远膝 62 校准（敌站位到墙边道具典型 20–35u）：temp 1.0 贴脸 +34（一发点着
     * wood，阈 26×随机 0.7–1.3）；d=20 +25.5（一发着大半 wood）；d=35 +21.7（低耐
     * 一发、高耐两发）；metal 阈 64–118 → 战线距离需持续高热三四发起。 */
    absorb(at, temp) {
      for (const p of parts) {
        if (p.dead || !p.mesh.parent) continue;
        p.mesh.getWorldPosition(_wp);
        const d = Math.hypot(_wp.x - at.x, _wp.z - at.z);
        p.heat += temp * 34 * 62 / (62 + d);
      }
    },
    step(dt, t) {
      // 火蔓延：先缓存燃烧部件世界位，再对全体辐射（tier 越高烤得越广）
      _burningPos.length = 0;
      let fireSum = 0;
      for (const p of parts) {
        if (p.dead || p.tier <= 0) continue;
        p.mesh.getWorldPosition(_wp);
        _burningPos.push({ x: _wp.x, y: _wp.y, z: _wp.z, tier: p.tier });
        fireSum += p.tier;
      }
      for (const q of parts) {
        if (q.dead) continue;
        q.mesh.getWorldPosition(_wp);
        for (const b of _burningPos) {
          const d = Math.hypot(_wp.x - b.x, _wp.z - b.z);
          if (d < 14) q.heat += b.tier * 4 * dt * 14 / (14 + d * 1.2);
        }
        // 冷却（0.72/s——0.55 时两回合间余温归零，战线距离的单发热量永远蓄不到
        // 点燃阈；放慢后跨回合蓄热成立，没人持续加热仍自然衰减）
        q.heat *= Math.pow(0.72, dt);
        // tier 演进（单调升：着了就不灭，火势只进不退——观感优先）
        if (q.tier === 0 && q.heat > q.igniteAt) {
          q.tier = 1;
          ignitePart(q);
        }
        if (q.tier === 1 && q.heat > q.blazeAt) q.tier = 2;
        if (q.tier === 2 && q.heat > q.infernoAt) q.tier = 3;
        if (q.tier > 0 && q.gone < 0 && q.heat > q.burnoutAt) q.gone = 0;
        if (q.tier > 0) {
          q.burnT += dt;
          const u = q.uni;
          if (u) {
            u.uTime.value = t;
            // 火势目标（tier 1/2/3 → 0.26/0.58/0.95：阴燃暗红零星、烈焰橙白连片）
            // 平滑逼近；燃尽段拉满（爆燃读感）
            const target = q.gone >= 0 ? 1.3 : [0, 0.26, 0.58, 0.95][q.tier];
            u.uFire.value += (target - u.uFire.value) * Math.min(1, dt * 2.4);
            u.uChar.value = Math.min(1, q.burnT * 1000 / q.charMs);
            u.uBurn.value = Math.min(0.6, q.burnT * 1000 / (q.charMs * 3.4));
            if (q.gone >= 0) {
              q.gone += dt * 1.7;
              u.uGone.value = Math.min(1, q.gone);
              if (q.gone >= 1.05) { q.mesh.visible = false; q.dead = true; q.proposer?.dispose?.(); }
            }
          }
        }
      }
      // 粒子窗口随火势（场景有火才 spawn；无火零窗口）——火舌主体 + 飘散火星
      if (pool?.setTypeActive) {
        if (fireSum > 0) {
          pool.setTypeActive(SCENE_FIRE, 1);
          pool.setTypeRateScale(SCENE_FIRE, Math.min(6, fireSum));
          pool.setTypeActive(SCENE_EMBER, 1);
          pool.setTypeRateScale(SCENE_EMBER, Math.min(4, fireSum * 0.6));
        } else {
          pool.setTypeActive(SCENE_FIRE, 0);
          pool.setTypeActive(SCENE_EMBER, 0);
        }
      }
    },
    dispose() {
      for (const p of parts) p.proposer?.dispose?.();
      parts.length = 0;
    },
    debug() {
      return parts.map(p => ({
        fam: p.fam, heat: +p.heat.toFixed(0), tier: p.tier,
        igniteAt: +p.igniteAt.toFixed(0), gone: +p.gone.toFixed(2),
        fire: p.uni ? +p.uni.uFire.value.toFixed(2) : null,
        proposer: !!p.proposer,
      })).slice(0, 12);
    },
  };
  return world;
}

function ignitePart(p) {
  // 材质 lazy clone：真烧起来的部件才脱离族单例（独立 uniforms；未烧部件零开销）
  const cloned = p.mesh.material.clone();
  cloned.userData = { ...p.mesh.material.userData };
  delete cloned.userData[COMBUST_KEY];
  p.mesh.material = cloned;
  p.uni = attachCombust(cloned);
  // 发射采样器（compute：几何表面采样 → 粒子提案）
  p.proposer = createFireProposer(p.mesh, p.uni.uFire);
}

// ---- B.combustible 的 respond 委托（behaviors.js 调） ----

export function combustibleRespond(handle, payload) {
  // 逐层上溯找挂燃烧世界的场景层（composeRoom 的 group——prop 在 liveRoot 下，
  // 盲上溯到舞台根会错过中间层）
  let scene = handle.object;
  while (scene && !scene.userData?.combust && scene.parent) scene = scene.parent;
  const combust = scene?.userData?.combust;
  if (!combust) return;
  if (!handle.object.userData._combCollected) {
    combust.collect(handle.object);
    handle.object.userData._combCollected = true;
  }
  if (payload?.at) combust.absorb(payload.at, payload.temp ?? 1);
}
