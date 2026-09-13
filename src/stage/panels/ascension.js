// 进阶事件面板（模态）：常规 = 四维度突破；种子包 = 九选三 + 刷新。

import { withLabels, DIM_META } from './shared.js';

/**
 * 进阶事件（模态）：常规 = 四维度突破；种子包 = 九选三 + 刷新。
 * 勾选缓冲由舞台以 `{ selected }` 注入（纯 UI 交互态，确认时才作为 intent 载荷上报）；
 * 勾选动作标 `local: true`，由舞台自己消化并就地重绘，不惊动 core。
 */
export function buildAscensionPanel(snap, { selected = new Set() } = {}) {
  const w = [];
  const off = snap.offering;

  if (!off) {
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

  const dimMeta = DIM_META[off.dimension] ?? { label: off.dimension };
  w.push({ kind: 'title', text: `种子包 · ${dimMeta.label}`, align: 'center' });
  if (snap.grant) {
    w.push({
      kind: 'sub', align: 'center', tint: '#9aa3b8',
      text: `初次点亮——已获赠 ${snap.grant.cardNames.join('、')} 直入牌组`
        + `，并获得体系能力「${snap.grant.abilityName}」`,
    });
  }
  w.push({
    kind: 'sub', align: 'center', tint: '#9aa3b8',
    text: `再从九张基石卡中任选 ${off.picks} 张加入牌组（已选 ${selected.size}/${off.picks}）`,
  });
  w.push({
    kind: 'cards', idPrefix: 'seed', cols: 5, scale: 0.62, gapY: 12,
    items: (off.cards ?? []).map(c => ({
      defId: c.defId, view: withLabels(c.view), active: selected.has(c.defId),
      action: { action: 'toggleSeed', defId: c.defId, local: true },
    })),
  });
  w.push({
    kind: 'button', id: 'seed:confirm', width: 260, size: 'main',
    label: `确认（${selected.size}/${off.picks}）`,
    enabled: selected.size === off.picks,
    action: { action: 'chooseSeedCards', defIds: [...selected] },
  });
  w.push({
    kind: 'button', id: 'seed:reroll', width: 260, size: 'sub',
    label: `刷新九张（剩余 ${off.rerollsLeft} 次）`,
    enabled: off.rerollsLeft > 0,
    action: { action: 'rerollSeedOffering' },
  });
  return w;
}
