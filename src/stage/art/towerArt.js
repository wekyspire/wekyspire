// 塔楼模块素材映射与缓存：assets/tower/*——塔楼层 billboard 纸片塔的拼接模块。
// 缓存/订阅/就绪信号语义继承 ArtImageCache（与 unitArt 同款实现）：
// get 未命中即发起异步加载并先返回 null（层块先按色块兜底），加载完成经 addOnLoad
// 通知 MapStage 重建层块挂贴图（重取即同步命中）。
// 模块按文件名（去扩展名）取用——「第一章_基础」→ assets/tower/第一章_基础.webp；
// 后续章节模块落同名目录即自动可用（towerWilderness 按章选模块）。
// 素材经 tools/compress_art.py 转 WebP（tower/ 分区 q90 保 alpha 边缘）。

import { ArtImageCache, IMG_EXT_RE, indexArtUrls } from './imageCache.js';

const ART_URLS = indexArtUrls(
  import.meta.glob('../../assets/tower/*.{png,jpg,jpeg,webp}', { eager: true, query: '?url', import: 'default' })
);

export class TowerArtCache extends ArtImageCache {
  /** 模块名（去扩展名）→ url；未登记返回 null。 */
  resolveUrl(name) {
    return name ? (ART_URLS[name.replace(IMG_EXT_RE, '')] ?? null) : null;
  }

  /** 同步取模块图：已加载 → HTMLImageElement；未加载 → 发起加载并返回 null。 */
  getModule(name) {
    const url = this.resolveUrl(name);
    return url ? this.getByUrl(url) : null;
  }
}

// 应用级共享单例（与 sharedUnitArtCache 同律）：MapStage / 预载门共用一份，
// 避免各自 new 导致模块重复加载与解码。
export const sharedTowerArtCache = new TowerArtCache();
