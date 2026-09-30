// 美术资源包运行期（quest_prompts/ASSET_PACK.md 设计实现）：
// 构建期 vite 插件（wekyspire-artpack）把全部位图产物裸拼接成
// artpack-<md5前8>.bin + dist 根的 artpack-manifest.js（ESM asset）。
// 此处在预载前拉包：动态 import manifest → 流式 fetch（onProgress 拿**精确**
// 字节进度，替代旧 HEAD 逐张探测）→ 校验总长 → 逐条 slice→Blob→objectURL。
//
// resolveArtUrl 是全仓库美术 URL 的唯一换汇点：命中 ENTRIES（按产物文件名）
// 返回 blob URL，否则原样透传——dev / 缺包 / 拉取失败 / 长度不符时整条链
// 自动回退逐张旧路径，消费方零感知。
//
// ⚠ 内存口径：12MB 级 ArrayBuffer 常驻 + 每条一个 Blob 视图（slice 惰性拷贝）
// 是「全量预载」架构的等价代价（旧路径把这些字节摊在浏览器 HTTP 缓存里）。
// blob URL 全局常驻不 revoke（预载语义 = 全局缓存）。膨胀到上百 MB 再升级
// Range 按需取（设计文档 §6）。

let urlMap = null;   // Map<产物文件名, blobUrl>；null = 未启用/失败 → 全透传

/** 是否已走包（预载统计口径切换用：包路径字节进度来自流式 fetch）。 */
export function artPackActive() { return urlMap !== null; }

/** URL 换汇：包内文件换 blob URL，其余（data: 占位 / 未入包 / dev 原路径）透传。 */
export function resolveArtUrl(url) {
  if (!urlMap || !url || url.startsWith('data:')) return url;
  return urlMap.get(url.split('?')[0].split('/').pop()) ?? url;
}

/**
 * 拉包并解包（幂等：已就绪直接返回 true）。
 * @returns {Promise<boolean>} false = 无包/失败（调用方走逐张回退，那里有重试 UI）
 */
export async function loadArtPack({ onProgress } = {}) {
  if (urlMap) return true;
  let manifest;
  try {
    // manifest 是 dist 根的构建期 asset，不在模块图里——运行期动态 import。
    // 相对 base（'./'）部署下 import 会按模块 URL 解析，必须锚到文档 base。
    const url = new URL('artpack-manifest.js', document.baseURI).href;
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
    return false;   // 中断/断网：回退逐张（重试 UI 在那条路径上）
  }
  if (buf.byteLength !== PACK_TOTAL) return false;   // 截断/脏包：回退
  const map = new Map();
  for (const [name, [off, len, mime]] of Object.entries(ENTRIES)) {
    map.set(name, URL.createObjectURL(new Blob([buf.slice(off, off + len)], { type: mime })));
  }
  urlMap = map;
  return true;
}
