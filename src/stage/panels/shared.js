// 休息阶段面板的共享小件：卡面标签映射、维度/房间表现文案、通用按钮与产出文案。
// 「快照 → widget 列表」纯映射，PanelObject 只认 widget 描述，不认识任何面板语义。

import { KEYWORD_LABELS } from '../../bridge/projection.js';
import { getSkillDefinition } from '../../core/skills/registry.js';
import { getRelicDefinition } from '../../core/relics/registry.js';

// 卡面视图的关键词 id → 页脚中文标签（标签表在 bridge，core 不得反向依赖，故在此映射）
export const withLabels = (view) => (view
  ? { ...view, keywords: (view.keywords ?? []).map(k => KEYWORD_LABELS[k] ?? k) }
  : view);

// 灵脉维度的表现配置（配色/字槽）：core 只给 id 与等级，画成什么样属表现层。
// 素材到位后把 glyph 换成美术图即可（与旧面板 .dim-icon「美术到位替换」同一处）。
// 导出：进阶幕间（runController.playAscensionScene）的对话选项也用这份文案，两处不漂移。
export const DIM_META = {
  fire: { label: '火灵脉', glyph: '炎', color: '#e85a5a' },
  wood: { label: '木灵脉', glyph: '木', color: '#4aa56e' },
  air: { label: '空灵脉', glyph: '风', color: '#5aa2e8' },
  body: { label: '体修', glyph: '武', color: '#b8894a' },
};

// 房间标题（表现文案；core 只给 currentRoom 这个 id）。
// 房间里的机器/篝火自己长什么样、能做什么，进场点一次就知道——不再配 hint 说明句。
export const ROOM_META = {
  training: { name: '训练场' },
  camp: { name: '营地' },
  campTraining: { name: '营地训练场' },
  gurpas: { name: '古尔帕斯之店' },
  slot: { name: '老虎机' },
  shop: { name: '商店房' },
  event: { name: '事件房' },
};

/** 营地动作瓦片（休整/找回瑞米）：占位面板与场景式面板共用（模块作用域）。
 *  D4：营地不再能升级卡（升级全部收进训练房新制）。 */
export const pushCampGroup = (w, c = { options: [] }) => {
  const tiles = [];
  if (c.options.includes('recoverRemi')) {
    tiles.push({ id: 'recoverRemi', name: '🐾 找回瑞米', desc: '瑞米回到身边', action: { action: 'campChoose', option: 'recoverRemi' } });
  }
  if (c.options.includes('rest')) {
    // ⚠ 瓦片副标题是**单行不换行**（bakeButtonFace 的 sublabel，画在瓦片画布上）：
    // 超出瓦片宽度会被**画布裁掉**（症状：两头的字没了只剩中间）。故 desc 压到 ~6 个汉字，
    // 完整口径放到下面的说明行（sub 行会换行/缩放，放得下）
    tiles.push({ id: 'rest', name: '🔥 休整', desc: '恢复35%生命值', action: { action: 'campChoose', option: 'rest' } });
  }  if (tiles.length) w.push({ kind: 'tiles', idPrefix: 'camp', tileHeight: 96, gapY: 14, items: tiles });
  // if (c.options.includes('rest')) {
  //   w.push({ kind: 'sub', align: 'center', tint: '#77809a', text: '休整 = 回复 35% 最大生命，并把魏启全部回满' });
  // }
};

/** 老虎机产出的可读文本（表现层翻译；引擎只给载荷）。 */
export function slotPrizeText(p) {
  if (!p) return '';
  if (p.kind === 'nothing') return '什么也没发生……';
  if (p.money != null) return `金币 +${p.money}`;
  if (p.healPct != null) return `恢复 ${Math.round(p.healPct * 100)}% 生命值`;
  if (p.fullRestore) return '全状态恢复：生命与魏启回满，负面效果清除';
  if (p.special === 'apple') return '瑞米最爱的苹果';
  if (p.special === 'goldApple') return '金苹果';
  if (p.special === 'fruit') return '瑞米升级果';
  if (p.special === 'training') return '训练次数 +1';
  if (p.upgradeCopyId) return `获得「升级后的复制品」：${defName(p.upgradeCopyId)}`;
  if (p.upgrade?.kind === 'random') return `随机升级 ${p.upgrade.count} 张卡牌`;
  if (p.upgrade?.kind === 'free') return '免费升级一张卡牌';
  if (p.relicChoices?.length) return '择一件 A 级遗物';
  if (p.relicId) return `获得遗物：${relicName(p.relicId)}`;
  if (p.choices?.length) return '择一张卡牌加入牌组';
  return p.kind ?? '';
}

export const defName = (id) => getSkillDefinition(id)?.name ?? id;
export const relicName = (id) => getRelicDefinition(id)?.name ?? id;
export const getRelicRarity = (id) => getRelicDefinition(id)?.rarity ?? 'C';

/**
 * 房间表头：标题 + 售货机入口（售货机与房间并存、不占房间名额，入口是**本地**动作）。
 * 场景式休息房把机器面板拆开单开（点哪台开哪台），所以表头要能被两个面板各自复用。
 */
export function roomHeader(w, snap, title = null) {
  const meta = ROOM_META[snap.room] ?? { name: snap.room };
  w.push({ kind: 'title', text: title ?? meta.name, align: 'center' });
  if (snap.shop) {
    w.push({
      kind: 'button', id: 'room:shop', width: 300, size: 'sub',
      label: '售货机',   // 持有金币顶栏常驻可见，不在这里复述
      action: { action: 'openShop', local: true },
    });
  }
}
