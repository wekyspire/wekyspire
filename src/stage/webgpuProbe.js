// WebGPU 支持预检（长期生产加载门，来自 App.vue 的启动兼容检查）：
// 拿不到 adapter 即不支持——用户定：不支持 WebGPU 的设备直接卡死在加载界面，不做任何回退。
// @returns {Promise<GPUAdapter|null>}
export async function probeWebGpuAdapter() {
  try {
    if (typeof navigator === 'undefined' || !navigator.gpu) return null;
    return await navigator.gpu.requestAdapter();
  } catch {
    return null;
  }
}
