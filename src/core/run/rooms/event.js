// 事件房（RUN_DESIGN §4）：占位脚本事件 2 个；正式事件剧本系统（含删卡事件、
// S 级卡投放、剧情注入接缝）见 §9 留坑，后续整体替换本文件。

export const EVENT_SCRIPTS = [
  {
    id: 'moneyBag',
    name: '钱袋',
    act(run) {
      run.player.money += 15;
      return { eventId: 'moneyBag', money: 15 };
    },
  },
  {
    id: 'spring',
    name: '治愈泉',
    act(run) {
      const heal = Math.ceil(run.player.maxHp * 0.25);
      run.player.hp = Math.min(run.player.maxHp, run.player.hp + heal);
      return { eventId: 'spring', heal };
    },
  },
];

// 按 run rng 确定性挑一个事件并执行（占位：无分支选项，直接结算）
export function playEvent(run) {
  if (run.currentRoom !== 'event') throw new Error('当前不在事件房');
  const script = EVENT_SCRIPTS[Math.floor(run.rng.next() * EVENT_SCRIPTS.length)];
  return script.act(run);
}
