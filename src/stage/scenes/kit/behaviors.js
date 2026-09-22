// propKit 交互行为模板目录（WORKFLOW §5）——首件落地：flutterOnImpact（2026-09-22 fx Phase 4）。
// 契约：行为模板返回 { interactions: { <event>: { radius?, respond(handle, payload) } } }；
// 资产侧 behaviors 字段只允许实例化模板（逻辑在 kit，参数在道具），composeRoom 把带
// behaviors 的道具排除出静态合批、登记进 notifiables；舞台经 cast（prop: 前缀）+
// fx/notify.js 单向分发。respond 一律 fire-and-forget（自己起补间），不进节拍。
// 规划余量：B.idleSway / B.shatterOnBlast / B.lightExtinguish / B.torchFlicker。
import gsap from 'gsap';

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

export const B = Object.freeze({ flutterOnImpact });
