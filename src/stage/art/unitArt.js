// 立牌素材映射与缓存：defId/side → assets/stage/*.png。
// 缓存/订阅/就绪信号语义继承 ArtImageCache（与 CardArtCache 共用实现）；
// get() 未命中即发起异步加载并先返回 null（占位色块），
// 加载完成经 addOnLoad 订阅通知 Stage 补挂纹理（立牌纹理不带 hit map，无成对替换问题）。
// 实例为应用级共享单例（sharedUnitArtCache）：BattleStage/MapStage 共用一份，
// 跨舞台/跨战斗复用已解码图（各自 new 会导致头像等素材重复加载与解码）。

import { ArtImageCache, IMG_EXT_RE, indexArtUrls } from './imageCache.js';
//
// 视角约定（STAGE_DESIGN §0 用户手绘稿）：友军（玩家/队友）背对屏幕，敌军正对屏幕。
//   unit_xxx.{webp,png}      = 舞台用图（友军=背视图，敌军=正视图）
//   unit_xxx_front.{webp,png} = 正视图备用（幕间/图鉴等 UI 场景）
// 素材经 tools/compress_art.py 转 WebP；查表按去扩展名匹配，新旧格式混放均可。

const ART_URLS = indexArtUrls(
  import.meta.glob('../../assets/stage/*.{png,jpg,jpeg,webp}', { eager: true, query: '?url', import: 'default' })
);

// defId → 立牌文件名；玩家（side==='player'）无 defId，固定 unit_player.png
// defId → 立牌文件名；玩家（side==='player'）无 defId，固定 unit_player.png
// bigSlime 复用史莱姆立绘：同种不同体型（身高系数放大），暂无专属素材
const UNIT_ART_FILES = Object.freeze({
  remi: 'unit_remi.png',
  slime: 'unit_slime.png',
  bigSlime: 'unit_slime.png',
  pyro: 'unit_warlock.png',
});

// 立牌相对高度系数（基准身高 26 世界单位 × baseScale）：
// 按角色体格调，不按图片像素——图已被抠图裁边，像素高≈角色高
const UNIT_HEIGHT_FACTOR = Object.freeze({
  player: 0.92,
  remi: 0.62,
  slime: 0.6,
  bigSlime: 0.95,
  pyro: 0.85,
});

export const STANDEE_BASE_HEIGHT = 26; // 世界单位（scale=1 时）

export function unitHeightFactor(defId, side) {
  if (side === 'player') return UNIT_HEIGHT_FACTOR.player;
  return UNIT_HEIGHT_FACTOR[defId] ?? 0.9;
}

export class UnitArtCache extends ArtImageCache {
  resolveUrl(defId, side) {
    const file = side === 'player' ? 'unit_player.png' : UNIT_ART_FILES[defId];
    return file ? (ART_URLS[file.replace(IMG_EXT_RE, '')] ?? null) : null;
  }

  /**
   * 同步取图：已加载 → HTMLImageElement；未加载 → 发起加载并返回 null；无素材 → null。
   */
  get(defId, side) {
    const url = this.resolveUrl(defId, side);
    return url ? this.getByUrl(url) : null;
  }

  /** 按文件名直接取图（如 'unit_player_front.png' 头像正视图），加载语义同 get()。 */
  getFile(file) {
    const url = ART_URLS[file.replace(IMG_EXT_RE, '')] ?? null;
    return url ? this.getByUrl(url) : null;
  }
}

// 应用级共享单例：BattleStage/MapStage 直接复用（node 单测无 document 不会触达）
export const sharedUnitArtCache = new UnitArtCache();
