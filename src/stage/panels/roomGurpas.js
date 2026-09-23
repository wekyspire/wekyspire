// 古尔帕斯之店（35 层）面板：货架购买、A/S 遗物收购、买到即开的卡包三选一。

import { withLabels } from './shared.js';

/**
 * 古尔帕斯之店（35 层）的库存 widget（无表头——表头由 buildRoomPanel 的 roomHeader 统一给）。
 * 买到即开的卡包三选一优先占屏；其余为货架按钮 + 收购区 + 离开。
 */
export function gurpasWidgets(w, snap) {
  const g = snap.gurpas ?? { items: [], sellable: [] };
  w.push({ kind: 'sub', align: 'center', tint: '#9aa3b8', text: `持有 ${g.money} 金币 ｜ 她只收 A/S 级遗物` });
  // 买到即开的卡包：优先占屏（三选一）
  if (g.pendingPackCards?.length) {
    w.push({ kind: 'sub', align: 'center', tint: '#cfe0f5', text: `卡包 ${g.pendingPack.packId === 'gurpasA' ? '（全 A 级）' : '（全 B 级）'}：择一张加入牌组` });
    w.push({
      kind: 'cards', idPrefix: 'gurpasPack', cols: 3, scale: 0.8,
      items: g.pendingPackCards.map(c => ({
        defId: c.defId, view: withLabels(c.view),
        // grantCard：得卡标记——舞台据此先播「择卡得卡」演出再上行意图
        action: { action: 'gurpasTake', defId: c.defId, grantCard: true },
      })),
    });
    return w;
  }
  g.items.forEach((it, i) => {
    const sold = it.sold ? '（已售出）' : '';
    const used = it.kind === 'remove' ? `（已用 ${it.used ?? 0}/${2}）` : '';
    w.push({
      kind: 'button', id: `gurpas:buy:${i}`, width: 460, size: 'sub',
      label: `${it.label} — ${it.price} 金${sold}${used}`,
      enabled: !it.sold && (it.kind !== 'remove' || (it.used ?? 0) < 2) && g.money >= it.price,
      action: { action: 'gurpasBuy', index: i },
    });
    if (it.sub) w.push({ kind: 'sub', align: 'center', tint: '#77809a', text: `　${it.sub}` });
  });
  w.push({ kind: 'gap' });
  if (g.sellable?.length) {
    w.push({ kind: 'sub', align: 'center', tint: '#a8c6a0', text: '收购（A/S 级）：' });
    for (const s of g.sellable) {
      w.push({
        kind: 'button', id: `gurpas:sell:${s.relicId}`, width: 400, size: 'sub',
        label: `卖出 ${s.name}（${s.rarity}）→ +${s.price} 金`,
        action: { action: 'gurpasSell', relicId: s.relicId },
      });
    }
  } else {
    w.push({ kind: 'sub', align: 'center', tint: '#77809a', text: '（你身上没有她收的 A/S 级遗物）' });
  }
  w.push({ kind: 'button', id: 'room:leave', label: '离开', width: 240, size: 'sub', action: { action: 'leaveRoom' } });
  return w;
}
