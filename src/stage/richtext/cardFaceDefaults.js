// 卡面烘焙的缺省实现（战斗舞台与休息阶段面板共用同一份，保证"所见即所得"）。
// 抽取原因：BattleStage 内联过一份，休息阶段面板需要完全相同的卡面（等阶框/费用徽章/
// 富文本正文/卡图/系列装饰/魏启水晶素材），第三份复制粘贴不可接受。
//
// 素材异步到图后重烘由调用方负责（addOnLoad 订阅 → 重烘），本工厂只负责取当前缓存值。

import { bakeCardFace } from './cardFace.js';

/**
 * @param {object} options
 *   cardArt: 卡图缓存（sharedCardArtCache；null = 无图出卡）
 *   unitArt: 立牌素材缓存（取魏启水晶徽章素材；null = 蓝色圆回落）
 *   scale:   烘焙超采样（1080p 卡面近 380px 高，scale 2 会糊）
 * @returns {(card: object) => {texture, hitRegions, width, height}}
 */
export function makeCardFaceBaker({ cardArt = null, unitArt = null, scale = 3 } = {}) {
  return (card) => bakeCardFace(card, {
    scale,
    art: cardArt?.get(card) ?? null,
    decor: cardArt?.getDecor?.(card) ?? null,
    manaCrystal: unitArt?.getFile('mana_crystal_full.png') ?? null,
  });
}
