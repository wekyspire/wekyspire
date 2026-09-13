// 战前准备面板（塔楼层）：层数 / 敌人预告 / 遗物装卸 / 进入战斗。

/** 战前准备（塔楼层）：层数 / 敌人预告 / 遗物装卸 / 进入战斗。 */
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

  w.push({ kind: 'gap' });
  w.push({
    kind: 'sub',
    // 槽位是权重和口径（Σcost ≤ 上限）：显示占用量而非件数
    text: `遗物（槽位 ${snap.relicSlots.used}/${snap.relicSlots.total}）`,
    tint: '#8a93b2',
  });
  if (!snap.relics?.length) w.push({ kind: 'text', text: '（无）', tint: '#77809a' });
  const slotRelics = (snap.relics ?? []).filter(r => !r.nonSlot);
  const nonSlotRelics = (snap.relics ?? []).filter(r => r.nonSlot);
  for (const r of slotRelics) {
    const tag = r.rarity ? `${r.rarity}·${r.cost}槽` : `${r.cost}槽`;
    const suffix = r.equipped ? '（已装备）' : '';
    w.push({
      kind: 'text', text: `[${tag}] ${r.name}${suffix}`, tint: r.equipped ? '#cfe0f5' : undefined,
      token: { type: 'relic', payload: { relicId: r.id } }, // hover 出效果预览
    });
    if (r.equipped) {
      w.push({ kind: 'button', id: `relic:unequip:${r.id}`, label: '卸下', action: { action: 'unequip', relicId: r.id } });
      if (r.canUse) {
        const uses = r.usesLeft != null ? `（余 ${r.usesLeft}）` : '';
        w.push({ kind: 'button', id: `relic:use:${r.id}`, label: `使用${uses}`, action: { action: 'useRelic', relicId: r.id } });
      }
    } else {
      w.push({
        kind: 'button', id: `relic:equip:${r.id}`,
        label: r.canEquip ? '装备' : '装备（槽位不足）',
        enabled: r.canEquip, // 可用性由 core 判定，Stage 只画
        action: { action: 'equip', relicId: r.id },
      });
    }
  }
  if (nonSlotRelics.length) {
    w.push({ kind: 'gap' });
    w.push({ kind: 'sub', text: '非槽位式（恒生效，不占槽）', tint: '#8a93b2' });
    for (const r of nonSlotRelics) {
      w.push({
        kind: 'text', text: `[${r.rarity ?? 'C'}] ${r.name}`, tint: '#a8c6a0',
        token: { type: 'relic', payload: { relicId: r.id } },
      });
    }
  }

  w.push({ kind: 'gap' });
  w.push({
    kind: 'button', id: 'prep:start', label: '进入战斗', size: 'main',
    enabled: snap.canStartBattle !== false, action: { action: 'startBattle' },
  });
  return w;
}
