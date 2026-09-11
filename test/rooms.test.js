import { describe, it, expect } from 'vitest';
import '../src/core/content/index.js';
import { registerSkill } from '../src/core/skills/registry.js';
import { createSkillRuntime } from '../src/core/state/skillRuntime.js';
import {
  createRun, enterBattle, createRunBattle, finishBattle, completeRewards, completeRoom,
} from '../src/core/run/runFlow.js';
import { chooseSkillReward } from '../src/core/run/rewards.js';
import { CAMP_PLACEHOLDER, campOptions, campRest, campRecoverRemi, campUpgrade } from '../src/core/run/rooms/camp.js';
import { SLOT_PLACEHOLDER, spinSlot } from '../src/core/run/rooms/slotMachine.js';
import { EVENT_SCRIPTS, playEvent } from '../src/core/run/rooms/event.js';

// 测试用晋升链（本文件独立模块注册表）
const noop = { use: () => true, describe: () => '测试卡' };
registerSkill({ id: 'testBase', name: '测试基卡', type: 'normal', tier: 'D', series: 'test',
  cost: { mana: 0, actionPoint: 1 }, charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', promotesTo: 'testUp', ...noop });
registerSkill({ id: 'testUp', name: '测试升卡', type: 'normal', tier: 'C', series: 'test',
  cost: { mana: 0, actionPoint: 1 }, charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', ...noop });

// 进入指定房间的 run（跳过战斗，直接摆到 room 阶段）
const inRoom = (room, { seed = 1, money = 0 } = {}) => {
  const run = createRun({ seed });
  run.gameStage = 'room';
  run.currentRoom = room;
  run.player.money = money;
  return run;
};

describe('营地（RUN_DESIGN §4.3）', () => {
  it('选项动态可见：找回瑞米仅打跑时出现，升级仅有可升级卡时出现', () => {
    const run = inRoom('camp');
    expect(campOptions(run)).toEqual(['rest']);
    run.remi.drivenOff = true;
    expect(campOptions(run)).toEqual(['recoverRemi', 'rest']);
    run.player.deck.push(createSkillRuntime('testBase'));
    expect(campOptions(run)).toEqual(['recoverRemi', 'rest', 'upgrade']);
  });

  it('休整：玩家 50% 生命 + 全部魏启 + 瑞米状态恢复', () => {
    const run = inRoom('camp');
    run.player.maxHp = 30;
    run.player.hp = 1;
    run.player.mana = 0;
    run.remi.drivenOff = true;
    campRest(run);
    expect(run.player.hp).toBe(1 + Math.ceil(run.player.maxHp * CAMP_PLACEHOLDER.restHealRatio));
    expect(run.player.mana).toBe(run.player.maxMana);
    expect(run.remi.drivenOff).toBe(false);
  });

  it('找回瑞米：未打跑抛错；打跑时恢复', () => {
    const run = inRoom('camp');
    expect(() => campRecoverRemi(run)).toThrow(/未被打跑/);
    run.remi.drivenOff = true;
    campRecoverRemi(run);
    expect(run.remi.drivenOff).toBe(false);
  });

  it('营地升级一张卡且不计训练次数', () => {
    const run = inRoom('camp');
    const rt = createSkillRuntime('testBase');
    run.player.deck.push(rt);
    campUpgrade(run, rt.uniqueID);
    expect(rt.defId).toBe('testUp');
    expect(run.player.trainingCount).toBe(0);
  });
});

describe('老虎机（§4.2，权重占位）', () => {
  it('房间/金币校验', () => {
    expect(() => spinSlot(inRoom('camp', { money: 99 }))).toThrow(/不在老虎机房/);
    expect(() => spinSlot(inRoom('slot', { money: SLOT_PLACEHOLDER.spinCost - 1 }))).toThrow(/金币不足/);
  });

  it('多 seed 抽奖：扣费正确且奖项效果自洽', () => {
    const types = new Set();
    for (let seed = 1; seed <= 40; seed++) {
      const run = inRoom('slot', { seed, money: 100 });
      const hp = run.player.hp;
      const res = spinSlot(run);
      types.add(res.type);
      expect(run.player.money).toBe(100 - SLOT_PLACEHOLDER.spinCost
        + (res.type === 'money' ? SLOT_PLACEHOLDER.moneyPrize : 0));
      if (res.type === 'fruit') expect(run.remi.fruits).toBe(1);
      if (res.type === 'training') expect(run.player.trainingCount).toBe(1);
      if (res.type === 'card') expect(run.player.deck.at(-1).defId).toBe(res.defId);
      expect(run.player.hp).toBe(hp); // 老虎机不动生命
    }
    expect(types.size).toBeGreaterThan(1); // 权重表多项均有机会
  });

  it('确定性：同种子抽奖序列一致', () => {
    const seq = (seed) => {
      const run = inRoom('slot', { seed, money: 100 });
      return [spinSlot(run).type, spinSlot(run).type];
    };
    expect(seq(9)).toEqual(seq(9));
  });
});

describe('事件房（§4 占位脚本）', () => {
  it('房间校验 + 事件确定性执行', () => {
    expect(() => playEvent(inRoom('camp'))).toThrow(/不在事件房/);
    const known = EVENT_SCRIPTS.map(s => s.eventId ?? s.id);
    for (let seed = 1; seed <= 10; seed++) {
      const run = inRoom('event', { seed });
      const money = run.player.money;
      const res = playEvent(run);
      expect(known.includes(res.eventId)).toBe(true);
      if (res.eventId === 'moneyBag') expect(run.player.money).toBe(money + 15);
      if (res.eventId === 'spring') expect(run.player.hp).toBe(run.player.maxHp); // 满血时封顶
    }
  });
});

describe('瑞米状态机（§3）', () => {
  it('战斗中瑞米 HP 归零 → 被打跑；后续战斗不出战', () => {
    const run = createRun({ seed: 1 });
    enterBattle(run);
    const battle = createRunBattle(run);
    expect(battle.battleState.allies.length).toBe(1);
    battle.battleState.allies[0].hp = 0; // 模拟瑞米被打趴
    finishBattle(run, 'victory', battle);
    expect(run.remi.drivenOff).toBe(true);

    chooseSkillReward(run, null);
    completeRewards(run); // floor 1 → training
    completeRoom(run);    // 训练房缺省跳过 → floor 2 prep
    enterBattle(run);
    const next = createRunBattle(run);
    expect(next.battleState.allies.length).toBe(0); // 被打跑后不出战
  });
});
