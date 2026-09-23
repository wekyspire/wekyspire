// 老虎机 / 银行机面板：转轮本体、恶魔 roll 词条、银行存取与超额取款。

import { roomHeader, slotPrizeText } from './shared.js';

/** 老虎机本体的 widget（无表头、无离开——场景式房间点机器单开，占位房间由 buildRoomPanel 组装）。 */
export function slotWidgets(w, snap, { sceneChoice = false } = {}) {
  // 恶魔 roll 进行中：机器已切恶魔形态、拉杆锁定（core 同款守卫）——面板只讲这一件事
  if (snap.bank?.pendingRoll) { demonRollWidgets(w, snap.bank.pendingRoll, sceneChoice); return; }
  const s = snap.slot ?? {};
  const pct = (v) => `${Math.round((v ?? 0) * 100)}%`;
  // 价格只在按钮上带一次（2026-09-22 精简）；「已拉」为全口径（含免费抽，与吞噬进度同口径）
  w.push({
    kind: 'sub', align: 'center', tint: '#9aa3b8',
    text: `持有 ${s.money} 金`
      + (s.freeRolls ? ` ｜ 免费 ${s.freeRolls} 次` : '')
      + ` ｜ 已拉 ${s.pulls ?? s.rolls ?? 0} 次`,
  });
  w.push({
    kind: 'sub', align: 'center', tint: '#77809a',
    text: `小奖 ${pct(s.minorChance)} / 大奖 ${pct(s.majorChance)}（未中累加）`,
  });

  // 产出：不能连抽，先处理这一件（文档：产出总是可以放弃不要的）
  const pd = s.pending;
  if (pd) {
    w.push({ kind: 'gap' });
    w.push({ kind: 'text', align: 'center', tint: pd.tier === 'major' ? '#e8eefb' : '#c3cee0',
      text: (pd.tier === 'major' ? '★ 大奖：' : '') + slotPrizeText(pd) });
    // 多选一奖项（2026-09-22 统一）：候选只出现在**全屏 overlay**（选卡/选遗物界面）——
    // 中奖即自动「获得演出 → dismiss 接候选界面」，这里不再内嵌卡行/遗物按钮墙（旧逻辑已删，
    // 用户报"没统一为获取动画 + 全屏多选"）。只留一个重开入口兜底（界面被异常关闭时）。
    if ((pd.choices?.length ?? 0) > 0 || (pd.relicChoices?.length ?? 0) > 0) {
      w.push({
        kind: 'button', id: 'slot:pickPrize', width: 300, size: 'sub',
        label: '挑选这份产出…',
        action: { action: 'openSlotPrize', local: true },
      });
    } else if (pd.upgrade?.kind === 'free') {
      w.push({
        kind: 'button', id: 'slot:pickUpgrade', width: 300, size: 'sub',
        label: '选择要免费升级的卡',
        action: { action: 'openUpgradePicker', source: 'slot', local: true },
      });
    }
    // 「放弃」兜底：演出/界面的「跳过」「返回」都是放弃，这里给面板侧的第三个出口
    // （headless 之外的降级路径 / 玩家改主意）。
    w.push({
      kind: 'button', id: 'slot:decline', width: 220, size: 'sub',
      label: '放弃',
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
  // 离房安慰奖（同一层拉了 ≥4 次杆一次没中，2026-09-21 D5 收紧）**完全不进 UI**（用户定 2026-09-13）：它既不是进度
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

/** 银行机的 widget（同上）。标题由 roomHeader 出（聚焦面板/合并面板各自带「银行机」小节头）。 */
export function bankWidgets(w, snap, { sceneChoice = false } = {}) {
  const bk = snap.bank;
  if (!bk) return;
  w.push({ kind: 'gap' });
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
      // 存款三档（2026-09-21 用户定：33% / 66% / 全部）——按持有金币取整；钱太少时
      // 低档位取整为 0 的按钮直接隐藏（core.bankDeposit 本就收任意金额，缺省=全部）。
      for (const { key, frac, label } of [
        { key: 33, frac: 0.33, label: '存入 33%' },
        { key: 66, frac: 0.66, label: '存入 66%' },
        { key: 'all', frac: 1, label: '存入全部' },
      ]) {
        const n = Math.floor(bk.money * frac);
        if (n <= 0) continue;
        w.push({
          kind: 'button', id: `bank:deposit:${key}`, width: 300, size: 'sub',
          label: `${label}（${n} 金）`,
          action: { action: 'bankDeposit', amount: n },
        });
      }
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
