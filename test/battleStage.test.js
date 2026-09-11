import { describe, it, expect } from 'vitest';
import '../src/core/content/index.js';
import * as THREE from 'three';
import Player from '../src/core/state/player.js';
import { createRunState } from '../src/core/state/runState.js';
import { createSkillRuntime } from '../src/core/state/skillRuntime.js';
import { getEnemyDefinition } from '../src/core/enemies/registry.js';
import { getAllyDefinition } from '../src/core/allies/registry.js';
import { registerSkill } from '../src/core/skills/registry.js';
import AwaitPlayerInputInstruction from '../src/core/instructions/input.js';
import { DiscardCardInstruction } from '../src/core/instructions/cards.js';
import { moveCard } from '../src/core/state/battleState.js';
import { createBridge, EventNames } from '../src/bridge/index.js';
import { StageManager } from '../src/stage/StageManager.js';
import { BattleStage, BUTTON_POSITIONS, CARD_HEIGHT } from '../src/stage/stages/BattleStage.js';
import { HAND_FAN_MECHANICS } from '../src/stage/layout/LayoutEngine.js';

// BattleStage 无头联调：真 bridge + 真场景图，fake 烘焙 + 同步 tween。
// 验证 reconcile 建销、拖拽出牌、按钮结束回合、结算期点选输入 的完整链路。

registerSkill({
  id: 'askDiscardStage', name: '问询·台',
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

// 消耗牌（焚毁离场）：keywords exhaust → UseSkillInstruction 走 burnt + cardBurnt
registerSkill({
  id: 'burnStageCard', name: '焚身',
  cost: { mana: 0, actionPoint: 1 },
  keywords: ['exhaust'],
  use() { return true; },
});

// 同步假 tween：立即应用并同步回调
function instantTween(object3D, to, { onComplete } = {}) {
  if (to.x != null) object3D.position.x = to.x;
  if (to.y != null) object3D.position.y = to.y;
  if (to.z != null) object3D.position.z = to.z;
  if (to.scale != null) object3D.scale.set(to.scale, to.scale, 1);
  onComplete?.();
  return { kill() {} };
}

const fakeBake = () => ({ texture: new THREE.Texture(), hitRegions: [], width: 200, height: 270 });
const fakeBakeLabel = () => ({ texture: new THREE.Texture(), width: 100, height: 30 });

function make(deck = ['punch', 'punch', 'punch', 'punch'], enemyCount = 1, tween = instantTween, bakeFace = fakeBake, allyCount = 0) {
  const runState = createRunState({
    player: new Player({ maxHp: 30, maxMana: 3, maxActionPoints: 3 }),
  });
  runState.player.deck = deck.map(d => createSkillRuntime(d));
  const bridge = createBridge({
    runState,
    enemies: Array.from({ length: enemyCount }, () => getEnemyDefinition('slime').createUnit()),
    allies: Array.from({ length: allyCount }, () => getAllyDefinition('remi').createUnit()),
    seed: 1,
  });
  const sm = new StageManager({ createRenderer: () => ({ render() {}, setSize() {}, dispose() {} }) });
  sm.attach({});
  sm.resize(1000, 1000);
  const stage = new BattleStage({
    bridge, stageManager: sm,
    bakeFace, bakeLabel: fakeBakeLabel,
    // tween:'gsap' = 不注入（用 StageAnimator 缺省的真 gsap，异步时序同浏览器）
    tween: tween === 'gsap' ? undefined : tween,
  });
  return { bridge, sm, stage };
}

// 世界 → 屏幕像素：走相机投影（透视下 z≠0 的点投影位置不同，必须带真实 z）。
// 双相机：单位在世界 pass 用世界相机（斜视）；卡牌/按钮/图标在 UI pass 用 uiCamera（正直）。
const toScreen = (stage, wx, wy, wz = 0) => stage._sm.worldToScreen(wx, wy, wz);
const toScreenUI = (stage, wx, wy, wz = 0) => stage._sm.worldToScreen(wx, wy, wz, stage._sm.uiCamera);

// 模拟一次完整拖拽：从 (fromWorld) 拖到 (toWorld) 松手（两端均为 UI 空间坐标）
function drag(stage, fromWorld, toWorld) {
  const a = toScreenUI(stage, ...fromWorld);
  const b = toScreenUI(stage, ...toWorld);
  stage.handlePointerDown(a.x, a.y);
  stage.handlePointerMove(b.x, b.y);
  stage.handlePointerUp(b.x, b.y);
}

function click(stage, worldPos) {
  const p = toScreenUI(stage, ...worldPos);
  stage.handlePointerDown(p.x, p.y);
  stage.handlePointerUp(p.x, p.y);
}

// 推进手牌弹簧至收敛（静息姿态逐帧软收敛，headless 无 rAF，需手动步进）
function settleHand(stage, seconds = 1.2) {
  const steps = Math.ceil(seconds / (1 / 60));
  for (let i = 0; i < steps; i++) stage.springs.update(1 / 60);
}

describe('BattleStage 无头联调', () => {
  it('状态栏瑞米区随投影同步：出战取盟友实时血量，盟友缺席整区隐藏', () => {
    const { bridge, stage } = make(['punch', 'punch', 'punch', 'punch'], 1, instantTween, fakeBake, 1);
    expect(stage.statusBar.getObjectByName('remi').visible).toBe(false); // 开战前未注入
    bridge.start();
    const remi = bridge.getProjection().allies.find(a => a.defId === 'remi');
    expect(remi).toBeTruthy();
    expect(stage.statusBar.getObjectByName('remi').visible).toBe(true);
    expect(stage.statusBar._remiHpSig).toBe(`${remi.hp}`); // 心形数字 = 盟友投影血量

    const { bridge: bridge2, stage: stage2 } = make(); // 无盟友装配 → 整区隐藏
    bridge2.start();
    expect(stage2.statusBar.getObjectByName('remi').visible).toBe(false);
  });

  it('start 后按投影建场景：手牌对象 + 单位对象 + 锚点归位', () => {
    const { bridge, stage } = make();
    bridge.start();
    settleHand(stage); // 弹簧收敛到扇形锚点（headless 无帧驱动）

    const proj = bridge.getProjection();
    // 持久注册表：手牌 + 牌库卡全建视图；牌库卡不可见（惰性烘面）
    expect(stage._views.size).toBe(proj.hand.length + proj.counts.deck);
    expect([...stage.model.cards.values()].filter(e => e.zone === 'deck')).toHaveLength(proj.counts.deck);    if (proj.zones.deck[0]) expect(stage._views.get(proj.zones.deck[0].uniqueID).visible).toBe(false);
    expect(stage._units.size).toBe(2); // player + slime

    // 手牌已跟踪到布局锚点：视图位置与 LayoutEngine 锚点一致、从左到右有序
    const entries = proj.hand.map(c => ({
      x: stage._views.get(c.uniqueID).position.x,
      anchor: stage.layout.getAnchor(c.uniqueID),
    })).sort((a, b) => a.x - b.x);
    for (const e of entries) expect(e.x).toBeCloseTo(e.anchor.x);
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].x).toBeGreaterThan(entries[i - 1].x);
    }
  });

  it('免目标卡（格挡）旧式拖拽：拖过出牌线松手 = 打出，卡随指针走', () => {
    const { bridge, stage } = make(['guard', 'punch', 'punch', 'punch']);
    bridge.start();
    settleHand(stage); // 弹簧收敛到扇形锚点（headless 无帧驱动）
    const player = bridge.battle.ctx.player;
    const guard = bridge.getProjection().hand.find(c => c.defId === 'guard');
    expect(guard.targetMode).toBe('none'); // 投影带交互声明
    const cardPos = stage._views.get(guard.uniqueID).position;

    // 拖拽中：卡随指针走（旧 behavior）
    const a = toScreenUI(stage, cardPos.x, cardPos.y, cardPos.z);
    const b = toScreenUI(stage, 0, 0);
    stage.handlePointerDown(a.x, a.y);
    stage.handlePointerMove(b.x, b.y);
    expect(stage._dragging?.id).toBe(guard.uniqueID);
    expect(stage._aiming).toBeNull();
    expect(stage._arrow.visible).toBe(false);
    expect(stage._views.get(guard.uniqueID).position.y).toBeGreaterThan(-5); // 已离开手牌扇区（≈0，z=30 平面反投影略有透视偏移）

    stage.handlePointerUp(b.x, b.y); // 过线松手 → 打出
    expect(player.shield).toBe(5);
    expect(stage.model.getZone(guard.uniqueID)).toBe('deck'); // 停车回牌库底（对象留存）
    expect(stage._views.get(guard.uniqueID).visible).toBe(false);
    const handZoned = [...stage.model.cards.values()].filter(e => e.zone === 'hand');
    expect(handZoned).toHaveLength(bridge.getProjection().hand.length);
  });

  it('选目标卡（冲拳）瞄准：卡留手牌高亮，松手不在敌人身上 = 取消（过线也不打出）', () => {
    const { bridge, stage } = make();
    bridge.start();
    settleHand(stage); // 弹簧收敛到扇形锚点（headless 无帧驱动）
    const slime = bridge.battle.battleState.enemies[0];
    const firstCard = bridge.getProjection().hand[0];
    expect(firstCard.targetMode).toBe('enemy');
    const obj = stage._views.get(firstCard.uniqueID);
    const home = obj.position.clone();

    const a = toScreenUI(stage, home.x, home.y, home.z);
    const b = toScreenUI(stage, 0, 0); // 桌面中央（y=0 > 出牌线，但不在敌人身上）
    stage.handlePointerDown(a.x, a.y);
    stage.handlePointerMove(b.x, b.y);

    // 瞄准中：卡不随指针走（留在手牌区），箭头显示且未锁定目标
    expect(stage._aiming?.id).toBe(firstCard.uniqueID);
    expect(stage._dragging).toBeNull();
    expect(stage._arrow.visible).toBe(true);
    expect(stage._arrow.targetValid).toBe(false);
    expect(obj.position.y).toBeLessThan(-25); // 仍在手牌扇区（home.y≈-40，撑开抬升有限）
    expect(obj.visualState).toBe('highlighted');

    stage.handlePointerUp(b.x, b.y); // 松手不在敌人身上 → 取消
    expect(slime.hp).toBe(slime.maxHp);
    expect(stage.model.getZone(firstCard.uniqueID)).toBe('hand');
    expect(stage._arrow.visible).toBe(false);
    expect(stage._aiming).toBeNull();
    // 取消后回到扇形锚点（去高亮、收撑开）
    expect(obj.position.x).toBeCloseTo(home.x);
    expect(obj.position.y).toBeCloseTo(home.y);
    expect(obj.visualState).toBe('normal');
  });

  it('拖回手牌区松手 = 取消：牌回锚点，不掉血', () => {
    const { bridge, stage } = make();
    bridge.start();
    settleHand(stage); // 弹簧收敛到扇形锚点（headless 无帧驱动）
    const slime = bridge.battle.battleState.enemies[0];
    const hpBefore = slime.hp;
    const firstCard = bridge.getProjection().hand[0];
    const home = stage._views.get(firstCard.uniqueID).position.clone();

    drag(stage, [home.x, home.y], [0, -45]); // 拖到下方又松手（y=-45 < -20）

    expect(slime.hp).toBe(hpBefore);
    const pos = stage._views.get(firstCard.uniqueID).position;
    expect(pos.x).toBeCloseTo(home.x);
    expect(pos.y).toBeCloseTo(home.y);
  });

  it('瞄准到指定敌人身上：箭头锁定变色 + 目标高亮，伤害落在该敌人', () => {
    const { bridge, stage } = make(['punch', 'punch', 'punch', 'punch'], 2);
    bridge.start();
    settleHand(stage); // 弹簧收敛到扇形锚点（headless 无帧驱动）
    const [e0, e1] = bridge.battle.battleState.enemies;
    const first = bridge.getProjection().hand[0];
    const obj = stage._views.get(first.uniqueID);
    const cardPos = obj.position;

    // 拖到第二个敌人身上（槽位由 scene 战线轴换算，读对象实际位置而非硬编码）
    const e1Pos = stage._units.get(e1.uniqueID).position;
    const a = toScreenUI(stage, cardPos.x, cardPos.y, cardPos.z);
    const b = toScreen(stage, e1Pos.x, e1Pos.y + 4, e1Pos.z); // 立牌下半身（组原点在脚底锚点；单位在世界空间）
    stage.handlePointerDown(a.x, a.y);
    stage.handlePointerMove(b.x, b.y);

    // 掠过 → 只有 e1 高亮，箭头锁定变色；卡本体仍留在手牌区
    expect(stage._dragTargetId).toBe(e1.uniqueID);
    expect(stage._units.get(e1.uniqueID).highlighted).toBe(true);
    expect(stage._units.get(e0.uniqueID).highlighted).toBe(false);
    expect(stage._arrow.visible).toBe(true);
    expect(stage._arrow.targetValid).toBe(true);
    expect(obj.position.y).toBeLessThan(-25);

    stage.handlePointerUp(b.x, b.y);
    expect(e1.hp).toBeLessThan(e1.maxHp);  // 指定目标受伤
    expect(e0.hp).toBe(e0.maxHp);          // 首个敌人未受牵连
    expect(stage._units.get(e1.uniqueID).highlighted).toBe(false); // 高亮已清
    expect(stage._arrow.visible).toBe(false);
  });
  it('点主按钮 = 结束回合：敌人行动，玩家掉血', () => {
    const { bridge, stage } = make();
    bridge.start();
    settleHand(stage); // 弹簧收敛到扇形锚点（headless 无帧驱动）
    const hpBefore = bridge.battle.ctx.player.hp;
    click(stage, [BUTTON_POSITIONS.main.x, BUTTON_POSITIONS.main.y]);
    expect(bridge.battle.ctx.player.hp).toBeLessThan(hpBefore);
  });

  it('换卡按钮：进模式手牌高亮 → 点手牌换出（置回牌库底抽1，费用递增）', () => {
    // 牌库需多于初始抽牌数，否则换牌置回牌库底的卡会立刻被抽回手牌
    const { bridge, stage } = make(['punch', 'punch', 'punch', 'punch', 'punch', 'punch']);
    bridge.start();
    settleHand(stage); // 弹簧收敛到扇形锚点（headless 无帧驱动）
    const proj0 = bridge.getProjection();
    expect(proj0.swapCost).toBe(0);
    // 换卡按钮初始可用（自由行动窗 + 手牌非空 + 费用够）
    expect(stage._buttons.swap.cardData).toMatchObject({ label: '换卡', enabled: true });

    // 点换卡按钮进入换卡模式：按钮激活态、手牌全部高亮
    click(stage, [BUTTON_POSITIONS.swap.x, BUTTON_POSITIONS.swap.y]);
    expect(stage._swapMode).toBe(true);
    expect(stage._buttons.swap.cardData.active).toBe(true);
    for (const c of bridge.getProjection().hand) {
      expect(stage._views.get(c.uniqueID).visualState).toBe('highlighted');
    }

    // 点一张手牌换出：手牌数不变、换出的牌置回牌库底、换卡费用递增、模式退出
    const target = bridge.getProjection().hand[0];
    const handBefore = bridge.getProjection().hand.length;
    const tPos = stage._views.get(target.uniqueID).position;
    click(stage, [tPos.x, tPos.y, tPos.z]);

    const proj1 = bridge.getProjection();
    expect(stage._swapMode).toBe(false);
    expect(proj1.hand.length).toBe(handBefore);                     // 抽回 1 张
    expect(proj1.zones.deck.at(-1).uniqueID).toBe(target.uniqueID); // 换出的牌在牌库底（FIFO 尾）
    expect(proj1.hand.some(c => c.uniqueID === target.uniqueID)).toBe(false);
    expect(proj1.swapCost).toBe(1);
    // 退出模式后手牌恢复可发动性着色（不再是换卡高亮）
    for (const c of proj1.hand) {
      expect(stage._views.get(c.uniqueID).visualState).not.toBe('highlighted');
    }
  });

  it('换卡模式可再点按钮取消；换卡模式下点手牌不会误触发拖拽', () => {
    const { bridge, stage } = make();
    bridge.start();
    settleHand(stage); // 弹簧收敛到扇形锚点（headless 无帧驱动）
    click(stage, [BUTTON_POSITIONS.swap.x, BUTTON_POSITIONS.swap.y]);
    expect(stage._swapMode).toBe(true);

    // 模式下按住手牌移动：不构成拖拽（down 被模式拦截）
    const card = bridge.getProjection().hand[0];
    const cPos = stage._views.get(card.uniqueID).position;
    const a = toScreen(stage, cPos.x, cPos.y, cPos.z);
    stage.handlePointerDown(a.x, a.y);
    expect(stage._dragging).toBeNull();
    expect(stage._aiming).toBeNull();
    stage.handlePointerUp(a.x, a.y); // 点按 = 换出

    // 再进模式 → 再点按钮取消
    click(stage, [BUTTON_POSITIONS.swap.x, BUTTON_POSITIONS.swap.y]);
    expect(stage._swapMode).toBe(true);
    click(stage, [BUTTON_POSITIONS.swap.x, BUTTON_POSITIONS.swap.y]);
    expect(stage._swapMode).toBe(false);
    expect(stage._buttons.swap.cardData.active).toBe(false);
  });

  it('结算期选卡输入：候选高亮，点选候选牌即应答', () => {
    const { bridge, stage } = make(['askDiscardStage', 'punch', 'punch', 'punch']);
    bridge.start();
    settleHand(stage); // 弹簧收敛到扇形锚点（headless 无帧驱动）
    const ask = bridge.getProjection().hand.find(c => c.defId === 'askDiscardStage');
    const askPos = stage._views.get(ask.uniqueID).position;
    drag(stage, [askPos.x, askPos.y, askPos.z], [0, 0]); // 打出问询

    const proj = bridge.getProjection();
    expect(proj.pendingInput?.request.kind).toBe('selectHandCard');
    const candidateId = proj.pendingInput.request.candidates[0];
    expect(stage._views.get(candidateId).visualState).toBe('highlighted');

    const deckBefore = proj.counts.deck;
    const cPos = stage._views.get(candidateId).position;
    click(stage, [cPos.x, cPos.y, cPos.z]); // 点选候选牌

    expect(bridge.getProjection().pendingInput).toBeNull();
    // +2：候选牌弃置回牌库底 + 问询卡本身在 stage 2 收尾回牌库底
    expect(bridge.getProjection().counts.deck).toBe(deckBefore + 2);
  });

  it('hover 手牌触发扇形撑开（布局重排）', () => {
    const { bridge, stage } = make();
    bridge.start();
    settleHand(stage); // 弹簧收敛到扇形锚点（headless 无帧驱动）
    const hand = bridge.getProjection().hand;
    const mid = hand[1];
    const before = stage._views.get(mid.uniqueID).scale.x;

    const pos = stage._views.get(mid.uniqueID).position;
    const p = toScreenUI(stage, pos.x, pos.y, pos.z); // 卡牌在 UI pass → uiCamera 投影
    stage.handlePointerMove(p.x, p.y);

    expect(stage._hoveredCardId).toBe(mid.uniqueID);
    settleHand(stage); // 弹簧推进到提拉姿态
    const lifted = stage._views.get(mid.uniqueID);
    expect(lifted.scale.x).toBeGreaterThan(before - 1e-6);
    expect(lifted.scale.x).toBeCloseTo(1.22); // 悬停提拉放大（HAND_FAN_MECHANICS.liftScale）
    const liftY = -65 + (CARD_HEIGHT * HAND_FAN_MECHANICS.liftScale) / 2 + 2;
    expect(lifted.position.y).toBeCloseTo(liftY, 1);
    // 整牌入屏回归：提拉后下缘不低于取景底（-65）——悬浮卡可完整阅读
    expect(lifted.position.y - (CARD_HEIGHT * HAND_FAN_MECHANICS.liftScale) / 2)
      .toBeGreaterThanOrEqual(-65 - 1e-6);
  });

  it('卡面富文本/S 标 token 悬浮不打断手牌 hover（撑开保持，离卡才退出）', () => {
    // 左半卡为 named 热区（模拟 /named、/effect 与 S 标的同协议命中）
    const tokenBake = () => ({
      texture: new THREE.Texture(),
      hitRegions: [{ type: 'named', payload: { name: '瑞米' }, rect: { x: 0, y: 0, w: 100, h: 270 } }],
      width: 200, height: 270,
    });
    const { bridge, stage } = make(['punch'], 1, instantTween, tokenBake);
    bridge.start();
    settleHand(stage);
    const leaves = [];
    bridge.frontendBus.on(EventNames.CARD_LEAVE, p => leaves.push(p));
    const punch = bridge.getProjection().hand[0];
    const obj = stage._views.get(punch.uniqueID);

    // 卡右半（热区外）→ hover 进撑开
    const onBody = toScreenUI(stage, obj.position.x + 4, obj.position.y, obj.position.z);
    stage.handlePointerMove(onBody.x, onBody.y);
    expect(stage._hoveredCardId).toBe(punch.uniqueID);
    settleHand(stage);

    // 移到卡左半（token）：tooltip 出，但手牌不退出撑开（无 CARD_LEAVE、位置保持提拉）
    const onToken = toScreenUI(stage, obj.position.x - 4, obj.position.y, obj.position.z);
    stage.handlePointerMove(onToken.x, onToken.y);
    expect(stage._hoveredCardId).toBe(punch.uniqueID);
    expect(leaves).toHaveLength(0);
    settleHand(stage);
    expect(obj.position.y).toBeCloseTo(-65 + (CARD_HEIGHT * HAND_FAN_MECHANICS.liftScale) / 2 + 2, 1);

    // 离卡（背景）→ 才退出悬浮
    const away = toScreenUI(stage, -80, 20);
    stage.handlePointerMove(away.x, away.y);
    expect(stage._hoveredCardId).toBeNull();
    expect(leaves).toHaveLength(1);
  });

  it('按住 Shift：压着的手牌临时切未应用描述卡面，松开/移开还原', () => {
    const { bridge, stage } = make(['punch']); // 单卡手牌：无扇形遮挡，拾取稳定命中
    bridge.start();
    settleHand(stage); // 弹簧收敛到扇形锚点（headless 无帧驱动）
    const punch = bridge.getProjection().hand[0];
    expect(punch.textAlt).toBe('6伤害'); // 双轨卡：未应用机制文案随投影下发

    const obj = stage._views.get(punch.uniqueID);
    const p = toScreenUI(stage, obj.position.x, obj.position.y, obj.position.z);
    stage.handlePointerMove(p.x, p.y);
    stage.setShiftDown(true);
    expect(obj.altMode).toBe(true);
    stage.setShiftDown(false);
    expect(obj.altMode).toBe(false);

    // 指针不在卡上时按 Shift 不切换（差分目标为空）
    const away = toScreenUI(stage, -80, 20);
    stage.handlePointerMove(away.x, away.y);
    stage.setShiftDown(true);
    expect(obj.altMode).toBe(false);
    stage.setShiftDown(false);
  });

  it('可发动性着色：AP 充足 normal，AP 耗尽后淡灰白 disabled', () => {
    const { bridge, stage } = make();
    bridge.start();
    settleHand(stage); // 弹簧收敛到扇形锚点（headless 无帧驱动）
    const hand = bridge.getProjection().hand;
    expect(stage._views.get(hand[0].uniqueID).visualState).toBe('normal');

    // 3 AP 打 3 张冲拳，剩下的牌 AP 不足 → 不可发动
    for (let i = 0; i < 3; i++) bridge.intents.playCard(hand[i].uniqueID);
    expect(bridge.getProjection().player.actionPoints).toBe(0);
    expect(stage._views.get(hand[3].uniqueID).visualState).toBe('disabled');
  });

  it('前端拒绝灰卡：显示 disabled 的卡不可发起拖拽/瞄准，提交也被拦', () => {
    const { bridge, stage } = make(['guard', 'punch', 'punch', 'punch']);
    bridge.start();
    settleHand(stage); // 弹簧收敛到扇形锚点（headless 无帧驱动）

    // ① AP 耗尽后显示灰的卡：拖拽发起被拒（显示态门）。计数探针装在布置之后
    const hand = bridge.getProjection().hand;
    const guardCard = hand.find(c => c.defId === 'guard');
    for (const c of hand.filter(c => c.uniqueID !== guardCard.uniqueID)) {
      bridge.intents.playCard(c.uniqueID); // 打光 AP（guard 留手）
    }
    let plays = 0;
    const origPlay = bridge.intents.playCard.bind(bridge.intents);
    bridge.intents.playCard = (...a) => { plays += 1; return origPlay(...a); };
    const gray = stage._views.get(guardCard.uniqueID);
    expect(gray.visualState).toBe('disabled');
    const pos = gray.position;
    const a = toScreenUI(stage, pos.x, pos.y, pos.z);
    const b = toScreenUI(stage, 0, 0);
    stage.handlePointerDown(a.x, a.y);
    stage.handlePointerMove(b.x, b.y);
    expect(stage._dragging).toBeNull(); // 灰卡拖不起来
    stage.handlePointerUp(b.x, b.y);
    expect(plays).toBe(0); // 无意图到达后端
    expect(bridge.getProjection().player.shield).toBe(0);

    // ② 显示态落后于后端的误操作防护：卡渲染为灰但后端实际可打（动画积压期场景）
    //    ——人为把一张可打之卡压灰，模拟显示滞后；交互仍应被前端拒绝
    const fresh = make(['guard', 'punch', 'punch', 'punch']);
    fresh.bridge.start();
    settleHand(fresh.stage);
    const card = fresh.bridge.getProjection().hand[0];
    const view = fresh.stage._views.get(card.uniqueID);
    view.setVisualState('disabled'); // 模拟 stale 显示
    let plays2 = 0;
    const orig2 = fresh.bridge.intents.playCard.bind(fresh.bridge.intents);
    fresh.bridge.intents.playCard = (...a) => { plays2 += 1; return orig2(...a); };
    const p1 = toScreenUI(fresh.stage, view.position.x, view.position.y, view.position.z);
    const p2 = toScreenUI(fresh.stage, 0, 0);
    fresh.stage.handlePointerDown(p1.x, p1.y);
    fresh.stage.handlePointerMove(p2.x, p2.y);
    fresh.stage.handlePointerUp(p2.x, p2.y);
    expect(plays2).toBe(0); // 显示灰 = 点不动，后端可打也不行（认知一致优先）
  });

  it('前端拒绝灰按钮：非等待输入时点主按钮不分发 endTurn', () => {
    const { bridge, stage } = make();
    bridge.start();
    settleHand(stage); // 弹簧收敛到扇形锚点（headless 无帧驱动）
    let endTurns = 0;
    const origEnd = bridge.intents.endTurn.bind(bridge.intents);
    bridge.intents.endTurn = () => { endTurns += 1; return origEnd(); };

    // 等待输入：按钮亮，可结束回合
    expect(stage._buttons.main.cardData.enabled).toBe(true);
    click(stage, [BUTTON_POSITIONS.main.x, BUTTON_POSITIONS.main.y]);
    expect(endTurns).toBe(1);

    // 显示滞后（动画积压期）：按钮面灰（后端实际等待中）——点击应被前端拒绝
    const fresh = make();
    fresh.bridge.start();
    const origEnd2 = fresh.bridge.intents.endTurn.bind(fresh.bridge.intents);
    let endTurns2 = 0;
    fresh.bridge.intents.endTurn = () => { endTurns2 += 1; return origEnd2(); };
    // 模拟显示滞后：按钮面灰（后端等待中）——点击应被前端拒绝
    fresh.stage._buttons.main.setCard({ label: '结束回合', enabled: false });
    fresh.stage._buttons.main.setVisualState('disabled');
    click(fresh.stage, [BUTTON_POSITIONS.main.x, BUTTON_POSITIONS.main.y]);
    expect(endTurns2).toBe(0);
    expect(fresh.bridge.getProjection().turn.count).toBe(1); // 未推进回合
  });

  it('咏唱卡：发动回手 + 手牌内激活边缘流光；免费解除离场飞行回牌库', () => {
    const { bridge, stage } = make(['focusChant', 'punch', 'punch', 'punch']);
    bridge.start();
    settleHand(stage); // 弹簧收敛到扇形锚点（headless 无帧驱动）
    const chant = bridge.getProjection().hand.find(c => c.defId === 'focusChant');
    bridge.intents.playCard(chant.uniqueID);

    // 发动：卡回手牌（无槽区），激活 → 边缘流光（特效层），随帧推进
    const view = stage._views.get(chant.uniqueID);
    expect(stage.model.getZone(chant.uniqueID)).toBe('hand');
    expect(view.hasActiveGlow).toBe(true);
    const dot = view.fx.edgeDot;
    const p0 = { x: dot.position.x, y: dot.position.y };
    view.updateFx(0.4);
    expect(dot.position.x !== p0.x || dot.position.y !== p0.y).toBe(true);

    // 再次打出（免费解除）→ 离场飞行回牌库（持久模型：停车不销毁）
    bridge.intents.playCard(chant.uniqueID);
    expect(stage.model.getZone(chant.uniqueID)).toBe('deck');
  });

  it('资源显示（概念图语言）：AP 金币数字 + 魏启单水晶徽章，随消耗切换', () => {
    const { bridge, stage } = make();
    bridge.start();
    settleHand(stage); // 弹簧收敛到扇形锚点（headless 无帧驱动）
    // 开局：AP 3/3 回满；魏启入战半满1 + 回合恢复1 = 2/3（新魏启规则）
    expect(stage._resources.ap.current).toBe(3);
    expect(stage._resources.ap.max).toBe(3);
    expect(stage._resources.mana.current).toBe(2);
    expect(stage._resources.mana.max).toBe(3);

    bridge.intents.playCard(bridge.getProjection().hand[0].uniqueID); // 拳 -1AP
    // AP 2/3：金币数字变化；魏启未消耗不变
    expect(stage._resources.ap.current).toBe(2);
    expect(stage._resources.mana.current).toBe(2);
  });

  it('悬浮卡牌开销 → 资源徽章交互态：可负担=highlight、不足=insufficient、离开=normal', () => {
    const { bridge, stage } = make();
    bridge.start();
    settleHand(stage); // 弹簧收敛到扇形锚点（headless 无帧驱动）
    const hand = bridge.getProjection().hand; // 冲拳 ×4，各 cost 1AP

    // 3AP 悬浮 1AP 卡 → AP 高亮、魏启零开销常态
    bridge.frontendBus.emit(EventNames.CARD_HOVER, { uniqueID: hand[0].uniqueID });
    expect(stage._resources.ap.mode).toBe('highlight');
    expect(stage._resources.mana.mode).toBe('normal');

    bridge.frontendBus.emit(EventNames.CARD_LEAVE, {});
    expect(stage._resources.ap.mode).toBe('normal');

    // 花光 AP 后悬浮同类卡 → 1AP > 0 可用量，进入不足态（覆盖高亮）
    for (let i = 0; i < 3; i++) bridge.intents.playCard(hand[i].uniqueID);
    bridge.frontendBus.emit(EventNames.CARD_HOVER, { uniqueID: hand[3].uniqueID });
    expect(stage._resources.ap.mode).toBe('insufficient');
  });

  it('打出 → 发动展示 → 敌人受伤 → 离场飞行：离场节拍排在效果之后', () => {
    const { bridge, stage } = make();
    bridge.start();
    settleHand(stage); // 弹簧收敛到扇形锚点（headless 无帧驱动）
    const order = [];
    const [origDisplay, origDamage, origFly] = [
      stage._skillDisplay.bind(stage), stage._damageHit.bind(stage), stage._flyOut.bind(stage)];
    stage._skillDisplay = (p, f) => { order.push('display'); return origDisplay(p, f); };
    stage._damageHit = (...args) => { order.push('damage'); return origDamage(...args); };
    stage._flyOut = (...args) => { order.push('flyOut'); return origFly(...args); };

    bridge.intents.playCard(bridge.getProjection().hand[0].uniqueID); // 冲拳
    // sequencer 编排：发动节拍 → 伤害节拍 → 离场节拍（各自阻塞，instantTween 同步播完）
    expect(order).toEqual(['display', 'damage', 'flyOut']);
    // 打出的卡停车回牌库底（持久模型：对象留存，zone 迁移）
    expect([...stage.model.cards.values()].filter(e => e.zone === 'hand')).toHaveLength(3);
    const played = bridge.battle.battleState.zones.deck.at(-1); // FIFO：非消耗打出卡回牌库底
    expect(stage.model.getZone(played.uniqueID)).toBe('deck');
    expect(stage._piles.deck.count).toBe(bridge.getProjection().counts.deck); // 飞进牌库后 sync 才应用
  });

  it('回归·打出卡的空窗期不被弹簧拉回手牌：展示毕（held）即摘弹簧目标', () => {
    // 步进 tween：不自动 complete，手动推进以观察「展示完成 → 离场起飞」之间的空窗
    const pending = [];
    const stepTween = (obj, to, opts = {}) => {
      pending.push(() => {
        if (to.x != null) obj.position.x = to.x;
        if (to.y != null) obj.position.y = to.y;
        if (to.z != null) obj.position.z = to.z;
        if (to.scale != null) obj.scale.set(to.scale, to.scale, 1);
        opts?.onComplete?.();
      });
      return { kill() {} };
    };
    const { bridge, stage } = make(['punch', 'punch', 'punch', 'punch'], 1, stepTween);
    bridge.start();
    while (pending.length) pending.shift()(); // 起手入场飞行全部落位
    settleHand(stage);
    const id = bridge.getProjection().hand[0].uniqueID;
    const view = stage._views.get(id);
    const homeX = view.position.x; // 手牌扇形锚点 x
    expect(homeX).toBeLessThan(-5); // 锚点确在扇形内（与展示位 0 可区分）

    bridge.intents.playCard(id); // 冲拳：sync → 展示（飞中 + 停留）→ 伤害 → 离场
    pending.shift()(); // 展示飞行：卡到中央 (0,-2,60)
    pending.shift()(); // 停留结束：finish + zone 'held' + 弹簧弃管；伤害节拍随后启动
    expect(view.position.x).toBe(0);
    expect(stage.model.getZone(id)).toBe('held');

    // 空窗推帧：离场飞行尚未开始，卡不得被弹簧拉回手牌锚点（回归病灶：飞回手→再飞牌库）
    for (let i = 0; i < 30; i++) stage.springs.update(1 / 60);
    expect(view.position.x).toBeCloseTo(0, 5);
    expect(view.position.y).toBeCloseTo(-2, 5);
    expect(stage.springs._targets.has(id)).toBe(false); // 弃管契约：目标表已摘

    while (pending.length) pending.shift()(); // 离场飞行等余下节拍播完
    expect(stage.model.getZone(id)).toBe('deck');
    expect(view.visible).toBe(false);
  });

  it('伤害节拍分流：全吸收不翻红不击退；生命值受伤才闪红', () => {
    const { bridge, stage } = make(['guard', 'punch', 'punch', 'punch']);
    bridge.start();
    settleHand(stage); // 弹簧收敛到扇形锚点（headless 无帧驱动）
    const guard = bridge.getProjection().hand.find(c => c.defId === 'guard');
    bridge.intents.playCard(guard.uniqueID); // 格挡 → 玩家 5 盾
    expect(bridge.getProjection().player.shield).toBe(5);
    const unit = stage._units.get(bridge.getProjection().player.uniqueID);
    let flashed = 0;
    const origFlash = unit.flash.bind(unit);
    unit.flash = (c) => { flashed++; return origFlash(c); };

    // 全吸收：节拍同步收（instantTween），但不闪红、无伤害文本
    let finished = 0;
    const spritesBefore = stage.particles.activeSpriteCount;
    stage._damageHit(unit, { dealt: 0, shieldAbsorbed: 2 }, () => finished++);
    expect(finished).toBe(1);
    expect(flashed).toBe(0); // 未翻红
    expect(stage.particles.activeSpriteCount - spritesBefore).toBe(1); // 只有吸收数字

    // 生命值受伤：闪红 + 伤害数字（击退链同步播完，闪红窗口已被 restoreColor 关）
    stage._damageHit(unit, { dealt: 3, shieldAbsorbed: 0 }, () => {});
    expect(flashed).toBe(1);
    expect(stage.particles.activeSpriteCount - spritesBefore).toBe(2);
  });

  it('护盾破碎碎粒只在"吸收击穿"时播放：部分吸收不出碎粒', () => {
    const { bridge, stage } = make(['guard', 'punch', 'punch', 'punch']);
    bridge.start();
    settleHand(stage); // 弹簧收敛到扇形锚点（headless 无帧驱动）
    const guard = bridge.getProjection().hand.find(c => c.defId === 'guard');
    bridge.intents.playCard(guard.uniqueID); // 玩家 5 盾
    expect(bridge.getProjection().player.shield).toBe(5);
    const unit = stage._units.get(bridge.getProjection().player.uniqueID);

    // 部分吸收（5 盾吸 2）：有吸收火花，无破碎碎粒（粒子具体数量属视觉调参，只断言语义）
    let before = stage.particles.activeCount;
    stage._damageHit(unit, { dealt: 0, shieldAbsorbed: 2 }, () => {});
    const partial = stage.particles.activeCount - before;
    expect(partial).toBeGreaterThan(0);

    // 吸穿最后一击（显示盾 5 吸 5）：追加破碎碎粒 → 粒量明显多于部分吸收
    before = stage.particles.activeCount;
    stage._damageHit(unit, { dealt: 0, shieldAbsorbed: 5 }, () => {});
    expect(stage.particles.activeCount - before).toBeGreaterThan(partial);
  });

  it('结算期输入挂起时卡不离场；应答后打出卡与被弃卡依次离场', () => {
    const { bridge, stage } = make(['askDiscardStage', 'punch', 'punch', 'punch']);
    bridge.start();
    settleHand(stage); // 弹簧收敛到扇形锚点（headless 无帧驱动）
    const ask = bridge.getProjection().hand.find(c => c.defId === 'askDiscardStage');
    bridge.intents.playCard(ask.uniqueID);

    // 结算暂停等玩家选卡：打出卡已离手进 pending → held 展示位停留（不回手牌、不离场）
    expect(bridge.getProjection().pendingInput).toBeTruthy();
    expect(bridge.getProjection().pending).toContain(ask.uniqueID);
    expect(stage.model.getZone(ask.uniqueID)).toBe('held');

    const victim = bridge.getProjection().pendingInput.request.candidates[0];
    const deckBefore = bridge.getProjection().counts.deck;
    bridge.interaction.respond([victim]);
    // 应答后：被弃卡的 cardDiscarded 节拍 + 打出卡的 cardMoved 节拍依次播完（均回牌库底）
    expect(stage.model.getZone(victim)).toBe('deck');
    expect(stage.model.getZone(ask.uniqueID)).toBe('deck');
    expect(bridge.getProjection().counts.deck).toBe(deckBefore + 2);
  });

  it('焚毁离场：原地燃烧殆尽 → 瞬移到牌库图标位销毁，节拍阻塞至燃尽（sync 在燃尽后）', () => {    const { bridge, stage } = make(['burnStageCard', 'punch', 'punch', 'punch']);
    bridge.start();
    settleHand(stage); // 弹簧收敛到扇形锚点（headless 无帧驱动）
    const rt = bridge.getProjection().hand.find(c => c.defId === 'burnStageCard');
    const obj = stage._views.get(rt.uniqueID);
    const home = obj.position.clone();

    // 拖出打出（免目标卡：过线松手）
    const a = toScreenUI(stage, home.x, home.y, home.z);
    const b = toScreenUI(stage, 0, 0);
    stage.handlePointerDown(a.x, a.y);
    stage.handlePointerMove(b.x, b.y);
    stage.handlePointerUp(b.x, b.y);

    // 展示节拍（instantTween 即完）→ 焚毁节拍：卡离册进入燃烧集，原地不动（不飞坟）
    expect(bridge.battle.battleState.zones.burnt.some(c => c.uniqueID === rt.uniqueID)).toBe(true);
    expect(stage._views.has(rt.uniqueID)).toBe(false); // 焚毁 = 唯一销毁路径
    expect(stage.model.get(rt.uniqueID)).toBeNull();
    expect(stage._burning.has(obj)).toBe(true);
    expect(obj.burning).toBe(true);
    // 焚毁在哪烧就在哪（弹簧未步进时停在展示位；浏览器中是归途上的任意点），
    // 只要没瞬移去牌库图标位——"原地燃烧"语义
    expect(Number.isFinite(obj.position.x)).toBe(true);
    expect(obj.position.x).not.toBeCloseTo(80, 0);

    // 半程泵（燃烧总长 750ms）：前沿推进，节拍仍在阻塞（显示状态未同步，余烬已喷发）
    stage._updateBurning(0.375);
    expect(obj._burnUniforms.uBurn.value).toBeCloseTo(0.5);
    expect(obj._emberPool.length).toBeGreaterThan(0);
    expect(stage._burning.size).toBe(1);

    // 燃尽：瞬移落位牌库图标（不可见即不可察）→ 销毁 → 节拍 finish → 队列跑完 sync
    stage._updateBurning(0.4);
    expect(stage._burning.size).toBe(0);
    expect(stage.uiScene.children.includes(obj)).toBe(false);
    expect(obj.position.x).toBe(80); // 牌库图标位
    expect(obj.position.y).toBe(-55);
    // sync 节拍已跑完：模型手牌数与后端一致
    expect([...stage.model.cards.values()].filter(e => e.zone === 'hand')).toHaveLength(bridge.getProjection().hand.length);
  });

  it('造牌入库：卡面生成→飞入牌库→计数跳增（anim 先于 sync，载荷带牌面视图）', () => {
    const events = [];
    const seen = [];
    const recTween = (obj, to, opts) => {
      // 进度代理（{t:0}，曲线飞行用）无 position——记录器需空安全
      seen.push({ obj, zAtBirth: obj.position?.z ?? null });
      return instantTween(obj, to, opts);
    };
    const { bridge, stage } = make(['chargeUp', 'punch', 'punch', 'punch'], 1, recTween);
    bridge.frontendBus.on('*', (type) => events.push(type));
    bridge.start();
    settleHand(stage); // 弹簧收敛到扇形锚点（headless 无帧驱动）

    const rt = bridge.getProjection().hand.find(c => c.defId === 'chargeUp');
    bridge.intents.playCard(rt.uniqueID);

    // 造牌节拍载荷：附 cardView（Stage 无法从投影反查 deck 卡的牌面）
    const addedIdx = events.indexOf(EventNames.ANIM_CARD_ADDED);
    expect(addedIdx).toBeGreaterThan(-1);
    // 离场类次序：造牌动画先于其后的状态同步（牌库计数随 sync 跳增）
    const syncIdx = events.indexOf(EventNames.ANIM_STATE_SYNC, addedIdx);
    expect(syncIdx).toBeGreaterThan(addedIdx);
    // 牌库计数与后端一致（千击已入库；sync 先于断言已应用）
    expect(bridge.battle.battleState.zones.deck.some(c => c.defId === 'instantStrike')).toBe(true);
    expect(bridge.getProjection().counts.deck).toBe(bridge.battle.battleState.zones.deck.length);
    // 演出用瞬态 spawn 卡：出现过且不留残（instantTween 即完即毁）
    // 高 z 断言：生成卡出生 z=70，盖过结算中发动卡的展示位（z=60）——防遮挡
    const spawn = seen.find(r => String(r.obj.uniqueID || '').startsWith('spawn:'));
    expect(spawn).toBeTruthy();
    expect(spawn.zAtBirth).toBe(70);
    expect(stage.uiScene.children.filter(c => String(c.uniqueID || '').startsWith('spawn:'))).toHaveLength(0);
  });

  it('持久对象：离场停车回牌库 → FIFO 轮转重抽，同一视图身份跨 zone 稳定（无建毁/无注册丢失）', () => {
    const pending = [];
    // 手动 tween：不自动完成，测试逐跳推进
    const manualTween = (obj, to, opts = {}) => {
      const h = { obj, opts, killed: false, kill() { this.killed = true; } };
      pending.push(h);
      return h;
    };
    const { bridge, stage } = make(['guard', 'punch', 'punch', 'punch'], 1, manualTween);
    bridge.start();
    settleHand(stage); // 弹簧收敛到扇形锚点（headless 无帧驱动）
    const guard = bridge.getProjection().hand.find(c => c.defId === 'guard');
    const view = stage._views.get(guard.uniqueID);
    expect(view.visible).toBe(true);

    // 直接驱动离场节拍（回牌库飞行）：zone 即时推进，飞行挂起中
    // （弧线飞行为进度代理补间：带 onUpdate 采样回调；起手入场飞行同款，取最新压栈者）
    const pendingBefore = pending.length;
    stage._departureBeat(guard.uniqueID, EventNames.ANIM_CARD_MOVED, { toZone: 'deck' }, () => {});
    expect(stage.model.getZone(guard.uniqueID)).toBe('deck');
    const flight = pending.slice(pendingBefore)
      .find(h => typeof h.opts?.onUpdate === 'function' && typeof h.opts.onComplete === 'function');
    expect(flight).toBeTruthy();

    // 飞行落地 → 停车（隐形，对象留存；无销毁、无注册交接）
    flight.opts.onComplete();
    expect(view.visible).toBe(false);
    expect(stage.animator.getObject(guard.uniqueID)).toBe(view);

    // FIFO 轮转重抽：backend 置回牌库底后再被抽回手牌 + sync 应用 → 同一对象显形归位
    moveCard(bridge.battle.battleState, guard.uniqueID, 'deck');
    moveCard(bridge.battle.battleState, guard.uniqueID, 'hand');
    stage._applySnapshot(bridge.getProjection());
    expect(stage._views.get(guard.uniqueID)).toBe(view); // 身份不变：无重建
    expect(stage.model.getZone(guard.uniqueID)).toBe('hand');
    expect(view.visible).toBe(true);
    expect(stage.animator.getObject(guard.uniqueID)).toBe(view); // 注册健在
  });

  it('卡牌飞行语言：贝塞尔弧线 + 淡入淡出 + 中段倾转、两端归零', () => {
    // 采样 tween：立即完成并按 10 步模拟全程 onUpdate（含 t=0 起点、t=1 终点）
    const samples = [];
    const simTween = (obj, to, opts = {}) => {
      samples.push({ obj, to, opts });
      const isProgress = to && to.t === 1;
      if (isProgress) {
        for (let i = 0; i <= 10; i++) opts.onUpdate?.(i / 10);
        opts.onComplete?.();
      } else {
        if (to.x != null) obj.position.x = to.x;
        if (to.y != null) obj.position.y = to.y;
        if (to.z != null) obj.position.z = to.z;
        if (to.scale != null) obj.scale.set(to.scale, to.scale, 1);
        opts.onComplete?.();
      }
      return { kill() {} };
    };
    const { bridge, stage } = make(['guard', 'punch', 'punch', 'punch'], 1, simTween);
    bridge.start();
    settleHand(stage); // 弹簧收敛到扇形锚点（headless 无帧驱动）

    // 离场飞行：从手牌到牌库 (80, -55)
    const first = bridge.getProjection().hand[0];
    const home = stage._views.get(first.uniqueID).position.clone();
    const flights = samples.filter(s => s.to?.t === 1);
    expect(flights.length).toBeGreaterThan(0);
    const outFlight = flights.at(-1); // 起手入场飞行在前，取最新（此测试未打出卡——最后一个是入场）
    const view = stage._views.get(first.uniqueID);
    const mat = view.faceMesh.material;

    // 弧线：中段采样点高于直线中点（向上拱）
    const straightMidY = (home.y + -55) / 2;
    // 手动驱动一次离场，捕获其飞行
    stage._departureBeat(first.uniqueID, EventNames.ANIM_CARD_MOVED, { toZone: 'deck' }, () => {});
    const dep = samples.filter(s => s.to?.t === 1).at(-1);
    dep.opts.onUpdate(0.5);
    expect(view.position.y).toBeGreaterThan(straightMidY); // 弧线拱起
    // 倾转：中段非零
    expect(Math.abs(view.rotation.z)).toBeGreaterThan(0.02);
    dep.opts.onUpdate(1);
    dep.opts.onComplete();
    // 落地硬化：位置精确、转正、不透明度复位（淡出不残留）、隐形停车
    expect(view.position.x).toBe(80);
    expect(view.position.y).toBe(-55);
    expect(view.rotation.z).toBe(0);
    expect(mat.opacity).toBe(1);
    expect(view.visible).toBe(false);
    expect(outFlight).toBeTruthy();
  });

  it('whenReady：node/无美术环境立即兑现（超时兜底不拖慢幕间）', async () => {
    const { bridge, stage } = make();
    bridge.start();
    settleHand(stage); // 弹簧收敛到扇形锚点（headless 无帧驱动）
    const t0 = Date.now();
    await stage.whenReady({ timeoutMs: 2500 });
    expect(Date.now() - t0).toBeLessThan(500); // 无在途加载 → 立即兑现而非等满超时
  });

  it('回归·幕间预载：黑幕后队列重放历史 sync 不把显示状态倒回去（手牌不闪烁）', () => {
    // 复现路径：runController 在黑幕中点 applyProjection（预载终态投影），战斗节拍
    // 排在 wipe 之后。battleStart 的 sync 捕获的是起手抽牌前的空手牌快照——若照重放，
    // 手牌会被全部打回牌库（视图隐藏）再由首抽 sync 拉回 = 开局闪烁
    const { bridge, stage } = make(['punch', 'punch', 'punch', 'punch', 'punch', 'punch']);
    let wipeDone = null; // 模拟黑幕 wipe 指令：挡住其后全部战斗节拍
    bridge.sequencer.enqueueInstruction({
      meta: { event: 'wipe' }, durationMs: 60000,
      start: ({ id, emit }) => { wipeDone = () => emit(EventNames.ANIMATION_INSTRUCTION_FINISHED, { id }); },
    });
    bridge.start();
    settleHand(stage); // 弹簧收敛到扇形锚点（headless 无帧驱动）
    stage.applyProjection(bridge.getProjection()); // 黑幕中点预载（runController 行为）
    const handIds = bridge.getProjection().hand.map(c => c.uniqueID);
    expect(handIds).toHaveLength(4);
    for (const id of handIds) expect(stage._views.get(id).visible).toBe(true);

    const rewinds = []; // 手牌被改判到其他 zone = 显示状态倒退
    const handler = ({ id, to }) => { if (handIds.includes(id)) rewinds.push(to); };
    stage.model.on('card-zone', handler);
    wipeDone(); // 揭幕：battleStart/首抽的 sync 依序重放
    expect(rewinds).toEqual([]);
    for (const id of handIds) {
      expect(stage.model.getZone(id)).toBe('hand');
      expect(stage._views.get(id).visible).toBe(true);
    }
  });

  it('回归·换牌离场飞行：真 gsap 下全程有限且可见，落地停车回牌库', async () => {
    // 复现路径：进度补间的 onUpdate 曾拿不到进度实参 → sample(NaN) → NaN 变换，
    // 飞行全程不可见（离场卡"直接消失"）。真 gsap 异步时序驱动，断言飞行中段状态
    const { bridge, stage } = make(['punch', 'punch', 'punch', 'punch', 'punch', 'punch'], 1, 'gsap');
    bridge.start();
    settleHand(stage); // 弹簧收敛到扇形锚点（headless 无帧驱动）
    await new Promise(r => setTimeout(r, 900)); // 起手入场飞行 + 队列排空落定

    const victim = bridge.getProjection().hand[0];
    const view = stage._views.get(victim.uniqueID);
    const homeX = view.position.x;
    bridge.intents.swapCard(victim.uniqueID); // 置回牌库底抽 1：离场节拍同步起飞
    expect(stage.model.getZone(victim.uniqueID)).toBe('deck'); // 节拍时点即推进

    await new Promise(r => setTimeout(r, 170)); // 飞行中段（340ms 补间，ease power1.in）
    expect(stage.animator.getState(victim.uniqueID)).toBe('animating');
    expect(view.visible).toBe(true);
    expect(Number.isFinite(view.position.x)).toBe(true);
    expect(view.position.x).toBeGreaterThan(homeX + 5); // 已离开手牌锚点向牌库飞行

    await new Promise(r => setTimeout(r, 700)); // 落地 + 后续 sync 应用
    // 换牌 = 置回牌库底 + 抽 1（净零）：图标计数与投影一致
    expect(stage._piles.deck.count).toBe(bridge.getProjection().counts.deck);
    expect(view.visible).toBe(false); // 停车（隐形），对象留存
    expect(view.position.x).toBe(80); // 牌库图标位
    expect(view.position.y).toBe(-55);
  });
});
