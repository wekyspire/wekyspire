import { describe, it, expect, beforeEach } from 'vitest';
import '../src/core/content/index.js';
import {
  createRun, enterBattle, finishBattle, assembleBattle, deriveBattleSeed,
} from '../src/core/run/runFlow.js';
import { RunDriver } from '../src/core/run/runDriver.js';
import { createRunController } from '../src/shell/runController.js';
import { takeSlotPrize } from '../src/core/run/rooms/slotMachine.js';
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

  it('老虎机 roll：逻辑先行、回执后揭示产出、伪回执拒绝、产出未处理不可再抽', () => {
    const ctrl = createRunController({ seed: 42 });
    ctrl.run.gameStage = 'room';
    ctrl.run.currentRoom = 'slot';
    ctrl.run.player.money = 400;
    // 保底拉满 → 本次必中：这两个用例的语义依赖"有产出待处理"（未中奖不产生产出）
    ctrl.run.slot = { floor: ctrl.run.floor, rolls: 0, sinceMinor: 20, sinceMajor: 0 };

    ctrl.spin(); // 第一次拉杆：队列空闲 → 立即起 roll
    const firstId = ctrl.slot.anim.id;
    expect(ctrl.slot.lastSpin).toBeNull();          // 结果未揭示（动画未落定）
    expect(ctrl.run.player.money).toBeLessThan(400); // 逻辑先行：扣费已结算
    expect(ctrl.run.slotPending).toBeTruthy();       // 产出已定，等领取/放弃

    ctrl.spin(); // 产出未处理：再拉杆无效（不会排队第二条）
    expect(ctrl.slot.anim.id).toBe(firstId);
    expect(ctrl.reportSlotAnimDone('bogus-id')).toBe(false); // 伪回执拒绝

    expect(ctrl.reportSlotAnimDone(firstId)).toBe(true);
    expect(ctrl.slot.lastSpin).toBeTruthy();         // 产出揭示
    expect(ctrl.slot.anim).toBeNull();
    expect(ctrl.sequencer.pendingCount).toBe(0);     // 队列排干

    // 领取后才允许再抽
    const pd = ctrl.run.slotPending;
    takeSlotPrize(ctrl.run, pd.choices?.[0]?.id ?? pd.relicChoices?.[0]?.id ?? null);
    ctrl.run.slot = { ...ctrl.run.slot, sinceMinor: 20, sinceMajor: 0 }; // 同上：保证有产出
    ctrl.spin();
    expect(ctrl.slot.anim).toBeTruthy();
    expect(ctrl.slot.anim.id).not.toBe(firstId);
    ctrl.reportSlotAnimDone(ctrl.slot.anim.id);
    expect(ctrl.sequencer.pendingCount).toBe(0);
  });
});
