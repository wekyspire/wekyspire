// 卡面视图（**战斗无关口径**）：bakeCardFace 的输入形状，只含纯数据。
// 用途：Shell 的整卡预览（CardFacePreview）与休息阶段面板的卡牌 widget 共用同一份——
// 避免同一段"从技能定义取展示字段"的代码出现第二、第三份复制。
//
// 战斗口径（实时数字、应用后描述、textAlt 双轨、targetMode）在
// bridge/projection.projectCardFull——它需要 battle ctx 与 previewDamage 干跑，不走这里。
//
// keywords 返回**原始 id**、不映射中文标签：标签表 KEYWORD_LABELS 在 bridge 层，
// core 不得 import 上层；由调用方（Shell / Stage）自行映射成页脚文案。

/**
 * @param {object} def 技能定义（注册表反查所得）
 * @param {object} ctx describe 上下文（休息阶段面板传 { player }，应用前口径）
 * @returns {null | object} 卡面视图；def 为空返回 null
 */
export function cardViewFromDef(def, ctx = {}) {
  if (!def) return null;
  return {
    name: def.name ?? '',
    tier: def.tier ?? null,
    type: def.type ?? 'normal',
    series: def.series ?? null,
    // 美术键（2026-09-25 补）：链级换代后 def.image 是卡图解析的主键（cardArtCache
    // resolveUrl 首选），缺了它面板/选卡器只能回落 series——家族桶键已随换代退役，
    // 全线解析归 null = "选卡界面空白卡"事故的根因。战斗手牌走 bridge 投影自带
    // image 所以有图，掩盖了这条链路的缺口。
    image: def.image ?? null,
    cost: def.cost ?? { mana: 0, actionPoint: 0 },
    keywords: def.keywords ?? [],
    cardMode: def.cardMode ?? 'normal',
    chantWeight: def.chantWeight ?? null,
    pack: def.pack ?? null,
    charges: def.charges ?? null,
    text: def.describe?.(ctx) ?? '',
  };
}
