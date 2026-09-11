// 商店货架取图（售货机的商品 billboard 用）：**遗物立绘优先**（`assets/relics/<遗物名>`，
// 与顶端资源栏/获得物特写同一张纹理），退化到道具/物品图（`assets/items|props`，药水/苹果/卡包）。
//
// 遗物立绘的共享缓存由 `art/relicArt.js` 提供。那份模块与 `assets/relics/` 素材是**并行开发中的
// 内容**，故这里用 glob 探测而不是静态 import：模块在 → 复用它的共享单例（同一 key 不重复解码），
// 不在 → 构建照常通过，货品卡退化为色块占位（与 ItemShowcaseObject 同一条退化线）。
import { sharedPropArtCache } from './propArt.js';

const relicMod = Object.values(import.meta.glob('./relicArt.js', { eager: true }))[0] ?? null;
const relicCache = relicMod?.sharedRelicArtCache ?? null;

/** key（遗物显示名 / 道具名）→ 共享 sRGB 纹理；未命中或未解码完 → null（调用方下一帧再试）。 */
export function goodsArtTexture(key) {
  if (!key) return null;
  return relicCache?.getTexture?.(key) ?? sharedPropArtCache.getTexture(key) ?? null;
}
