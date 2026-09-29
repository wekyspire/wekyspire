// 纹理延迟销毁器（WebGPU 迁移后的正式方案，probe-w2 确诊）：
// 换图即 dispose 时，上一帧（甚至本帧更早已经录制的 pass）绑定组仍引用旧纹理——
// WebGPU 提交在 GPU 时间线异步执行，CPU 侧 dispose 立刻销毁 GPUTexture，仍在飞/已排队
// 的 submit 携带已销毁纹理 → GPUValidationError 刷屏。WebGL 时代 gl.deleteTexture 由
// 驱动兜底（引用计数 + 延迟回收），WebGPU 没有这个安全网。
// 口径：换图点只把旧纹理交到这里排队，渲染循环每帧 flush 一次，压满 DEFER_FRAMES 帧
// 后才真正 dispose——那时引用它的 submit 早已出队。（TMP-PROBE 延迟销毁试验证实有效，
// 此文件 = 试验的正式化；调用点从「old?.dispose?.()」改为「deferDisposeTexture(old)」。）
const DEFER_FRAMES = 3;

/** @type {{ res: {dispose():void}, due: number }[]} */
const queue = [];
let frameNo = 0;

/**
 * 把可 dispose 的 GPU 资源（纹理为主）排入延迟销毁队列。
 * @param {{ dispose(): void } | null | undefined} res
 */
export function deferDisposeTexture(res) {
  if (!res || typeof res.dispose !== 'function') return;
  queue.push({ res, due: frameNo + DEFER_FRAMES });
}

/** 渲染循环每帧调用一次（StageManager tick 末尾）：到期资源真正销毁。 */
export function flushDeferredDisposals() {
  frameNo++;
  let i = 0;
  while (i < queue.length && queue[i].due <= frameNo) i++; // 队列按 due 单调入队，前缀即到期段
  for (let j = 0; j < i; j++) queue[j].res.dispose();
  if (i > 0) queue.splice(0, i);
}
