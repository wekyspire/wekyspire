import { describe, it, expect, beforeEach } from 'vitest';
import '../src/core/content/index.js';
import {
  createRun, enterBattle, finishBattle, assembleBattle, deriveBattleSeed,
} from '../src/core/run/runFlow.js';
import { RunDriver } from '../src/core/run/runDriver.js';
import { createRunController } from '../src/shell/runController.js';
import { recordSave, readSave, clearSave } from '../src/shell/saves.js';

// run 生命周期（Shell 编排器层）：存档 rng 直存、舞台防重入、房间瞬态清理、
// 战斗装配单一事实源。核心状态机本身见 runFlow.test.js。

const clearAllSaves = () => { clearSave(false); clearSave(true); };

describe('存档 rng 状态直存（读档时间线 = 活局时间线）', () => {
  beforeEach(clearAllSaves);

  it('读档后 rng 内部态与活局一致，后续随机流不漂移', () => {
    const live = new RunDriver({ seed: 77 }).start();
    let guard = 0;
    while (live.floor < 4 && !live.isFinished() && guard++ < 200) live.step(); // 真实路径过 3 层（房间派发真实消耗 rng）
    expect(live.floor).toBe(4);

    recordSave(live.run);
    const loaded = createRunController({ save: readSave(false) });
    expect(loaded.run.floor).toBe(4);
    // 修复前：恢复回放只 advanceFloor（不消耗 run.rng），读档后 rng 状态 ≠ 活局
    expect(loaded.run.rng.getState()).toBe(live.run.rng.getState());
    for (let i = 0; i < 5; i++) {
      expect(loaded.run.rng.next()).toBe(live.run.rng.next()); // 后续房间/事件派发完全一致
    }
  });

  it('快照含 rngState（uint32 可 JSON 往返）', () => {
    const ctrl = createRunController({ seed: 9 });
    const raw = readSave(false);
    expect(raw.rngState).toBe(ctrl.run.rng.getState());
    expect(Number.isInteger(raw.rngState)).toBe(true);
  });
});

describe('战斗装配单一事实源（headless 与真实游戏共用）', () => {
  it('assembleBattle：编成按遭遇、种子按派生、瑞米被打跑不出战', () => {
    const run = createRun({ seed: 3 });
    enterBattle(run);
    run.encounter = ['slime'];
    const asm = assembleBattle(run);
    expect(asm.enemies.map(e => e.defId)).toEqual(['slime']);
    expect(asm.allies.map(a => a.defId)).toEqual(['remi']);
    expect(asm.seed).toBe(deriveBattleSeed(run.seed, run.floor));
    run.remi.drivenOff = true;
    expect(assembleBattle(run).allies).toEqual([]);
  });
});

describe('进入战斗防重入', () => {
  beforeEach(clearAllSaves);

  it('转场 pending 期间重复调用只开一场', async () => {
    const ctrl = createRunController({ seed: 5 });
    ctrl.startBattle();
    ctrl.startBattle(); // 同步双击：第二次应被 battlePending 挡下
    await new Promise(r => setTimeout(r, 20));
    expect(ctrl.run.gameStage).toBe('battle');
    expect(ctrl.getBattleBridge()).toBeTruthy();
  });
});

describe('房间瞬态清理', () => {
  beforeEach(clearAllSaves);

  it('进入新奖励房时清空上一房的老虎机/事件结果', () => {
    const ctrl = createRunController({ seed: 42 });
    ctrl.slot.lastSpin = { type: 'nothing' };       // 伪造上一房残留
    ctrl.eventRoom.result = { eventId: 'moneyBag', money: 15 };
    enterBattle(ctrl.run);
    finishBattle(ctrl.run, 'victory', null);
    ctrl.claimReward(null); // 跳过技能 → 第 1 层为训练房
    expect(ctrl.run.gameStage).toBe('room');
    expect(ctrl.slot.lastSpin).toBeNull();
    expect(ctrl.eventRoom.result).toBeNull();
  });

  it('事件房重复探索不重复结算', () => {
    const ctrl = createRunController({ seed: 42 });
    ctrl.run.gameStage = 'room';       // 直接构造事件房（房间调度本身见 runFlow.test.js）
    ctrl.run.currentRoom = 'event';
    ctrl.triggerEvent();
    expect(ctrl.eventRoom.result).toBeTruthy();
    const afterFirst = ctrl.run.rng.getState();
    ctrl.triggerEvent(); // 二次探索被拦：不重复消耗 rng、不重复入账
    expect(ctrl.run.rng.getState()).toBe(afterFirst);
    expect(ctrl.eventRoom.result.eventId).toBeTruthy();
  });

  it('老虎机 roll（S4）：逻辑先行、演出串行、回执揭示、伪回执拒绝', () => {
    const ctrl = createRunController({ seed: 42 });
    ctrl.run.gameStage = 'room';
    ctrl.run.currentRoom = 'slot';
    ctrl.run.player.money = 100;

    ctrl.spin(); // 第一次拉杆：队列空闲 → 立即起 roll
    const firstId = ctrl.slot.anim.id;
    expect(ctrl.slot.lastSpin).toBeNull();       // 结果未揭示（动画未落定）
    expect(ctrl.run.player.money).not.toBe(100); // 逻辑先行：扣费已结算（中奖则含奖金）

    ctrl.spin(); // 连点第二次：第二条 roll 指令排在第一条后
    expect(ctrl.slot.anim.id).toBe(firstId);     // 仍是第一条在播（严格串行）
    expect(ctrl.reportSlotAnimDone('bogus-id')).toBe(false); // 伪回执拒绝

    expect(ctrl.reportSlotAnimDone(firstId)).toBe(true); // UI animationend 回执
    expect(ctrl.slot.lastSpin).toBeTruthy();     // 第一条结果揭示
    expect(ctrl.slot.anim).toBeTruthy();         // 第二条同步接棒
    const secondId = ctrl.slot.anim.id;
    expect(secondId).not.toBe(firstId);

    ctrl.reportSlotAnimDone(secondId);
    expect(ctrl.slot.anim).toBeNull();
    expect(ctrl.sequencer.pendingCount).toBe(0); // 全部排干
  });
});
