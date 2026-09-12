// 营地 · 训练场（合并房与旧单房占位路径）面板：营地半场 + 训练半场。

import { withLabels, upgradeButton, pushCampGroup, roomHeader } from './shared.js';

/**
 * 训练部分（营地·训练场合并房的训练半场）：免费升级 → 强绑择一张加入牌组 / 退化抓牌 / 跳过。
 * 占位房间与**场景式房间**（RoomStage 点训练桩开的那份）共用同一份。
 */
export function trainingWidgets(w, snap) {
  const t = snap.training ?? {};
  if (t.choices?.length) {
    w.push({
      kind: 'sub', align: 'center', tint: '#9aa3b8',
      text: t.forced ? '升级完成！必须择一张加入牌组：' : '择一张加入牌组：',
    });
    w.push({
      kind: 'cards', idPrefix: 'train', cols: 3, scale: 0.8,
      items: t.choicesCards.map(x => ({
        defId: x.defId, view: withLabels(x.view),
        // grantCard：得卡标记——舞台据此先播「择卡得卡」演出再上行意图
        action: { action: 'trainingDraw', defId: x.defId, grantCard: true },
      })),
    });
  } else if (!t.done && t.mode === 'upgrade') {
    w.push({ kind: 'sub', align: 'center', tint: '#9aa3b8', text: '训练：免费升级一张卡（完成后须再择一张加入牌组）：' });
    w.push(upgradeButton('training'));
    w.push({ kind: 'sub', align: 'center', tint: '#77809a', text: '（不想训练就直接点「继续前进」离开）' });
  } else if (!t.done) {
    w.push({ kind: 'sub', align: 'center', tint: '#9aa3b8', text: '训练：暂无可升级的卡牌，改为抓一张。' });
    w.push({ kind: 'button', id: 'train:roll', width: 240, label: '抓牌', action: { action: 'trainingDrawRoll' } });
    w.push({ kind: 'sub', align: 'center', tint: '#77809a', text: '（不想训练就直接点「继续前进」离开）' });
  } else {
    w.push({ kind: 'sub', align: 'center', tint: '#6f7a92', text: '训练部分：本房已完成' });
  }
}

/** 营地部分（休整 / 找回瑞米 / 免费升级一张）：占位房间与场景式房间共用。 */
export function campWidgets(w, snap) {
  const c = snap.camp ?? { options: [] };
  w.push({ kind: 'sub', align: 'center', tint: c.used ? '#6f7a92' : '#9aa3b8', text: '营地部分（本房一次）：' });
  if (c.used) w.push({ kind: 'sub', align: 'center', tint: '#6f7a92', text: '本房营地动作已用过' });
  else pushCampGroup(w, c);
}

/**
 * **场景式房间：点篝火开的面板**（用户定 2026-09-12）——只有营地部分。
 * 与训练桩的面板（buildTrainingPartPanel）**必须区分开**：两件交互物各管半边，
 * 点哪件处理哪半边（早期两件都开合并面板 = 交互物形同虚设，用户报"点了没区别"）。
 */
export function buildCampPartPanel(snap) {
  const w = [];
  campWidgets(w, snap);
  return w;
}

/** **场景式房间：点训练桩开的面板**——只有训练部分。 */
export function buildTrainingPartPanel(snap) {
  const w = [];
  trainingWidgets(w, snap);
  return w;
}

/**
 * **营地 · 训练场合并房面板**（用户定 2026-09-12）。
 *
 * 场景式房间里**点篝火（或训练桩）开这一份**：营地选项与训练选项一起给——两个部分同处一室，
 * 玩家点任何一个交互物都该看到全部可做的事，不用来回点两件东西。
 * 例外：训练的三选一还挂着时（升级后的强绑尾款）**只显示训练部分**——那是必须做完的抉择，
 * 把营地组也铺上去会把下沿停靠面板顶到屏幕上缘、盖住房间。
 */
export function buildCampTrainingPanel(snap) {
  const w = [];
  const t = snap.training ?? {};
  roomHeader(w, snap, '🔥 营地 · ⚔ 训练场');
  if (t.choices?.length && t.forced) { trainingWidgets(w, snap); return w; }
  campWidgets(w, snap);
  w.push({ kind: 'gap' });
  w.push({ kind: 'sub', align: 'center', tint: t.done ? '#6f7a92' : '#9aa3b8', text: '⚔ 训练部分（本房一次）：' });
  trainingWidgets(w, snap);
  return w;
}
