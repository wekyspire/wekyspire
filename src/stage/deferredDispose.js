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
  flushBufferGuard();
}

// ---- uniform UBO 延迟销毁垫片（WebGPU bindingBuffer 版，2026-09-30 夜测病灶）----
// three 的 Bindings 组销毁 uniform UBO（GPUBuffer label 前缀 'bindingBuffer'）后，
// 已录制/复用的 bind group 仍可能长期引用它并每帧 submit → GPUValidationError
// 刷屏（slot 房 ~60 条/s 静置复现，probe-webgpu-id 实锤同 buffer 每 200ms 重复
// destroy）。与纹理版同一病理（WebGPU 无引用计数安全网），但销毁方在 three 内部，
// 只能在原生原型层拦截：label 过滤 + 延迟 DESTROY_DELAY_MS 后落刀；若引用方在
// 窗口内放手（重建新组接管），报错即归零。池上限防极端膨胀（KB 级 × 上限，可忽略）。
const DESTROY_DELAY_MS = 1000;
const BUFFER_GUARD_CAP = 256;
let bufferGuardInstalled = false;
/** @type {{ buf: GPUBuffer, orig: () => void, due: number }[]} */
let bufferGuardQueue = [];

/** 安装一次性垫片（渲染器宿主启动时调用；非浏览器/重复调用安全）。 */
export function installBindingBufferGuard() {
  if (bufferGuardInstalled || typeof globalThis.GPUBuffer === 'undefined') return;
  bufferGuardInstalled = true;
  const origDestroy = GPUBuffer.prototype.destroy;
  GPUBuffer.prototype.destroy = function destroyPatched() {
    const label = this.label ?? '';
    if (!label.startsWith('bindingBuffer')) return origDestroy.call(this);
    if (bufferGuardQueue.length >= BUFFER_GUARD_CAP) {
      // 池满：最老的先落刀（宁可偶发一条报错也不无界膨胀）
      const drop = bufferGuardQueue.shift();
      drop.orig.call(drop.buf);
    }
    bufferGuardQueue.push({ buf: this, orig: () => origDestroy.call(this), due: performance.now() + DESTROY_DELAY_MS });
  };
}

/** 每帧随 flushDeferredDisposals 走：到期的 UBO 真正销毁。 */
function flushBufferGuard() {
  if (bufferGuardQueue.length === 0) return;
  const now = performance.now();
  let i = 0;
  while (i < bufferGuardQueue.length && bufferGuardQueue[i].due <= now) i++;
  for (let j = 0; j < i; j++) bufferGuardQueue[j].orig.call(bufferGuardQueue[j].buf);
  if (i > 0) bufferGuardQueue.splice(0, i);
}
