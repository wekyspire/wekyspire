import { describe, it, expect, vi } from 'vitest';
import '../src/core/content/index.js';
import mitt from 'mitt';
import Player from '../src/core/state/player.js';
import { createRunState } from '../src/core/state/runState.js';
import { createSkillRuntime } from '../src/core/state/skillRuntime.js';
import { getEnemyDefinition } from '../src/core/enemies/registry.js';
import { registerSkill } from '../src/core/skills/registry.js';
import AwaitPlayerInputInstruction from '../src/core/instructions/input.js';
import { DiscardCardInstruction } from '../src/core/instructions/cards.js';
import { createBridge, EventNames } from '../src/bridge/index.js';
import { ANIM_TIMING } from '../src/bridge/events.js';
import AnimationSequencer from '../src/core/anim/sequencer.js';

// ---- Bridge 层测试：事件翻译 / 动画队列 / 投影 / 意图 / 输入仲裁 ----

// 单选弃牌（测试卡）：结算期输入请求的最小样本
registerSkill({
  id: 'askDiscard', name: '问询',
  cost: { mana: 0, actionPoint: 1 },
  use(sctx, stage) {
    if (stage === 0) {
      sctx.self._input = new AwaitPlayerInputInstruction({
        request: {
          kind: 'selectHandCard', count: 1,
          candidates: sctx.battleState.zones.hand
            .filter(c => c.uniqueID !== sctx.self.uniqueID).map(c => c.uniqueID),
        },
      });
      sctx.kernel.submitInstruction(sctx.self._input);
      return false;
    }
    const [uniqueID] = sctx.self._input.result.selection;
    sctx.self._input = null;
    sctx.kernel.submitInstruction(new DiscardCardInstruction({ uniqueID }));
    return true;
  },
});

function makeBridge({ deck = [], enemies = ['slime'], abilities = [], seed = 1, config = {} } = {}) {
  const runState = createRunState({
    player: new Player({ maxHp: 30, maxMana: 3, maxActionPoints: 3 }),
  });
  runState.player.deck = deck.map(d => createSkillRuntime(d));
  runState.player.abilities = abilities;
  return createBridge({
    runState,
    enemies: enemies.map(id => getEnemyDefinition(id).createUnit()),
    seed, config,
  });
}

// 模拟"瞬时 Stage"：任何动画事件立即回 finish
function autoFinish(bridge, log = null) {
  bridge.frontendBus.on('*', (type, payload) => {
    if (type.startsWith('anim:')) {
      if (log) log.push(type);
      if (payload?._animId) {
        bridge.frontendBus.emit(EventNames.ANIMATION_INSTRUCTION_FINISHED, { id: payload._animId });
      }
    }
  });
}

describe('Bridge：事件翻译与状态标脏', () => {
  it('战斗开始发 BATTLE_START；出牌发动画事件并标脏', () => {
    const bridge = makeBridge({ deck: ['punch', 'punch', 'punch', 'punch'] });
    const backendLog = [];
    const animLog = [];
    bridge.backendBus.on('*', (type, payload) => backendLog.push(type));
    autoFinish(bridge, animLog);

    bridge.start();
    expect(backendLog).toContain(EventNames.BATTLE_START);
    expect(backendLog).toContain(EventNames.STATE_DIRTY);
    expect(animLog).toContain(EventNames.ANIM_CARD_DRAWN); // 起手抽牌

    const slime = bridge.battle.battleState.enemies[0];
    bridge.intents.playCard(bridge.getProjection().hand[0].uniqueID);
    expect(animLog).toContain(EventNames.ANIM_SKILL_USED);
    expect(animLog).toContain(EventNames.ANIM_DAMAGE);
    expect(slime.hp).toBe(14);
    expect(bridge.sequencer.pendingCount).toBe(0); // 瞬时 Stage 全部播完
  });
});

describe('Bridge：动画队列屏障与超时', () => {
  it('默认严格串行：前序未 finish 时后续不启动；效果/离场节拍后必跟 sync', () => {
    const bridge = makeBridge({ deck: ['punch', 'punch', 'punch', 'punch'] });
    const animLog = [];
    bridge.frontendBus.on('*', (type, payload) => {
      if (type.startsWith('anim:')) animLog.push({ type, id: payload?._animId });
    });
    bridge.start(); // battleStart 的 state-sync 启动（running），后续排队
    expect(animLog).toHaveLength(1);
    expect(animLog[0].type).toBe(EventNames.ANIM_STATE_SYNC);

    bridge.intents.playCard(bridge.getProjection().hand[0].uniqueID);
    expect(animLog).toHaveLength(1); // 出牌全部节拍被挡住

    // 逐条 finish 放干（含 syncIfIdle 可能在尾部补的兜底 sync）
    let guard = 0;
    while (guard++ < 30 && bridge.sequencer.pendingCount > 0) {
      bridge.frontendBus.emit(EventNames.ANIMATION_INSTRUCTION_FINISHED, { id: animLog.at(-1).id });
    }
    const types = animLog.map(a => a.type);
    // 非 sync 节拍的严格次序：drawn → resource(回合开始魏启+1) → skillUsed → resource(扣费) → damage → cardMoved
    expect(types.filter(t => t !== EventNames.ANIM_STATE_SYNC)).toEqual([
      EventNames.ANIM_CARD_DRAWN, EventNames.ANIM_RESOURCE,
      EventNames.ANIM_SKILL_USED, EventNames.ANIM_RESOURCE,
      EventNames.ANIM_DAMAGE,
      EventNames.ANIM_CARD_MOVED,
    ]);
    const at = (t) => types.indexOf(t);
    // 方向性：效果/离场 = 先动画后 sync（演完再变数字 / 飞回牌库底数字才+1）
    expect(types[at(EventNames.ANIM_DAMAGE) + 1]).toBe(EventNames.ANIM_STATE_SYNC);
    expect(types[at(EventNames.ANIM_CARD_MOVED) + 1]).toBe(EventNames.ANIM_STATE_SYNC);
    // 入场 = 先 sync 后动画（先转移再播动画）
    expect(types[at(EventNames.ANIM_CARD_DRAWN) - 1]).toBe(EventNames.ANIM_STATE_SYNC);
  });

  it('ANIM_TIMING 全部为宽松兜底档（≥2000ms）：节拍衔接以 finish 为准，超时不参与调度', () => {
    for (const [event, ms] of Object.entries(ANIM_TIMING)) {
      expect(ms, `${event} 兜底档过短，可能在复杂结算中强杀真实动画`).toBeGreaterThanOrEqual(2000);
    }
  });

  it('durationMs 超时强杀：Stage 不回 finish 也自动推进', () => {
    vi.useFakeTimers();
    try {
      const bridge = makeBridge({ deck: ['punch', 'punch', 'punch', 'punch'] });
      const animLog = [];
      bridge.frontendBus.on('*', (type, payload) => {
        if (type.startsWith('anim:')) animLog.push({ type, id: payload?._animId });
      });
      bridge.start();
      bridge.intents.playCard(bridge.getProjection().hand[0].uniqueID);
      expect(animLog).toHaveLength(1); // 仍被挡

      vi.advanceTimersByTime(2600); // 超过 ANIM_CARD_DRAWN 的 2500ms 兜底档
      expect(animLog.length).toBeGreaterThan(1); // 超时强杀后后续启动
      vi.advanceTimersByTime(40000); // 全部超时清场（节拍 × 宽松兜底档位的总和）
      expect(bridge.sequencer.pendingCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waitTags: [] 的指令可与前序并行启动', () => {
    const bus = mitt();
    const seq = new AnimationSequencer({ bus });
    const started = [];
    seq.enqueueInstruction({ durationMs: 5000, start: () => started.push('a') });
    seq.enqueueInstruction({ durationMs: 5000, start: () => started.push('b') });
    expect(started).toEqual(['a']); // b 被 a 挡住

    seq.enqueueInstruction({ waitTags: [], durationMs: 5000, start: () => started.push('c') });
    expect(started).toEqual(['a', 'c']); // c 不等待，立即并行
  });
});

describe('Bridge：状态投影', () => {
  it('投影只含公开字段（无 _ 私有），随结算更新，手牌含名称与描述文本', () => {
    const bridge = makeBridge({ deck: ['punch', 'punch', 'punch', 'punch'] });
    autoFinish(bridge);
    bridge.start();

    const p0 = bridge.getProjection();
    expect(p0.player.hp).toBe(30);
    expect(p0.counts.deck).toBe(0);
    expect(p0.hand).toHaveLength(4);
    expect(p0.hand[0].name).toBe('拳');
    expect(p0.hand[0].text).toContain('6');
    expect(p0.swapCost).toBe(0);
    expect(p0.pendingInput).toBeNull();
    expect(p0.waitingPlayerInput).toBe(true);

    // 无 _ 开头私有字段泄漏
    const json = JSON.stringify(p0);
    expect(json).not.toMatch(/"_\w+":/);

    bridge.intents.playCard(p0.hand[0].uniqueID);
    const p1 = bridge.getProjection();
    expect(p1.enemies[0].hp).toBe(14);
    expect(p1.hand).toHaveLength(3);
    expect(p1.player.actionPoints).toBe(2);
  });

  it('单位效果压平定义元数据（name/type/color/icon），Stage 无需 import Core 注册表', () => {
    const bridge = makeBridge({ deck: ['inflame', 'punch', 'punch', 'punch'] });
    autoFinish(bridge);
    bridge.start();
    const card = bridge.getProjection().hand.find(c => c.defId === 'inflame');
    bridge.intents.playCard(card.uniqueID, bridge.getProjection().enemies[0].uniqueID);
    const fx = bridge.getProjection().enemies[0].effects;
    expect(fx).toHaveLength(1);
    expect(fx[0]).toMatchObject({
      effectId: 'burn', stacks: 5, name: '燃烧', type: 'debuff', color: 'red', icon: '🔥',
    });
    // 可序列化约束：定义引用不外泄，只有压平后的纯数据
    expect(Object.values(fx[0]).every(v => v == null || typeof v !== 'object')).toBe(true);
  });
});

describe('Bridge：意图层与可用性', () => {
  it('canPlayCard/playCard/swapCard 行为与置灰一致', () => {
    const bridge = makeBridge({ deck: ['focusChant', 'punch', 'punch', 'punch'] });
    autoFinish(bridge);
    bridge.start();

    const proj = bridge.getProjection();
    const punch = proj.hand.find(c => c.defId === 'punch');
    const chant = proj.hand.find(c => c.defId === 'focusChant');

    expect(bridge.intents.canPlayCard(punch.uniqueID)).toBe(true);
    expect(bridge.intents.playCard(punch.uniqueID)).toBe(true);

    // 换牌：首次 0 AP
    expect(bridge.intents.canSwapCard(punch.uniqueID)).toBe(false); // punch 已打出
    const next = bridge.getProjection().hand[0];
    expect(bridge.intents.canSwapCard(next.uniqueID)).toBe(true);
    expect(bridge.intents.swapCard(next.uniqueID)).toBe(true);
    expect(bridge.getProjection().player.actionPoints).toBe(2); // 出牌 1 + 换牌 0

    // 咏唱双态：发动（付费，留手牌激活）→ 再次打出（免费解除，回牌库）
    bridge.intents.playCard(chant.uniqueID);
    const chantProj = bridge.getProjection().hand.find(c => c.uniqueID === chant.uniqueID);
    expect(chantProj.isActivated).toBe(true);
    expect(bridge.intents.canPlayCard(chant.uniqueID)).toBe(true); // 免费解除可用
    bridge.intents.playCard(chant.uniqueID);
    expect(bridge.getProjection().hand.some(c => c.uniqueID === chant.uniqueID)).toBe(false); // 已回牌库

    expect(bridge.intents.canEndTurn()).toBe(true);
    expect(bridge.intents.endTurn()).toBe(true);
    expect(bridge.getProjection().turn.count).toBe(2);
  });
});

describe('Bridge：结算期输入仲裁', () => {
  it('请求事件 → 非法应答被拒 → 合法应答结算继续', () => {
    const bridge = makeBridge({ deck: ['askDiscard', 'punch', 'punch', 'punch'] });
    const events = [];
    bridge.backendBus.on('*', (type, payload) => {
      if (type === EventNames.INPUT_REQUESTED || type === EventNames.INPUT_RESOLVED) {
        events.push({ type, payload });
      }
    });
    autoFinish(bridge);
    bridge.start();

    const ask = bridge.getProjection().hand.find(c => c.defId === 'askDiscard');
    bridge.intents.playCard(ask.uniqueID);

    expect(events.map(e => e.type)).toEqual([EventNames.INPUT_REQUESTED]);
    const { request } = events[0].payload;
    expect(request.kind).toBe('selectHandCard');
    expect(bridge.getProjection().pendingInput?.request).toEqual(request);
    expect(bridge.interaction.activeRequest).toEqual(request);

    // 非法应答：不在 candidates 内
    expect(bridge.interaction.respond(['sk_not_exist'])).toBe(false);
    expect(bridge.interaction.activeRequest).not.toBeNull();
    // 非法应答：数量不符
    expect(bridge.interaction.respond([])).toBe(false);

    // 合法应答
    const target = request.candidates[0];
    expect(bridge.interaction.respond([target])).toBe(true);
    expect(events.map(e => e.type)).toEqual([
      EventNames.INPUT_REQUESTED, EventNames.INPUT_RESOLVED,
    ]);
    expect(bridge.interaction.activeRequest).toBeNull();
    expect(bridge.getProjection().pendingInput).toBeNull();
    expect(bridge.getProjection().waitingPlayerInput).toBe(true);
    expect(bridge.getProjection().counts.deck).toBe(2); // 弃牌落牌库底：askDiscard 自身 + 被弃牌
    expect(bridge.getProjection().zones.deck.at(-1).defId).toBe('askDiscard'); // FIFO：发动卡收尾居末位

    // 无挂起请求时应答被拒
    expect(bridge.interaction.respond([target])).toBe(false);
  });
});
