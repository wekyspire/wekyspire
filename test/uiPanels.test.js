import { describe, it, expect } from 'vitest';
import mitt from 'mitt';
import '../src/core/content/index.js';
import { MapStage } from '../src/stage/stages/MapStage.js';
import { StageManager } from '../src/stage/StageManager.js';
import { PanelObject } from '../src/stage/objects/PanelObject.js';
import { ButtonObject } from '../src/stage/objects/ButtonObject.js';
import { TextBlockObject } from '../src/stage/objects/TextBlockObject.js';
import { panelSnapshot, prepSnapshot, rewardSnapshot, ascensionSnapshot } from '../src/core/run/panelSnapshot.js';
import { SlotRollObject } from '../src/stage/objects/SlotRollObject.js';
import { buildPrepPanel, buildRewardPanel, buildAscensionPanel, buildRoomPanel } from '../src/stage/panels/index.js';
import { createRun, enterBattle, finishBattle } from '../src/core/run/runFlow.js';
import { createSkillRuntime } from '../src/core/state/skillRuntime.js';
import { grantRelic, equipRelic } from '../src/core/run/prep.js';
import { registerRelic } from '../src/core/relics/registry.js';

// 面板测试用 fixture：内容侧第一批没有「主动使用」型遗物，故在此登记一件（契约保留）
registerRelic({
  id: 'panelTestFlask', name: '测试壶', rarity: 'C', cost: 1, uses: 1,
  description: '测试用：战前主动回复 5 生命。',
  prepUse(run) { run.player.hp = Math.min(run.player.maxHp, run.player.hp + 5); },
});
import { EventNames } from '../src/bridge/events.js';
import { createRunController, awaitFloorArrive } from '../src/shell/runController.js';
import { AnimationSequencer } from '../src/core/anim/sequencer.js';
import { clearSave } from '../src/shell/saves.js';
import { attachTooltipForwarding } from '../src/shell/tooltipForward.js';
import { tooltipState } from '../src/shell/tooltipHub.js';

// 休息阶段 UI 迁移的契约测试（用户 2026-09 对本次迁移显式豁免「测试维护暂停」）。
// 只测基础设施契约：快照推导 / 布局确定性 / 拾取路由 / 释放 / 事件幂等；
// 视觉样式与演出不写测试（浏览器由用户验收，uiGallery.html 为视觉门）。

// 假舞台只记录推流；通道语义与 MapStage 的真实现一致（setPanel / setPanelIntentHandler）
function fakeMapStage() {
  const pushes = [];
  const statuses = [];
  const stage = {
    pushes,
    statuses,
    intentHandler: null,
    setStatus(s) { statuses.push(s); },
    setPanel(snap) { pushes.push(snap); },
    setPanelIntentHandler(fn) { stage.intentHandler = fn; },
    setFloor() {},
    // 抵达动画立即回执：真实实现走 gsap，这里只关心"回执之后链条有没有继续"
    arriveFloor(_floor, _total, { onDone } = {}) { onDone?.(); },
  };
  return stage;
}

// 无渲染器的舞台管理器（假 renderer，与既有舞台测试同法）
function fakeManager() {
  const sm = new StageManager({ createRenderer: () => ({ render() {}, setSize() {}, dispose() {} }) });
  sm._viewWidth = 1920;
  sm._viewHeight = 1080;
  return sm;
}

describe('panelSnapshot（core 纯函数：数据下行唯一通道）', () => {
  it('prep：层数/距 Boss/敌人预告名字/遗物可用性全部在 core 内解析', () => {
    const run = createRun({ seed: 11 });
    grantRelic(run, 'blackMountainRock');
    const snap = prepSnapshot(run);

    expect(snap.kind).toBe('prep');
    expect(snap.floor).toBe(1);
    expect(snap.totalFloors).toBeGreaterThan(0);
    // 第 1 层：距首个 Boss 层 = 11 - 1（章 = 10 普通层 + 1 Boss 层）
    expect(snap.toBoss).toBe(10);
    expect(snap.atBossFloor).toBe(false);
    // 敌人名字在 core 侧反查（Stage 不碰注册表）
    expect(snap.encounter.length).toBe(run.encounter.length);
    for (const e of snap.encounter) expect(typeof e.name).toBe('string');

    const horn = snap.relics.find(r => r.id === 'blackMountainRock');
    expect(horn).toBeTruthy();
    expect(horn.equipped).toBe(false);
    expect(horn.canUse).toBe(false); // 未装备 → 不可用（可用性由 core 判定）
  });

  it('prep：装备后装备位数与主动遗物可用性同步；次数耗尽不可用', () => {
    const run = createRun({ seed: 12 });
    grantRelic(run, 'panelTestFlask'); // uses:1 的主动遗物（fixture）
    equipRelic(run, 'panelTestFlask');
    let snap = prepSnapshot(run);
    expect(snap.relicSlots.used).toBe(1);
    expect(snap.relics[0].equipped).toBe(true);
    expect(snap.relics[0].canUse).toBe(true);

    run.relicUses.panelTestFlask = 0; // 次数耗尽
    snap = prepSnapshot(run);
    expect(snap.relics[0].canUse).toBe(false);
  });

  it('非 prep 阶段返回 null（该面板尚未迁移 → 宿主不装配，Vue 侧仍在）', () => {
    const run = createRun({ seed: 13 });
    expect(panelSnapshot(run)).not.toBeNull();
    run.gameStage = 'battle';
    expect(panelSnapshot(run)).toBeNull();
    expect(panelSnapshot(null)).toBeNull();
  });
});

describe('TextBlockObject / ButtonObject（headless 可构造 = 契约测试前提）', () => {
  it('无 document 也能构造与布局；同签名文本不重烘', () => {
    const t = new TextBlockObject({});
    t.setText('层数 1 / 44');
    const first = t.material.map;
    expect(t.scale.x).toBeGreaterThan(0);
    expect(t.scale.y).toBeGreaterThan(0);
    t.setText('层数 1 / 44'); // 同签名
    expect(t.material.map).toBe(first); // 未重烘
    t.setText('层数 2 / 44'); // 变签名
    expect(t.material.map).not.toBe(first);
    t.dispose();
  });

  it('按钮三态签名 diff：同数据不重烘，hover 触发重烘，几何按 10px/wu 换算', () => {
    const b = new ButtonObject({ id: 'b1', width: 200, height: 40 });
    expect(b.geometry.parameters.width).toBeCloseTo(20, 5); // 200px / 10
    expect(b.geometry.parameters.height).toBeCloseTo(4, 5);
    expect(b.setData({ label: '装备' })).toBe(true);
    const map = b.material.map;
    expect(b.setData({ label: '装备' })).toBe(false); // 同签名
    expect(b.material.map).toBe(map);
    b.setHovered(true);
    expect(b.material.map).not.toBe(map); // hover 抬亮重烘
    b.dispose();
  });

  it('disabled 态不因 hover 重烘（视觉与语义一致）', () => {
    const b = new ButtonObject({ id: 'b2' });
    b.setData({ label: '进入战斗', enabled: false });
    const map = b.material.map;
    b.setHovered(true);
    expect(b.material.map).toBe(map);
    b.dispose();
  });
});

describe('PanelObject（widget 行流 + 点击路由）', () => {
  const snapOf = () => {
    const run = createRun({ seed: 21 });
    grantRelic(run, 'blackMountainRock');
    return prepSnapshot(run);
  };

  it('按 widget 列表建行；按钮注册进 picker；点击把 action 交给宿主', () => {
    const stage = new MapStage({});
    const pickables = [];
    const fakePicker = {
      addPickable: (id, obj, opts) => pickables.push({ id, opts }),
      removePickable: (id) => { const i = pickables.findIndex(p => p.id === id); if (i >= 0) pickables.splice(i, 1); },
    };
    const intents = [];
    const panel = new PanelObject({ onIntent: (a) => intents.push(a) });
    panel.attachPicker(fakePicker);
    panel.setWidgets('prep', buildPrepPanel(snapOf()));

    expect(panel.rowCount).toBeGreaterThan(0);
    // 每个按钮一条 pickable；此外遗物行还注册了 token 热区（kind 'row'，供 hover 出效果预览）
    const btnPickables = pickables.filter(p => p.opts.kind === 'button');
    expect(btnPickables.length).toBe(panel.buttons.length);
    expect(pickables.filter(p => p.opts.kind === 'row').length).toBeGreaterThan(0);
    expect(pickables.every(p => p.opts.space === 'ui')).toBe(true);

    // 点「装备」按钮 → 上报 equip intent（Stage 不解释语义）
    const equipBtn = panel.buttons.find(b => b.pickId.startsWith('relic:equip:'));
    expect(equipBtn).toBeTruthy();
    expect(panel.onClick({ kind: 'button', id: equipBtn.pickId })).toBe(true);
    expect(intents).toEqual([{ action: 'equip', relicId: 'blackMountainRock' }]);

    // 点非按钮（背景）不产生意图
    expect(panel.onClick({ kind: 'background' })).toBe(false);
    expect(intents).toHaveLength(1);

    panel.dispose();
    expect(pickables).toHaveLength(0); // 释放即摘 pickable
  });

  it('disabled 按钮不触发意图', () => {
    const intents = [];
    const panel = new PanelObject({ onIntent: (a) => intents.push(a) });
    panel.setWidgets('t', [
      { kind: 'button', id: 'x', label: '进不去', enabled: false, action: { action: 'startBattle' } },
    ]);
    expect(panel.onClick({ kind: 'button', id: 'x' })).toBe(false);
    expect(intents).toHaveLength(0);
    panel.dispose();
  });

  it('重建幂等：重复 setWidgets 不累积行/按钮', () => {
    const panel = new PanelObject({});
    const widgets = [{ kind: 'text', text: 'a' }, { kind: 'button', id: 'k', label: 'K' }];
    panel.setWidgets('t', widgets);
    const n = panel.rowCount;
    panel.setWidgets('t', widgets);
    expect(panel.rowCount).toBe(n);
    expect(panel.buttons).toHaveLength(1);
    expect(panel.children).toHaveLength(n); // 旧行已移除
    panel.dispose();
  });

  it('锚定形态贴左上角（沿用原 Vue 面板 12px 边距 / 250px 宽）', () => {
    const panel = new PanelObject({});
    const halfUIW = ((100 * 16) / 9) / 2;
    expect(panel.position.x).toBeCloseTo(-halfUIW + 1.2, 4);
    panel.dispose();
  });

  it('行流布局：行不重叠、且全部落在 UI 取景带内（面板不越界的硬契约）', () => {
    const run = createRun({ seed: 41 });
    for (const id of ['blackMountainRock', 'panelTestFlask']) grantRelic(run, id);
    equipRelic(run, 'panelTestFlask'); // 触发「卸下 + 使用」两个按钮
    const panel = new PanelObject({});
    panel.setWidgets('prep', buildPrepPanel(prepSnapshot(run)));

    const UI_TOP = -15 + 100 / 2;      // UI_CAMERA_LOOK_AT_Y + WORLD_HEIGHT/2
    const UI_BOTTOM = -15 - 100 / 2;
    let prevBottom = Infinity;
    for (const { top, bottom, h, contentH, kind } of panel.rows) {
      const absTop = panel.position.y + top;
      const absBottom = panel.position.y + bottom;
      // 落在取景带内（上不越顶、下不越底）
      expect(absTop).toBeLessThanOrEqual(UI_TOP + 1e-6);
      expect(absBottom).toBeGreaterThanOrEqual(UI_BOTTOM - 1e-6);
      // 与上一行不重叠（行框由固定行高切分）
      expect(absTop).toBeLessThanOrEqual(prevBottom + 1e-6);
      // 逐行内容不溢出各自行框（文本等比收敛 / 按钮几何即行框）
      expect(contentH, kind).toBeLessThanOrEqual(h + 1e-6);
      prevBottom = absBottom;
    }
    expect(panel.heightWu).toBeGreaterThan(0);
    panel.dispose();
  });
});

describe('MapStage 输入通道与面板装配', () => {
  it('attachInput 建 picker；setPanel(prep) 装配面板并接上意图出口', () => {
    const stage = new MapStage({});
    const sm = fakeManager();
    const intents = [];
    stage.setPanelIntentHandler((a) => intents.push(a));
    stage.attachInput({ stageManager: sm, bus: mitt() });
    expect(stage.picker).toBeTruthy();

    const run = createRun({ seed: 31 });
    grantRelic(run, 'blackMountainRock');
    stage.setPanel(prepSnapshot(run));
    expect(stage.panel).toBeTruthy();
    expect(stage.panel.kind).toBe('prep');
    expect(stage.panel.buttons.length).toBeGreaterThan(0);

    // 点「装备」→ 经 MapStage 的意图出口上报（指针路由的最后一环）
    const btn = stage.panel.buttons.find(b => b.pickId.startsWith('relic:equip:'));
    stage.panel.onClick({ kind: 'button', id: btn.pickId });
    expect(intents).toEqual([{ action: 'equip', relicId: 'blackMountainRock' }]);
    stage.dispose();
  });

  it('setPanel(null) 与 dispose 都清干净（无残留子对象/pickable）', () => {
    const stage = new MapStage({});
    const sm = fakeManager();
    stage.attachInput({ stageManager: sm, bus: mitt() });
    stage.setPanel(prepSnapshot(createRun({ seed: 32 })));
    const panel = stage.panel;
    const registered = panel.buttons.length;
    expect(registered).toBeGreaterThan(0);

    stage.setPanel(null);
    expect(stage.panel).toBeNull();
    expect(stage.uiScene.children.includes(panel)).toBe(false);

    // dispose 幂等且不抛
    stage.dispose();
    stage.dispose();
  });

  it('未登记的 kind 不装配（迁移期该面板仍由 Vue 渲染；四个休息面板现已全部登记）', () => {
    const stage = new MapStage({});
    stage.attachInput({ stageManager: fakeManager(), bus: mitt() });
    stage.setPanel({ kind: 'noSuchPanel' });
    expect(stage.panel).toBeNull();
    // 快照为 null（如战斗阶段）同样清场
    stage.setPanel(prepSnapshot(createRun({ seed: 91 })));
    expect(stage.panel).not.toBeNull();
    stage.setPanel(null);
    expect(stage.panel).toBeNull();
    stage.dispose();
  });

  it('指针按下/抬起命中一致才算点击（防拖出误触）', () => {
    const stage = new MapStage({});
    const sm = fakeManager();
    const intents = [];
    stage.setPanelIntentHandler((a) => intents.push(a));
    stage.attachInput({ stageManager: sm, bus: mitt() });
    const run = createRun({ seed: 33 });
    grantRelic(run, 'blackMountainRock');
    stage.setPanel(prepSnapshot(run));
    const btn = stage.panel.buttons.find(b => b.pickId.startsWith('relic:equip:'));
    const hit = { kind: 'button', id: btn.pickId };

    // 按下 A、抬起 B（背景）→ 不触发
    stage._downHit = hit;
    stage.picker.pick = () => ({ kind: 'background' });
    stage.handlePointerUp(0, 0);
    expect(intents).toHaveLength(0);
    expect(stage._downHit).toBeNull(); // 按压态被消费掉

    stage.dispose();
  });
});

describe('端到端：runController 的快照下行 / 意图上行（真实编排器，非桩）', () => {
  it('创建即推 prep 快照；意图落回 core 后回推新快照（装备位随之变化）', () => {
    clearSave(false); clearSave(true);
    const map = fakeMapStage();
    const ctrl = createRunController({ seed: 77, mapStage: map });

    // 下行：初始快照就是 prep，且 Stage 拿到的是纯数据
    expect(map.pushes.length).toBeGreaterThan(0);
    const first = map.pushes.at(-1);
    expect(first.kind).toBe('prep');
    expect(first.relicSlots).toEqual({ used: 0, total: ctrl.run.player.relicSlots });

    // 上行：面板点击 → runController 分发 → core 落地 → notify 回推新快照
    grantRelic(ctrl.run, 'blackMountainRock');
    expect(typeof map.intentHandler).toBe('function');
    map.intentHandler({ action: 'equip', relicId: 'blackMountainRock' });

    expect(ctrl.run.player.equippedRelics).toEqual(['blackMountainRock']); // core 真的变了
    const after = map.pushes.at(-1);
    expect(after.relicSlots.used).toBe(1);
    expect(after.relics.find(r => r.id === 'blackMountainRock').equipped).toBe(true);

    // 再点卸下 → 回退
    map.intentHandler({ action: 'unequip', relicId: 'blackMountainRock' });
    expect(ctrl.run.player.equippedRelics).toEqual([]);
    expect(map.pushes.at(-1).relicSlots.used).toBe(0);
  });

  it('未知 action 与坏输入不抛错（面板改版期间的前后兼容）', () => {
    clearSave(false); clearSave(true);
    const map = fakeMapStage();
    const ctrl = createRunController({ seed: 78, mapStage: map });
    expect(() => map.intentHandler(null)).not.toThrow();
    expect(() => map.intentHandler({ action: 'shopBuy' })).not.toThrow();
    expect(() => map.intentHandler({ action: 'equip', relicId: 'noSuchRelic' })).toThrow();
  });
});

describe('rewardSnapshot + 模态面板（卡片三选一）', () => {
  // 造一个处于 reward 阶段的 run（胜利 → 生成战后奖励；初始只有体修包 → 核心自动开包）
  function rewardRun(seed = 51) {
    const run = createRun({ seed });
    enterBattle(run);
    finishBattle(run, 'victory');
    return run;
  }

  it('奖励快照：金币入账 + 卡包 + 卡面视图（describe 已在 core 侧解析）', () => {
    const run = rewardRun();
    const snap = rewardSnapshot(run);
    expect(snap.kind).toBe('reward');
    expect(snap.money).toBeGreaterThan(0);
    expect(snap.packs.length).toBeGreaterThan(0);
    // 初始只解锁体修包 → spawnRewards 已自动开包，直接进选卡态
    expect(snap.packId).toBeTruthy();
    expect(snap.skillChoices).toHaveLength(3);
    for (const c of snap.skillChoices) {
      expect(typeof c.defId).toBe('string');
      expect(c.view).toBeTruthy();
      expect(typeof c.view.text).toBe('string'); // 应用前口径的卡面正文
      // keywords 是原始 id（中文标签的映射在 Stage 侧做，core 不依赖 bridge 的标签表）
      expect(c.view.keywords.every(k => typeof k === 'string')).toBe(true);
      expect(c.view.keywords.includes('消耗')).toBe(false);
    }
  });

  it('未选卡包时快照给瓦片列表（多包可选）', () => {
    const run = rewardRun(52);
    run.rewards.packId = null;
    run.rewards.skillChoices = [];
    run.rewards.packs = ['body', 'fire'];
    const snap = rewardSnapshot(run);
    expect(snap.packId).toBeNull();
    expect(snap.packs.map(p => p.id)).toEqual(['body', 'fire']);
    expect(snap.packs.every(p => typeof p.name === 'string' && typeof p.desc === 'string')).toBe(true);
  });

  it('模态面板：卡包瓦片走 chooseRewardPack；卡面走 claimReward；重建不累积', () => {
    const intents = [];
    const pickables = [];
    const panel = new PanelObject({ form: 'modal', onIntent: (a) => intents.push(a) });
    panel.attachPicker({
      addPickable: (id, obj, opts) => pickables.push({ id, opts }),
      removePickable: (id) => { const i = pickables.findIndex(p => p.id === id); if (i >= 0) pickables.splice(i, 1); },
    });

    // ① 瓦片态（多包未选）
    const run = rewardRun(53);
    run.rewards.packId = null; run.rewards.skillChoices = []; run.rewards.packs = ['body', 'fire'];
    panel.setWidgets('reward', buildRewardPanel(rewardSnapshot(run)));
    expect(panel.buttons.find(b => b.pickId.startsWith('pack:'))).toBeTruthy();
    panel.onClick({ kind: 'button', id: 'pack:fire' });
    expect(intents.at(-1)).toEqual({ action: 'chooseRewardPack', packId: 'fire' });

    // ② 卡面态：卡注册为 kind 'card'（Picker 做 UV 二级查询 → 卡面 token tooltip），
    //    整卡命中走 claimReward
    const run2 = rewardRun(54);
    const snap2 = rewardSnapshot(run2);
    panel.setWidgets('reward', buildRewardPanel(snap2));
    const cardPickables = pickables.filter(p => p.opts.kind === 'card');
    expect(cardPickables).toHaveLength(3);
    expect(pickables.every(p => p.opts.space === 'ui')).toBe(true);
    const first = snap2.skillChoices[0].defId;
    panel.onClick({ kind: 'card', id: `reward:${first}` });
    expect(intents.at(-1)).toEqual({ action: 'claimReward', defId: first });

    // 跳过
    panel.onClick({ kind: 'button', id: 'reward:skip' });
    expect(intents.at(-1)).toEqual({ action: 'claimReward', defId: null });

    // 换内容（卡面 → 卡面）不累积子对象
    const before = panel.children.length;
    panel.setWidgets('reward', buildRewardPanel(snap2));
    expect(panel.children.length).toBe(before);
    panel.dispose();
    expect(pickables).toHaveLength(0);
  });

  it('模态形态：内容居中于取景带、落在带内、卡面横向对称', () => {
    const run = rewardRun(55);
    const panel = new PanelObject({ form: 'modal' });
    panel.setWidgets('reward', buildRewardPanel(rewardSnapshot(run)));
    expect(panel.position.x).toBe(0); // 局部原点 = 取景带中心
    const UI_TOP = -15 + 100 / 2; const UI_BOTTOM = -15 - 100 / 2;
    for (const { top, bottom } of panel.rows) {
      expect(panel.position.y + top).toBeLessThanOrEqual(UI_TOP + 1e-6);
      expect(panel.position.y + bottom).toBeGreaterThanOrEqual(UI_BOTTOM - 1e-6);
    }
    const xs = panel._cards.map(c => c.object.position.x);
    expect(xs).toHaveLength(3);
    expect(xs[0] + xs[2]).toBeCloseTo(0, 4); // 三张卡对称于中线
    expect(xs[1]).toBeCloseTo(0, 4);
    panel.dispose();
  });

  it('模态层序：文字/按钮/卡面全部高于背板（否则背板会盖住它们）', () => {
    const run = rewardRun(57);
    const panel = new PanelObject({ form: 'modal' });
    panel.setWidgets('reward', buildRewardPanel(rewardSnapshot(run)));
    const bgZ = panel.backdropZ;
    for (const { object } of panel._rows) {
      if (object) expect(object.position.z).toBeGreaterThan(bgZ); // 文本行
    }
    for (const btn of panel.buttons) expect(btn.position.z).toBeGreaterThan(bgZ);
    for (const c of panel._cards) expect(c.object.position.z).toBeGreaterThan(bgZ);
    panel.dispose();
  });

  it('端到端：奖励意图落回 core（领取 → 卡进组 → 离房）', () => {
    clearSave(false); clearSave(true);
    const map = fakeMapStage();
    const ctrl = createRunController({ seed: 56, mapStage: map });
    enterBattle(ctrl.run);
    finishBattle(ctrl.run, 'victory');
    const snap = rewardSnapshot(ctrl.run);
    expect(snap.skillChoices).toHaveLength(3);

    const deckBefore = ctrl.run.player.deck.length;
    const pick = snap.skillChoices[0].defId;
    map.intentHandler({ action: 'claimReward', defId: pick });
    expect(ctrl.run.player.deck.length).toBe(deckBefore + 1); // 卡真的进组了
    expect(ctrl.run.gameStage).not.toBe('reward'); // 领取即离房
    // notify 回推的是新阶段的面板（reward 已结束）
    expect(map.pushes.at(-1)?.kind).not.toBe('reward');
  });
});

describe('ascensionSnapshot + 种子包勾选（本地交互态）', () => {
  // 造一个处于 ascension 阶段的 run
  async function ascRun(seed = 71) {
    const m = await import('../src/core/run/ascension.js');
    const run = createRun({ seed });
    run.gameStage = 'ascension';
    return { run, m };
  }

  it('常规态快照：四维度带等级、突破说明、跳过可点', async () => {
    const { run } = await ascRun();
    const snap = ascensionSnapshot(run);
    expect(snap.kind).toBe('ascension');
    expect(snap.offering).toBeNull();
    // LEINO_DIMENSIONS 目前只实装火（木/空/体待实装）——快照如实反映 core 的维度表
    expect(snap.dims.map(d => d.id)).toEqual(['fire']);
    expect(snap.dims.every(d => typeof d.level === 'number')).toBe(true);
    expect(snap.maxAscensions).toBeGreaterThan(0);
    expect(snap.healAmount).toBeGreaterThan(0);

    const panel = new PanelObject({ form: 'modal' });
    panel.setWidgets('ascension', buildAscensionPanel(snap));
    const dimTiles = panel.buttons.filter(b => b.pickId.startsWith('dim:'));
    expect(dimTiles).toHaveLength(snap.dims.length);
    expect(panel.buttons.some(b => b.pickId === 'asc:skip')).toBe(true);
    panel.dispose();
  });

  it('种子包态：九张卡面（5 列换行）、确认键初始禁用、刷新键按剩余次数', async () => {
    const { run, m } = await ascRun(72);
    m.chooseAscension(run, 'fire'); // 首次 0→1 → 获赠基石卡并挂起九选三
    expect(run.cardOffering).toBeTruthy();
    const snap = ascensionSnapshot(run);
    expect(snap.offering.cards).toHaveLength(9);
    expect(snap.offering.picks).toBe(3);
    expect(snap.grant).toBeTruthy(); // 首次点亮的体系赠礼
    expect(snap.grant.cardNames.length).toBeGreaterThan(0);

    const panel = new PanelObject({ form: 'modal' });
    panel.setWidgets('ascension', buildAscensionPanel(snap, { selected: new Set() }));
    expect(panel._cards).toHaveLength(9);
    expect(panel.children).toBeTruthy();
    // 9 张 5 列 → 2 行（末行 4 张也居中）
    const ys = [...new Set(panel._cards.map(c => Math.round(c.object.position.y)))];
    expect(ys).toHaveLength(2);
    const confirm = panel._buttonActions.get('seed:confirm');
    expect(confirm.enabled).toBe(false); // 未选满 3 张不可确认
    panel.dispose();
  });

  it('勾选缓冲：local 动作由舞台消化并就地重绘，选满 3 张后确认键可用', async () => {
    const { run, m } = await ascRun(73);
    m.chooseAscension(run, 'fire');
    const snap = ascensionSnapshot(run);
    const stage = new MapStage({});
    const sm = fakeManager();
    const intents = [];
    stage.setPanelIntentHandler((a) => intents.push(a));
    stage.attachInput({ stageManager: sm, bus: mitt() });
    stage.setPanel(snap);
    expect(stage._panelUi.selected.size).toBe(0);

    const ids = snap.offering.cards.map(c => c.defId);
    // 点选前两张：本地消化，不上报 core
    stage._panel.onClick({ kind: 'card', id: `seed:${ids[0]}` });
    stage._panel.onClick({ kind: 'card', id: `seed:${ids[1]}` });
    expect([...stage._panelUi.selected]).toEqual([ids[0], ids[1]]);
    expect(intents).toHaveLength(0);
    // 高亮态反映勾选；确认键仍禁用
    expect(stage._panel._cards.find(c => c.id === `seed:${ids[0]}`).object.visualState).toBe('highlighted');
    expect(stage._panel._buttonActions.get('seed:confirm').enabled).toBe(false);

    // 第三张 → 确认键可用；再点已选的 → 取消勾选
    stage._panel.onClick({ kind: 'card', id: `seed:${ids[2]}` });
    expect(stage._panel._buttonActions.get('seed:confirm').enabled).toBe(true);
    stage._panel.onClick({ kind: 'card', id: `seed:${ids[2]}` });
    expect(stage._panelUi.selected.size).toBe(2);
    expect(stage._panel._buttonActions.get('seed:confirm').enabled).toBe(false);

    // 选满后确认 → 非 local，上报 core（载荷是 id 列表）
    stage._panel.onClick({ kind: 'card', id: `seed:${ids[2]}` });
    stage._panel.onClick({ kind: 'button', id: 'seed:confirm' });
    expect(intents.at(-1)).toEqual({ action: 'chooseSeedCards', defIds: [ids[0], ids[1], ids[2]] });

    // 换面板 → 本地态清空（防旧勾选串到下一处）
    stage.setPanel(null);
    expect(stage._panelUi).toBeNull();
    stage.dispose();
  });

  it('勾选视觉：高亮不被 hover 抢走，且选中卡挂上「已选取」打勾徽标', async () => {
    const { run, m } = await ascRun(75);
    m.chooseAscension(run, 'fire');
    const snap = ascensionSnapshot(run);
    const stage = new MapStage({});
    const sm = fakeManager();
    stage.attachInput({ stageManager: sm, bus: mitt() });
    stage.setPanel(snap);
    const ids = snap.offering.cards.map(c => c.defId);

    // 初始：无勾选 → 无徽标
    expect(stage._panel._cards.every(c => c.badge === null)).toBe(true);

    // 勾选第一张 → 该卡有徽标且高亮
    stage._panel.onClick({ kind: 'card', id: `seed:${ids[0]}` });
    const picked = stage._panel._cards.find(c => c.id === `seed:${ids[0]}`);
    expect(picked.selected).toBe(true);
    expect(picked.badge).toBeTruthy();
    expect(picked.object.children).toContain(picked.badge); // 挂在卡面下（继承位置/缩放）
    expect(picked.object.visualState).toBe('highlighted');

    // hover 另一张卡：勾选卡的高亮必须**保持**（回归：早先被设回 normal）
    stage._panel.onHover({ kind: 'card', id: `seed:${ids[1]}` });
    expect(picked.object.visualState).toBe('highlighted');
    const hovered = stage._panel._cards.find(c => c.id === `seed:${ids[1]}`);
    expect(hovered.object.visualState).toBe('highlighted');
    expect(hovered.badge).toBeNull(); // hover 不产生勾选记号

    // 指针移出全部卡：勾选卡仍高亮
    stage._panel.onHover({ kind: 'background' });
    expect(picked.object.visualState).toBe('highlighted');
    expect(stage._panel._cards.find(c => c.id === `seed:${ids[1]}`).object.visualState).toBe('normal');

    // 取消勾选 → 徽标随之消失（重建）
    stage._panel.onClick({ kind: 'card', id: `seed:${ids[0]}` });
    expect(stage._panel._cards.find(c => c.id === `seed:${ids[0]}`).badge).toBeNull();

    // 释放：徽标必须被显式摘除（CardObject.dispose 不管任意子对象，宿主负责）
    stage._panel.onClick({ kind: 'card', id: `seed:${ids[0]}` });
    const again = stage._panel._cards.find(c => c.id === `seed:${ids[0]}`);
    const badge = again.badge;
    const cardObj = again.object;
    expect(cardObj.children).toContain(badge);
    stage.setPanel(null);
    expect(cardObj.children).not.toContain(badge); // 已摘除，不留幽灵子对象
    stage.dispose();
  });

  it('勾选不超上限（picks 张之后不再接受新勾选）', async () => {
    const { run, m } = await ascRun(74);
    m.chooseAscension(run, 'fire');
    const snap = ascensionSnapshot(run);
    const stage = new MapStage({});
    stage.attachInput({ stageManager: fakeManager(), bus: mitt() });
    stage.setPanel(snap);
    const ids = snap.offering.cards.map(c => c.defId);
    for (const id of ids.slice(0, 5)) stage._panel.onClick({ kind: 'card', id: `seed:${id}` });
    expect(stage._panelUi.selected.size).toBe(snap.offering.picks);
    stage.dispose();
  });
});

describe('roomSnapshot + 房间面板（四房）+ 老虎机揭示闸门', () => {
  function roomRun(room, seed = 81) {
    const run = createRun({ seed });
    run.gameStage = 'room';
    run.currentRoom = room;
    return run;
  }

  it('训练场：升级行带晋升目标名；候选态给卡面；强制尾款不给跳过', () => {
    const run = roomRun('training', 82);
    grantRelic(run, 'blackMountainRock'); // 无关，仅确保 run 完整
    let snap = panelSnapshot(run);
    expect(snap.kind).toBe('room');
    expect(snap.room).toBe('training');
    expect(['upgrade', 'draw']).toContain(snap.training.mode);
    // 快照给的是**牌组全部卡** + 各自升级目标（选卡界面渲染全部卡、不可升级的置灰）
    expect(snap.training.upgradeCards.length).toBe(run.player.deck.length);
    for (const c of snap.training.upgradeCards) {
      expect(c.uniqueID).toBeTruthy();
      expect(c.view).toBeTruthy();
      expect(typeof c.enabled).toBe('boolean');
      expect(c.tipDefId).toBeTruthy();               // hover 预览的目标（无升级目标时回退自身）
      if (c.enabled) expect(c.toView).toBeTruthy();  // 可升级者带升级后的卡面视图
    }

    // 候选态（模拟升级后的强制尾款）
    run.roomData = { drawChoices: ['punch'], forced: true };
    snap = panelSnapshot(run);
    expect(snap.training.choices).toEqual(['punch']);
    expect(snap.training.choicesCards[0].view).toBeTruthy();
    const panel = new PanelObject({ form: 'modal' });
    panel.setWidgets('room', buildRoomPanel(snap));
    expect(panel._cards).toHaveLength(1); // 候选卡面
    expect(panel._buttonActions.has('train:skip')).toBe(false); // 强绑尾款不给跳过
    panel.dispose();

    // 非强制时可跳过
    run.roomData = { drawChoices: ['punch'], forced: false };
    const p2 = new PanelObject({ form: 'modal' });
    p2.setWidgets('room', buildRoomPanel(panelSnapshot(run)));
    expect(p2._buttonActions.get('train:skip').enabled).toBe(true);
    p2.dispose();
    run.roomData = null;
  });

  it('营地：瓦片按选项动态出现，升级行走 campChoose', () => {
    const run = roomRun('camp', 83);
    const snap = panelSnapshot(run);
    expect(snap.camp.options).toContain('rest');
    const panel = new PanelObject({ form: 'modal' });
    panel.setWidgets('room', buildRoomPanel(snap));
    expect(panel.buttons.some(b => b.pickId === 'camp:rest')).toBe(true);
    // 未被打跑时不应有「找回瑞米」
    expect(panel.buttons.some(b => b.pickId === 'camp:recoverRemi')).toBe(false);
    run.remi.drivenOff = true;
    panel.setWidgets('room', buildRoomPanel(panelSnapshot(run)));
    expect(panel.buttons.some(b => b.pickId === 'camp:recoverRemi')).toBe(true);
    panel.dispose();
  });

  it('老虎机：单价/保底概率/吞噬进度都进快照；转动中禁止连点', () => {
    const run = roomRun('slot', 84);
    run.player.money = 200;
    let snap = panelSnapshot(run, { slot: { anim: null, lastSpin: null } });
    expect(snap.slot.cost).toBeGreaterThan(0);       // 首抽单价
    expect(snap.slot.money).toBe(200);
    expect(snap.slot.minorChance).toBeGreaterThan(0); // 保底概率
    expect(snap.slot.majorChance).toBeGreaterThan(0);
    expect(snap.slot.devour).toMatchObject({ progress: 0, every: 7, ready: false });

    const panel = new PanelObject({ form: 'modal' });
    panel.setWidgets('room', buildRoomPanel(snap));
    expect(panel._buttonActions.get('slot:spin').enabled).toBe(true);
    expect(panel.buttons.some(b => b.pickId === 'slot:leave')).toBe(true);

    // 转动中：拉杆禁用（防连点）
    snap = panelSnapshot(run, { slot: { anim: { id: 'a1', prize: { kind: 'moneySmall' } }, lastSpin: null } });
    panel.setWidgets('room', buildRoomPanel(snap));
    expect(snap.slot.spinning.id).toBe('a1');
    expect(panel._buttonActions.get('slot:spin').enabled).toBe(false);

    // 产出挂起：显示奖项文案 + 领取/放弃，且不能继续抽
    run.slotPending = { tier: 'minor', kind: 'moneySmall', money: 22 };
    snap = panelSnapshot(run, { slot: { anim: null, lastSpin: null } });
    expect(snap.slot.pending.money).toBe(22);
    panel.setWidgets('room', buildRoomPanel(snap));
    const texts = panel._rows.filter(r => r.widget.text).map(r => r.widget.text);
    expect(texts.some(t => t.includes('22'))).toBe(true);
    expect(panel._buttonActions.get('slot:take').enabled).toBe(true);
    expect(panel._buttonActions.get('slot:decline').enabled).toBe(true);
    // 处理完才能再抽：产出挂起时干脆不渲染拉杆
    expect(panel._buttonActions.get('slot:spin')).toBeUndefined();
    panel.dispose();
    run.slotPending = null;
  });

  it('事件房：探索前只给探索键，探索后给结果与离开', () => {
    const run = roomRun('event', 85);
    const panel = new PanelObject({ form: 'modal' });
    panel.setWidgets('room', buildRoomPanel(panelSnapshot(run, {})));
    expect(panel.buttons.some(b => b.pickId === 'event:explore')).toBe(true);
    expect(panel.buttons.some(b => b.pickId === 'event:leave')).toBe(false);

    const snap = panelSnapshot(run, { eventResult: { eventId: 'moneyBag', money: 15 } });
    panel.setWidgets('room', buildRoomPanel(snap));
    expect(panel.buttons.some(b => b.pickId === 'event:leave')).toBe(true);
    const texts = panel._rows.filter(r => r.widget.text).map(r => r.widget.text);
    expect(texts.some(t => t.includes('15'))).toBe(true);
    panel.dispose();
  });
});

describe('老虎机揭示闸门：演出完成才出结果（回归：旧实现靠 DOM animationend）', () => {
  it('转轮到时长才回执一次；快照未出现 spinning 时不播', () => {
    const roll = new SlotRollObject({ durationMs: 1000 });
    let done = 0;
    roll.play(() => { done += 1; });
    expect(roll.running).toBe(true);
    expect(roll.update(400)).toBe(false); // 未到时长不回执
    expect(done).toBe(0);
    expect(roll.update(700)).toBe(true);  // 越过时长 → 恰好一次回执
    expect(done).toBe(1);
    expect(roll.running).toBe(false);
    expect(roll.update(50)).toBe(false);  // 结束后不再重复回执
    expect(done).toBe(1);
    roll.dispose();
  });

  it('舞台接线：快照出现 spinning → 播一次 → 回执上报 slotAnimDone（同轮不重播）', () => {
    const stage = new MapStage({});
    stage.attachInput({ stageManager: fakeManager(), bus: mitt() });
    const intents = [];
    stage.setPanelIntentHandler((a) => intents.push(a));
    const run = (() => { const r = createRun({ seed: 86 }); r.gameStage = 'room'; r.currentRoom = 'slot'; return r; })();

    stage.setPanel(panelSnapshot(run, { slot: { anim: null, lastSpin: null } }));
    expect(stage._slotRoll ?? null).toBeNull(); // 未转动时不创建转轮对象（惰性）

    // 转动开始
    stage.setPanel(panelSnapshot(run, { slot: { anim: { id: 'a1', prize: { type: 'money', money: 15 } }, lastSpin: null } }));
    expect(stage._slotRoll.running).toBe(true);

    // 同轮重绘不重播（进度不被打断）
    stage._slotRoll.update(300);
    stage.setPanel(panelSnapshot(run, { slot: { anim: { id: 'a1', prize: { type: 'money', money: 15 } }, lastSpin: null } }));
    expect(stage._slotRoll.running).toBe(true);

    // 播完 → 恰好一次回执，且带上轮次 id
    stage._slotRoll.update(2000);
    expect(intents).toEqual([{ action: 'slotAnimDone', id: 'a1' }]);

    // 结果揭示（spinning 消失）→ 转轮收起
    stage.setPanel(panelSnapshot(run, { slot: { anim: null, lastSpin: { type: 'money', money: 15 } } }));
    expect(stage._slotRoll.running).toBe(false);
    stage.dispose();
  });
});

describe('老虎机完整链路（回归：点拉杆后卡在「转动中」）', () => {
  // 回归背景：结果揭示后只清了 Shell 侧的 slot 瞬态、没有重推面板快照，面板是**快照驱动**的，
  // 于是永远停在最后那份「转动中」快照上（旧版 Vue 面板响应式读 ctrl.slot，掩盖了这一点）。
  it('spin → 转轮播完 → 揭示产出 → 领取后才可再抽', () => {
    clearSave(false); clearSave(true);
    const sm = new StageManager({ createRenderer: () => ({ render() {}, setSize() {}, dispose() {} }) });
    sm._viewWidth = 1920; sm._viewHeight = 1080;
    const map = new MapStage({});
    const ctrl = createRunController({ seed: 95, mapStage: map, stageManager: sm });
    map.attachInput({ stageManager: sm, bus: ctrl.animBus });
    sm.setStage(map); // 触发 onEnter → 注册帧驱动（转轮靠它推进）

    ctrl.run.gameStage = 'room';
    ctrl.run.currentRoom = 'slot';
    ctrl.run.player.money = 200;
    // 保底拉满且大奖概率压到 0 → 本次必中**小奖**（未中奖无产出；小奖不挂"指定升级"）
    ctrl.run.slot = { floor: ctrl.run.floor, rolls: 0, sinceMinor: 20, sinceMajor: -1 };
    const moneyBefore = ctrl.run.player.money;

    ctrl.spin();
    expect(ctrl.run.player.money).toBeLessThan(moneyBefore); // 逻辑先行：扣费立即结算
    expect(ctrl.run.slotPending).toBeTruthy();                // 产出已定，等处理
    expect(ctrl.slot.anim).toBeTruthy();
    expect(map._snap.slot.spinning).toBeTruthy();             // 面板进入转动态
    expect(map._buttonActionsOf('slot:spin').enabled).toBe(false);
    expect(map._slotRoll.running).toBe(true);

    // 帧驱动到转轮播完（1.1s）
    const frames = [...sm._tickHandlers];
    expect(frames.length).toBeGreaterThan(0); // 没有帧驱动 = 转轮永远不会完成
    for (let i = 0; i < 120; i++) for (const f of frames) f(0.016);

    // 揭示：Shell 瞬态与**面板快照**都必须更新（后者才是界面读的）
    expect(ctrl.slot.anim).toBeNull();
    expect(ctrl.slot.lastSpin).toBeTruthy();
    expect(map._snap.slot.spinning).toBeNull();
    expect(map._snap.slot.pending).toBeTruthy();               // 待处理产出
    expect(map._buttonActionsOf('slot:spin').enabled).toBe(false); // 处理完才可再抽

    // 领取（多选一的产出用 slotTake(choice)）——之后拉杆恢复。
    // 真实 runController 的意图入口由 mapStage.setPanelIntentHandler 挂到舞台的 _onIntent 上。
    const pd = ctrl.run.slotPending;
    const choice = pd.choices?.[0]?.id ?? pd.relicChoices?.[0]?.id ?? null;
    // 需要"选一个"的产出（卡多选一/遗物三选一）不发领取键：点候选即领取，两条路径同一意图
    const needsPick = (pd.choices?.length ?? 0) > 0 || (pd.relicChoices?.length ?? 0) > 0;
    if (!needsPick) expect(map._buttonActionsOf('slot:take').enabled).toBe(true);
    map._onIntent({ action: 'slotTake', choice });
    expect(ctrl.run.slotPending).toBeNull();
    expect(map._snap.slot.pending).toBeNull();
    expect(map._buttonActionsOf('slot:spin').enabled).toBe(true);
    map.dispose();
  });
});
describe('全屏选卡界面（营地/训练场升级）：滚动 + hover 预览升级版本 + 返回/确认', () => {
  // 造一个营地房（并把牌组撑大以触发滚动）
  function campRun(deckSize = 24, seed = 101) {
    const run = createRun({ seed });
    run.gameStage = 'room';
    run.currentRoom = 'camp';
    while (run.player.deck.length < deckSize) {
      run.player.deck.push(createSkillRuntime('punch'));
    }
    return run;
  }

  function openPicker(source, run, deckSize) {
    const sm = fakeManager();
    const bus = mitt();
    const shown = [];
    bus.on(EventNames.TOOLTIP_SHOW, (p) => shown.push(p));
    bus.on(EventNames.TOOLTIP_HIDE, () => shown.push({ hidden: true }));
    const stage = new MapStage({});
    const intents = [];
    stage.setPanelIntentHandler((a) => intents.push(a));
    stage.attachInput({ stageManager: sm, bus });
    stage.setPanel(panelSnapshot(run, {}));
    stage._onPanelAction({ action: 'openUpgradePicker', source, local: true });
    return { stage, intents, shown, bus };
  }

  it('入口是「升级一张卡」按钮，且是本地动作（不惊动 core）', () => {
    const run = campRun();
    const intents = [];
    const stage = new MapStage({});
    stage.attachInput({ stageManager: fakeManager(), bus: mitt() });
    stage.setPanelIntentHandler((a) => intents.push(a));
    stage.setPanel(panelSnapshot(run, {}));
    const btn = stage._buttonActionsOf('camp:upgrade');
    expect(btn.action).toEqual({ action: 'openUpgradePicker', source: 'camp', local: true });
    stage._panel.onClick({ kind: 'button', id: 'camp:upgrade' });
    expect(intents).toHaveLength(0);          // 本地动作不上报
    expect(stage.cardPicker.opened).toBe(true);
    stage.dispose();
  });

  it('界面渲染牌组全部卡；不可升级的置灰且点不动', () => {
    const run = campRun();
    const { stage, intents } = openPicker('camp', run);
    const picker = stage.cardPicker;
    expect(picker.cardCount).toBe(run.player.deck.length);

    const cards = panelSnapshot(run, {}).camp.upgradeCards;
    const locked = cards.find(c => !c.enabled);
    if (locked) {
      const obj = picker._entries.find(e => e.uniqueID === locked.uniqueID).obj;
      expect(obj.visualState).toBe('disabled');
      expect(picker.onClick({ kind: 'button', id: `picker:card:${locked.uniqueID}` })).toBe(false);
      expect(picker.selectedIds).toHaveLength(0);
    }
    stage.dispose();
  });

  it('hover 卡牌时发出的 tooltip 是**升级后**的卡（tipDefId），离开即隐藏', () => {
    const run = campRun();
    const { stage, shown } = openPicker('camp', run);
    const cards = panelSnapshot(run, {}).camp.upgradeCards;
    const up = cards.find(c => c.enabled && c.tipDefId !== c.defId);
    expect(up).toBeTruthy(); // 需要一张真能升级的卡

    stage.cardPicker.onHover({ kind: 'button', id: `picker:card:${up.uniqueID}` }, 120, 240);
    const ev = shown.at(-1);
    expect(ev.kind).toBe('card');
    expect(ev.payload.cardId).toBe(up.tipDefId);      // 预览的是升级版本
    expect(ev.payload.cardId).not.toBe(up.defId);
    expect(ev.x).toBe(120); expect(ev.y).toBe(240);   // 跟随指针坐标
    expect(stage.cardPicker._entries.find(e => e.uniqueID === up.uniqueID).obj.visualState)
      .toBe('highlighted');

    stage.cardPicker.onHover({ kind: 'background' }, 0, 0);
    expect(shown.at(-1)).toEqual({ hidden: true });
    stage.dispose();
  });

  it('滚动：牌组够大时可滚，滚出可视带的卡被隐藏（因此不可命中）', () => {
    const run = campRun(40); // 7 行，滚到底时首行才真正滚出可视带
    const { stage } = openPicker('camp', run);
    const picker = stage.cardPicker;
    expect(picker.maxScroll).toBeGreaterThan(0);       // 一屏放不下 → 需要滚动

    const firstRow = picker._entries.slice(0, 6);
    const lastRow = picker._entries.slice(-6);
    expect(firstRow.every(e => e.obj.visible)).toBe(true);  // 首行在可视带内
    expect(lastRow.every(e => !e.obj.visible)).toBe(true);  // 末行初始在带外（滚下来才出现）
    const thumbYTop = picker._bar.thumb.position.y;
    expect(picker._bar.thumb.visible).toBe(true);

    expect(stage.handleWheel(600)).toBe(true);              // 滚轮向下
    expect(picker.scrollY).toBeGreaterThan(0);
    expect(picker._bar.thumb.position.y).toBeLessThan(thumbYTop); // 滑块下移

    // 滚到底：首行被推出带外 → 隐藏（Picker 的 visibleUp 守卫据此使其不可命中）
    expect(stage.handleWheel(100000)).toBe(true);
    expect(picker.scrollY).toBe(picker.maxScroll);
    expect(firstRow.every(e => !e.obj.visible)).toBe(true);
    expect(lastRow.every(e => e.obj.visible)).toBe(true);
    expect(stage.handleWheel(1000)).toBe(false);            // 到底不再移动

    // 滚回顶：首行回到带内、滑块回到起点
    expect(stage.handleWheel(-100000)).toBe(true);
    expect(picker.scrollY).toBe(0);
    expect(firstRow.every(e => e.obj.visible)).toBe(true);
    expect(picker._bar.thumb.position.y).toBeCloseTo(thumbYTop, 5);
    stage.dispose();
  });

  it('确认：选中一张可升级的卡 → 按钮可用 → 上报 core；返回：不上报', () => {
    const run = campRun();
    // 营地路径
    const a = openPicker('camp', run);
    const up = panelSnapshot(run, {}).camp.upgradeCards.find(c => c.enabled);
    a.stage.cardPicker.onClick({ kind: 'button', id: `picker:card:${up.uniqueID}` });
    expect(a.stage.cardPicker.selectedIds).toEqual([up.uniqueID]);
    expect(a.stage._buttonActionsOf('picker:confirm').enabled).toBe(true);
    a.stage.cardPicker.onClick({ kind: 'button', id: 'picker:confirm' });
    expect(a.intents).toEqual([{ action: 'campChoose', option: 'upgrade', uniqueID: up.uniqueID }]);
    expect(a.stage.cardPicker.opened).toBe(false);       // 确认后关闭

    // 训练场路径复用同一界面，但确认走 trainingUpgrade
    const run2 = campRun(12, 102);
    run2.currentRoom = 'training';
    const b = openPicker('training', run2);
    const up2 = panelSnapshot(run2, {}).training.upgradeCards.find(c => c.enabled);
    b.stage.cardPicker.onClick({ kind: 'button', id: `picker:card:${up2.uniqueID}` });
    b.stage.cardPicker.onClick({ kind: 'button', id: 'picker:confirm' });
    expect(b.intents).toEqual([{ action: 'trainingUpgrade', uniqueID: up2.uniqueID }]);

    // 返回：关闭且不上报
    const c = openPicker('camp', run);
    c.stage.cardPicker.onClick({ kind: 'button', id: 'picker:back' });
    expect(c.stage.cardPicker.opened).toBe(false);
    expect(c.intents).toHaveLength(0);
  });

  it('卸面板时选卡界面一并关闭（不留残影）', () => {
    const run = campRun();
    const { stage } = openPicker('camp', run);
    expect(stage.cardPicker.opened).toBe(true);
    stage.setPanel(null);
    expect(stage.cardPicker.opened).toBe(false);
    expect(stage.cardPicker.visible).toBe(false);
    stage.dispose();
  });
});

describe('覆盖物层序：选卡界面/老虎机转轮必须高于休息面板', () => {
  // 回归背景：面板的 z 是**组内偏移**（组在 PANEL=60，内容实际在世界 z=141），
  // 而覆盖物若按绝对值写（如 90/82）就会落在面板背板（140）之后被挡住。
  // 症状：训练场点「升级一张卡」后选卡界面看不见；老虎机转轮同样被挡。
  it('选卡界面与转轮的世界 z 均高于面板内容', () => {
    const run = createRun({ seed: 111 });
    run.gameStage = 'room';
    run.currentRoom = 'training';
    run.player.deck.push(...['punch', 'guard'].map(id => createSkillRuntime(id)));

    const stage = new MapStage({});
    stage.attachInput({ stageManager: fakeManager(), bus: mitt() });
    stage.setPanel(panelSnapshot(run, {}));

    // 面板内容的世界 z（组 z + 组内偏移）
    const panelContentZ = stage._panel.position.z + Math.max(
      ...stage._panel.children.filter(c => c.visible).map(c => c.position.z),
    );

    stage._onPanelAction({ action: 'openUpgradePicker', source: 'training', local: true });
    expect(stage.cardPicker.opened).toBe(true);
    const pickerZ = Math.max(...stage.cardPicker.children.map(c => stage.cardPicker.position.z + c.position.z));
    expect(pickerZ).toBeGreaterThan(panelContentZ);

    // 老虎机转轮：同样是挂在 uiScene 上的覆盖物，必须高于面板
    const slotRun = createRun({ seed: 112 });
    slotRun.gameStage = 'room';
    slotRun.currentRoom = 'slot';
    slotRun.player.money = 20;
    const s2 = new MapStage({});
    s2.attachInput({ stageManager: fakeManager(), bus: mitt() });
    s2.setPanel(panelSnapshot(slotRun, { slot: { anim: { id: 'a1', prize: { type: 'money' } }, lastSpin: null } }));
    const panelZ2 = s2._panel.position.z + Math.max(...s2._panel.children.filter(c => c.visible).map(c => c.position.z));
    expect(s2._slotRoll.position.z).toBeGreaterThan(panelZ2);

    stage.dispose(); s2.dispose();
  });
});

describe('塔楼抵达节拍：等待必须能结束（回归：曾漏 resolve 卡死战后链条）', () => {
  // 回归背景：endBattle 等待抵达动画的 Promise 漏了 resolve，网页端每次战后
  // notify 都不执行——奖励面板不出现、金币停在旧值；Vue 版面板靠 reactive 掩盖了它。
  // 该逻辑单列为 awaitFloorArrive，正是因为在 headless 下无法整链驱动（BattleStage 要 canvas）。
  const tick = (ms) => new Promise(r => setTimeout(r, ms));

  it('动画正常回执 → 立即结束等待（不是等保险丝）', async () => {
    const seq = new AnimationSequencer({ bus: mitt() });
    const map = fakeMapStage();
    const t0 = Date.now();
    await awaitFloorArrive(seq, map, { floor: 3, totalFloors: 44, ms: 5000 });
    expect(Date.now() - t0).toBeLessThan(400); // 回执即放行，远早于 5s 保险丝
  });

  it('动画永不回执（rAF 暂停/队列被堵）→ 由等待侧保险丝放行，不永久卡死', async () => {
    const seq = new AnimationSequencer({ bus: mitt() });
    const map = fakeMapStage();
    map.arriveFloor = () => {}; // 永不回执
    const t0 = Date.now();
    await awaitFloorArrive(seq, map, { floor: 3, totalFloors: 44, ms: 120 });
    const dt = Date.now() - t0;
    expect(dt).toBeGreaterThanOrEqual(100); // 确实等过
    expect(dt).toBeLessThan(1500);          // 但一定会放行
  });

  it('抵达指令带上正确的层号与帧事件（便于排障）', async () => {
    const seq = new AnimationSequencer({ bus: mitt() });
    const seen = [];
    const map = fakeMapStage();
    map.arriveFloor = (f, t, { onDone } = {}) => { seen.push([f, t]); onDone?.(); };
    await awaitFloorArrive(seq, map, { floor: 7, totalFloors: 44, ms: 200 });
    expect(seen).toEqual([[7, 44]]);
    expect(seq._instructions.every(i => i.status === 'finished')).toBe(true); // 队列不留残节拍
  });
});

describe('常驻 tooltip 转发（3D 源 → tooltipHub）', () => {
  it('rest 阶段无 BattleHud 时 tooltip 仍能到达 hub；摘除即隐藏', () => {
    const bus = mitt();
    const detach = attachTooltipForwarding(bus);
    bus.emit(EventNames.TOOLTIP_SHOW, { kind: 'effect', payload: { name: '荆棘' }, x: 30, y: 40 });
    expect(tooltipState.visible).toBe(true);
    expect(tooltipState.model).toBeTruthy();
    detach();
    expect(tooltipState.visible).toBe(false);
  });

  it('同事件被转发两次不改变状态（与 BattleHud 那份转发共存是安全的）', () => {
    const bus = mitt();
    const detach = attachTooltipForwarding(bus);
    const evt = { kind: 'effect', payload: { name: '荆棘' }, x: 30, y: 40 };
    bus.emit(EventNames.TOOLTIP_SHOW, evt);
    const model = tooltipState.model;
    const pos = { x: tooltipState.x, y: tooltipState.y };
    bus.emit(EventNames.TOOLTIP_SHOW, evt); // 第二次
    expect(tooltipState.model).toBe(model); // 同 token 不重算
    expect(tooltipState.x).toBe(pos.x);
    expect(tooltipState.y).toBe(pos.y);
    bus.emit(EventNames.TOOLTIP_HIDE, {});
    bus.emit(EventNames.TOOLTIP_HIDE, {});
    expect(tooltipState.visible).toBe(false);
    detach();
  });

  it('null 总线安全降级（headless / 无舞台）', () => {
    expect(typeof attachTooltipForwarding(null)).toBe('function');
    expect(() => attachTooltipForwarding(null)()).not.toThrow();
  });
});
