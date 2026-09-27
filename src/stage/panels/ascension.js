// 进阶事件面板（模态）：四维度突破 + 跳过（2026-09-22 种子包删除后只剩这一条路径）。

import { DIM_META } from './shared.js';

/**
 * 进阶事件（模态）：选一条主维度突破，或跳过（体修等阶 +1）。
 * 首次 0→1 的获赠宣告在进阶幕间结果页（runCutsceneFlows.ascensionResultPage）。
 */
export function buildAscensionPanel(snap) {
  const w = [];
  w.push({ kind: 'title', text: snap.title ?? '进阶事件', align: 'center' });
  w.push({ kind: 'sub', text: '灵力涌动——择一条主维度突破：', tint: '#9aa3b8', align: 'center' });
  w.push({
    kind: 'tiles', idPrefix: 'dim', tileHeight: 104, gapY: 14,
    items: (snap.dims ?? []).map((d) => {
      const meta = DIM_META[d.id] ?? { label: d.id, glyph: '?', color: '#8a93b2' };
      return {
        id: d.id, name: `${meta.glyph} ${meta.label}`, desc: `等级 ${d.level}`,
        action: { action: 'chooseAscensionDimension', dimension: d.id },
      };
    }),
  });
  w.push({ kind: 'gap' });
  w.push({
    kind: 'button', id: 'asc:skip', label: '跳过（体修等级 +1，生命上限 +3）', width: 300,
    action: { action: 'skipAscension' },
  });
  w.push({ kind: 'gap' });
  w.push({
    kind: 'sub', align: 'center', tint: '#77809a',
    text: `总进阶 ${snap.ascensionCount}/${snap.maxAscensions}`
      + ` ｜ 突破后恢复 ${snap.healAmount} 点生命、魏启上限 +${snap.manaGain}`,
  });
  return w;
}
