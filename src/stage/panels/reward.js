// 战后奖励面板（模态）：金币入账 + 卡包选择 + 包内三选一（或跳过）。

import { withLabels } from './shared.js';

/**
 * 战后奖励（模态）：金币入账 + 卡包选择 + 包内三选一（或跳过）。
 * 卡包未选时给瓦片；已开包（含单包自动开）给卡面三选一。
 */
export function buildRewardPanel(snap) {
  const removal = snap.cardRemoval;
  const w = [];
  w.push({ kind: 'title', text: snap.title ?? '战后奖励', align: 'center' });
  w.push({ kind: 'text', text: `金币 +${snap.money}`, tint: '#ffd75e', align: 'center' });
  w.push({ kind: 'gap' });

  // Boss 通关奖励：删卡机会（§2.1）——与古尔帕斯的删卡服务同一套选卡界面
  if (removal) {
    w.push({
      kind: 'button', id: 'reward:removeCard', width: 360, size: 'sub',
      label: `使用删卡机会（剩 ${removal.count} 次）`,
      action: { action: 'openUpgradePicker', source: 'bossRemove', local: true },
    });
    w.push({ kind: 'gap' });
  }

  if (!snap.packId) {
    w.push({ kind: 'sub', text: '选择一个卡包（按该体系灵脉等级出卡）：', tint: '#9aa3b8', align: 'center' });
    w.push({
      kind: 'tiles', idPrefix: 'pack', tileHeight: 96,
      items: (snap.packs ?? []).map(p => ({
        id: p.id, name: p.name, desc: p.desc,
        action: { action: 'chooseRewardPack', packId: p.id },
      })),
    });
    return w;
  }

  w.push({
    kind: 'sub',
    text: `${snap.packName ?? ''} · 择一张技能卡加入牌组`,
    tint: '#9aa3b8', align: 'center',
  });
  w.push({
    kind: 'cards', idPrefix: 'reward',
    items: (snap.skillChoices ?? []).map(c => ({
      defId: c.defId, view: withLabels(c.view),
      // grantCard：得卡标记——舞台据此先播「择卡得卡」演出（脉冲→飞入牌库）再上行意图
      action: { action: 'claimReward', defId: c.defId, grantCard: true },
    })),
  });
  w.push({ kind: 'gap' });
  w.push({
    kind: 'button', id: 'reward:skip', label: '跳过奖励', width: 220,
    action: { action: 'claimReward', defId: null },
  });
  return w;
}
