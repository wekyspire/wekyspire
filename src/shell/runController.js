import { reactive, markRaw } from 'vue';
import mitt from 'mitt';
import AnimationSequencer from '../core/anim/sequencer.js';
import Player, { PLAYER_BASE_HP } from '../core/state/player.js';
import { createSkillRuntime } from '../core/state/skillRuntime.js';
import {
  createRun, enterBattle, finishBattle, completeRewards, completeRoom,
  assembleBattle, isBossFloor, advanceFloor,
} from '../core/run/runFlow.js';
import { chooseSkillReward, chooseRewardPack as chooseRewardPackCore } from '../core/run/rewards.js';
import { gatedPromotionTargets } from '../core/run/promotion.js';
import { getSkillDefinition } from '../core/skills/registry.js';
import { getEnemyDefinition } from '../core/enemies/registry.js';
import { getRelicDefinition } from '../core/relics/registry.js';
import { getAllyDefinition } from '../core/allies/registry.js';
import { createBridge, EventNames } from '../bridge/index.js';
import { BattleStage } from '../stage/stages/BattleStage.js';
import { sceneIdForFloor } from '../stage/scenes/rooms/index.js';
import { preloadBattleArt } from '../stage/art/preload.js';
import { trainingMode, upgradableCards, trainUpgrade, trainDrawChoices, trainDraw, skipTraining } from '../core/run/rooms/training.js';
import { campOptions, campRest, campRecoverRemi, campUpgrade } from '../core/run/rooms/camp.js';
import {
  bankDeposit, bankWithdraw, bankOverdraft, chooseDemonDebuff, bankUpgrade, bankBurn,
} from '../core/run/rooms/bank.js';
import {
  buyGurpas, takeGurpasCard, sellGurpasRelic, removeCardAtGurpas,
} from '../core/run/rooms/gurpas.js';
import {
  SLOT, spinSlot, takeSlotPrize, declineSlotPrize, slotUpgrade,
  devourSlot, devourableRelics, devourableCards, slotView,
} from '../core/run/rooms/slotMachine.js';
import { playEvent } from '../core/run/rooms/event.js';
import { buyShopItem, takeShopCard } from '../core/run/rooms/shop.js';
import {
  chooseAscension, LEINO_DIMENSIONS,
  chooseSeedCards as chooseSeedCardsCore, rerollSeedOffering as rerollSeedOfferingCore,
} from '../core/run/ascension.js';
import { equipRelic, unequipRelic, prepUseRelic, refreshRunModifiers } from '../core/run/prep.js';
import { panelSnapshot } from '../core/run/panelSnapshot.js';
import { DisplayModel } from '../bridge/displayModel.js';
import { BODY_STARTER_DECK } from '../core/content/bodySkills.js';
import { RunEvents } from './runEvents.js';
import { createCutscenePlayer } from './overlay/cutscenePlayer.js';
import { recordSave } from './saves.js';

export { RunEvents };

// run 层 Shell 编排器：Vue 薄壳与 core run 状态机之间的唯一通道。
// run 本体经 reactive() 暴露（状态只存 id 与数字，代理安全）；
// 每次阶段迁移经 runBus 发事件——阶段 8 的 cutscene/剧情在此订阅注入。

// 默认起始卡组 = 体修基础卡组（BODY_CULTIVATION_CARDS §0：从拳/盾生长的三系种子）
const DEFAULT_DECK = [...BODY_STARTER_DECK];

// PCG 房型开关：true = 战斗房间按章节/Boss 走配方层（scenes/rooms），
// false = 全部回退手工大厅 dungeon（一键回滚，排查表现问题时用）
const USE_PCG_ROOMS = true;

// 塔楼抵达节拍时长（ms）：指令 durationMs 与等待侧兜底共用同一数值源
const FLOOR_ARRIVE_MS = 4000;

/**
 * 等待塔楼抵达动画播完（塔楼高亮块"长出"）。
 *
 * **必须 resolve**：战后剧本与 notify（面板 / 金币 / 资源行刷新）都排在这一拍之后。
 * 早先这里漏了 resolve——网页端每次战后 notify 都不执行（奖励面板不出现、金币停在旧值），
 * 此前只有 Vue 面板靠 reactive 自行刷新才把它掩盖过去。
 *
 * 两道保险丝：① 指令自身 durationMs（队列节拍卫生）；② 等待侧 setTimeout——若指令因
 * 队列被堵而根本没启动，队列那个 durationMs 计时器压根不会被创建（计时器是在
 * _startInstruction 里挂的），只能靠等待侧兜底放行。
 *
 * 单列为可测函数：endBattle 走真实 BattleStage（要 canvas），headless 下无法整链驱动。
 */
export function awaitFloorArrive(sequencer, mapStage, { floor, totalFloors, ms = FLOOR_ARRIVE_MS } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = () => { if (settled) return; settled = true; resolve(); };
    sequencer.enqueueInstruction({
      meta: { event: 'tower:floor-arrive', floor },
      durationMs: ms,
      start: ({ id, emit }) => mapStage.arriveFloor(floor, totalFloors, {
        onDone: () => { emit(EventNames.ANIMATION_INSTRUCTION_FINISHED, { id }); settle(); },
      }),
    });
    setTimeout(settle, ms + 200);
  });
}

// 存档快照 → run：advanceFloor 推进层数（遭遇/房间按 seed 确定性，无需回放），
// 再覆盖养成字段。存档语义 = 检查点：落盘只在 prep，故恢复后必处 prep。
function restoreFromSave(run, save) {
  while (run.floor < save.floor) advanceFloor(run);
  // rng 状态直存直取：回放 advanceFloor 不消耗 run.rng（遭遇用派生种子），
  // 若不恢复状态，读档后的房间派发会偏离活局时间线（旧档无此字段=维持回放语义）
  if (save.rngState != null) run.rng.setState(save.rngState);
  const p = run.player;
  const sp = save.player;
  p.hp = sp.hp; p.maxHp = sp.maxHp;
  p.mana = sp.mana; p.maxMana = sp.maxMana;
  p.maxActionPoints = sp.maxActionPoints; p.actionPoints = sp.maxActionPoints;
  p.money = sp.money;
  p.deck = sp.deck.map(rt => ({ ...rt }));
  p.abilities = [...sp.abilities];
  p.relics = [...sp.relics];
  p.equippedRelics = [...sp.equippedRelics];
  p.relicSlots = sp.relicSlots;
  p.leino = { ...sp.leino };
  p.trainingCount = sp.trainingCount;
  p.ascensionCount = sp.ascensionCount;
  p.bodyLevel = sp.bodyLevel ?? 0; // 旧档无此字段：隐藏体修等级从 0 起
  p.maxHandSize = sp.maxHandSize ?? 7; // 旧档（咏唱槽时代）无此字段：兜底默认
  // 旧档无 baseStats：以当前值为基准兜底；随后 refreshRunModifiers 会把遗物修正重算回去
  p.baseStats = sp.baseStats ? { ...sp.baseStats } : {
    maxHp: p.maxHp, maxMana: p.maxMana, maxActionPoints: p.maxActionPoints,
    attack: p.attack, defense: p.defense, maxHandSize: p.maxHandSize,
  };
  Object.assign(run.remi, save.remi);
  run.pendingCardRemoval = save.pendingCardRemoval;
  run.relicUses = { ...save.relicUses };
  run.shop = save.shop ? { ...save.shop, items: save.shop.items.map(it => ({ ...it })) } : null;
  run.shopPending = save.shopPending ? { ...save.shopPending, choices: [...save.shopPending.choices] } : null;
  run.shopAppleBought = !!save.shopAppleBought;
  run.slot = save.slot ? { ...save.slot } : null;
  run.slotPending = save.slotPending ? { ...save.slotPending } : null;
  run.slotUpgradePending = !!save.slotUpgradePending;
  run.slotDevour = save.slotDevour ?? 0;
  run.slotFreeRolls = save.slotFreeRolls ?? 0;
  run.slotApples = save.slotApples ?? 0;
}

export function createRunController({ seed = (Date.now() >>> 0), stageManager = null, mapStage = null, save = null, storyMode = false } = {}) {
  const runBus = mitt();
  // run 级共享演出队列（S2）：battle / room / tower / cutscene 指令在同一队列定序，
  // 跨层演出链（终局动画 → 幕间黑幕 → 塔楼抵达）由此成为可表达的结构
  const animBus = mitt();
  const runSequencer = new AnimationSequencer({ bus: animBus, finishedEvent: EventNames.ANIMATION_INSTRUCTION_FINISHED });
  // run 级显示状态权威（与 runSequencer 对等的状态面）：被节拍逐步推进的前端真值，
  // 跨场景存活（battle/room/tower），各 Stage 只是它的视图。Phase 1 收编卡牌注册表
  const displayModel = new DisplayModel();
  const isStory = save?.storyMode ?? storyMode; // 读档优先用存档自身的模式
  const run = reactive(createRun({
    seed: save?.seed ?? seed,
    player: new Player({ maxHp: PLAYER_BASE_HP, maxMana: 3, maxActionPoints: 3 }),
  }));
  if (save) restoreFromSave(run, save);
  else {
    run.player.deck = DEFAULT_DECK.map(id => createSkillRuntime(id));
  }
  // 装备遗物的 run 级修正每次从基准重算（增删装备/读档后都对齐；杜绝逐战叠加）
  refreshRunModifiers(run);
  run.storyMode = isStory; // 模式只影响剧情演出（对话剧本）；战斗内瑞米机制两模式一致

  let battleBridge = null;   // markRaw：战斗桥含 kernel/three 引用，不入响应式
  // 房间层舞台侧瞬态（不进 core run）：老虎机演出播放态 + 事件结算结果。
  // 面板快照经 panelExtras() 一并下行（roomSnapshot 的 extra 入参）。
  const slot = reactive({ lastSpin: null, anim: null }); // anim: { id, prize } 播放中（roll 动画）
  const eventRoom = reactive({ result: null });
  let battleStage = null;
  const log = reactive([]);  // 战斗日志（Shell 展示用）

  // three.js 状态栏（两舞台共享 PlayerStatusObject）：战斗外 AP 恒满，魏启 = run 持久值；
  // 金币/瑞米两舞台同源。战斗内 AP/魏启/血量由 bridge reconcile 接管，此处补
  // run 快照（金币/瑞米/角色血条/遗物槽）——遗物视图在此压平（Stage 不反查 Core 注册表）。
  const equippedRelicViews = () => run.player.equippedRelics.map((id) => {
    const def = getRelicDefinition(id);
    return {
      id, name: def?.name ?? id, icon: def?.icon ?? null,
      usesLeft: def?.uses ? (run.relicUses[id] ?? 0) : null,
    };
  });
  // 瑞米区视图（run 快照）：被打跑 = 未出战整区隐藏；战斗外恒满血（营地语义：
  // 每场按满血出战）。满血值借 createUnit 读（内容定义无静态面板字段可查）；
  // 攻/盾横幅暂走状态栏展示常量（盾=每回合赋盾量口径，行为未实装 0 占位）
  const remiMaxHp = getAllyDefinition('remi')?.createUnit().maxHp ?? null;
  const remiView = () => (!remiMaxHp || run.remi.drivenOff)
    ? { present: false }
    : { present: true, hp: remiMaxHp };
  const syncMapStatus = () => {
    mapStage?.setStatus({
      ap: run.player.maxActionPoints, apMax: run.player.maxActionPoints,
      mana: run.player.mana, manaMax: run.player.maxMana,
      money: run.player.money,
      hp: run.player.hp, maxHp: run.player.maxHp,
      relics: equippedRelicViews(),
      remi: remiView(),
    });
    // 金币/遗物在顶端资源行（状态栏不再显示）；战斗护盾不跨阶段残留
    battleStage?.topBar.setMoney(run.player.money);
    battleStage?.topBar.setRelics(equippedRelicViews());
    battleStage?.statusBar.setPlayerShield(0);
    battleStage?.statusBar.setPlayerHp(run.player.hp, run.player.maxHp);
    battleStage?.statusBar.setRemi(remiView());
  };
  // 面板快照的舞台侧瞬态：老虎机演出播放态与事件结果不在 core run 里（见 roomSnapshot 注释）
  const panelExtras = () => ({ slot, eventResult: eventRoom.result });
  syncMapStatus(); // 初始同步一次（后续随 notify 自动跟随）
  mapStage?.setPanel?.(panelSnapshot(run, panelExtras())); // 休息阶段面板快照（数据下行唯一通道）
  if (run.gameStage === 'prep' || run.gameStage === 'end') recordSave(run); // 初始即检查点（首层开局/读档落位）
  const notify = () => {
    syncMapStatus(); // 状态栏数值跟随每次迁移（魏启变化/层数推进）
    mapStage?.setPanel?.(panelSnapshot(run, panelExtras())); // 面板内容跟随阶段迁移（同一快照推导）
    // prep 入场即预热下场战斗素材：遭遇已知（advanceFloor 已定）、卡组已定
    // （奖励选卡在 reward 阶段完成）——无 cutscene 的普通层也有整个战前准备
    // 阶段可用作加载窗口（幂等：共享缓存按 url 去重）
    if (run.gameStage === 'prep') preloadBattleArt({ deck: run.player.deck, ...assembleBattle(run) });
    // 存档检查点：prep（层首）与 end（终局）落盘；战斗内退出 = 回到本层战前。
    if (run.gameStage === 'prep' || run.gameStage === 'end') recordSave(run);
    runBus.emit(RunEvents.STAGE_CHANGED, { stage: run.gameStage, floor: run.floor });
  };
  let logSeq = 0;
  const pushLog = ({ text, kind }) => {
    log.unshift({ id: ++logSeq, text, kind }); // 稳定 key（unshift 列表用 index key 会全量重渲）
    if (log.length > 30) log.pop();
  };

  // ---- cutscene（游戏流程手动驱动：对话剧本 + 幕间转场）----
  // S3：剧本 step 编译为 run sequencer 指令——与战斗/房间/塔楼演出同一时钟
  const cutscene = createCutscenePlayer({ sequencer: runSequencer });
  // 按当前 run 状态查触发规则并逐条播放（幂等；阻塞靠流程侧 await）
  const playPendingCutscenes = async () => {
    const ctx = { stage: run.gameStage, floor: run.floor, storyMode: run.storyMode };
    for (const id of cutscene.pendingTriggers(ctx)) {
      await cutscene.play(id);
    }
  };
  playPendingCutscenes(); // 开场剧本（故事模式 prep 第 1 层；肉鸽模式/读档不命中）

  // ---- 战斗 ----
  // 进场：战前剧本（如 preBoss）→ 幕间转场（全黑中点切舞台 + 预载）→ 战斗
  let battlePending = false; // 防重入：转场 pending 期间连点「进入战斗」只开一场
  function startBattle() {
    if (battlePending || run.gameStage !== 'prep') return;
    battlePending = true;
    // 素材预载即刻发起（不等黑幕）：立绘/卡图进共享缓存，战前剧本（cutscene）
    // 与黑幕转场的整段窗口都用于加载；BattleStage 建视图时同步命中，不再
    // "占位后补挂"。assembleBattle 是纯读取（encounter/remi/种子派生），
    // 可先于 enterBattle 调用，doSwap 复用同一份装配
    const assembled = assembleBattle(run);
    preloadBattleArt({ deck: run.player.deck, ...assembled });
    const doSwap = async () => {
      enterBattle(run);
      const { enemies, allies, seed } = assembled;
      const bridge = createBridge({ runState: run, enemies, allies, seed, frontendBus: animBus, sequencer: runSequencer });
      bridge.backendBus.on(EventNames.BATTLE_LOG, pushLog);
      bridge.backendBus.on(EventNames.BATTLE_END, ({ result }) => endBattle(result, bridge));
      battleBridge = markRaw(bridge);
      if (stageManager) {
        battleStage?.dispose(); // 上一场舞台即刻释放（场景图 + composer 渲染目标）
        const sceneId = USE_PCG_ROOMS ? sceneIdForFloor(run.floor) : 'dungeon';
        // 房间种子 = 战斗种子 + 层号派生：同层同种子恒定同布局，重打同层房间不变
        battleStage = new BattleStage({
          bridge, stageManager, displayModel, scene: sceneId, sceneSeed: `${seed}:room:${run.floor}`,
        });
        stageManager.setStage(battleStage);
      }
      bridge.start();
      // 黑幕后直接应用首帧投影：战斗演出指令排在队列中的 wipe 指令之后，揭幕前
      // 不会启动——若等首拍 sync，整个黑幕期间场景是空的（单位/卡牌揭幕后才迟到的
      // 根因）。先建好视图，whenReady 才能真实感知在途加载并保持黑幕到就绪；
      // 队列随后重放的更早 sync 节拍（如 battleStart 的空手牌快照）被显示时刻
      // 单调守卫丢弃，显示状态不会倒退（否则手牌"闪没又闪回"）
      battleStage?.applyProjection(bridge.getProjection());
      log.length = 0;
      notify();
      await battleStage?.whenReady(); // 预载完成信号（超时兜底）→ 揭幕
    };
    (async () => {
      await playPendingCutscenes(); // prep 阶段命中项（Boss 层 = preBoss）
      if (stageManager) await cutscene.sceneTransition(doSwap, { holdMs: 250 });
      else await doSwap(); // headless/无舞台：直切
    })().finally(() => { battlePending = false; });
  }

  // 退场：幕间转场（全黑中点回写 run + 切回地图）→ 塔楼抵达动画（同队列串行）→ 战后剧本
  function endBattle(result, bridge) {
    const doSwap = () => {
      finishBattle(run, result, bridge.battle); // 回写 run（含瑞米打跑检测）
      battleBridge = null;
      if (stageManager && mapStage) {
        mapStage.setFloor(run.floor, run.totalFloors); // 黑幕后即落位；高亮生长由抵达动画接管
        stageManager.setStage(mapStage);
      }
      battleStage?.dispose(); // 战斗舞台随退场释放（此前引用滞留至下一场被静默覆盖）
      battleStage = null;
      // 状态栏提前同步（用户 2026-09-11 报）：原来只有链条末尾的 notify() 会刷状态栏，
      // 于是爬塔动画播完才看到战后的血量/金币。这里在黑幕中就先把状态推给地图舞台
      // （只刷状态栏/资源行，不动面板、不触发存档与预载）。
      syncMapStatus();
    };
    (async () => {
      if (stageManager) await cutscene.sceneTransition(doSwap);
      else doSwap(); // headless/无舞台：直切
      // 塔楼抵达（S5）：排在黑幕 reveal 之后（同一队列串行），当前层高亮块长出；
      // 等待语义与两道保险丝见 awaitFloorArrive 的注释（曾因漏 resolve 卡死战后链条）
      if (stageManager && mapStage) {
        await awaitFloorArrive(runSequencer, mapStage, {
          floor: run.floor, totalFloors: run.totalFloors,
        });
      }
      await playPendingCutscenes(); // reward 阶段命中项（Boss 层 = postBoss）
      notify();
    })();
  }

  // ---- reward ----
  // 卡包制：先开包（chooseRewardPack）再领卡；只有体修包时 spawnRewards 已自动开包
  function chooseRewardPack(packId) {
    if (run.gameStage !== 'reward' || !run.rewards) return;
    chooseRewardPackCore(run, packId);
    notify();
  }
  function claimReward(defId = null) {
    if (run.gameStage !== 'reward') return; // 防迟到重复点击
    chooseSkillReward(run, defId);
    completeRewards(run);
    if (run.gameStage === 'room') { slot.lastSpin = null; slot.anim = null; eventRoom.result = null; } // 进新房清上一房瞬态
    notify();
  }

  // ---- rooms（每房一次免费操作后即离房；消费/重复交互待后续细化）----
  // 各入口先查 gameStage：连点/迟到点击会让核心变更先落地、completeRoom 再抛错，造成重复结算
  // 训练房「先升后抓」：升级动作只挂起强制三选一（roomData.forced）不离房，
  // 抓牌领取/跳过/阶段一跳过三种终端任一发生才 completeRoom。
  // 各入口先查 gameStage：连点/迟到点击会让核心变更先落地、completeRoom 再抛错，造成重复结算
  // 合并房（campTraining）：营地与训练各自一次；roomData 同时承载两个部分的记账，
  // 所以「训练是否可用」不能再用 roomData 的真假判断，改看 trained/drawChoices。
  const trainingLocked = () => !!run.roomData?.trained || !!run.roomData?.drawChoices;
  const campLocked = () => !!run.roomData?.campUsed;
  // 合并房不自动离房（两部分都要给机会），单房保持原语义「做完即离房」
  function maybeLeaveRoom() {
    if (run.gameStage !== 'room') return;
    if (run.currentRoom === 'campTraining') { notify(); return; }
    completeRoom(run);
    notify();
  }
  function trainingUpgrade(uniqueID) {
    if (run.gameStage !== 'room' || trainingLocked()) return;
    trainUpgrade(run, uniqueID); // 内部已 roll 强制抓牌候选
    notify();
  }
  function trainingSkip() {
    if (run.gameStage !== 'room' || trainingLocked()) return; // 已在抉择中 → 必须走对应选择
    skipTraining(run);
    maybeLeaveRoom();
  }
  function trainingDrawRoll() {
    if (run.gameStage !== 'room' || trainingLocked()) return;
    trainDrawChoices(run);
    notify();
  }
  function trainingDraw(defId = null) {
    if (run.gameStage !== 'room' || !run.roomData?.drawChoices) return;
    trainDraw(run, defId); // forced 状态下 null 由核心抛错拦截（UI 不渲染跳过入口）
    maybeLeaveRoom();
  }
  function campChoose(option, uniqueID = null) {
    if (run.gameStage !== 'room' || campLocked()) return;
    if (option === 'rest') campRest(run);
    else if (option === 'recoverRemi') campRecoverRemi(run);
    else if (option === 'upgrade') campUpgrade(run, uniqueID);
    maybeLeaveRoom();
  }
  // 合并房的主动离房（单房由动作自动离房，不需要这个）
  // ---- 银行机（与老虎机成对；SLOT_MACHINE.md §银行机）----
  function bankDo(kind, arg) {
    if (run.gameStage !== 'room' || run.currentRoom !== 'slot') return;
    try {
      if (kind === 'deposit') bankDeposit(run, arg ?? null);       // 缺省 = 全部存入
      else if (kind === 'withdraw') bankWithdraw(run);
      else if (kind === 'overdraft') bankOverdraft(run, arg);
      else if (kind === 'pick') chooseDemonDebuff(run, arg);
      else if (kind === 'upgradeOffer') bankUpgrade(run, arg);
      else if (kind === 'burnOffer') bankBurn(run, arg);
    } catch (err) {
      console.warn('[bank]', err.message);
    }
    notify();
  }

  // Boss 奖励的删卡机会（§2.1）：与古尔帕斯删卡服务同一套能力
  function bossRemoveCard(uniqueID) {
    if (run.pendingCardRemoval <= 0) return;
    try {
      removeCardAtGurpas(run, uniqueID);
      run.pendingCardRemoval -= 1;
    } catch (err) {
      console.warn('[removeCard]', err.message);
    }
    notify();
  }

  // ---- 古尔帕斯之店（35 层固定房；SHOP.md §二）----
  function gurpasDo(kind, arg, arg2) {
    if (run.gameStage !== 'room' || run.currentRoom !== 'gurpas') return;
    try {
      if (kind === 'buy') buyGurpas(run, arg);
      else if (kind === 'take') takeGurpasCard(run, arg);
      else if (kind === 'sell') sellGurpasRelic(run, arg);
      else if (kind === 'remove') removeCardAtGurpas(run, arg2 ?? arg);
    } catch (err) {
      console.warn('[gurpas]', err.message);
    }
    notify();
  }

  function leaveRoom() {
    if (run.gameStage !== 'room') return;
    completeRoom(run);   // 强绑抓牌未领时由核心抛错拦截
    notify();
  }
  let slotFinish = null; // 当前 roll 指令回执句柄（UI animationend → reportSlotAnimDone）
  function spin() { // 可重复消费（每次扣费/消耗免费 roll）；roll 动画经 run sequencer 串行编排
    if (run.gameStage !== 'room' || run.currentRoom !== 'slot') return;
    if (run.slotPending) return; // 上一次产出还没处理
    const prize = spinSlot(run); // 逻辑先行：扣费与定奖立即结算，演出随后揭示产出
    runSequencer.enqueueInstruction({
      meta: { event: 'room:slot-spin', prize: prize.kind },
      durationMs: 4000, // 前端卡死保险丝（UI 未回执时兜底推进）
      start: ({ id, emit }) => {
        slot.anim = { id, prize };
        slotFinish = (reportId) => {
          if (reportId !== id) return false;
          slot.anim = null;
          slot.lastSpin = prize; // 结果在动画落定后揭示（渐进揭示语义）
          slotFinish = null;
          // 揭示后必须重推面板快照：面板是**快照驱动**的（漏掉它的症状＝永远停在「转动中」）
          notify();
          emit(EventNames.ANIMATION_INSTRUCTION_FINISHED, { id });
          return true;
        };
      },
    });
    notify();
  }
  // 产出结算（可放弃——文档：这些产出总是可以放弃不要的）
  function slotTake(choice = null) {
    if (run.gameStage !== 'room' || !run.slotPending) return;
    takeSlotPrize(run, choice);
    slot.lastSpin = null; // 结算完收起揭示横幅
    notify();
  }
  function slotDecline() {
    if (run.gameStage !== 'room' || !run.slotPending) return;
    declineSlotPrize(run);
    slot.lastSpin = null;
    notify();
  }
  // 大奖「免费指定升级」：选卡界面确认后落地
  function slotPickUpgrade(uniqueID) {
    if (run.gameStage !== 'room' || !run.slotUpgradePending) return;
    slotUpgrade(run, uniqueID);
    notify();
  }
  // 吞噬（粉碎换金币）
  function slotDevour(target) {
    if (run.gameStage !== 'room' || run.currentRoom !== 'slot') return;
    devourSlot(run, target);
    notify();
  }
  function reportSlotAnimDone(reportId) { return slotFinish?.(reportId) ?? false; }
  // ---- 商店（售货机，SHOP.md §一）----
  // 与奖励房并存、不占房间名额：购买不消耗房间行动，故不调 completeRoom。
  function shopBuy(index) {
    if (run.gameStage !== 'room' || !run.shop) return;
    buyShopItem(run, index);
    notify();
  }
  function shopTakeCard(defId) {
    if (run.gameStage !== 'room' || !run.shopPending) return;
    takeShopCard(run, defId);
    notify();
  }
  function leaveSlot() {
    if (run.gameStage !== 'room') return;
    completeRoom(run);
    notify();
  }
  function triggerEvent() {
    if (run.gameStage !== 'room' || run.currentRoom !== 'event' || eventRoom.result) return; // 已探索不重复结算
    eventRoom.result = playEvent(run);
    notify();
  }
  function leaveEvent() {
    if (run.gameStage !== 'room') return;
    completeRoom(run);
    notify();
  }

  // ---- ascension ----
  function chooseAscensionDimension(dimension) {
    if (run.gameStage !== 'ascension') return;
    chooseAscension(run, dimension);
    notify();
  }
  // 跳过进阶：不选灵脉，改记 1 点隐藏体修等级（故事模式暗线）
  function skipAscension() {
    if (run.gameStage !== 'ascension' || run.cardOffering) return;
    chooseAscension(run, null);
    notify();
  }

  // 种子包：九选三 + 一次刷新（首次 0→1 时挂起）
  function chooseSeedCards(defIds) {
    if (run.gameStage !== 'ascension' || !run.cardOffering) return;
    chooseSeedCardsCore(run, defIds);
    notify();
  }
  function rerollSeedOffering() {
    if (run.gameStage !== 'ascension' || !run.cardOffering) return;
    rerollSeedOfferingCore(run);
    notify();
  }

  // ---- prep ----
  function equip(relicId) { equipRelic(run, relicId); notify(); }
  function unequip(relicId) { unequipRelic(run, relicId); notify(); }
  function useRelic(relicId) { prepUseRelic(run, relicId); notify(); }

  // ---- 休息阶段面板：意图上行 ----
  // 意图表 = Stage 上报的 { action, ... }。Stage 侧不判断可用性（enabled 由快照下发），
  // 这里只把语义落到既有入口（与 bridge/intents「UI 操作 → flow API 的唯一入口」同律）。
  // 面板逐个迁移：迁移一个在此加一条 action。
  function dispatchPanelIntent(intent) {
    const action = intent?.action;
    if (action === 'equip') equip(intent.relicId);
    else if (action === 'unequip') unequip(intent.relicId);
    else if (action === 'useRelic') useRelic(intent.relicId);
    else if (action === 'startBattle') startBattle();
    else if (action === 'chooseRewardPack') chooseRewardPack(intent.packId);
    else if (action === 'claimReward') claimReward(intent.defId ?? null);
    else if (action === 'chooseAscensionDimension') chooseAscensionDimension(intent.dimension);
    else if (action === 'skipAscension') skipAscension();
    else if (action === 'chooseSeedCards') chooseSeedCards(intent.defIds);
    else if (action === 'rerollSeedOffering') rerollSeedOffering();
    // 房间层
    else if (action === 'trainingUpgrade') trainingUpgrade(intent.uniqueID);
    else if (action === 'trainingDrawRoll') trainingDrawRoll();
    else if (action === 'trainingDraw') trainingDraw(intent.defId ?? null);
    else if (action === 'trainingSkip') trainingSkip();
    else if (action === 'campChoose') campChoose(intent.option, intent.uniqueID ?? null);
    else if (action === 'spin') spin();
    else if (action === 'slotAnimDone') reportSlotAnimDone(intent.id); // 舞台演出回执（非玩家意图）
    else if (action === 'bankDeposit') bankDo('deposit', intent.amount ?? null);
    else if (action === 'bankWithdraw') bankDo('withdraw');
    else if (action === 'bankOverdraft') bankDo('overdraft', intent.tier);
    else if (action === 'bankPick') bankDo('pick', intent.id);
    else if (action === 'bankUpgradeOffer') bankDo('upgradeOffer', intent.uniqueID);
    else if (action === 'bankBurnOffer') bankDo('burnOffer', intent.uniqueID);
    else if (action === 'bossRemoveCard') bossRemoveCard(intent.uniqueID);
    else if (action === 'gurpasBuy') gurpasDo('buy', intent.index);
    else if (action === 'gurpasTake') gurpasDo('take', intent.defId);
    else if (action === 'gurpasSell') gurpasDo('sell', intent.relicId);
    else if (action === 'gurpasRemove') gurpasDo('remove', intent.uniqueID, intent.uniqueID);
    else if (action === 'leaveRoom') leaveRoom();
    else if (action === 'leaveSlot') leaveSlot();
    else if (action === 'slotTake') slotTake(intent.choice ?? null);
    else if (action === 'slotDecline') slotDecline();
    else if (action === 'slotPickUpgrade') slotPickUpgrade(intent.uniqueID);
    else if (action === 'slotDevourRelic') slotDevour({ kind: 'relic', relicId: intent.relicId });
    else if (action === 'slotDevourCard') slotDevour({ kind: 'card', uniqueID: intent.uniqueID });
    else if (action === 'triggerEvent') triggerEvent();
    else if (action === 'leaveEvent') leaveEvent();
    // 商店（售货机）：与房间并存，购买不消耗房间行动
    else if (action === 'buyShopItem') shopBuy(intent.index);
    else if (action === 'takeShopCard') shopTakeCard(intent.defId);
  }
  mapStage?.setPanelIntentHandler?.(dispatchPanelIntent);

  // 离局清理（App.toTitle/newGame 调用）：战斗舞台释放 + 挂起演出瞬落
  // （动画不可序列化——重进/读档由检查点重建稳态）
  function dispose() {
    battleStage?.dispose();
    battleStage = null;
    runSequencer.cancelAll();
  }

  return {
    run, runBus, log, slot, eventRoom, cutscene,
    sequencer: runSequencer, animBus, dispose,
    LEINO_DIMENSIONS, SLOT,
    slotView: () => slotView(run),
    devourableRelics: () => devourableRelics(run),
    devourableCards: () => devourableCards(run),
    skillName: (id) => getSkillDefinition(id)?.name ?? id,
    // 升级预览：该卡晋升后的目标定义（过等阶门禁，与 trainUpgrade 缺省取的第一个可用目标一致）
    promoteTargetOf: (rt) => gatedPromotionTargets(run, getSkillDefinition(rt.defId))[0] ?? null,
    // encounter 元素是楼层缩放 descriptor {defId,maxHp,attack}（兼容裸 id 字符串）
    enemyName: (e) => {
      const id = e?.defId ?? e;
      return getEnemyDefinition(id)?.name ?? id;
    },
    isBossFloor,
    trainingMode: () => trainingMode(run),
    upgradableCards: () => upgradableCards(run),
    campOptions: () => campOptions(run),
    getBattleBridge: () => battleBridge,
    getBattleStage: () => battleStage,
    startBattle, claimReward, chooseRewardPack,
    trainingUpgrade, trainingDrawRoll, trainingDraw, trainingSkip,
    campChoose, leaveRoom, bankDo, gurpasDo, spin, reportSlotAnimDone, leaveSlot, triggerEvent, leaveEvent,
    chooseAscensionDimension, skipAscension, chooseSeedCards, rerollSeedOffering,
    equip, unequip, useRelic,
  };
}
