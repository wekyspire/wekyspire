// 全量美术清单 + 进网页统一预载（菜单层顶层加载界面 AssetLoadingScreen 的数据源）。
// 清单由构建期 import.meta.glob 自动收集：src/assets 下任何位图落盘即入册，无需登记
// （与 core 内容注册的「显式 import」约定区分开——素材没有逻辑语义，无需显式点名；
//   新增美术资源只要丢进 assets 任意子目录，构建即自动纳入预载）。
// 预载成果按路径分区 warm 进共享缓存：stage/* → UnitArtCache、cards/* → CardArtCache，
// 舞台首拍 get() 同步命中（无「占位色块 → 补挂」闪变）；cutscenes/images 等纯展示图
// 只温浏览器缓存（<img>/CSS 引用同一 URL，后续取用零网络零解码等待）。
import { sharedUnitArtCache } from './unitArt.js';
import { sharedCardArtCache } from './cardArtCache.js';

// 根级散图（如 remi.webp）与任意深度子目录（cards/decor/ 等）均被 ** 命中；
// 扩展名过滤天然排除 css/mp3 等非位图（素材经 tools/compress_art.py 转 WebP）
export const ART_MANIFEST = Object.freeze(
  Object.entries(
    import.meta.glob('../../assets/**/*.{png,jpg,jpeg,webp}', { eager: true, query: '?url', import: 'default' }),
  ).map(([path, url]) => Object.freeze({ path, url })),
);

/**
 * 统一预载全部美术素材：逐张 onload/onerror 计数（单张失败不阻塞，计入返回值），
 * onProgress(loaded, total) 驱动加载界面进度条，全部落定后 resolve。
 * @param {object} options
 *   onProgress: (loaded, total) => void       进度回调（每张落定一次）
 *   imageFactory: 类                          测试注入的 Image 桩（缺省全局 Image）
 *   caches: { stage, card }                   测试注入位（缺省共享单例）
 * @returns {Promise<{ total: number, failed: number }>}
 */
export function preloadAllArt({ onProgress, imageFactory = null, caches = null } = {}) {
  const Img = imageFactory ?? (typeof Image !== 'undefined' ? Image : null);
  const targets = caches ?? { stage: sharedUnitArtCache, card: sharedCardArtCache };
  const total = ART_MANIFEST.length;
  const warmInto = (path, url, img) => {
    const t = path.includes('/assets/stage/')
      ? targets.stage
      : path.includes('/assets/cards/') ? targets.card : null;
    t?.warm?.(url, img);
  };
  if (!Img || !total) {
    onProgress?.(0, 0); // node/headless 无图可载：立即放行（不挡测试与 SSR 式路径）
    return Promise.resolve({ total, failed: 0 });
  }
  let done = 0;
  let failed = 0;
  return new Promise((resolve) => {
    for (const { path, url } of ART_MANIFEST) {
      const img = new Img();
      const settle = (ok) => {
        done += 1;
        if (!ok) failed += 1;
        else warmInto(path, url, img);
        onProgress?.(done, total);
        if (done === total) resolve({ total, failed });
      };
      img.onload = () => settle(true);
      img.onerror = () => settle(false);
      img.src = url;
    }
  });
}
