// 战前准备面板（塔楼层）：层数 / 敌人预告 / 遗物装卸（图标 + 拖拽 + 容量条）/ 进入战斗。
import { RelicLoadoutObject, relicLoadoutSpec } from '../objects/RelicLoadoutObject.js';

/** 战前准备（塔楼层）：层数 / 敌人预告 / 遗物装卸（2026-09-24 交互升级）/ 进入战斗。 */
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
  w.push({ kind: 'text', text: `层数 ${snap.floor} / ${snap.totalFloors}` });
  w.push({
    kind: 'text',
    text: snap.atBossFloor ? `本层即 Boss！` : `距 Boss 层 ${snap.toBoss} 层`,
    tint: snap.atBossFloor ? '#ff7875' : undefined,
  });

  w.push({ kind: 'gap' });
  w.push({ kind: 'sub', text: '下层敌人预告', tint: '#8a93b2' });
  if (!snap.encounter?.length) w.push({ kind: 'text', text: '（无）', tint: '#77809a' });
  for (const e of snap.encounter ?? []) {
    w.push({ kind: 'text', text: e.name, tint: '#f08080' });
  }

  // —— 遗物装卸区（custom widget）：图标 + hover 详情 + 拖拽装卸 + 槽容量 point bar ——
  // 意图仍走 equip/unequip/useRelic（与旧按钮同一条链）；「槽位 N/M」并入容量条读数。
  w.push({ kind: 'gap' });
  w.push({ kind: 'sub', text: '遗物', tint: '#8a93b2' });
  w.push({
    kind: 'custom',
    height: relicLoadoutSpec(snap.relics, snap.relicSlots).height,
    build: (panel) => new RelicLoadoutObject({
      relics: snap.relics ?? [],
      slots: snap.relicSlots ?? { used: 0, total: 0 },
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
