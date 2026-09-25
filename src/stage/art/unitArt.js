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
//   形态变体（Boss 转阶段换装）见 UNIT_ART_VARIANTS
// 素材经 tools/compress_art.py 转 WebP；查表按去扩展名匹配，新旧格式混放均可。

const ART_URLS = indexArtUrls(
  import.meta.glob('../../assets/stage/*.{png,jpg,jpeg,webp}', { eager: true, query: '?url', import: 'default' })
);

// defId → 立牌文件名；玩家（side==='player'）无 defId，固定 unit_player.png
// bigSlime 复用史莱姆立绘：同种不同体型（身高系数放大），暂无专属素材
const UNIT_ART_FILES = Object.freeze({
  remi: 'unit_remi.png',
  slime: 'unit_slime.png',
  bigSlime: 'unit_slime.png',
  slimelet: 'unit_slimelet.png',
  // A/B 行为变体（2026-09-22 章1重写）复用基底立绘：同种个体，只是行动顺序不同
  slimeletA: 'unit_slimelet.png',
  slimeletB: 'unit_slimelet.png',
  hedgehog: 'unit_hedgehog.png',
  mossBallA: 'unit_mossBall.png',
  mossBallB: 'unit_mossBall.png',
  buzzbug: 'unit_buzzbug.png',
  buzzbugA: 'unit_buzzbug.png',
  buzzbugB: 'unit_buzzbug.png',
  swampAmbusher: 'unit_swampAmbusher.png',
  thornWeed: 'unit_thornWeed.png',
  carrionBeetle: 'unit_carrionBeetle.png',
  staticPuff: 'unit_staticPuff.png',
  diggerMole: 'unit_diggerMole.png',
  pufferToad: 'unit_pufferToad.png',
  blastPod: 'unit_blastPod.png',
  stoneCocoon: 'unit_stoneCocoon.png',
  rockSnail: 'unit_rockSnail.png',
  wraith: 'unit_wraith.png',
  wraithA: 'unit_wraith.png',
  wraithB: 'unit_wraith.png',
  snowwolf: 'unit_snowwolf.png',
  rockPangolin: 'unit_rockPangolin.png',
  pyro: 'unit_pyro.png',
});

// 形态变体（`${defId}:${variant}` → 立牌文件）：Boss 转阶段换立绘（剧本 setArtVariant 触发）。
// 变体只换图、不换体量——立牌高仍按 UNIT_HEIGHT_FACTOR，宽由图片纵横比派生，
// 所以两张形态图必须**纵向同高**（横向可以差很多，火翼张开属正常）
const UNIT_ART_VARIANTS = Object.freeze({
  'pyro:p2': 'unit_pyro_p2.png',
});

// 立牌相对高度系数（基准身高 26 世界单位 × baseScale）：
// 按角色体格调，不按图片像素——图已抠图裁边（像素高≈角色高，见 tmp/trim_unit_art.py），
// 所以系数直接决定「谁在画里比谁高」：Boss 必须压过骑士一头，否则新立绘会显得比队友还小
const UNIT_HEIGHT_FACTOR = Object.freeze({
  player: 0.92,
  remi: 0.62,
  slime: 0.6,
  bigSlime: 0.95,
  slimelet: 0.4,
  slimeletA: 0.4,
  slimeletB: 0.4,
  hedgehog: 0.5,
  mossBallA: 0.6,
  mossBallB: 0.6,
  buzzbug: 0.45,
  buzzbugA: 0.45,
  buzzbugB: 0.45,
  swampAmbusher: 1.0,
  thornWeed: 0.55,
  carrionBeetle: 0.5,
  staticPuff: 0.55,
  diggerMole: 0.55,
  pufferToad: 0.6,
  blastPod: 0.5,
  stoneCocoon: 0.7,
  rockSnail: 0.55,
  wraith: 0.75,
  wraithA: 0.75,
  wraithB: 0.75,
  snowwolf: 0.95,
  rockPangolin: 1.0,
  pyro: 1.02,
});

export const STANDEE_BASE_HEIGHT = 26; // 世界单位（scale=1 时）

export function unitHeightFactor(defId, side) {
  if (side === 'player') return UNIT_HEIGHT_FACTOR.player;
  return UNIT_HEIGHT_FACTOR[defId] ?? 0.9;
}

export class UnitArtCache extends ArtImageCache {
  /** @param {string|null} variant 形态变体（如 'p2'）；未登记的组合回落到本图 */
  resolveUrl(defId, side, variant = null) {
    const file = variant ? (UNIT_ART_VARIANTS[`${defId}:${variant}`] ?? UNIT_ART_FILES[defId])
      : (side === 'player' ? 'unit_player.png' : UNIT_ART_FILES[defId]);
    return file ? (ART_URLS[file.replace(IMG_EXT_RE, '')] ?? null) : null;
  }

  /**
   * 同步取图：已加载 → HTMLImageElement；未加载 → 发起加载并返回 null；无素材 → null。
   */
  get(defId, side, variant = null) {
    const url = this.resolveUrl(defId, side, variant);
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
