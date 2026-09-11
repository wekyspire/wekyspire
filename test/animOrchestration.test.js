import { describe, it, expect, vi } from 'vitest';
import '../src/core/content/index.js';
import mitt from 'mitt';
import Player from '../src/core/state/player.js';
import { createRunState } from '../src/core/state/runState.js';
import { createSkillRuntime } from '../src/core/state/skillRuntime.js';
import { getEnemyDefinition } from '../src/core/enemies/registry.js';
import { createBridge, EventNames } from '../src/bridge/index.js';
import AnimationSequencer from '../src/core/anim/sequencer.js';

// 跨层演出编排（S0-S2）：BATTLE_END 队列尾闸 / 通用 sequencer 能力 / run 级注入。

function makeBridge(overrides = {}) {
  const runState = createRunState({ player: new Player({ maxHp: 30, maxMana: 3, maxActionPoints: 3 }) });
  runState.player.deck = ['punch', 'punch', 'punch', 'punch'].map(id => createSkillRuntime(id));
  return createBridge({
    runState,
    enemies: [getEnemyDefinition('slime').createUnit()],
    seed: 1,
    ...overrides,
  });
}

describe('通用 sequencer（S1 抽出）', () => {
  it('start 内自完结（同步 finish）立即泵起后续指令——尾闸/闸门依赖的语义', () => {
    const seq = new AnimationSequencer({ bus: mitt() });
    const order = [];
    seq.enqueueInstruction({ durationMs: 0, start: ({ id }) => { order.push('a'); seq.finish(id); } });
    seq.enqueueInstruction({ durationMs: 0, start: ({ id }) => { order.push('b'); seq.finish(id); } });
    expect(order).toEqual(['a', 'b']); // 同步链式推进，无宏任务跳变
    expect(seq.pendingCount).toBe(0);
  });

  it('cancelAll 瞬落：未启动的 start 不再执行、running 的超时定时器清除', () => {
    vi.useFakeTimers();
    try {
      const seq = new AnimationSequencer({ bus: mitt() });
      const started = [];
      seq.enqueueInstruction({ durationMs: 100, start: () => started.push('a') });
      seq.enqueueInstruction({ durationMs: 100, start: () => started.push('b') });
      expect(started).toEqual(['a']); // 严格串行：b 排队
      seq.cancelAll();
      vi.advanceTimersByTime(1000);
      expect(started).toEqual(['a']); // b 未启动；a 超时回调已被清除
      expect(seq.pendingCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('run 级注入（S2）', () => {
  it('bridge 接受共享 frontendBus/sequencer：多 bridge 同一定序', () => {
    const bus = mitt();
    const seq = new AnimationSequencer({ bus, finishedEvent: EventNames.ANIMATION_INSTRUCTION_FINISHED });
    const bridge = makeBridge({ frontendBus: bus, sequencer: seq });
    expect(bridge.frontendBus).toBe(bus);
    expect(bridge.sequencer).toBe(seq);
    // 注入实例上照常入队/回执
    const seen = [];
    bus.on('anim:x', (p) => seen.push(p?._animId));
    const id = seq.enqueueInstruction({ meta: { event: 'anim:x' }, durationMs: 50, start: ({ id, emit }) => emit('anim:x', { _animId: id }) });
    expect(seen).toEqual([id]);
    bus.emit(EventNames.ANIMATION_INSTRUCTION_FINISHED, { id });
    expect(seq.pendingCount).toBe(0);
  });
});

describe('BATTLE_END 队列尾闸（S0）', () => {
  it('前置动画未完成不发射；死亡动画在队列中；排干后恰一次发射且晚于死亡动画', () => {
    const bridge = makeBridge();
    const order = []; // 演出启动顺序 + 终局发射的统一时序轴
    bridge.backendBus.on(EventNames.BATTLE_END, () => order.push('backend:battle-end'));
    bridge.frontendBus.on('*', (type, payload) => {
      if (type.startsWith('anim:')) order.push(type);
    });
    bridge.start();

    // slime 20 HP：回合 1 三拳（18）→ endTurn（敌方行动）→ 回合 2 一拳击杀
    for (let i = 0; i < 3; i++) {
      bridge.intents.playCard(bridge.getProjection().hand[0].uniqueID);
    }
    bridge.intents.endTurn();
    bridge.intents.playCard(bridge.getProjection().hand[0].uniqueID);
    expect(bridge.isFinished()).toBe(true); // 内核已终局

    expect(bridge.sequencer.findPending(i => i.meta?.event === EventNames.ANIM_UNIT_DEATH))
      .toBeTruthy();                                  // 死亡演出在队列中（尚未启动）
    expect(bridge.sequencer.pendingCount).toBeGreaterThan(0);
    expect(order).not.toContain('backend:battle-end'); // 修复前：此刻已发射

    // 逐条回执排干（从最老指令起；含终局 sync 与可能的兜底 sync）
    let guard = 0;
    while (guard++ < 120 && bridge.sequencer.pendingCount > 0) {
      const first = bridge.sequencer.findPending(() => true);
      bridge.frontendBus.emit(EventNames.ANIMATION_INSTRUCTION_FINISHED, { id: first.id });
    }
    expect(bridge.sequencer.pendingCount).toBe(0);
    expect(order.filter(x => x === 'backend:battle-end')).toHaveLength(1); // 恰一次
    // 顺序契约：死亡演出先于终局发射（严格串行队列保证）
    expect(order.indexOf(EventNames.ANIM_UNIT_DEATH)).toBeLessThan(order.indexOf('backend:battle-end'));
  });
});
