// 老虎机 / 银行机面板：转轮本体、恶魔 roll 词条、银行存取与超额取款。

import { roomHeader, slotPrizeText } from './shared.js';

/** 老虎机本体的 widget（无表头、无离开——场景式房间点机器单开，占位房间由 buildRoomPanel 组装）。 */
export function slotWidgets(w, snap, { sceneChoice = false } = {}) {
  // 恶魔 roll 进行中：机器已切恶魔形态、拉杆锁定（core 同款守卫）——面板只讲这一件事
  if (snap.bank?.pendingRoll) { demonRollWidgets(w, snap.bank.pendingRoll, sceneChoice); return; }
  const s = snap.slot ?? {};

  // 场景路径（2026-09-28 用户定）：领奖/选奖/放弃全部走获得演出与全屏 overlay，
  // 指引信息机器身上的计数器已经讲了——面板只留拉杆一枚按钮（价格在按钮上，免费显示免费）。
  if (sceneChoice) {
    w.push({
      kind: 'button', id: 'slot:spin', width: 260, size: 'main',
      label: s.spinning ? '转动中…'
        : (s.freeRolls > 0 ? `拉杆！（免费${s.freeRolls > 1 ? ` ×${s.freeRolls}` : ''}）` : `拉杆！（${s.cost} 金）`),
      enabled: !!s.canSpin && !s.spinning,
      action: { action: 'spin' },
    });
    return w;
  }

  // ---- 以下为非场景兜底路径（占位房间/降级：没有 3D 机器与 overlay 挂点，按钮必须留全）----
  const pct = (v) => `${Math.round((v ?? 0) * 100)}%`;
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

  // 吞噬：累积满 7 次 roll 才可粉碎一件遗物/卡换金币（兜底路径保留按钮入口；
  // 场景路径的入口 = 机器投料口热区 + 首满教学对话框，不进面板）。
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
 * 悬停转轮出 tooltip。场景路径面板一个字的指引都不留（2026-09-28 用户定：文本膨胀
 * 全删，规则由首遇/例行对话讲——runController.maybeNarrateDemonRoll）。
 * 无场景的占位路径（gallery/headless 降级）没有转盘可点，才需要这里的按钮兜底，
 * 否则那条路会卡死。
 */
export function demonRollWidgets(w, pr, sceneChoice) {
  if (sceneChoice) return true;
  w.push({ kind: 'gap' });
  w.push({ kind: 'title', text: '😈 恶魔 roll', align: 'center' });
  w.push({
    kind: 'sub', align: 'center', tint: '#cfe0f5',
    text: `超额取款已入账 ${pr.gold} 金——选一个词条承受：`,
  });
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
    text: `每 ${bk.ratePer} 金币生产 ${bk.rateYield} 金币！（连续${bk.combo}层未存取款）`,
  });
  if (bk.deposit > 0) {
    w.push({ kind: 'sub', align: 'center', tint: '#77809a', text: `再攒一层可多拿 +${bk.nextInterest} 金币` });
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
          label: `${label}（${n} 金币）`,
          action: { action: 'bankDeposit', amount: n },
        });
      }
    }
    if (bk.deposit > 0) {
      w.push({
        kind: 'button', id: 'bank:withdraw', width: 340, size: 'sub',
        label: `全部提现！`,
        action: { action: 'bankWithdraw' },
      });
    }
    if (bk.canOverdraft) {
      w.push({ kind: 'sub', align: 'center', tint: '#ff8a80', text: '承受诅咒并获取更多金钱！' });
      for (const t of bk.tiers) {
        w.push({
          kind: 'button', id: `bank:overdraft:${t.id}`, width: 240, size: 'sub',
          label: `${t.gold} 金币`,
          action: { action: 'bankOverdraft', tier: t.id },
        });
      }
    } else if (bk.lockout > 0) {
      // 此时暂时无法继续超额取款
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
