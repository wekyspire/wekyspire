// 事件房（RUN_DESIGN §4；用户定 2026-09-12 改版）：**随机事件 = 对话 + 选项 + 逻辑**。
//
// 形态：不再走 UI 面板、也不做 3D 场景——由 Shell 用 cutscene 播放（**幕间 CG + 普通对话**，
// `dialogue` step 的 `bg` 字段即事件背景图，见 `shell/overlay/eventArt.js` 与 CutsceneOverlay）。
// 本文件只管**内容与结算**：页面文本、选项、以及每个选项的 run 级效果。
//
// 契约：
//   { id, name, art, pages:[{speaker,text}], choices(run) -> [{id,label,hint?,disabled?}],
//     resolve(run, choiceId) -> { pages:[…结果页], eventId, ...效果载荷 } }
//   · pages 是"开场白"（探索前的叙述），choices 之后由 Shell 接着播 resolve 的结果页
//   · choices 的 hint 按当前局面动态算（回血量/金币数都写实数），disabled 用于前提不成立
//   · 抽取按 run.rng **确定性**取一个，并记进 `run.roomData.eventId`——同一次遇到不重抽
//     （快照重绘/重进房都拿到同一件事）
//
// 占位说明：两个事件还没有美术 → `art` 只是"取图用的 key"，真素材丢进
// `src/assets/images/events/<key>.webp` 就会自动顶替占位图。

const pct = (run, ratio) => Math.max(1, Math.ceil(run.player.maxHp * ratio));

export const EVENT_SCRIPTS = [
  {
    id: 'moneyBag',
    name: '钱袋',
    art: 'moneyBag',
    pages: [
      { speaker: '旁白', text: '地砖缝里卡着一只鼓鼓的钱袋，绳结松了一半。' },
      { speaker: '旁白', text: '袋子上的纹章被磨掉了——看不出是谁的。' },
    ],
    choices: (run) => [
      { id: 'takeAll', label: '整袋收进腰包', hint: '+15 金' },
      { id: 'search', label: '先在四周翻一翻', hint: '也许还有别人掉的东西……也许惊动点什么' },
      { id: 'leave', label: '原样放回去', hint: '什么都不拿，也什么都不惹' },
    ],
    resolve(run, choiceId) {
      if (choiceId === 'search') {
        // 确定性赌博：run.rng（同种子同结果）
        if (run.rng.next() < 0.5) {
          run.player.money += 10;
          return {
            eventId: 'moneyBag', money: 10,
            pages: [{ speaker: '旁白', text: '（袋口还塞着几枚零钱——今天的手气不错。）' }],
          };
        }
        const lost = Math.min(run.player.hp - 1, 5);
        run.player.hp = Math.max(1, run.player.hp - lost);
        return {
          eventId: 'moneyBag', damage: lost,
          pages: [{ speaker: '旁白', text: `（你碰倒了倚在墙上的铁牌，砸了个正着——损失 ${lost} 点生命。）` }],
        };
      }
      if (choiceId === 'leave') {
        return {
          eventId: 'moneyBag', money: 0,
          pages: [{ speaker: '旁白', text: '（你把它推回原处。塔楼里，没人会为一只钱袋谢你。）' }],
        };
      }
      run.player.money += 15;
      return {
        eventId: 'moneyBag', money: 15,
        pages: [{ speaker: '旁白', text: '（钱袋沉甸甸的，正好合手。）' }],
      };
    },
  },
  {
    id: 'spring',
    name: '治愈泉',
    art: 'spring',
    pages: [
      { speaker: '旁白', text: '墙根涌出一眼清泉，水面浮着细碎的微光。' },
      { speaker: '旁白', text: '泉边刻着半行字：“饮者……”——后半句被人磨平了。' },
    ],
    choices: (run) => [
      { id: 'drink', label: '痛饮一番', hint: `回复 ${pct(run, 0.25)} 点生命` },
      { id: 'wash', label: '只洗把脸，接一壶带在身上', hint: `回复 ${pct(run, 0.08)} 点生命，下一场战斗开局多得 1 点魏启` },
      { id: 'leave', label: '不碰它', hint: '（泉水在身后继续流。）' },
    ],
    resolve(run, choiceId) {
      if (choiceId === 'wash') {
        const heal = Math.min(run.player.maxHp - run.player.hp, pct(run, 0.08));
        run.player.hp += heal;
        run.pendingManaBonus = (run.pendingManaBonus ?? 0) + 1;   // 与可乐同一机制（战斗开局兑现即清）
        return {
          eventId: 'spring', heal, manaBonus: 1,
          pages: [{ speaker: '旁白', text: `（水是凉的。你把壶塞好——下次开打时，它会在你手边。）` }],
        };
      }
      if (choiceId === 'leave') {
        return {
          eventId: 'spring', heal: 0,
          pages: [{ speaker: '旁白', text: '（你绕开了它。水声在背后慢慢远去。）' }],
        };
      }
      const heal = Math.min(run.player.maxHp - run.player.hp, pct(run, 0.25));
      run.player.hp += heal;
      return {
        eventId: 'spring', heal,
        pages: [{ speaker: '旁白', text: heal > 0 ? `（伤口收了口，呼吸顺了——回复 ${heal} 点生命。）` : '（你已经不需要它了。）' }],
      };
    },
  },
];

const findScript = (id) => EVENT_SCRIPTS.find(s => s.id === id) ?? null;

/**
 * 抽到的事件（确定性 + 缓存）：首次取时按 run.rng 抽一个并存进 `run.roomData.eventId`，
 * 同一次遇到再取永远同一件（重绘/重进房不重抽、不再消耗 rng）。
 */
export function eventScriptOf(run) {
  if (run.currentRoom !== 'event') throw new Error('当前不在事件房');
  const cached = findScript(run.roomData?.eventId);
  if (cached) return cached;
  const script = EVENT_SCRIPTS[Math.floor(run.rng.next() * EVENT_SCRIPTS.length)];
  run.roomData = { ...(run.roomData ?? {}), eventId: script.id };
  return script;
}

/** 给 Shell 播的视图：开场白 + 按当前局面动态算出的选项。 */
export function eventView(run) {
  const s = eventScriptOf(run);
  return {
    id: s.id, name: s.name, art: s.art,
    pages: s.pages.map(p => ({ ...p })),
    choices: s.choices(run).map(c => ({ ...c })),
  };
}

/**
 * 落实玩家的选择（**只允许一次**）：返回结果页与效果载荷。
 * 逻辑全在这里（core 层），Shell 只负责把选项摆出来、把人选的那个交回来。
 */
export function resolveEvent(run, choiceId) {
  const s = eventScriptOf(run);
  if (run.roomData?.eventResolved) throw new Error('这一房的事件已经结算过了');
  const res = s.resolve(run, choiceId);
  run.roomData = { ...(run.roomData ?? {}), eventResolved: choiceId };
  return res;
}

/** 该事件的默认选项（无头驱动/兜底用：不选就是第一个）。 */
export const defaultEventChoice = (run) => eventView(run).choices[0]?.id ?? null;

/**
 * 旧入口（headless RunDriver / 测试）：抽事件 + 用默认选项结算，返回效果载荷。
 * 交互式流程不走这里（Shell 播 cutscene、玩家自己选）。
 */
export function playEvent(run, { choice = null } = {}) {
  const id = choice ?? defaultEventChoice(run);
  return resolveEvent(run, id);
}
