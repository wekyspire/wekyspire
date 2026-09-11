// 卡面图案缓存（§4 卡图链路）：技能卡插画 → 已加载 Image 的同步查询。
// 缓存/订阅/就绪信号语义继承 ArtImageCache（与 UnitArtCache 共用实现）。
// 解析规则（沿用旧仓库约定）：
//   1. def.image（技能定义显式指定，不含扩展名，如 image:'奇迹' → assets/cards/奇迹.png）
//   2. 兜底 `${type}-${tierIndex}.png`（type=fire/wood…，tierIndex D=0..S=4，素材如 fire-1.png）
//   3. 都没有 → 无卡图（牌面按无图布局）
// 加载是异步的：get() 未命中即发起加载并先返回 null（按无图烘焙），
// 加载完成经 addOnLoad 订阅通知 Stage 重烘牌面（纹理与 hit map 成对替换的铁律不变）。
// 实例为应用级共享单例（sharedCardArtCache）：跨舞台/跨战斗复用已解码图，
// 并让"预取 → 建视图命中"成为可能（每场战斗 new 缓存会把解码成果全部丢弃）。

import { ArtImageCache, indexArtUrls } from './imageCache.js';

// vite 静态收集素材 URL（去扩展名 filename → url，png/webp 混放透明切换）
const ART_URLS = indexArtUrls(
  import.meta.glob('../../assets/cards/*.{png,jpg,jpeg,webp}', { eager: true, query: '?url', import: 'default' })
);
// 系列装饰图层（assets/cards/decor/decor-{系列}.*）：整卡面装饰框（自带透明镂空），
// 按系列/类型匹配，素材未就位时回退程序化装饰（cardFace.js）
const DECOR_URLS = indexArtUrls(
  import.meta.glob('../../assets/cards/decor/*.{png,jpg,jpeg,webp}', { eager: true, query: '?url', import: 'default' })
);

const TIER_ART_INDEX = Object.freeze({ D: 0, C: 1, B: 2, A: 3, S: 4 });

export class CardArtCache extends ArtImageCache {
  /** 该卡是否有可用素材（同步，不发起加载）。 */
  resolveUrl(card) {
    const key = card.image ?? `${card.type ?? 'normal'}-${TIER_ART_INDEX[card.tier] ?? 0}`;
    return ART_URLS[key] ?? null;
  }

  /**
   * 系列装饰图层解析：decor-{series} 优先，回落 decor-{type}。
   * @param {object} card  projectCardFull 视图（series/type）
   */
  resolveDecorUrl(card) {
    for (const key of [card.series, card.type]) {
      if (!key) continue;
      const url = DECOR_URLS[`decor-${key}`];
      if (url) return url;
    }
    return null;
  }

  /**
   * 同步取图：已加载 → HTMLImageElement；未加载 → 发起加载并返回 null。
   * @param {object} card  projectCardFull 视图（image/type/tier）
   */
  get(card) {
    const url = this.resolveUrl(card);
    return url ? this.getByUrl(url) : null;
  }

  /** 同步取系列装饰图层（语义同 get；与卡图共用同一缓存与加载完成通知）。 */
  getDecor(card) {
    const url = this.resolveDecorUrl(card);
    return url ? this.getByUrl(url) : null;
  }
}

// 应用级共享单例：BattleStage 直接复用（node 单测注入 fake bakeFace 时不会触达）
export const sharedCardArtCache = new CardArtCache();
