// 全量美术清单 + 进网页统一预载（菜单层顶层加载界面 AssetLoadingScreen 的数据源）。
// 清单由构建期 import.meta.glob 自动收集：src/assets 下任何位图落盘即入册，无需登记
// （与 core 内容注册的「显式 import」约定区分开——素材没有逻辑语义，无需显式点名；
//   新增美术资源只要丢进 assets 任意子目录，构建即自动纳入预载）。
// 预载成果按路径分区 warm 进共享缓存：stage/* → UnitArtCache、cards/* → CardArtCache、
// ui/* → BubbleArtCache（对话泡泡）、relics/* → 遗物立绘缓存（顶端资源栏的遗物槽是
// 2D canvas 烘焙，必须在首拍同步取到图，没有「下一帧再补」的余地），
// 舞台首拍 get() 同步命中（无「占位色块 → 补挂」闪变）；cutscenes/images 等纯展示图
// 只温浏览器缓存（<img>/CSS 引用同一 URL，后续取用零网络零解码等待）。
import { sharedUnitArtCache } from './unitArt.js';
import { sharedCardArtCache } from './cardArtCache.js';
import { sharedUiArtCache } from './bubbleArt.js';
import { sharedRelicArtCache } from './relicArt.js';

// 根级散图（如 remi.webp）与任意深度子目录（cards/decor/ 等）均被 ** 命中；
// 扩展名过滤天然排除 css/mp3 等非位图（素材经 tools/compress_art.py 转 WebP）
export const ART_MANIFEST = Object.freeze(
  Object.entries(
    import.meta.glob('../../assets/**/*.{png,jpg,jpeg,webp}', { eager: true, query: '?url', import: 'default' }),
  ).map(([path, url]) => Object.freeze({ path, url })),
);

/**
 * 资源体积探测（HEAD + Content-Length，并行）：给加载界面算**总大小/已下载/网速/ETA**。
 * 顺带把静态资源预热进浏览器缓存（随后的 Image 加载多走缓存命中）。
 * 探测失败（CORS/无 Content-Length/网络抖动）只让该条缺席——**绝不阻断开播**，
 * 前端指标自动退化为"按张数估算"。
 */
async function probeSizes() {
  const sizes = new Map();
  if (typeof fetch !== 'function') return sizes;
  await Promise.all(ART_MANIFEST.map(async ({ url }) => {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (!res.ok) return;
      const n = Number(res.headers.get('content-length'));
      if (Number.isFinite(n) && n > 0) sizes.set(url, n);
    } catch { /* 单条探测失败：缺席即可（不阻断） */ }
  }));
  return sizes;
}

/**
 * 统一预载全部美术素材：逐张 onload/onerror 计数（**单张失败不吞**——计入返回值，
 * 由加载门决定"卡住不放行"，见 App.vue 的 assetsReady 判定），
 * onProgress(loaded, total) 驱动进度条；onStats 给出体积/网速/ETA 的原始量。
 * @param {object} options
 *   onProgress: (loaded, total) => void             进度回调（每张落定一次；签名保持不变）
 *   onStats: (stats) => void                        统计回调（每次进度 + 探测完成时）
 *          stats = { done, total, loadedBytes, totalBytes, elapsedMs, failed }
 *          （loadedBytes/totalBytes 只有在 HEAD 探测拿到 Content-Length 时才有意义）
 *   imageFactory: 类                                测试注入的 Image 桩（缺省全局 Image）
 *   caches: { stage, card, ui, relic }              测试注入位（缺省共享单例）
 * @returns {Promise<{ total: number, failed: number }>}
 */
export function preloadAllArt({ onProgress, onStats = null, imageFactory = null, caches = null } = {}) {
  const Img = imageFactory ?? (typeof Image !== 'undefined' ? Image : null);
  const targets = caches ?? {
    stage: sharedUnitArtCache, card: sharedCardArtCache, ui: sharedUiArtCache, relic: sharedRelicArtCache,
  };
  const total = ART_MANIFEST.length;
  const warmInto = (path, url, img) => {
    const t = path.includes('/assets/stage/')
      ? targets.stage
      : path.includes('/assets/cards/') ? targets.card
        : path.includes('/assets/relics/') ? targets.relic
          : path.includes('/assets/ui/') ? targets.ui : null;
    t?.warm?.(url, img);
  };
  if (!Img || !total) {
    onProgress?.(0, 0); // node/headless 无图可载：立即放行（不挡测试与 SSR 式路径）
    onStats?.({ done: 0, total, loadedBytes: 0, totalBytes: 0, elapsedMs: 0, failed: 0 });
    return Promise.resolve({ total, failed: 0 });
  }
  let t0 = Date.now();
  const settled = new Set();     // 已落定的 url（探测晚到时补记体积）
  const sizes = new Map();       // url -> bytes（HEAD 探测；缺席 = 未知）
  let totalBytes = 0;
  let loadedBytes = 0;
  let done = 0;
  let failed = 0;
  const stats = () => ({ done, total, loadedBytes, totalBytes, elapsedMs: Date.now() - t0, failed });
  const report = () => { onProgress?.(done, total); onStats?.(stats()); };
  return (async () => {
    // 先探测体积（并行 HEAD）：拿到总大小，进度条才能给出真实百分比/速度/ETA。
    // 探测本身也把资源预热进缓存；失败/无 fetch/无 document（node 测试）则整段跳过。
    if (!imageFactory && typeof document !== 'undefined') {
      for (const [url, n] of await probeSizes()) {
        sizes.set(url, n);
        totalBytes += n;
        if (settled.has(url)) loadedBytes += n;   // 已加载完的条目立刻补记
      }
      report();
    }
    // 下载计时从**探测之后**起算（探测阶段只有小 HEAD 响应，算进均速会把 ETA 抬得很难看）
    t0 = Date.now();
    await new Promise((resolve) => {
      for (const { path, url } of ART_MANIFEST) {
        const img = new Img();
        const settle = (ok) => {
          done += 1;
          settled.add(url);
          if (!ok) failed += 1;
          else {
            warmInto(path, url, img);
            if (sizes.has(url)) loadedBytes += sizes.get(url);
          }
          report();
          if (done === total) resolve();
        };
        img.onload = () => settle(true);
        img.onerror = () => settle(false);
        img.src = url;
      }
    });
    return { total, failed };
  })();
}
