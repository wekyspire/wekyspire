import { describe, it, expect } from 'vitest';
import '../src/core/content/index.js'; // 注册全部最小内容
import { createRng } from '../src/core/state/rng.js';
import {
  createRun, enterBattle, createRunBattle, finishBattle, completeRewards, completeRoom,
  deriveBattleSeed, roomOfFloor, isBossFloor, isTrainingFloor, isPreBossFloor,
  TOTAL_FLOORS, FLOORS_PER_CHAPTER,
} from '../src/core/run/runFlow.js';
import { RunDriver } from '../src/core/run/runDriver.js';
import { chooseSkillReward } from '../src/core/run/rewards.js';
import { ASCENSION_PLACEHOLDER, totalLeino } from '../src/core/run/ascension.js';

describe('塔结构与楼层表（RUN_DESIGN §1/§4）', () => {
  it('44 层 = 4 章，Boss 层 11/22/33/44', () => {
    expect(TOTAL_FLOORS).toBe(44);
    expect(FLOORS_PER_CHAPTER).toBe(11);
    const bosses = [];
    for (let f = 1; f <= TOTAL_FLOORS; f++) if (isBossFloor(f)) bosses.push(f);
    expect(bosses).toEqual([11, 22, 33, 44]);
  });

  it('训练房固定 4N-2 层（Boss 层 22 无房间；10 层被战前营地顶替）', () => {
    const trainings = [];
    for (let f = 1; f <= TOTAL_FLOORS; f++) if (isTrainingFloor(f)) trainings.push(f);
    expect(trainings).toEqual([2, 6, 10, 14, 18, 26, 30, 34, 38, 42]); // 22 是 Boss 层
  });

  it('Boss 战前一层必出营地保底，且优先于训练房', () => {
    expect([10, 21, 32, 43].every(isPreBossFloor)).toBe(true);
    const rng = createRng(1);
    for (const f of [10, 21, 32, 43]) expect(roomOfFloor(f, rng)).toBe('camp');
  });

  it('Boss 层无奖励房；其余层派发四种房之一', () => {
    const rng = createRng(1);
    expect(roomOfFloor(11, rng)).toBeNull();
    for (const f of [3, 4, 7, 8, 12, 15]) {
      expect(['slot', 'camp', 'event']).toContain(roomOfFloor(f, rng));
    }
    expect(roomOfFloor(2, createRng(1))).toBe('training');
  });
});

describe('建局与确定性（§6.1）', () => {
  it('同种子整局可复现：遭遇与房间派发逐层一致', () => {
    const trace = (seed) => {
      const d = new RunDriver({ seed, totalFloors: 11 }).start();
      d.runToEnd();
      return { result: d.result, history: d.history };
    };
    const a = trace(42);
    const b = trace(42);
    expect(a.history.map(h => h.encounter.join('+'))).toEqual(b.history.map(h => h.encounter.join('+')));
    expect(a.history.map(h => h.room)).toEqual(b.history.map(h => h.room));
    expect(a.result).toBe(b.result);
    expect(['victory', 'defeat']).toContain(a.result);
  });

  it('battleSeed 派生：逐层不同且输入确定', () => {
    const s1 = deriveBattleSeed(7, 1);
    expect(s1).toBe(deriveBattleSeed(7, 1));
    expect(s1).not.toBe(deriveBattleSeed(7, 2));
    expect(s1).not.toBe(deriveBattleSeed(8, 1));
  });

  it('故事模式接缝：profile 携带瑞米基线等级（§6.4）', () => {
    const run = createRun({ seed: 1, profile: { remiBaseLevel: 3 } });
    expect(run.remi.level).toBe(3);
    expect(createRun({ seed: 1 }).remi.level).toBe(1); // 无限模式传空 profile
  });
});

describe('阶段机迁移', () => {
  it('完整链路：prep → battle → reward → room → prep(下一层)', () => {
    const run = createRun({ seed: 5 });
    expect(run.gameStage).toBe('prep');
    expect(Array.isArray(run.encounter) && run.encounter.length > 0).toBe(true);

    enterBattle(run);
    expect(run.gameStage).toBe('battle');
    const battle = createRunBattle(run);
    expect(battle.battleState.enemies.length).toBe(run.encounter.length);

    finishBattle(run, 'victory');
    expect(run.gameStage).toBe('reward');
    expect(run.rewards.skillChoices.length).toBe(3);
    chooseSkillReward(run, run.rewards.skillChoices[0]);
    completeRewards(run); // floor 1 → 随机房（训练房已移至 4N-2 层）
    expect(run.gameStage).toBe('room');
    expect(['slot', 'camp', 'event']).toContain(run.currentRoom);
    completeRoom(run);
    expect(run.gameStage).toBe('prep');
    expect(run.floor).toBe(2);
  });

  it('战斗失败 → run 直接终局', () => {
    const run = createRun({ seed: 5 });
    enterBattle(run);
    finishBattle(run, 'defeat');
    expect(run.gameStage).toBe('end');
    expect(run.result).toBe('defeat');
  });

  it('Boss 层胜利：记一次删卡机会且无奖励房直达下一层', () => {
    const run = createRun({ seed: 5, totalFloors: 11 });
    run.gameStage = 'battle';
    run.floor = 11;
    finishBattle(run, 'victory');
    expect(run.pendingCardRemoval).toBe(1);
    chooseSkillReward(run, null); // 跳过技能奖励
    completeRewards(run); // Boss 层无房间 → 登顶
    expect(run.gameStage).toBe('end');
    expect(run.result).toBe('victory');
  });

  it('未领取奖励时 completeRewards 抛错', () => {
    const run = createRun({ seed: 5 });
    enterBattle(run);
    finishBattle(run, 'victory');
    expect(() => completeRewards(run)).toThrow(/尚未领取/);
  });

  it('阶段不符时抛错（防跨阶段误调用）', () => {
    const run = createRun({ seed: 5 });
    expect(() => finishBattle(run, 'victory')).toThrow(/阶段不符/);
    expect(() => completeRoom(run)).toThrow(/阶段不符/);
  });
});

describe('RunDriver 整局驱动（§6.5）', () => {
  it('一行跑完整局（11 层一章，含 Boss）：训练房/进阶缺省处理一致', () => {
    const d = new RunDriver({ seed: 7, totalFloors: 11 }).start();
    d.runToEnd();
    expect(d.isFinished()).toBe(true);
    expect(['victory', 'defeat']).toContain(d.result);
    // 每层都有战斗记录，层数连续
    expect(d.history.map(h => h.floor)).toEqual(
      Array.from({ length: d.history.length }, (_, i) => i + 1));
    // 训练房缺省处理：每个训练房都被计入 trainingCount
    const trainingRooms = d.history.filter(h => h.room === 'training').length;
    expect(trainingRooms).toBeGreaterThan(0);
    expect(d.run.player.trainingCount).toBe(trainingRooms);
    // 进阶缺省处理：门槛曲线 = 首进阶 1 次训练，此后每 2 次训练 +1 级
    const p = d.run.player;
    const { firstTrainings, trainingsPerLevel, maxAscensions } = ASCENSION_PLACEHOLDER;
    let expected = 0;
    while (expected < maxAscensions
      && p.trainingCount >= firstTrainings + expected * trainingsPerLevel) expected += 1;
    expect(p.ascensionCount).toBe(expected);
    expect(totalLeino(d.run)).toBe(p.ascensionCount);
    expect(p.leino.fire).toBe(p.ascensionCount); // 占位缺省策略加火灵脉
  });

  it('onRewards/onRoom 钩子在每个对应阶段被调用', () => {
    const seen = { rewards: 0, rooms: 0 };
    const d = new RunDriver({ seed: 3, totalFloors: 11 }).start();
    d.onRewards = () => { seen.rewards++; };
    d.onRoom = () => { seen.rooms++; };
    d.runToEnd();
    expect(seen.rewards).toBe(d.history.length); // 每场胜利后一次（失败终局则少于层数）
    expect(seen.rooms).toBe(d.history.filter(h => h.room).length);
  });
});

describe('完整 44 层整局（测试计划：胜利/失败两条终局路径）', () => {
  it('胜利路径：流程完整性（坦克验证流）——44 层连续无死路', () => {
    // 敌人强度已随楼层缩放（floorEnemyGenerator），天真策略中后期阵亡是设计使然；
    // 本用例只验证流程完整性：坦克玩家（maxHp 999 + 攻击面板 40，战斗必然终局）
    // + 默认策略杀穿全塔，层数连续、Boss 层无奖励房、无卡死。
    // 平衡口径由「天真策略推进下限」另测。
    const d = new RunDriver({ seed: 5, player: { maxHp: 999, attack: 40 } }).start();
    d.runToEnd();
    expect(d.result).toBe('victory');
    expect(d.isFinished()).toBe(true);
    expect(d.history.length).toBe(TOTAL_FLOORS);
    expect(d.history.map(h => h.floor)).toEqual(
      Array.from({ length: TOTAL_FLOORS }, (_, i) => i + 1));
    // Boss 层无奖励房
    for (const h of d.history) {
      if (isBossFloor(h.floor)) expect(h.room).toBeNull();
    }
  });

  it('平衡下限：天真策略至少能过开局教学段（推进到 floor 4）', () => {
    // 设计口径（2026-08 定调）：多敌压力从第 2 层起铺开，「无脑出牌」只保底
    // 过开局教学段（约 3-4 层）；此后被多敌战斗拦下属预期，不设更高保底。
    let reached = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const d = new RunDriver({ seed }).start();
      d.runToEnd();
      if (d.result === 'victory' || d.floor >= 4) reached++;
    }
    // 2026-09 实测 31/40：防御向重设计（花刀系伤害改护盾 / 先发削弱 / 斩慢热起手
    // 0 充能）主动收走了天真策略的部分伤害上限，教学段过率 88% → 78% 属预期下移。
    // 若再明显下滑，优先查卡池/初始卡组/初始能力/遭遇编成改动。
    expect(reached).toBeGreaterThanOrEqual(30); // 30/40 = 75% 过教学段
  });

  it('失败路径：脆皮玩家首场阵亡 → run 失败终局', () => {
    // 钉死强化史莱姆（高 HP 高攻，首回合必打不死且必挨刀）——初始卡组的
    // 肾上腺素爆发已能一回合秒掉基础弱敌，1 血照样过层，不能用裸怪测阵亡
    const d = new RunDriver({ seed: 5, player: { maxHp: 1 } }).start();
    d.run.encounter = [{ defId: 'slime', maxHp: 999, attack: 99 }];
    d.runToEnd();
    expect(d.result).toBe('defeat');
    expect(d.floor).toBe(1);
  });
});
