// 老虎机 / 银行机面板：转轮本体、恶魔 roll 词条、银行存取与超额取款。

import { withLabels, roomHeader, slotPrizeText, getRelicRarity } from './shared.js';

/** 老虎机本体的 widget（无表头、无离开——场景式房间点机器单开，占位房间由 buildRoomPanel 组装）。 */
export function slotWidgets(w, snap, { sceneChoice = false } = {}) {
  // 恶魔 roll 进行中：机器已切恶魔形态、拉杆锁定（core 同款守卫）——面板只讲这一件事
  if (snap.bank?.pendingRoll) { demonRollWidgets(w, snap.bank.pendingRoll, sceneChoice); return; }
  const s = snap.slot ?? {};
  const pct = (v) => `${Math.round((v ?? 0) * 100)}%`;
  w.push({
    kind: 'sub', align: 'center', tint: '#9aa3b8',
    text: `单抽 ${s.cost} 金 ｜ 持有 ${s.money}`
      + (s.freeRolls ? ` ｜ 免费 ${s.freeRolls} 次` : '')
      + ` ｜ 已抽 ${s.rolls ?? 0}`,
  });
  w.push({
    kind: 'sub', align: 'center', tint: '#77809a',
    text: `小奖 ${pct(s.minorChance)}（未中累加）｜ 大奖 ${pct(s.majorChance)}（未中累加）`,
  });

  // 产出：不能连抽，先处理这一件（文档：产出总是可以放弃不要的）
  const pd = s.pending;
  if (pd) {
    w.push({ kind: 'gap' });
    w.push({ kind: 'text', align: 'center', tint: pd.tier === 'major' ? '#e8eefb' : '#c3cee0',
      text: (pd.tier === 'major' ? '★ 大奖：' : '') + slotPrizeText(pd) });
    if (pd.relicChoices?.length) {
      for (const r of pd.relicChoices) {
        w.push({
          kind: 'button', id: `slot:relic:${r.id}`, width: 320, size: 'sub',
          label: `${r.name}（${getRelicRarity(r.id)}）`,
          action: { action: 'slotTake', choice: r.id },
        });
      }
    } else if (pd.choices?.length) {
      // 卡多选一（3 或 6 张）：一整行卡面，点哪张领哪张
      w.push({
        kind: 'cards', idPrefix: 'slotPrize', cols: Math.min(6, pd.choices.length),
        scale: pd.choices.length > 3 ? 0.52 : 0.72,
        items: pd.choices.map(c => ({
          defId: c.defId, view: withLabels(c.view),
          // grantCard：得卡标记——舞台据此先播「择卡得卡」演出再上行意图
          action: { action: 'slotTake', choice: c.defId, grantCard: true },
        })),
      });
    } else if (pd.upgrade?.kind === 'free') {
      w.push({
        kind: 'button', id: 'slot:pickUpgrade', width: 300, size: 'sub',
        label: '选择要免费升级的卡',
        action: { action: 'openUpgradePicker', source: 'slot', local: true },
      });
    }
    // 需要"选一个"的产出不给领取键（点候选即领取）；**其余产出也不给"领取"键**——
    // 中奖即自动唤起获得演出（用户定 2026-09-12：领取必须是获得演出，不是操纵条里一个
    // 干巴巴的按钮）。这里只留「放弃」兜底（演出被跳过/已关闭时仍能处理掉这份产出）。
    w.push({
      kind: 'button', id: 'slot:decline', width: 220, size: 'sub',
      label: (pd.choices?.length ?? 0) > 0 || (pd.relicChoices?.length ?? 0) > 0 ? '全部放弃' : '放弃',
      action: { action: 'slotDecline' },
    });
    return w;
  }

  if (s.needsCardPick) {
    w.push({ kind: 'gap' });
    w.push({ kind: 'text', align: 'center', tint: '#e8eefb', text: '免费指定升级：请选择一张卡' });
    w.push({
      kind: 'button', id: 'slot:pickUpgrade', width: 300, size: 'sub',
      label: '选择要免费升级的卡',
      action: { action: 'openUpgradePicker', source: 'slot', local: true },
    });
    return w;
  }

  if (s.spinning) {
    w.push({ kind: 'sub', align: 'center', tint: '#77809a', text: '🎰 …' });
  } else if (s.lastSpin) {
    w.push({ kind: 'text', align: 'center', tint: '#e8eefb', text: slotPrizeText(s.lastSpin) });
  }
  w.push({
    kind: 'button', id: 'slot:spin', width: 260, size: 'main',
    label: s.spinning ? '转动中…' : `拉杆！（${s.cost} 金）`,
    enabled: !!s.canSpin && !s.spinning,
    action: { action: 'spin' },
  });

  // 吞噬：累积满 7 次 roll 才可粉碎一件遗物/卡换金币。
  // **入口是一个按钮**（不再把候选平铺成按钮墙）：点它 → dialogue 层问「粉碎什么？」
  // → 全屏选卡/选遗物界面。编排在 runController（Stage 只上报"入口被点了"）。
  const dv = s.devour ?? {};
  w.push({ kind: 'gap' });
  w.push({
    kind: 'sub', align: 'center', tint: dv.ready ? '#a8c6a0' : '#77809a',
    text: dv.ready
      ? '老虎机张开了嘴——可以粉碎一件遗物或一张卡换金币：'
      : `吞噬进度 ${dv.progress ?? 0}/${dv.every ?? 7}（每拉一次杆累积 1）`,
  });
  if (dv.ready) {
    w.push({
      kind: 'button', id: 'slot:crush', width: 340, size: 'sub',
      label: '粉碎物品…', action: { action: 'requestDevour' },
    });
  }
  // 离房安慰奖（拉了 ≥2 次杆一次没中）**完全不进 UI**（用户定 2026-09-13）：它既不是进度
  // 也不是可领取项——玩家点「继续前进」离房时，机器自己凑上来吐可乐/鸡腿让你二选一
  // （场景演出见 RoomStage._playGift），领完自动续上离房切幕。面板里既不提示也不给按钮，
  // 免得把"离房"这件事拆成"先在面板里领东西、再点一次继续"两步。
}

/**
 * 恶魔 roll 进行中（机器已切恶魔形态）：**词条在场景里选**（老虎机上那三张卡片），
 * 面板只给状态与三条效果文本（对着卡片读）。
 * @param sceneChoice true = 场景里选（不给按钮，只有可读行）；false = 无场景的占位路径（给按钮）
 */
export function demonRollWidgets(w, pr, sceneChoice) {
  w.push({ kind: 'gap' });
  w.push({ kind: 'title', text: '😈 恶魔 roll', align: 'center' });
  w.push({
    kind: 'sub', align: 'center', tint: '#cfe0f5',
    text: `超额取款已入账 ${pr.gold} 金——`
      + (sceneChoice ? '在轮盘上选一个词条承受（悬停看效果）' : '选一个词条承受：'),
  });
  // 场景路径**不再列词条**（用户定 2026-09-13）：那三个词条就是转盘停下来的三面，悬停转轮
  // 出 tooltip，操纵条里再抄一遍纯属重复。无场景的占位路径（gallery/headless 降级）没有转盘
  // 可点，才需要这里的按钮兜底，否则那条路会卡死。
  if (sceneChoice) return true;
  for (const o of pr.options) {
    w.push({
      kind: 'button', id: `bank:pick:${o.id}`, width: 440, size: 'sub',
      label: `${o.name}：${o.desc}`,
      action: { action: 'bankPick', id: o.id },
    });
  }
  return true;
}

/** 银行机的 widget（同上）。 */
export function bankWidgets(w, snap, { sceneChoice = false } = {}) {
  const bk = snap.bank;
  if (!bk) return;
  w.push({ kind: 'gap' });
  w.push({ kind: 'sub', align: 'center', tint: '#9ccfff', text: '🏦 银行机' });
  w.push({
    kind: 'sub', align: 'center', tint: '#9aa3b8',
    text: `存款 ${bk.deposit} 金 ｜ 连击 ${bk.combo} ｜ 每层利率 每 ${bk.ratePer} 金产 ${bk.rateYield} 金`,
  });
  if (bk.deposit > 0) {
    w.push({ kind: 'sub', align: 'center', tint: '#77809a', text: `再攒一层可多拿 +${bk.nextInterest} 金` });
  }
  if (bk.pendingDebuffs?.length) {
    w.push({
      kind: 'sub', align: 'center', tint: '#ff8a80',
      text: '身负恶魔词条：' + bk.pendingDebuffs.map(d => `${d.name}(剩${d.battlesLeft}场)`).join('、'),
    });
  }
  if (bk.pendingRoll) {
    demonRollWidgets(w, bk.pendingRoll, sceneChoice);
  } else {
    if (bk.money > 0) {
      w.push({
        kind: 'button', id: 'bank:deposit', width: 300, size: 'sub',
        label: `存入全部（${bk.money} 金）`,
        action: { action: 'bankDeposit' },
      });
    }
    if (bk.deposit > 0) {
      w.push({
        kind: 'button', id: 'bank:withdraw', width: 340, size: 'sub',
        label: `取款（${bk.deposit} 金，会打断连击）`,
        action: { action: 'bankWithdraw' },
      });
    }
    if (bk.canOverdraft) {
      w.push({ kind: 'sub', align: 'center', tint: '#ff8a80', text: '超额取款（立刻拿钱，代价是恶魔词条）：' });
      for (const t of bk.tiers) {
        w.push({
          kind: 'button', id: `bank:overdraft:${t.id}`, width: 240, size: 'sub',
          label: `${t.name} +${t.gold} 金`,
          action: { action: 'bankOverdraft', tier: t.id },
        });
      }
    } else if (bk.lockout > 0) {
      w.push({
        kind: 'sub', align: 'center', tint: '#77809a',
        text: `银行机暂时不让你超额取款（再过 ${bk.lockout} 次见面）`,
      });
    }
  }
  for (const offer of bk.offers ?? []) {
    w.push(offer === 'upgrade'
      ? {
        kind: 'button', id: 'bank:offerUpgrade', width: 320, size: 'sub',
        label: '立即免费升级一张卡',
        action: { action: 'openUpgradePicker', source: 'bankUpgrade', local: true },
      }
      : {
        kind: 'button', id: 'bank:offerBurn', width: 320, size: 'sub',
        label: '自选焚毁一张卡',
        action: { action: 'openUpgradePicker', source: 'bankBurn', local: true },
      });
  }
}

/** **老虎机面板**（场景式休息房：点机身 → 开这一份）。 */
export function buildSlotPanel(snap, opts = {}) {
  const w = [];
  roomHeader(w, snap, '🎰 老虎机');
  slotWidgets(w, snap, opts);
  return w;
}

/** **银行机面板**（场景式休息房：点银行机 → 开这一份）。 */
export function buildBankPanel(snap, opts = {}) {
  const w = [];
  roomHeader(w, snap, '🏦 银行机');
  bankWidgets(w, snap, opts);
  return w;
}
