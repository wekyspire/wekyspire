// 房间层面板分发器：按快照的 room 字段组装表头 + 各房型 widget。
// 具体房型内容在 roomCamp / roomSlot / roomGurpas / shop 各自的文件里。

import { roomHeader, ROOM_META } from './shared.js';
import { trainingWidgets, campWidgets } from './roomCamp.js';
import { slotWidgets, bankWidgets } from './roomSlot.js';
import { gurpasWidgets } from './roomGurpas.js';
import { buildShopPanel } from './shop.js';

/** 奖励房（模态）：合并房（营地·训练场）/ 老虎机 / 古尔帕斯之店 / 事件房 / 商店房。 */
export function buildRoomPanel(snap) {
  const w = [];
  roomHeader(w, snap);

  // 合并房（营地 · 训练场）：两个部分各一次；训练抉择中优先占屏，营地组在下方仍然可用
  // 合并房（营地 · 训练场）：两个部分各一次；训练抉择中优先占屏，营地组在下方仍然可用
  if (snap.room === 'campTraining') {
    trainingWidgets(w, snap);
    campWidgets(w, snap);
    // 离房（强绑抓牌未领时不允许——completeRoom 也会拦，这里不给按钮以免误导）
    if (!(snap.training ?? {}).forced) {
      w.push({ kind: 'button', id: 'room:leave', label: '离开', width: 240, size: 'sub', action: { action: 'leaveRoom' } });
    }
    return w;
  }

  if (snap.room === 'slot') {
    roomHeader(w, snap);
    slotWidgets(w, snap);
    bankWidgets(w, snap);
    w.push({ kind: 'button', id: 'slot:leave', label: '离开', width: 220, size: 'sub', action: { action: 'leaveSlot' } });
    return w;
  }

  if (snap.room === 'gurpas') {
    gurpasWidgets(w, snap);
    return w;
  }

  if (snap.room === 'event') {
    // 随机事件已改成**幕间播片**（cutscene 的 CG + 对话 + 选项，用户定 2026-09-12）：
    // 事件房没有场景舞台、也不再走面板交互——进房即自动播（runController.playEventScene）。
    // 这里只留一句话与一个**安全阀**入口（万一没自动播起来，玩家还能手动触发，不会被卡住）。
    w.push({ kind: 'sub', align: 'center', tint: '#9aa3b8', text: ROOM_META.event.hint });
    w.push({
      kind: 'button', id: 'event:play', width: 260, size: 'sub',
      label: '看看发生了什么', action: { action: 'triggerEvent' },
    });
    return w;
  }

  if (snap.room === 'shop') {
    // 商店房：**一整间货房**（用户定 2026-09-12）。场景版（RoomStage）点售货机开货架面板；
    // 这里是无场景的占位路径（headless/降级）——同一份货架内容，末尾给"离开房间"。
    return buildShopPanel(snap, { standalone: true });
  }

  w.push({ kind: 'sub', align: 'center', tint: '#77809a', text: '（此房间暂无面板）' });
  return w;
}
