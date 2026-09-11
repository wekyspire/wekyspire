// 图源缓存核心：URL → HTMLImageElement 的「未命中即异步加载、先返 null」语义，
// 与「订阅加载完成 addOnLoad / 全部在途落定 whenIdle」的舞台补挂协议。
// UnitArtCache 与 CardArtCache 原为逐行重合的双份实现，抽取为公共基类；
// warm() 供全量预载（assetManifest）把「已解码完成的图」直接注入缓存——
// 舞台首拍 get() 同步命中，无占位色块→补挂的闪变。

// 位图扩展名（glob 与查表共用）：素材落盘格式不限（png/webp/jpg），查表按去扩展名匹配
export const IMG_EXT_RE = /\.(png|jpe?g|webp)$/i;

/**
 * 文件名 → URL 表（去扩展名键，png/webp 混放透明切换；冲突时 webp 优先）。
 * @param {Record<string, string>} globbed import.meta.glob(..., import:'default') 的 path→url
 */
export function indexArtUrls(globbed) {
  const table = {};
  for (const [path, url] of Object.entries(globbed)) {
    const base = path.split('/').pop();
    const key = base.replace(IMG_EXT_RE, '');
    if (!(key in table) || base.toLowerCase().endsWith('.webp')) table[key] = url;
  }
  return table;
}

export class ArtImageCache {
  constructor() {
    this._cache = new Map(); // url -> HTMLImageElement | 'loading' | 'error'
    this._loadListeners = []; // 加载完成订阅方（多舞台共存时各自收到通知）
    this._pending = new Set();   // 在途加载（幕间预载 readiness 信号用）
    this._idleWaiters = [];
  }

  /** 订阅「某张图加载完成」（Stage 借此补挂纹理/重烘牌面），返回退订函数（dispose 必调，防幽灵舞台）。 */
  addOnLoad(fn) {
    this._loadListeners.push(fn);
    return () => {
      const i = this._loadListeners.indexOf(fn);
      if (i >= 0) this._loadListeners.splice(i, 1);
    };
  }

  _emitLoad(url) {
    for (const fn of [...this._loadListeners]) fn(url);
  }

  /** 全部在途加载落定（无在途立即兑现）——幕间黑幕预载的揭幕信号。 */
  whenIdle() {
    if (!this._pending.size) return Promise.resolve();
    return new Promise(resolve => this._idleWaiters.push(resolve));
  }

  _settle(url) {
    this._pending.delete(url);
    if (!this._pending.size) {
      const waiters = this._idleWaiters;
      this._idleWaiters = [];
      for (const resolve of waiters) resolve();
    }
  }

  /** 同步查询 + 未命中发起加载：已加载 → 图；在途/失败/未发起 → null。 */
  getByUrl(url) {
    const hit = this._cache.get(url);
    if (hit && hit !== 'loading' && hit !== 'error') return hit;
    if (hit === undefined) this._load(url);
    return null;
  }

  /** 预载注入：写入「已由别处解码完成的图」，不覆盖任何已有态（加载中/已加载/失败）。 */
  warm(url, img) {
    if (!url || !img) return false;
    if (this._cache.has(url)) return false;
    this._cache.set(url, img);
    return true;
  }

  _load(url) {
    this._cache.set(url, 'loading');
    this._pending.add(url);
    const img = new Image();
    img.onload = () => {
      this._cache.set(url, img);
      this._settle(url);
      this._emitLoad(url);
    };
    img.onerror = () => {
      this._cache.set(url, 'error');
      this._settle(url);
    };
    img.src = url;
  }
}
