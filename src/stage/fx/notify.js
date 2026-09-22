// 单向 notify 分发口（fx 架构，2026-09-22 Phase 4）：
// 「战斗中 3D 场景物体可 PCG 交互（碎裂/震荡）」的落地形态——**纯异步单向通信**：
// 外界只 notify 事件（重击落地、爆炸冲击……），不读回值、不等结果、不进节拍。
// 交互模式由 PCG 资源自身声明（prop def 的 behaviors → interactions 表，逻辑模板
// 在 kit/behaviors.js，参数在道具），notify 按 cast 里 prop: 前缀圈选 + 半径过滤分发。
//
// 句柄形态（composeRoom notifiables 契约）：{ name, object, interactions: {
//   impact: { radius?, respond(handle, payload) }, ... } }
// respond 一律 fire-and-forget（自己起补间/粒子），异常只告警不炸分发。

export function createNotifyHub({ cast }) {
  const notify = (event, payload = {}) => {
    for (const { handle } of cast.query('prop:')) {
      const spec = handle?.interactions?.[event];
      if (!spec) continue;
      // 半径圈选：payload.at（x/z 世界坐标）存在且 spec 给了 radius 才过滤
      if (payload.at && spec.radius != null) {
        const p = handle.object?.position ?? null;
        if (!p) continue;
        const dx = p.x - payload.at.x;
        const dz = p.z - payload.at.z;
        if (Math.hypot(dx, dz) > spec.radius) continue;
      }
      try {
        spec.respond(handle, payload);
      } catch (err) {
        console.warn(`[fx/notify] 道具响应异常（${handle?.name} ← ${event}）：`, err);
      }
    }
  };
  return { notify };
}
