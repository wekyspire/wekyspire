// run 级表现意图的执行器：**core 只声明意图，这里决定"怎么演、什么时候演"**。
//
// 事件/剧情在 core 结算时声明获得物特写意图（金币/卡牌…），本对象把它**排队**；
// runController 在安全时机 `drain()` 出来逐个交给 Stage 的 `showcaseItem`。
//
// 为什么要排队而不是立即播：core 结算发生在对话「选中那一拍」，此时 cutscene 还在播、
// 黑幕还没揭——获得演出必须排在揭幕后（否则被黑幕吞掉半截，用户 2026-09-12 定的节拍）。
// 队列把「事件做了什么」与「什么时候演」解耦：内容只管声明，时序归 Shell。
//
// ⚠ 外观策略（artKey/tint/时长）是表现层的事，集中在下面这张表；core 只给语义（kind+文案）。

/** showcase 意图 kind → 演出外观。card 的图按 defId 查（没素材由组件退化成色块）。 */
const VISUALS = {
  gold: { artKey: 'gold', tint: 0xffd75e, effect: '金币已经落进你的钱袋（关闭后继续行程）' },
  pack: { artKey: 'pack', tint: 0xffe6ad },
  potion: { artKey: 'potion', tint: 0xd8e2f4 },
  card: { tint: 0xd8e2f4 },
};

export function createRunPresenter() {
  let queue = [];
  let unitQueue = [];
  return {
    /** core 声明一次获得物特写意图（排队；不立即播）。 */
    showcase(intent) { if (intent) queue.push(intent); },
    /** core 声明单位演出指令（2026-09-25：事件驱动房间单位移动/形态；排队同 showcase）。 */
    unitCommand(cmd) { if (cmd) unitQueue.push(cmd); },
    /** 取走全部待播意图（Shell 在揭幕之后调）。 */
    drain() { return queue.splice(0); },
    /** 取走全部单位指令（与 drain 同时机）。 */
    drainUnitCommands() { return unitQueue.splice(0); },
    /** 丢弃待播意图（换局/异常路径）。 */
    clear() { queue.length = 0; unitQueue.length = 0; },
    get pending() { return queue.length + unitQueue.length; },
  };
}

/** 把 core 的 showcase 意图翻成 Stage `showcaseItem` 的载荷。 */
export function showcaseItemOf(intent) {
  const v = VISUALS[intent.kind] ?? {};
  return {
    title: intent.title ?? '',
    desc: intent.desc ?? '',
    effect: intent.effect || v.effect || '',
    artKey: intent.kind === 'card' ? (intent.defId ?? null) : (v.artKey ?? null),
    tint: v.tint ?? 0xffe6ad,
    autoDismissMs: intent.autoDismissMs ?? 0,
  };
}
