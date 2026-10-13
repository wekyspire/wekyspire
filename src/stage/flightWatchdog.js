// 卡牌飞行演出（焚毁/升级）的兜底看门狗：**有进展就续命**。固定墙钟会在帧饥饿
// （后台 GPU 争用等）时误杀还在爬的演出——gsap 按实时驱动，帧率坍塌时 1.5s 的
// 演出墙钟远跑不完。心跳由演出的 ticker 计数提供；连续 starveLimit 拍无心跳判真
// 断链强收，capMs 绝对上限兜「ticker 活着但链真断」的挂死。
export function createFlightWatchdog({
  heartbeat, onExpire, intervalMs = 2000, starveLimit = 2, capMs = 30000,
} = {}) {
  let last = 0;
  let starved = 0;
  const deadline = Date.now() + capMs;
  const timer = setInterval(() => {
    if (Date.now() > deadline) { clearInterval(timer); onExpire(); return; }
    if (heartbeat() > last) { last = heartbeat(); starved = 0; return; }
    if (++starved >= starveLimit) { clearInterval(timer); onExpire(); }
  }, intervalMs);
  return () => clearInterval(timer);
}
