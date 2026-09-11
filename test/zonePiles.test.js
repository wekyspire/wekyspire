import { describe, it, expect } from 'vitest';
import '../src/core/content/index.js';
import * as THREE from 'three';
import Player from '../src/core/state/player.js';
import { createRunState } from '../src/core/state/runState.js';
import { createSkillRuntime } from '../src/core/state/skillRuntime.js';
import { getEnemyDefinition } from '../src/core/enemies/registry.js';
import { createBridge, EventNames } from '../src/bridge/index.js';
import { StageManager } from '../src/stage/StageManager.js';
import { BattleStage, CARD_HEIGHT } from '../src/stage/stages/BattleStage.js';

// 区域图标与卡流动动画：牌库图标计数、点击查看器、
// 生成（牌库处出现）与离场（非焚毁飞回牌库图标停车；焚毁原地燃尽）的状态差分驱动模型。

// 记录型手动 tween：先记录目标，放行时才应用数值并回调（模拟"动画播完到位"）
function manualTween() {
  const pending = [];
  const records = [];
  const apply = (obj, to) => {
    if (to.x != null) obj.position.x = to.x;
    if (to.y != null) obj.position.y = to.y;
    if (to.z != null) obj.position.z = to.z;
    if (to.scale != null) obj.scale.set(to.scale, to.scale, 1);
  };
  const tween = (obj, to, opts = {}) => {
    records.push({ obj, to });
    pending.push(() => { apply(obj, to); opts?.onComplete?.(); });
    return { kill() {} };
  };
  tween.records = records;
  tween.completeNext = () => pending.shift()?.();
  tween.completeAll = () => { while (pending.length) pending.shift()(); };
  return tween;
}

const fakeBake = () => ({ texture: new THREE.Texture(), hitRegions: [], width: 200, height: 270 });
const fakeBakeLabel = () => ({ texture: new THREE.Texture(), width: 100, height: 30 });
const fakeBakeIcon = () => ({ texture: new THREE.Texture(), width: 160, height: 200 });

function make(deck = ['punch', 'punch', 'punch', 'punch', 'guard', 'guard', 'guard', 'guard'], bakeFace = fakeBake) {
  const runState = createRunState({
    player: new Player({ maxHp: 30, maxMana: 3, maxActionPoints: 3 }),
  });
  runState.player.deck = deck.map(d => createSkillRuntime(d));
  const bridge = createBridge({
    runState,
    enemies: [getEnemyDefinition('slime').createUnit()],
    seed: 1,
  });
  const sm = new StageManager({ createRenderer: () => ({ render() {}, setSize() {}, dispose() {} }) });
  sm.attach({});
  sm.resize(1000, 1000);
  const tween = manualTween();
  const stage = new BattleStage({
    bridge, stageManager: sm,
    bakeFace, bakeLabel: fakeBakeLabel, tween,
  });
  // 替换默认 pile 的浏览器烘焙（node 无 document 时已是占位，这里显式注入便于断言）
  return { bridge, sm, stage, tween };
}

// 世界 → 屏幕像素：走相机投影（透视下 z≠0 的点投影位置不同，必须带真实 z）。
// 区域图标在 UI pass → 用 uiCamera 投影（双相机约定，见 battleStage.test.js）
const toScreen = (stage, wx, wy, wz = 0) => stage._sm.worldToScreen(wx, wy, wz, stage._sm.uiCamera);
function click(stage, worldPos) {
  const p = toScreen(stage, ...worldPos);
  stage.handlePointerDown(p.x, p.y);
  stage.handlePointerUp(p.x, p.y);
}

describe('区域图标与卡流动动画', () => {
  it('牌库图标计数与投影一致（无弃牌堆）', () => {
    const { bridge, stage } = make();
    bridge.start();
    const proj = bridge.getProjection();
    expect(stage._piles.deck.count).toBe(proj.counts.deck);
    expect(stage._piles.discard).toBeUndefined(); // 弃牌堆已删除：FIFO 单循环区
    expect(Object.keys(proj.counts).sort()).toEqual(['burnt', 'deck']);
  });

  it('抽牌生成模型：新卡在牌库图标处出现，经跟踪飞入手牌', () => {
    const { bridge, stage, tween } = make();
    bridge.start();
    // 起手 4 张：每张都有向扇形锚点的跟踪 tween（tween 未放行时仍在牌库图标处）
    const proj = bridge.getProjection();
    for (const c of proj.hand) {
      const obj = stage._views.get(c.uniqueID);
      expect(obj.position.x).toBe(80);  // 牌库图标位置
      expect(obj.position.y).toBe(-55);
    }
    tween.completeAll(); // 放行跟踪 → 飞入扇形
    const xs = proj.hand.map(c => stage._views.get(c.uniqueID).position.x);
    expect(Math.min(...xs)).toBeLessThan(0);
    expect(Math.max(...xs)).toBeGreaterThan(0);
  });

  it('离场模型：打出的卡等自己的离场节拍才飞向牌库，sync 后牌库计数才+1', () => {
    const { bridge, stage, tween } = make();
    bridge.start();
    tween.completeAll();
    const deckBefore = stage._piles.deck.count; // 差值断言：deck 计数含牌库原有卡
    const first = bridge.getProjection().hand[0];
    bridge.intents.playCard(first.uniqueID);

    // 显示状态未推进（sync 排在节拍链之后）：卡仍在手牌，未起飞，牌库数字未提前+1
    expect(stage.model.getZone(first.uniqueID)).toBe('hand');
    expect(stage._piles.deck.count).toBe(deckBefore);
    expect(stage._views.get(first.uniqueID).visible).toBe(true); // 仍在桌上

    tween.completeAll(); // 发动展示 → 伤害 → 离场弧线飞行（淡出）→ sync 应用
    const view = stage._views.get(first.uniqueID);
    // 停车回库：弧线落位牌库图标（onComplete 硬化终态）→ 隐形停车，不透明度复位
    expect(view.position.x).toBe(80);
    expect(view.position.y).toBe(-55);
    expect(view.visible).toBe(false);
    expect(view.faceMesh.material.opacity).toBe(1);
    expect(stage.model.getZone(first.uniqueID)).toBe('deck');
    expect(stage._piles.deck.count).toBe(deckBefore + 1); // 飞进牌库后数字才+1
  });

  it('点牌库图标开查看器：卡全部在取景带内，点卡不关闭、点空白关闭且 pickable 清空', () => {
    const { bridge, stage, tween } = make();
    bridge.start();
    tween.completeAll();
    const deckCount = bridge.getProjection().counts.deck;
    expect(deckCount).toBeGreaterThan(0);

    click(stage, [80, -55, 5]); // 牌库图标（z=5）
    expect(stage._viewer.opened).toBe(true);
    expect(stage._viewer.zone).toBe('deck');
    expect(stage._viewer.count).toBe(deckCount);

    // 取景带回归：所有卡（含半高）都在 y ∈ [-65, 35] 内（旧版首行越顶裁切）
    for (const c of stage._viewer.cards) {
      expect(c.y + (CARD_HEIGHT * c.baseScale) / 2).toBeLessThanOrEqual(35);
      expect(c.y - (CARD_HEIGHT * c.baseScale) / 2).toBeGreaterThanOrEqual(-65);
    }

    // 点卡 = 读卡，保持打开
    const first = stage._viewer.cards[0];
    click(stage, [first.x, first.y]);
    expect(stage._viewer.opened).toBe(true);

    // 点背板空白处关闭；pickable 全量注销（无拾取泄漏）
    click(stage, [-70, -60]);
    expect(stage._viewer.opened).toBe(false);
    for (const id of stage.picker._pickables.keys()) {
      expect(id.startsWith('viewer:')).toBe(false);
    }
  });

  it('查看器与战斗同链路：卡面 token → tooltip、整卡 → hover 抬升/回落', () => {
    // 卡面左半带热区（模拟富文本 token）：渲染/拾取与手牌共用同一 bakeFace→hitRegions 协议
    const tokenBake = () => ({
      texture: new THREE.Texture(),
      hitRegions: [{ type: 'effect', payload: { name: '燃烧', powerDelta: 0 }, rect: { x: 0, y: 0, w: 100, h: 270 } }],
      width: 200, height: 270,
    });
    const { bridge, stage, tween } = make(undefined, tokenBake);
    bridge.start();
    tween.completeAll();
    const tooltips = [];
    const tooltipHides = [];
    const hovers = [];
    bridge.frontendBus.on(EventNames.TOOLTIP_SHOW, p => tooltips.push(p));
    bridge.frontendBus.on(EventNames.TOOLTIP_HIDE, () => tooltipHides.push(1));
    bridge.frontendBus.on(EventNames.CARD_HOVER, p => hovers.push(p));

    click(stage, [80, -55, 5]); // 开查看器
    const first = stage._viewer.cards[0];

    // 卡左半（token 区）→ tooltip 协议（BattleHud 同源消费）
    const onToken = toScreen(stage, first.x - 4, first.y);
    stage.handlePointerMove(onToken.x, onToken.y);
    expect(tooltips.length).toBe(1);
    expect(tooltips[0].kind).toBe('effect');
    expect(tooltips[0].payload.name).toBe('燃烧');

    // 卡右半（无 token）→ tooltip 隐藏 + 整卡 hover（viewer 前缀 id）+ 画廊抬升
    const onCard = toScreen(stage, first.x + 4, first.y);
    stage.handlePointerMove(onCard.x, onCard.y);
    expect(tooltipHides.length).toBe(1);
    expect(hovers.at(-1).uniqueID).toBe(first.id);
    expect(first.hovered).toBe(true);
    stage._viewer.update(0.5);
    expect(first.obj.scale.x).toBeGreaterThan(first.baseScale);
    expect(first.obj.position.y).toBeGreaterThan(first.y);

    // 移开到背板 → hover 回落收敛回基态
    const away = toScreen(stage, -70, -60);
    stage.handlePointerMove(away.x, away.y);
    stage._viewer.update(1.0);
    expect(first.obj.scale.x).toBeCloseTo(first.baseScale, 5);
    expect(first.obj.position.y).toBeCloseTo(first.y, 5);
  });

  it('查看器打开期间不响应出牌拖拽', () => {
    const { bridge, stage, tween } = make();
    bridge.start();
    tween.completeAll();
    click(stage, [80, -55, 5]); // 开查看器
    const handBefore = bridge.getProjection().hand.length;
    const first = bridge.getProjection().hand[0];
    const obj = stage._views.get(first.uniqueID);
    const p = toScreen(stage, obj.position.x, obj.position.y, obj.position.z);
    stage.handlePointerDown(p.x, p.y);
    expect(stage._dragging).toBeNull();
    expect(bridge.getProjection().hand.length).toBe(handBefore);
  });

  it('查看器卡同样支持 Shift 详情切换（同一渲染栈），关闭查看器时详情态还原', () => {
    const { bridge, stage, tween } = make(['punch', 'punch', 'punch', 'punch', 'punch', 'punch']);
    bridge.start();
    tween.completeAll();
    click(stage, [80, -55, 5]); // 开查看器（余牌全 punch：双轨卡，textAlt 必在）
    const first = stage._viewer.cards[0];
    const p = toScreen(stage, first.x, first.y);
    stage.handlePointerMove(p.x, p.y);
    stage.setShiftDown(true);
    expect(first.obj.altMode).toBe(true);
    stage.setShiftDown(false);
    expect(first.obj.altMode).toBe(false);

    // Shift 按住期间关闭查看器：详情态随模态层还原（不残留到已销毁对象）
    stage.setShiftDown(true);
    expect(first.obj.altMode).toBe(true);
    click(stage, [-70, -60]);
    expect(stage._viewer.opened).toBe(false);
    expect(first.obj.altMode).toBe(false);
  });

  it('显示状态推进（sync 节拍应用）时查看器自动关闭（内容失效）', () => {
    const { bridge, stage, tween } = make();
    bridge.start();
    tween.completeAll();
    click(stage, [80, -55, 5]);
    expect(stage._viewer.opened).toBe(true);
    bridge.intents.endTurn(); // 状态变更 → 节拍链 → sync 应用 → reconcile 关查看器
    tween.completeAll();
    expect(stage._viewer.opened).toBe(false);
  });
});
