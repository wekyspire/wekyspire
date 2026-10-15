// 幕间/流程指令壳（P2 队列化单飞的通用形状；自 devour/training/event/ascension 四处
// 同型收敛——rule of three 满额）。
//
// 流程 = 一条指令：
//   · 退出 'all'（tagAll:false）——流程内部还要往同一队列排内容（cutscene 剧本步骤/
//     特写链/切幕），带 'all' 的话它们会等流程收尾而流程又在等它们 = 互等死锁；
//   · 自家标签互等（waitTags 含 tag）——同类流程的再入请求排在首份后面（单飞纪律），
//     投料口/面板这类「点选先于模态路由」的再入源由此结构性堵住；
//   · entryOk 状态门在 start 时复检——排到队尾的重复请求此刻若局面已翻篇即自灭；
//   · 玩家节奏段（对话/选卡可长考）不能上墙钟保险丝——play 自己在 finally 里调
//     done()（壳再兜一层异步异常，防 unhandled rejection）。
// entryOk 必须是**纯读**（run/舞台状态），不可有副作用。

export function enqueueFlowInstruction(dedicatedSequencer, { tag, meta, entryOk, play }) {
  if (!entryOk()) return false;
  dedicatedSequencer.enqueueInstruction({
    meta,
    tags: [tag], tagAll: false,
    waitTags: ['all', tag],
    start: ({ id }) => {
      const done = () => dedicatedSequencer.finish(id, { reason: 'manual' });
      if (!entryOk()) { done(); return; }   // 排队期间局面已翻篇：自灭
      void Promise.resolve(play(done)).catch((err) => {
        console.warn(`[flow:${tag}]`, err?.message ?? err);
        done();   // play 没走到 finally 的极端路径（正常 play 自带 finally done）
      });
    },
  });
  return true;
}

/**
 * 轮询等待条件成立（流程指令 play 内的「等舞台/局面就绪」段共用形状）。
 * 刻意**没有超时**：等待条件含玩家节奏段（选卡/特写收下），墙钟保险丝会误杀
 * （时基裁决同 battle-span）；pred 读取的世界消失时应自然返回真值收尾
 * （可选链落到 undefined 的取反），不靠超时兜底。
 */
export function waitFor(pred, everyMs = 150) {
  return new Promise((resolve) => {
    const tick = () => {
      if (pred()) { resolve(true); return; }
      setTimeout(tick, everyMs);
    };
    tick();
  });
}
