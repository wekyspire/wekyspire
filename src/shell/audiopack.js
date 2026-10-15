// 音频资源包运行期（镜像 stage/art/artpack.js，缓存键独立——音频改版不动美术包名）：
// 构建期 vite 插件（wekyspire-audiopack）把全部音频产物裸拼接成
// audiopack-<md5前8>.bin + dist 根的 audiopack-manifest.js（ESM asset）。
// 此处在预载前拉包：动态 import manifest → 流式 fetch（onProgress 拿精确字节进度）
// → 校验总长 → 逐条 slice→Blob→objectURL。
//
// resolveAudioUrl 是音频 URL 的唯一换汇点：命中 ENTRIES（按产物文件名）返回
// blob URL，否则原样透传——dev / 缺包 / 拉取失败 / 长度不符时整条链自动回退
// 逐条旧路径（原始单文件保留在产物里），消费方零感知。
// blob URL 全局常驻不 revoke（预载语义 = 全局缓存）。

let urlMap = null;   // Map<产物文件名, blobUrl>；null = 未启用/失败 → 全透传

/** 只取包元信息（不下载包体）：加载界面把音频字节提前并入总分母（统一进度条）。 */
export async function audioPackInfo() {
  try {
    const url = new URL('audiopack-manifest.js', document.baseURI).href;
    const m = await import(/* @vite-ignore */ url);
    return Number.isFinite(m.PACK_TOTAL) && m.PACK_TOTAL > 0 ? { total: m.PACK_TOTAL } : null;
  } catch {
    return null;   // dev / 未部署包
  }
}

/** URL 换汇：包内文件换 blob URL，其余（dev 原路径 / 未入包）透传。 */
export function resolveAudioUrl(url) {
  if (!urlMap || !url || url.startsWith('data:') || url.startsWith('blob:')) return url;
  return urlMap.get(url.split('?')[0].split('/').pop()) ?? url;
}

/**
 * 拉包并解包（幂等：已就绪直接返回 true）。
 * @returns {Promise<boolean>} false = 无包/失败（调用方走逐条回退）
 */
export async function loadAudioPack({ onProgress } = {}) {
  if (urlMap) return true;
  let manifest;
  try {
    const url = new URL('audiopack-manifest.js', document.baseURI).href;
    manifest = await import(/* @vite-ignore */ url);
  } catch {
    return false;   // dev / 未部署包
  }
  const { PACK_URL, PACK_TOTAL, ENTRIES } = manifest;
  let res;
  try {
    res = await fetch(new URL(PACK_URL, document.baseURI).href);
  } catch {
    return false;
  }
  if (!res.ok) return false;
  let buf;
  const t0 = Date.now();
  try {
    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader();
      const chunks = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
        onProgress?.(got, PACK_TOTAL, Date.now() - t0);
      }
      const merged = new Uint8Array(got);
      let o = 0;
      for (const c of chunks) { merged.set(c, o); o += c.length; }
      buf = merged.buffer;
    } else {
      buf = await res.arrayBuffer();
      onProgress?.(buf.byteLength, PACK_TOTAL, Date.now() - t0);
    }
  } catch {
    return false;
  }
  if (buf.byteLength !== PACK_TOTAL) return false;   // 截断/脏包：回退
  const map = new Map();
  for (const [name, [off, len, mime]] of Object.entries(ENTRIES)) {
    map.set(name, URL.createObjectURL(new Blob([buf.slice(off, off + len)], { type: mime })));
  }
  urlMap = map;
  return true;
}
