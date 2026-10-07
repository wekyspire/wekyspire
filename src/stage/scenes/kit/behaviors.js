// propKit 交互行为模板目录（WORKFLOW §5）——flutterOnImpact（fx Phase 4）+
// physBody / combustible（2026-10-06 场景交互：冲击波物理与燃烧）。
// 契约：行为模板返回 { interactions: { <event>: { radius?, respond(handle, payload) } } }；
// 资产侧 behaviors 字段只允许实例化模板（逻辑在 kit，参数在道具），composeRoom 把带
// behaviors 的道具排除出静态合批、登记进 notifiables；舞台经 cast（prop: 前缀）+
// fx/notify.js 单向分发。respond 一律 fire-and-forget（自己起补间/物理），不进节拍。
// 规划余量：B.idleSway / B.lightExtinguish / B.torchFlicker。
import gsap from 'gsap';
import * as THREE from 'three';
import { impactAt, physProfile, shatter } from '../../fx/phys/propPhysics.js';
import { combustibleRespond } from '../../fx/phys/combustion.js';

// 受击震颤：notify('impact') 落在半径内 → 道具原地衰减摆动（绕底 z 微倾，sin 衰减包络）。
// 连续命中掐断上一段重起（震颤是状态不是队列）；基准姿态在首次命中时快照。
// 幅度按距离衰减（房间尺度下 radius 只是粗门——真衰减在这里：近处猛晃、远处涟漪）。
export function flutterOnImpact({ radius = 95, tilt = 0.05, durationMs = 450, swings = 3 } = {}) {
  return {
    interactions: {
      impact: {
        radius,
        respond(handle, payload) {
          const obj = handle.object;
          if (!obj) return;
          // 距离衰减：k ∈ [0.2, 1]，贴脸全幅、半径边缘留一丝涟漪
          let k = 1;
          if (payload?.at && obj.position) {
            const d = Math.hypot(obj.position.x - payload.at.x, obj.position.z - payload.at.z);
            k = Math.max(0.2, 1 - d / radius);
          }
          if (obj.userData._baseRz === undefined) obj.userData._baseRz = obj.rotation.z;
          try { obj.userData._flutterTween?.kill?.(); } catch (_) {}
          const proxy = { t: 0 };
          const amp = tilt * k;
          obj.userData._flutterTween = gsap.to(proxy, {
            t: 1, duration: durationMs / 1000, ease: 'none',
            onUpdate: () => {
              obj.rotation.z = obj.userData._baseRz
                + amp * Math.sin(proxy.t * Math.PI * 2 * swings) * (1 - proxy.t);
            },
            onComplete: () => {
              obj.rotation.z = obj.userData._baseRz;
              obj.userData._flutterTween = null;
            },
          });
        },
        // 舞台销毁收尾（hub.dispose 逐件回调）：杀在途震颤 + 回基准姿态，
        // 不留活补间写死对象
        dispose(handle) {
          const obj = handle?.object;
          if (!obj) return;
          try { obj.userData._flutterTween?.kill?.(); } catch (_) {}
          obj.userData._flutterTween = null;
          if (obj.userData._baseRz !== undefined) obj.rotation.z = obj.userData._baseRz;
        },
      },
    },
  };
}

// 冲击波物理体（2026-10-06 场景交互）：impact 三级响应——
//   s < integrity×0.42        震颤（委托 flutter 同款摆动，幅度按 s）
//   s < integrity             位移（整体入物理世界滑动/翻倒，撞地撞墙后停在新位置）
//   s ≥ integrity             散架 L1（子部件各自飞）；s ≥ integrity×2.3 追加 L2
//                             （拆出的部件内图元 mesh 再散——桶板与铁箍分家）
// 冲击强度 s = power × 距离衰减（propPhysics.impactAt）；integrity 随机浮动
// （physProfile）保证同款道具每次炸开的样子都不一样。
export function physBody({ radius = 95, integrity = 22 } = {}) {
  const flutter = flutterOnImpact({ radius });
  return {
    interactions: {
      impact: {
        radius,
        respond(handle, payload) {
          const obj = handle.object;
          if (!obj) return;
          // 逐层上溯找挂物理世界的场景层（composeRoom 的 group；prop 在 liveRoot 下）
          let scene = obj;
          while (scene && !scene.userData?.propPhys && scene.parent) scene = scene.parent;
          const world = scene?.userData?.propPhys;
          const s = impactAt(payload, obj.position);
          if (s <= 0 || !world) {
            flutter.interactions.impact.respond(handle, payload);
            return;
          }
          const prof = physProfile(obj, Math.random, { integrity });
          if (s < prof.integrity * 0.42) {
            flutter.interactions.impact.respond(handle, payload);
            return;
          }
          // 冲击方向：爆心 → 道具（xz 单位向量）
          const at = payload?.at;
          let dx = 0, dz = 0;
          if (at) {
            dx = obj.position.x - at.x;
            dz = obj.position.z - at.z;
            const d = Math.hypot(dx, dz) || 1;
            dx /= d; dz /= d;
          }
          const dir = at ? { x: dx, z: dz } : null;
          if (s < prof.integrity) {
            // 位移：滑动 + 微翻（不散架——被推着走）
            const k = s / prof.integrity;
            world.fling(obj, _vel.set(
              dx * 14 * k, Math.min(9 * k, 7), dz * 14 * k,
            ), _ang.set((Math.random() - 0.5) * 2.4, (Math.random() - 0.5) * 2.4, (Math.random() - 0.5) * 2.4));
            return;
          }
          // 散架 L1；强冲击追加 L2（拆出的部件按各自强度再散成图元）
          const parts = shatter(obj, s, dir, world, Math.random);
          if (s >= prof.integrity * 2.3) {
            for (const p of parts) {
              const pp = physProfile(p, Math.random, { integrity: integrity * 0.62 });
              if (s >= pp.integrity * 1.15) shatter(p, s, dir, world, Math.random);
            }
          }
          // 散出部件已脱离 prop 子树——同场景若可燃，部件的燃烧登记就地转移
          //（combust.collect 有 _combPart 去重，prop 尚未收集过也无害）
          const combust = scene?.userData?.combust;
          if (combust) for (const p of parts) combust.collect(p);
        },
        dispose(handle) { flutter.interactions.impact.dispose?.(handle); },
      },
    },
  };
}

// 可燃体（2026-10-06 场景交互）：heat 事件 → 部件热量注入（combustion.js 状态机：
// 点燃/火势 tier/邻近蔓延/燃尽 + GPU 火焰粒子通路）。参数只有 radius——
// 部件耐火随机在 combustion 侧（physProfile.flameResist × 族系数）。
export function combustible({ radius = 110 } = {}) {
  return {
    interactions: {
      heat: {
        radius,
        respond(handle, payload) {
          combustibleRespond(handle, payload);
        },
      },
    },
  };
}

const _vel = new THREE.Vector3();
const _ang = new THREE.Vector3();

export const B = Object.freeze({ flutterOnImpact, physBody, combustible });
