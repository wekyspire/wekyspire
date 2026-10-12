// 战前准备面板（塔楼层）：删卡机会 / 背囊遗物栏（点击或拖装）/ 进入战斗。
// 层数与敌人预告不在面板内——层数在塔身层数牌与右缘刻度尺，敌人预告在左半屏大立牌
// （EnemyPreviewObject）；槽容量读数在顶部资源行旁的槽位条（RelicSlotMeterObject）。
import { RelicLoadoutObject, relicLoadoutSpec } from '../objects/RelicLoadoutObject.js';

/** 战前准备（塔楼层）。 */
export function buildPrepPanel(snap) {
  const w = [];
  w.push({ kind: 'title', text: snap.title ?? '战前准备' });
  // 未用掉的删卡机会（Boss 奖励）也可以在塔楼层用掉
  if (snap.cardRemoval) {
    w.push({
      kind: 'button', id: 'prep:removeCard', width: 360, size: 'sub',
      label: `使用删卡机会（剩 ${snap.cardRemoval.count} 次）`,
      action: { action: 'openUpgradePicker', source: 'bossRemove', local: true },
    });
  }

  // —— 背囊遗物栏（custom widget）：点击装备 / 拖到顶栏装备；顶栏点击卸下 ——
  w.push({
    kind: 'custom',
    height: relicLoadoutSpec(snap.relics, snap.relicSlots).height,
    build: (panel) => new RelicLoadoutObject({
      relics: snap.relics ?? [],
      fireIntent: (a) => panel.fireIntent(a),
      bakeText: panel._bakeText ?? null,
    }),
  });

  w.push({ kind: 'gap' });
  w.push({
    kind: 'button', id: 'prep:start', label: '进入战斗', size: 'main',
    enabled: snap.canStartBattle !== false, action: { action: 'startBattle' },
  });
  return w;
}
