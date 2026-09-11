import { describe, it, expect, beforeEach } from 'vitest';
import '../src/core/content/index.js';
import { snapshotRun, recordSave, readSave, clearSave } from '../src/shell/saves.js';
import { settings, toggleSound, persistSettings } from '../src/shell/settings.js';
import { createRunController } from '../src/shell/runController.js';
import { advanceFloor } from '../src/core/run/runFlow.js';

// 菜单级基础设施：存档快照（§6.4 序列化纪律）+ 检查点恢复 + 设置开关。

const clearAllSaves = () => { clearSave(false); clearSave(true); }; // 两模式槽都清空

describe('存档快照与持久化', () => {
  beforeEach(clearAllSaves);

  it('快照 = 纯数据，JSON 往返无损', () => {
    const ctrl = createRunController();
    const snap = snapshotRun(ctrl.run);
    const round = JSON.parse(JSON.stringify(snap));
    expect(round).toEqual(snap);
    expect(snap.floor).toBe(1);
    expect(snap.player.deck.length).toBeGreaterThan(0);
  });

  it('record / read / clear 三态', () => {
    expect(readSave()).toBeNull();
    const ctrl = createRunController();
    recordSave(ctrl.run);
    const save = readSave();
    expect(save).not.toBeNull();
    expect(save.seed).toBe(ctrl.run.seed);
    clearSave();
    expect(readSave()).toBeNull();
  });
  it('建局即落盘初始检查点（首层战前就有存档）', () => {
    const ctrl = createRunController();
    const save = readSave();
    expect(save).not.toBeNull();
    expect(save.floor).toBe(1);
    expect(save.seed).toBe(ctrl.run.seed);
  });

  it('模式隔离：无限与故事各占一个存档槽，互不覆盖', () => {
    const ctrlA = createRunController({ seed: 7, storyMode: false });
    ctrlA.run.player.money = 10;
    recordSave(ctrlA.run);
    const ctrlB = createRunController({ seed: 8, storyMode: true });
    ctrlB.run.player.money = 20;
    recordSave(ctrlB.run);

    expect(readSave(false).seed).toBe(7);   // 无限槽未被故事局覆盖
    expect(readSave(true).seed).toBe(8);    // 故事槽独立存在
    expect(readSave(false).player.money).toBe(10);
    expect(readSave(true).player.money).toBe(20);
    clearSave(true);
    expect(readSave(true)).toBeNull();
    expect(readSave(false)).not.toBeNull();
  });

  it('storyMode 随快照往返：读档回到存档自身的模式', () => {
    const ctrlA = createRunController({ seed: 5, storyMode: true });
    recordSave(ctrlA.run);
    // 故意传入相反的 storyMode 选项：读档仍以存档自身为准
    const ctrlB = createRunController({ save: readSave(true), storyMode: false });
    expect(ctrlB.run.storyMode).toBe(true);
  });
});

describe('读档恢复（检查点制：层首落盘，战斗内退出 = 回到本层战前）', () => {
  beforeEach(clearAllSaves);

  it('从第 3 层检查点恢复：层数/金币/卡组与落盘时一致', () => {
    const ctrlA = createRunController({ seed: 42 });
    const run = ctrlA.run;
    advanceFloor(run); advanceFloor(run); // 推进到第 3 层（prep）
    run.player.money = 77;
    recordSave(run);

    const ctrlB = createRunController({ save: readSave() });
    expect(ctrlB.run.floor).toBe(3);
    expect(ctrlB.run.gameStage).toBe('prep');
    expect(ctrlB.run.player.money).toBe(77);
    expect(ctrlB.run.seed).toBe(42); // 同 seed：遭遇/房间派发可复现
    expect(ctrlB.run.player.deck.map(rt => rt.defId))
      .toEqual(run.player.deck.map(rt => rt.defId));
  });

  it('读档不重放开场：恢复后层数 > 1 时开场触发不命中', () => {
    const ctrlA = createRunController();
    advanceFloor(ctrlA.run); // floor 2
    recordSave(ctrlA.run);
    const ctrlB = createRunController({ save: readSave() });
    expect(ctrlB.run.floor).toBe(2);
    expect(ctrlB.cutscene.pendingTriggers({ stage: 'prep', floor: 2 })).toEqual([]);
  });
});

describe('设置', () => {
  it('音效开关可翻转且持久化不抛错', () => {
    const before = settings.soundOn;
    toggleSound();
    expect(settings.soundOn).toBe(!before);
    persistSettings();
    toggleSound(); // 还原
    expect(settings.soundOn).toBe(before);
  });
});
