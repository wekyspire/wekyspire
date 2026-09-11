import { createRunState } from '../state/runState.js';
import { createBattle } from '../flow/battle.js';
import { spawnEnemy } from './floorEnemyGenerator.js';
import { getAllyDefinition } from '../allies/registry.js';
import { spawnRewards, isRewardsClaimed } from './rewards.js';
import { ascensionReady } from './ascension.js';
import { ensureShopStock } from './rooms/shop.js';
import { accrueBankInterest, consumePendingDebuffs, bankOnDeath, bankOnVisit } from './rooms/bank.js';
import { ensureGurpasStock, GURPAS_FLOOR } from './rooms/gurpas.js';
import { activeRelics } from './prep.js';
import { getRelicDefinition } from '../relics/registry.js';

// run 层流程：普通确定性状态机，不套结算指令树（RUN_DESIGN §6）。
// 阶段机：prep（战前准备/地图）→ battle → reward（战后固定奖励）→ room（奖励房）
//        → [ascension（训练达标时插入，§5.3）] → prep(下一层) → … → end
// 本文件只管阶段迁移与楼层表；奖励/房间内部逻辑在 rewards.js 与 rooms/ 内。

// ---- 塔结构（§1.1） ----
export const FLOORS_PER_CHAPTER = 11;               // 10 普通层 + 1 Boss 层
export const TOTAL_FLOORS = FLOORS_PER_CHAPTER * 4; // 44 层 = 4 章

export const isBossFloor = (floor) => floor % FLOORS_PER_CHAPTER === 0;
// 训练房固定 4N-2 层（2/6/10…42）——首进阶落在第 2 层，玩家快速特化进入真正的初始卡组。
// 优先级：Boss 层（22）无房间，Boss 战前一层（10）营地保底顶替训练房（细则见 §9）。
export const isTrainingFloor = (floor) => !isBossFloor(floor) && floor % 4 === 2;
// Boss 战前一层必出营地保底（§4.3）
export const isPreBossFloor = (floor) => (floor + 1) % FLOORS_PER_CHAPTER === 0;

// 战斗种子派生：同 runSeed 同 floor 恒定，整局可复现（§6.1）
export function deriveBattleSeed(seed, floor) {
  let h = (seed ^ Math.imul(floor, 0x9E3779B9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45D9F3B) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// 奖励房派发（§1/§4；2026-09-11 用户定：**营地与训练场合并**）。
// 规则：原「训练层 4N-2」与「Boss 前保底层」统一为**营地·训练场合并房**（二者总是一起出现，
// 固定不随机）；其余自由楼层只在**事件 / 老虎机**之间随机——不再单独出营地。
// 后果（有意为之）：回复来源集中在合并层（2/6/10/14/18/21/26/30/32/34/38/42/43）。
export function roomOfFloor(floor, rng) {
  if (isBossFloor(floor)) return null;   // Boss 层无奖励房（Boss 奖励=删卡，另行处理）
  if (isPreBossFloor(floor) || isTrainingFloor(floor)) return 'campTraining';
  if (floor === GURPAS_FLOOR) return 'gurpas';   // 古尔帕斯之店：35 层固定（SHOP.md §二）
  return rng.pick(['slot', 'event']);
}

// 遭遇生成：floorEnemyGenerator 按楼层分段池 + HP/攻击缩放产出可序列化描述符。
import { generateEncounter } from './floorEnemyGenerator.js';
export { generateEncounter }; // 转发保旧引用兼容（直接 import 自 runFlow 的写法不变）

// ---- 建局 ----
// profile：跨局持久内容（故事模式接缝 §6.4；单次游玩传空，行为不变）。
// totalFloors：塔高覆盖位（故事模式可变更塔结构；测试用）。
export function createRun({ seed = 1, profile = null, player = null, totalFloors = TOTAL_FLOORS } = {}) {
  const run = createRunState({ seed, profile, player });
  run.totalFloors = totalFloors;
  run.encounter = generateEncounter(run);
  return run;
}

// ---- 阶段迁移 ----

function expectStage(run, stage) {
  if (run.gameStage !== stage) {
    throw new Error(`run 阶段不符：期望 '${stage}'，实际 '${run.gameStage}'（floor=${run.floor}）`);
  }
}

// prep → battle（战前准备完成，进入本层战斗）
export function enterBattle(run) {
  expectStage(run, 'prep');
  run.gameStage = 'battle';
  return run;
}

// 按当前 run 装配战斗单位与种子。单一事实源：headless（createRunBattle）与
// 真实游戏（runController → createBridge）共用，瑞米出战/种子派生规则改一处即可。
export function assembleBattle(run) {
  return {
    enemies: run.encounter.map(spawnEnemy), // 描述符（楼层缩放终值）| 裸 id（测试直塞兼容）
    allies: run.remi.drivenOff ? [] : [getAllyDefinition('remi').createUnit()],
    seed: deriveBattleSeed(run.seed, run.floor),
  };
}

// 按当前遭遇装配战斗（战斗种子 = derive(runSeed, floor)；瑞米被打跑则不出战）
export function createRunBattle(run, { presenter = null, config = {} } = {}) {
  expectStage(run, 'battle');
  const { enemies, allies, seed } = assembleBattle(run);
  return createBattle({ runState: run, enemies, allies, seed, presenter, config });
}

// 战斗终局回写：胜利 → reward（生成战后固定奖励）；失败 → end(defeat)。
// battle 传入时同步瑞米状态：HP 归零 = 被打跑（§3），之后不再出战直至营地找回。
// Boss 通关奖励：HP 回满（章间断层修复——「险胜 Boss 带残血进下一章被处刑」是
// 20 局试玩的头号死亡漏斗，2026-09 定案：满血进章；营地休整相应降档至 30%）。
export function finishBattle(run, verdict, battle = null) {
  expectStage(run, 'battle');
  const remi = battle?.battleState.allies.find(a => a.defId === 'remi');
  if (remi?.isDead()) run.remi.drivenOff = true;
  if (verdict === 'victory') {
    // 遗物的战斗胜利钩子：**run 级资源只在 run 层改**（战斗内订阅不得直写 run 状态）。
    // 放在 spawnRewards 之前——遗物收益与战后奖励分开记账。
    for (const id of activeRelics(run)) getRelicDefinition(id)?.onBattleVictory?.(run, battle);
    if (isBossFloor(run.floor)) {
      run.pendingCardRemoval += 1; // Boss 奖励：删卡机会（§2.1）
      run.player.hp = run.player.maxHp; // 章间休整：HP 回满
    }
    run.gameStage = 'reward';
    spawnRewards(run);
  } else {
    run.gameStage = 'end';
    run.result = 'defeat';
    bankOnDeath(run);   // 死亡导致银行机存款清空（SLOT_MACHINE.md）
  }
  // 跨战斗恶魔词条：本场已消耗一场
  consumePendingDebuffs(run);
  return run;
}

// reward 阶段完成（奖励领取逻辑在 rewards.js；未抉择完奖励不允许推进）
export function completeRewards(run) {
  expectStage(run, 'reward');
  if (!isRewardsClaimed(run)) throw new Error('战后奖励尚未领取，不能离开 reward 阶段');
  run.rewards = null;
  run.currentRoom = roomOfFloor(run.floor, run.rng);
  if (run.currentRoom) {
    run.gameStage = 'room';
    // 售货机与房间**并存**（不占房间名额）：商店层进房时把当层货架掷好（按楼层缓存）
    ensureShopStock(run);
    // 银行机与老虎机成对出现：进老虎机房即算"见到银行机一次"（递减超额取款黑名单）
    if (run.currentRoom === 'slot') bankOnVisit(run);
    if (run.currentRoom === 'gurpas') ensureGurpasStock(run);  // 进店掷货架（同层不重掷）
    return run;
  }
  return advanceFloor(run); // Boss 层无奖励房，直接推进
}

// room 阶段完成（房间内部逻辑在 rooms/，本函数只迁移阶段）。
// 离开训练房时训练次数达标 → 直接进入进阶事件（§4.1/§5.3，不再延后）。
export function completeRoom(run) {
  expectStage(run, 'room');
  // 训练「先升后抓」的强绑尾款：升级已发生、抓牌未领 → 不允许离房（GUI/headless 同一守卫）
  if (run.roomData?.forced) throw new Error('升级后的强绑抓牌必须领取，不能离开房间');
  const room = run.currentRoom;
  run.currentRoom = null;
  run.roomData = null;
  if ((room === 'training' || room === 'campTraining') && ascensionReady(run)) {
    run.gameStage = 'ascension';
    return run;
  }
  return advanceFloor(run);
}

// 进入下一层：登顶 → end(victory)；否则回 prep 并生成新遭遇
export function advanceFloor(run) {
  run.floor += 1;
  if (run.floor > run.totalFloors) {
    run.gameStage = 'end';
    run.result = 'victory';
    return run;
  }
  run.gameStage = 'prep';
  // 银行机计息（SLOT_MACHINE.md：每过一层连击 +1 并按档位结算存款利息）
  accrueBankInterest(run);
  run.encounter = generateEncounter(run);
  return run;
}
