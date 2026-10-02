// 营地 · 训练场（合并房与旧单房占位路径）面板：营地半场 + 训练半场。
// 训练改版：训练 = 必做阶段且先于篝火。训练节拍 =
// 开始（升阶，达标当场进阶）→ 可选段（4 选 1 抓一张 → 抓了欠一次升级）→ 篝火解锁。

import { pushCampGroup, roomHeader } from './shared.js';

/**
 * 训练部分（营地·训练场合并房的训练半场）：
 * 开始训练（必做）→ 抓牌四选一（可选，抓了欠升级尾款）→ 尾款（升 2 张 C→B / 升 1 张 B→A）。
 * 交互迁移：抓牌与升级全部走全屏 overlay（自动唤起），面板只剩入口与状态——
 * 「挑选/升级」类按钮只保留**重入保险**（overlay 被返回/异常关掉时再开一次），正常流程
 * 玩家一个也不用点。
 */
export function trainingWidgets(w, snap) {
  const t = snap.training ?? {};
  if (!t.started) {
    w.push({ kind: 'button', id: 'train:begin', width: 260, size: 'main', label: '开始训练', action: { action: 'trainingBegin' } });
  } else if (t.pendingUpgrade) {
    // 尾款未清：正常流程在抓牌落地那拍自动弹「模式二选一 → 全屏选卡」；这里只留重入
    w.push({ kind: 'sub', align: 'center', tint: '#e8c85a', text: '还欠一次升级' });
    w.push({ kind: 'button', id: 'train:resume', width: 260, size: 'main', label: '继续修行…', action: { action: 'trainingUpgradeResume' } });
  } else if (t.choices?.length) {
    // 抓牌候选已掷出（正常自动开全屏四选一）：重开入口兜底
    w.push({ kind: 'button', id: 'train:pickDraw', width: 260, size: 'main', label: '挑选抓牌候选…', action: { action: 'trainingDrawPick' } });
  } else if (!t.optionalDone) {
    // 可选段入口：按钮只写动作，代价与收益走下方说明小字（用户定两层结构）
    w.push({ kind: 'button', id: 'train:roll', width: 260, size: 'main', label: '继续训练', action: { action: 'trainingDrawRoll' } });
    w.push({ kind: 'sub', align: 'center', tint: '#77809a', text: '获得一张新卡牌，并升级现有卡牌' });
  } else {
    w.push({ kind: 'sub', align: 'center', tint: '#6f7a92', text: '训练完成' });
  }
}

/** 营地部分（休整 / 找回瑞米 / 免费升级一张）：占位房间与场景式房间共用。 */
export function campWidgets(w, snap) {
  const c = snap.camp ?? { options: [] };
  if (c.locked) {
    w.push({ kind: 'sub', align: 'center', tint: '#6f7a92', text: '训练之后，再来火边歇息吧！' });
    return;
  }
  // w.push({ kind: 'sub', align: 'center', tint: c.used ? '#6f7a92' : '#9aa3b8', text: '营地' });
  // if (c.used) w.push({ kind: 'sub', align: 'center', tint: '#6f7a92', text: '本房营地动作已用过' });
  /*else */
  
  if(!c.used) pushCampGroup(w, c);
}

/**
 * **场景式房间：点篝火开的面板**——只有营地部分。
 * 与训练桩的面板（buildTrainingPartPanel）**必须区分开**：两件交互物各管半边，
 * 点哪件处理哪半边（早期版本两件都开合并面板 = 交互物形同虚设，用户报"点了没区别"）。
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
 * **营地 · 训练场合并房面板**。
 *
 * 场景式房间里**点篝火（或训练桩）开这一份**：营地选项与训练选项一起给——两个部分同处一室，
 * 玩家点任何一个交互物都该看到全部可做的事，不用来回点两件东西。
 * 例外：训练的必做抉择还挂着时（四选一候选 / 尾款升级）**只显示训练部分**——那是必须
 * 做完的抉择，把营地组也铺上去会把下沿停靠面板顶到屏幕上缘、盖住房间。
 */
export function buildCampTrainingPanel(snap) {
  const w = [];
  const t = snap.training ?? {};
  roomHeader(w, snap, '🔥 营地与 ⚔ 训练场');
  if (t.pendingUpgrade || t.choices?.length) { trainingWidgets(w, snap); return w; }
  campWidgets(w, snap);
  w.push({ kind: 'gap' });
  w.push({ kind: 'sub', align: 'center', tint: t.started ? '#6f7a92' : '#9aa3b8', text: '⚔ 训练' });
  trainingWidgets(w, snap);
  return w;
}
