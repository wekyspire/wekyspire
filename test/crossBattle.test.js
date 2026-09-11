import { describe, it, expect } from 'vitest';
import '../src/core/content/index.js';
import * as THREE from 'three';
import mitt from 'mitt';
import Player from '../src/core/state/player.js';
import { createRunState } from '../src/core/state/runState.js';
import { createSkillRuntime } from '../src/core/state/skillRuntime.js';
import { getEnemyDefinition } from '../src/core/enemies/registry.js';
import { createBridge, EventNames } from '../src/bridge/index.js';
import { StageManager } from '../src/stage/StageManager.js';
import { BattleStage } from '../src/stage/stages/BattleStage.js';
import { DisplayModel } from '../src/bridge/displayModel.js';
import AnimationSequencer from '../src/core/anim/sequencer.js';

// 跨战斗回归：shell 同款接线（共享 animBus + runSequencer + DisplayModel）。
// 历史缺陷：BattleStage.dispose 把 mitt on() 的返回值当 off 用（实际 undefined），
// '*' 监听跨场泄漏——幽灵舞台继续处理新战斗的 sync 节拍，抢先写共享模型的
// faceSig，真舞台看到签名相同跳过烘面 → 第二场战斗卡牌全白（存档重进才恢复）。
// 修复 = 自持 handler 走 off() + _disposed 幽灵守卫。本测试锁定该语义。

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

describe('跨战斗：共享 DisplayModel / 总线 / 队列的第二场战斗', () => {
  it('旧舞台 dispose 后不再处理节拍；第二场全部手牌烘面（非白卡）', () => {
    const displayModel = new DisplayModel();
    const animBus = mitt();
    const runSequencer = new AnimationSequencer({ bus: animBus, finishedEvent: EventNames.ANIMATION_INSTRUCTION_FINISHED });
    const sm = new StageManager({ createRenderer: () => ({ render() {}, setSize() {}, dispose() {} }) });
    sm.attach({});
    sm.resize(1000, 1000);

    const playBattle = (deck) => {
      const runState = createRunState({ player: new Player({ maxHp: 30, maxMana: 3, maxActionPoints: 3 }) });
      runState.player.deck = deck.map(d => createSkillRuntime(d));
      const bridge = createBridge({
        runState,
        enemies: [getEnemyDefinition('slime').createUnit()],
        seed: 11,
        frontendBus: animBus,
        sequencer: runSequencer,
      });
      const stage = new BattleStage({
        bridge, stageManager: sm, displayModel,
        bakeFace: fakeBake, bakeLabel: fakeBakeLabel, tween: instantTween,
      });
      return { bridge, stage };
    };

    // ---- 战斗 1 ----
    const b1 = playBattle(['punch', 'punch', 'punch', 'punch']);
    b1.bridge.start();
    b1.stage.dispose(); // 退场：只销毁视图，模型留存
    let ghostCalls = 0;
    const b1Contents = b1.stage._syncCardContents.bind(b1.stage);
    b1.stage._syncCardContents = (p) => { ghostCalls += 1; return b1Contents(p); };

    // ---- 战斗 2（新 bridge + 新 stage，同一模型/总线/队列）----
    const b2 = playBattle(['punch', 'guard', 'duckHead', 'slash', 'punch']);
    b2.bridge.start();

    const proj = b2.bridge.getProjection();
    expect(ghostCalls).toBe(0); // 幽灵守卫：旧舞台不再处理新战斗的任何节拍

    let unbaked = 0;
    for (const c of proj.hand) {
      const view = b2.stage._views.get(c.uniqueID);
      if (!view?.cardData) unbaked++; // setCard 未跑 = 白卡
      if (!view?.visible) unbaked++;
    }
    expect(unbaked).toBe(0);
    // 模型/视图与后端一致
    expect(displayModel.cards.size).toBe(proj.hand.length + proj.counts.deck);
    expect(b2.stage._views.size).toBe(displayModel.cards.size);
    // 手牌 zone 全部就位
    expect([...displayModel.cards.values()].filter(e => e.zone === 'hand')).toHaveLength(proj.hand.length);
  });
});
