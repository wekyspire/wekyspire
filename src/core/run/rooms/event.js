// 事件房（RUN_DESIGN §4.4；用户定 2026-09-12 改版，2026-09-13 内容化）：**随机事件 = 对话 + 选项 + 逻辑**。
//
// 形态：不走 UI 面板、不做 3D 场景——由 Shell 用 cutscene 播（幕间 CG + 普通对话 + 选项），
// `dialogue` step 的 `bg` 即事件背景图（见 `shell/overlay/eventArt.js`）。本文件只是**房间侧逻辑**：
// 抽取、视图、结算落账。**内容与效果在 `core/content/events/*`**（定义进 `core/events/registry.js`），
// 效果由内容自己主动施加（见 `core/run/runEffects.js`）——这里不做任何效果解释。
//
// 结算契约（用户定 2026-09-13）：
//   resolveEvent(run, choiceId, ctx) -> { eventId, name, pages, effects }
//   · pages   = 结果页（纯叙事），Shell 接着播
//   · effects = 本次施加的效果流水（纯描述，文本前端/日志用）——**不是**待执行的载荷
//   效果在 `resolve` 调用期间就落账了，Shell 对"事件做了什么"一无所知，也就无从侵入。
//
// 抽取：按 run.rng **确定性**在「本模式可用 + requires 通过」的池里按 weight 抽一个，记进
// `run.roomData.eventId`——同一次遇到不重抽（快照重绘/重进房拿到同一件事，且不再消耗 rng）。
//
// 占位说明：事件美术只是"取图用的 key"，真素材丢 `src/assets/images/events/<key>.webp` 自动顶替。
import { allEvents, hasEvent, getEventDefinition } from '../../events/registry.js';
import { createRunContext } from '../runContext.js';

/** 该事件是否允许在当前 run 出现（模式门禁 + 内容自定义前提）。 */
export function eventEligible(run, def) {
  const mode = def.mode ?? 'both';
  if (mode === 'story' && !run.storyMode) return false;
  if (mode === 'endless' && run.storyMode) return false;
  return def.requires ? !!def.requires(run) : true;
}

/** 当前可用事件池（按注册序；权重在抽取时用）。 */
export const eventPool = (run) => allEvents().filter(def => eventEligible(run, def));

// 缓存命中才复用；内容被删/改名（本地开发）时退回重抽，不让旧 id 把房间打死
const findScript = (id) => (id && hasEvent(id) ? getEventDefinition(id) : null);

/**
 * 抽到的事件（确定性 + 缓存）：首次取时在可用池里按 weight 抽一个并存进 `run.roomData.eventId`，
 * 同一次遇到再取永远同一件（重绘/重进房不重抽、不再消耗 rng）。
 */
export function eventScriptOf(run) {
  if (run.currentRoom !== 'event') throw new Error('当前不在事件房');
  const cached = findScript(run.roomData?.eventId);
  if (cached) return cached;
  const pool = eventPool(run);
  if (!pool.length) throw new Error('没有可用的事件（事件池为空或全被 requires/模式挡掉）');
  const total = pool.reduce((s, d) => s + Math.max(0, d.weight ?? 1), 0);
  let roll = run.rng.next() * total;
  let script = pool[pool.length - 1];
  for (const d of pool) {
    roll -= Math.max(0, d.weight ?? 1);
    if (roll < 0) { script = d; break; }
  }
  run.roomData = { ...(run.roomData ?? {}), eventId: script.id };
  return script;
}

const pagesOf = (def, run, ctx) => {
  const pages = typeof def.pages === 'function' ? def.pages(run, ctx) : def.pages;
  return (pages ?? []).map(p => ({ ...p }));
};

/** 给 Shell 播的视图：开场白 + 按当前局面动态算出的选项。 */
export function eventView(run, ctx = null) {
  const s = eventScriptOf(run);
  const c = ctx ?? createRunContext(run);
  return {
    id: s.id, name: s.name, art: s.art,
    pages: pagesOf(s, run, c),
    choices: (s.choices?.(run, c) ?? []).map(ch => ({ ...ch })),
  };
}

/**
 * 落实玩家的选择（**只允许一次**）：施加效果（内容自己做，写进 `ctx`）+ 返回结果页与效果流水。
 * 逻辑全在 core，Shell 只负责把选项摆出来、把人选的那个交回来、把结果页播出去。
 */
export function resolveEvent(run, choiceId, ctx = null) {
  const s = eventScriptOf(run);
  if (run.roomData?.eventResolved) throw new Error('这一房的事件已经结算过了');
  const c = ctx ?? createRunContext(run);
  const mark = c.log.length;                       // 只回收**本次**施加的效果
  const out = s.resolve?.(run, choiceId, c) ?? {};
  run.roomData = { ...(run.roomData ?? {}), eventResolved: choiceId };
  return {
    eventId: s.id,
    name: s.name,
    pages: (out.pages ?? []).map(p => ({ ...p })),
    effects: c.log.slice(mark),
  };
}

/** 该事件的默认选项（无头驱动/兜底用：不选就是第一个）。 */
export const defaultEventChoice = (run) => eventView(run).choices[0]?.id ?? null;

/**
 * 无头入口（RunDriver / 试玩引擎 / 测试）：抽事件 + 用默认选项结算。
 * 交互式流程不走这里（Shell 播 cutscene、玩家自己选）。
 */
export function playEvent(run, { choice = null, ctx = null } = {}) {
  const id = choice ?? defaultEventChoice(run);
  return resolveEvent(run, id, ctx);
}
