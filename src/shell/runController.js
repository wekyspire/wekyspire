import { reactive, markRaw } from 'vue';
import mitt from 'mitt';
import AnimationSequencer from '../core/anim/sequencer.js';
import DedicatedSequencer from '../core/anim/dedicatedSequencer.js';
import Player, { PLAYER_BASE_HP, PLAYER_BASE_AP } from '../core/state/player.js';
import { createSkillRuntime } from '../core/state/skillRuntime.js';
import {
  createRun, enterBattle, finishBattle, completeRewards, completeRoom,
  assembleBattle, isBossFloor, advanceFloor, TOTAL_FLOORS, FLOORS_PER_CHAPTER,
} from '../core/run/runFlow.js';
import { chooseSkillReward, chooseRewardPack as chooseRewardPackCore } from '../core/run/rewards.js';
import { restoreRunFromSave } from '../core/run/saveRestore.js';
import { gatedPromotionTargets } from '../core/run/promotion.js';
import { getSkillDefinition } from '../core/skills/registry.js';
import { getEnemyDefinition } from '../core/enemies/registry.js';
import { getRelicDefinition } from '../core/relics/registry.js';
import { getAllyDefinition } from '../core/allies/registry.js';
import { createBridge, EventNames } from '../bridge/index.js';
import { BattleStage } from '../stage/stages/BattleStage.js';
import { sceneIdForFloor } from '../stage/scenes/rooms/index.js';
import { restRecipeFor, mergeRecipeOverride } from '../stage/scenes/rooms/presets.js';
import { RoomStage } from '../stage/stages/RoomStage.js';
import { EndStage } from '../stage/stages/EndStage.js';
import { preloadBattleArt } from '../stage/art/preload.js';
import { upgradableCards, beginTraining, trainUpgradeStart, trainUpgrade, trainDrawChoices, trainDraw, trainUpgradeModes } from '../core/run/rooms/training.js';
import { campOptions, campRest, campRecoverRemi, campLocked as campGateLocked } from '../core/run/rooms/camp.js';
import { SLOT } from '../core/run/rooms/slotMachine.js';
import { eventView, resolveEvent } from '../core/run/rooms/event.js';
import { createRunContext } from '../core/run/runContext.js';
import { playMusic, stopMusic, duckWind, playRoomAmbience, stopAmbience, stopAmbienceLayer, duckAmbienceLayer } from './audio.js';
import { createRunPresenter } from './runPresenter.js';
import { ascensionReady, LEINO_DIMENSIONS } from '../core/run/ascension.js';
import { equipRelic, unequipRelic, prepUseRelic, refreshRunModifiers } from '../core/run/prep.js';
import { panelSnapshot, deckViewEntries } from '../core/run/panelSnapshot.js';
import { createRunShowcase } from './runShowcase.js';
import { createRunQuestions } from './runQuestions.js';
import { hasOpenQuestion, answerQuestion } from '../core/run/questions.js';
import { enqueueFlowInstruction, waitFor } from './flowInstruction.js';
import { createStageDirector } from './stageDirector.js';
import { createDisplayScalars } from './displayScalars.js';
import { createRunMachines } from './runMachines.js';
import { DisplayModel } from '../bridge/displayModel.js';
import { createCutscenePlayer } from './overlay/cutscenePlayer.js';
import { createSceneWipe } from './overlay/sceneWipe.js';
import { createRunCutsceneFlows } from './runCutsceneFlows.js';
import { createRunDebug } from './runDebug.js';
import { createQuiescenceChecker, battleQuiescent, createPredicateFuse } from './quiescence.js';
import { recordSave } from './saves.js';

// run 层 Shell 编排器：Vue 薄壳与 core run 状态机之间的唯一通道。
// run 本体经 reactive() 暴露（状态只存 id 与数字，代理安全）。

// 起始卡组由开局路线授予（core/run/routes.js，D2）——不再有全局默认卡组。

// PCG 房型开关：true = 战斗房间按章节/Boss 走配方层（scenes/rooms），
// false = 全部回退手工大厅 dungeon（一键回滚，排查表现问题时用）
const USE_PCG_ROOMS = true;

// 塔楼抵达节拍时长（ms）：指令 durationMs 与等待侧兜底共用同一数值源
const FLOOR_ARRIVE_MS = 6000; // 抵达指令保险丝：≥ 爬升动画时长（5s）+ 揭幕余量

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
export function awaitFloorArrive(sequencer, mapStage, { floor, totalFloors, ms = FLOOR_ARRIVE_MS, clearFx = null } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let instrId = null;
    const settle = () => { if (settled) return; settled = true; resolve(); };
    instrId = sequencer.enqueueInstruction({
      meta: { event: 'tower:floor-arrive', floor },
      // 爬升是背景演出：退出 'all' 且不等任何人——爬升期间遗物装卸/获得特写
      // 照常播（notify 的忙判同样把 'floor-arrive' 排除在外）；后续剧本/进房
      // 节拍本来就排在本指令 resolve 之后，不靠标签定序
      tags: ['floor-arrive'], tagAll: false, waitTags: [],
      durationMs: ms,
      start: ({ id, emit }) => {
        // 楼层通过：刚清掉那层的敌人残影崩解——与爬升同拍起跑。回执 = 爬升落定
        // **且**残影视觉落定（不含灰尾）——本层有房间时相机不爬（同层直落），
        // 这道闸保证「房间切幕」排在崩解演完之后，演出不会被切走
        const clearHandle = clearFx ? mapStage.playFloorClear(clearFx) : null;
        let climbDone = false, clearDone = !clearHandle;
        const tryFinish = () => {
          if (!climbDone || !clearDone) return;
          emit(EventNames.ANIMATION_INSTRUCTION_FINISHED, { id });
          settle();
        };
        mapStage.arriveFloor(floor, totalFloors, { onDone: () => { climbDone = true; tryFinish(); } });
        clearHandle?.visualDone?.then(() => { clearDone = true; tryFinish(); });
      },
    });
    // 完成链可能被舞台切换打断（回调悬空）：墙钟在已知时长 +200ms 处完结指令，
    // 不留悬挂指令喂 6s 保险丝（时长已知的演出段允许墙钟帽）
    setTimeout(() => { settle(); if (instrId != null) sequencer.finish(instrId, { reason: 'manual' }); }, ms + 200);
  });
}

export function createRunController({ seed = (Date.now() >>> 0), stageManager = null, mapStage = null, save = null, storyMode = false, debugMode = false, route = 'body', onRestart = null } = {}) {
  // 双 sequencer（双轨拆分）：
  //   · battleSequencer（经典最小形态）= 后端单向数据流——bridge 把战斗 wire 指令排进它、
  //     舞台演出完在 battleBus 上回执。S2 的「battle/room/tower/cutscene 共队列」就此废除：
  //     终局→黑幕→塔楼的衔接改走事件/承诺（endBattle 本就等 bridge 收尾后才起幕间链）。
  //   · dedicatedSequencer（DedicatedSequencer，前端专属）= 房间/幕间/塔楼/问句呈现/
  //     流程指令壳的全部前端编排，持有前端词汇（onEnd/owner/cancelByOwner/tagAll）。
  //   两实例各自的总线，动画执行器按指令来源分别回执；前端编排的混沌不再触及战斗节拍。
  const animBus = mitt();
  const dedicatedSequencer = new DedicatedSequencer({ bus: animBus, finishedEvent: EventNames.ANIMATION_INSTRUCTION_FINISHED });
  const battleBus = mitt();
  const battleSequencer = new AnimationSequencer({ bus: battleBus, finishedEvent: EventNames.ANIMATION_INSTRUCTION_FINISHED });
  // run 级显示状态权威（与 dedicatedSequencer 对等的状态面）：被节拍逐步推进的前端真值，
  // 跨场景存活（battle/room/tower），各 Stage 只是它的视图。Phase 1 收编卡牌注册表
  const displayModel = new DisplayModel();
  const isStory = save?.storyMode ?? storyMode; // 读档优先用存档自身的模式
  // 调试局标记：读档以存档自身为准（造档工具产出的档自带 debugMode: true）
  const isDebug = save?.debugMode ?? debugMode;
  const run = reactive(createRun({
    seed: save?.seed ?? seed,
    player: new Player({ maxHp: PLAYER_BASE_HP, maxMana: 3, maxActionPoints: PLAYER_BASE_AP }),
    route: save ? null : route,   // 读档恢复现场，不重复结算路线授予
    // 生产版封顶第一章：11 层 Boss 打完即终局（胜利/失败）——
    // 二章及以后的内容与数值还没到能见人的时候。dev 保持全程 44 层。
    // totalFloors 走 core 的覆盖位：advanceFloor 的终局判定/塔楼高度/层数文案全部随之。
    totalFloors: import.meta.env.PROD ? FLOORS_PER_CHAPTER : TOTAL_FLOORS,
  }));
  if (save) restoreRunFromSave(run, save); // 恢复原语在 core（headless 工具共用同一份）
  else {
    // 调试模式（开始界面勾选 / ?debug=1，仅新开局生效）：直发 GM 卡「一拳」（999 群伤固有）
    // ——爬塔流程验证工具；读档不吃（调试局的卡组本身已含此卡，随存档走）
    if (isDebug) run.player.deck.push(createSkillRuntime('onePunch'));
  }
  // 装备遗物的 run 级修正每次从基准重算（增删装备/读档后都对齐；杜绝逐战叠加）
  refreshRunModifiers(run);
  run.storyMode = isStory; // 模式口径（扩）：剧情演出 + 瑞米（同伴出战/营地游荡/果实养成）只在故事模式；肉鸽模式无瑞米
  run.debugMode = isDebug; // 调试局：存档走 debug 槽（saves.modeOf）+ 面板可开

  let battleBridge = null;   // markRaw：战斗桥含 kernel/three 引用，不入响应式
  let battleStage = null;
  let roomStage = null;   // 场景式休息房舞台（仅 gameStage==='room' 且有配方时存在）
  let endStage = null;    // 终局结算舞台（仅 gameStage==='end' 时存在）
  const log = reactive([]);  // 战斗日志（Shell 展示用）
  // 房间层舞台侧瞬态（不进 core run）：老虎机揭示横幅（lastSpin 由转轮指令的
  // onEnd 载荷落、随问句落幕清——见 runQuestions）；「转动中」不入此对象，
  // 事实源 = 队列类型化查询 slotSpinPending。
  const slot = reactive({ lastSpin: null });
  // 转轮「转动中」的类型化队列查询：room:slot-spin 指令还在队里 = 在播。
  // 面板快照（spinning 置灰）与问句呈现（特写等转轮）共用这一个判据。
  const slotSpinPending = () => !!dedicatedSequencer.findPending(i => i.meta?.event === 'room:slot-spin');
  // run 级表现上下文：core 内容（事件/剧情）想演出就走它声明意图（见 runPresenter.js）。
  // presenter 只排队，由 runShowcase.flushRunPresentations() 在安全时机（揭幕后）统一播。
  const runPresenter = createRunPresenter();
  const runCtx = createRunContext(run, { presenter: runPresenter });
  // 显示标量通道（§4.6）：core 即时结算、显示值随队列节拍推进（金币演出首个消费者）。
  // onApplied = 重推状态栏（落地/对账拍刷新读数）——syncMapStatus 晚绑定箭头。
  const scalars = createDisplayScalars({
    sequencer: dedicatedSequencer,
    onApplied: () => syncMapStatus(),
  });

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
  // 瑞米区视图（run 快照）：瑞米是故事模式同伴（肉鸽模式整区隐藏）；
  // 故事模式里被打跑 = 未出战整区隐藏；战斗外恒满血（营地语义：每场按满血出战）。
  // 满血值借 createUnit 读（内容定义无静态面板字段可查）。
  // （攻/盾横幅已删 瑞米意图显示其行动）
  const remiMaxHp = getAllyDefinition('remi')?.createUnit().maxHp ?? null;
  const remiView = () => (!run.storyMode || !remiMaxHp || run.remi.drivenOff)
    ? { present: false }
    : { present: true, hp: remiMaxHp };
  const syncMapStatus = () => {
    // money 走显示值（§4.6 通道：演出未落地的增量按住不放）；其余标量仍直读 core
    const money = scalars.read('money', run.player.money);
    const status = {
      ap: run.player.maxActionPoints, apMax: run.player.maxActionPoints,
      mana: run.player.mana, manaMax: run.player.maxMana,
      money,
      hp: run.player.hp, maxHp: run.player.maxHp,
      relics: equippedRelicViews(),
      remi: remiView(),
      deckCount: run.player.deck.length,   // 卡组 chip 张数（战斗内由 reconcile 从各区加总接管）
    };
    mapStage?.setStatus(status);
    roomStage?.setStatus(status);   // 场景式休息房：同一份数值推给房间舞台的状态栏/顶端资源行
    // 金币/遗物在顶端资源行（状态栏不再显示）；战斗护盾不跨阶段残留
    battleStage?.topBar.setMoney(money);
    battleStage?.topBar.setRelics(equippedRelicViews());
    // 卡组 chip 张数 = run 牌组总量（与画廊条目同源；战斗中 run 牌组恒定，notify 落位即准——
    // 战斗克隆可能多出遗物加的战斗卡（大剑的斩），那属于牌库面板的战斗口径，不进 build 计数）
    battleStage?._deckChip.setCount(run.player.deck.length);
    battleStage?.statusBar.setPlayerShield(0);
    battleStage?.statusBar.setPlayerHp(run.player.hp, run.player.maxHp);
    battleStage?.statusBar.setRemi(remiView());
  };
  // 面板快照的舞台侧瞬态：老虎机演出播放态不在 core run 里（见 roomSnapshot 注释）
  const panelExtras = () => ({ slot: { lastSpin: slot.lastSpin, spinning: slotSpinPending() } });
  // 存档检查点：只在 prep（层首）与 end（终局）落盘；战斗内退出 = 回到本层战前。
  // 调试局（debugMode，含"改过状态的普通局"）写独立的 debug 槽（saves.modeOf）——
  // 真实存档永不被调试动作污染，这是调试模式的安全边界。
  const persist = () => {
    if (run.gameStage !== 'prep' && run.gameStage !== 'end') return;
    recordSave(run);
  };
  // 阶段落定效应：只看 gameStage 值的协议反应，挂在阶段真正落定的时刻——
  // transitionStage 中点（阶段迁移唯一入口）、swapAnyToMap（调试硬重置落定点）、
  // 构造初始（读档落位）。
  const settleStageEffects = () => {
    persist();   // 检查点：prep（层首）与 end（终局）落盘；战斗内退出 = 回到本层战前
    // prep 入场即预热下场战斗素材：遭遇已知（advanceFloor 已定）、卡组已定
    // （奖励选卡在 reward 阶段完成）——无 cutscene 的普通层也有整个战前准备
    // 阶段可用作加载窗口（幂等：共享缓存按 url 去重）。预热失败只损失加载窗
    //（陈年坏档的死键等），绝不让它炸穿构造/迁移链
    if (run.gameStage === 'prep') {
      try { preloadBattleArt({ deck: run.player.deck, ...assembleBattle(run) }); }
      catch (err) { console.warn('[preload] 战前预热失败（照常运行）：', err?.message ?? err); }
    }
    // 终局兜底：杂径落进 'end'（败北/登顶/读档恢复）都切进结算舞台——正常路径
    //（claimReward/endBattle）直调，此处是幂等重入的保险丝
    if (run.gameStage === 'end') void enterEndScreen();
  };
  // ---- 获得演出（遗物特写 / 老虎机 / 恶魔 roll / 售货机 / 离开安慰奖）----
  // 「到手那一拍」的编排整体在 runShowcase.js：core 结算已发生，那边只管时序与舞台。
  // 遗物特写由授予源显式入队（presentRelic），不再 notify 差分。
  // 这里的引用全部**晚绑定**（箭头闭包捕获词法绑定，运行期才取值）：panelStage/notify 是
  // 本块之后才初始化的 const，slotTake/slotDecline/leaveRoom 是 hoisted function 声明——
  // 构造期不调用它们，初始化顺序安全。
  const showcase = createRunShowcase({
    run, runPresenter, dedicatedSequencer, scalars,
    panelStage: () => panelStage(),
    roomStage: () => roomStage,
    notify: (opts) => notify(opts),
    actions: {
      leaveRoom: () => leaveRoom(),
    },
  });
  // 问句呈现驱动（P2 问句协议的 shell 侧）：notify 拍差分 core 问句 → 驱动选卡呈现。
  // 放在 notify 定义之前（notify 体内调用它；引用全部晚绑定）
  const questions = createRunQuestions({
    run,
    panelStage: () => panelStage(),
    notify: (opts) => notify(opts),           // 直答分支的状态迁移重推
    shopDispensing: () => showcase.isShopDispensing(),
    slotSpinning: () => slotSpinPending(),   // 特写等转轮（FIFO 序）
    slot,                                     // 揭示横幅随 slotPrize 问句落幕
    startTrainingUpgrade: () => openTrainingUpgradeFlow(),   // trainingUpgrade 问句呈现 = 尾款自动链
    startBankOffer: () => showcase.openBankOfferPicker(),    // bankOffer 问句呈现 = 附赠选卡
    presentRelic: (id) => showcase.presentRelic(id),         // 单件遗物直答路径的授予源特写
  });
  syncMapStatus(); // 初始同步一次（后续随 notify 自动跟随）
  mapStage?.setPanel(panelSnapshot(run, panelExtras())); // 休息阶段面板快照（数据下行唯一通道）

  // 该房间是否由**幕间/房间场景**呈现（事件幕间 or 有休息房配方）——呈现中塔楼层**不渲染房间面板**：
  // 否则"选完奖励 → 进房"的瞬间塔楼会先铺一帧房间面板（营地/售货机/老虎机），幕间黑幕
  // 随后才盖住。用"待呈现/已呈现"两个条件判定，
  // 不用"有配方"直接推断——无舞台/占位路径仍要把面板留给塔楼层。
  // 训练改版：**房内进阶**期间（gameStage 'ascension' 且 roomStage 存活——
  // currentRoom/roomData 原地保留）也按"房间场景呈现中"处理——阶段模态面板（种子包九选三）
  // 画在 RoomStage 上，塔楼不得再建一份不可见的重复面板（指针已路由到 RoomStage，
  // 见 App.vue activeStage）。离房路径的 ascension 已清 currentRoom/roomStage，条件自然不成立。
  let roomScenePending = false;   // 进房演出待/在切换（进房那一刻由 claimReward 置位）
  const roomPresentedOnScene = () => (run.gameStage === 'room' || run.gameStage === 'ascension')
    && !!stageManager
    && (roomScenePending || !!roomStage)
    && (run.currentRoom === 'event' || !!restRecipeFor(run.currentRoom));
  // notify = 变异后果的显示刷新（纯投影）：状态栏 + 面板快照三舞台分发 + 问句呈现驱动。
  // 职责边界：阶段协议反应（存档检查点/终局路由/战前预热）归 settleStageEffects 的
  // 三个阶段落定点；内容触发（遗物特写/吞噬教学/恶魔解说）归各自触发源；显示标量对账
  // 归空闲沿——notify 不背任何不属于显示刷新的逻辑。
  // idle 门控：无最大延迟帽——排空前方的演出时长不可知，玩家节奏段选卡/特写长考期间
  // 面板旧值等待是正确语义。队列忙时显示刷新让位，空闲沿**无条件**
  // 补发（不是挂脏才发——漏喊的刷新在下一次队列排空自愈，「漏 notify」族由结构消灭；
  // 演出期面板本就被画面盖住，跳过的只是不可见重绘）。force 旁路只剩两类真契约：
  // ①黑幕中点揭幕就位（transitionStage/进阶豁免点——揭幕不得露旧画面）；②notify 后
  // 紧跟直开选卡的快照新鲜度（选卡器读 panelHost._snap，分布被门控跳过 = 旧快照开卡；
  // 走问句驱动呈现的选卡无此问题——补发拍先分布再 drive）。
  const notify = (opts) => {
    // 谓词口径：pendingCount 含旁挂指令（battle-span 全程占队、scalar-hold 特写窗 ≤30s、
    // devour-tutor 让位窗）——「队列忙 = 演出在播」是近似而非等价。当前旁挂占队期间
    // 面板本就该静止（战斗期无 run 面板诉求 / 特写窗模态盖屏），近似成立是良性的；
    // ⚠ 新增**长期占队**的旁挂指令类型时必须重估本门（勿靠巧合成立）。
    // 'floor-arrive'（塔楼爬升）是显式例外：爬升是背景演出，不占屏——爬升期间
    // 遗物装卸/面板刷新照常放行（否则 prep 期 5s 爬升压住一切显示刷新）
    if (!opts?.force && dedicatedSequencer.findPending(i => !i.tags.has('floor-arrive'))) return;   // 忙：让位，空闲沿补发
    if (run.gameStage !== 'room') roomScenePending = false;
    syncMapStatus(); // 状态栏数值跟随每次迁移（魏启变化/层数推进）
    const snap = panelSnapshot(run, panelExtras()); // 面板内容跟随阶段迁移（同一快照推导）
    // 战后奖励**画在战斗舞台上**：战斗结束后不换舞台，奖励 overlay 直接
    // 盖在战斗房间前；"战斗房 → 塔楼"的场景切换在**领奖后的切幕中点**完成（见 afterRewardToFloor）。
    // 无战斗舞台（headless/降级）时自然落到塔楼层（mapStage）。
    if (run.gameStage === 'reward') battleStage?.setPanel(snap);
    else battleStage?.setPanel(null);
    mapStage?.setPanel(roomPresentedOnScene() ? null : snap);
    roomStage?.setPanel(snap);    // 场景式休息房：机器面板与翻牌计数器同源重绘
    questions.drive();   // 问句呈现：待答问句 + 屏幕空闲 → 开全屏选卡/产出特写（恢复即重发）
  };

  // 空闲沿家政（队列忙→空的每一次翻沿，稳定空闲语义见 dedicatedSequencer.onIdle）：
  // ①显示标量对账（§4.6 自愈——cancel 不落载荷的孤儿增量贴回）→ ②notify 无条件补发
  // （P4a 自愈语义：漏喊的刷新在排空拍对账；顺序在 drive 前 = 问句呈现读到新鲜快照）
  // → ③遗物特写队列补排（出货演出收尾拍/上一件被点掉后的下一件）。
  const offIdleHousekeeping = dedicatedSequencer.onIdle(() => {
    scalars.reconcile();
    notify();
    showcase.flushRelicShowcase();
  });

  let logSeq = 0;
  const pushLog = ({ text, kind }) => {
    log.unshift({ id: ++logSeq, text, kind }); // 稳定 key（unshift 列表用 index key 会全量重渲）
    if (log.length > 30) log.pop();
  };

  // ---- cutscene（游戏流程手动驱动：对话剧本 + 幕间转场）----
  // S3：剧本 step 编译为 run sequencer 指令——与战斗/房间/塔楼演出同一时钟。
  // **切幕器独立于内容播放器**：`sceneWipe` 由 cutscene 播放器驱动、
  // 由 App.vue 的 SceneWipeOverlay 渲染——黑幕的**目的地**可以是 3D 舞台，也可以是一段
  // cutscene 内容（事件房：切幕开始 → 对话/CG 就位 → 切幕结束）。
  const sceneWipe = createSceneWipe();
  // getFxServices：'fx' step 的舞台服务来源——三舞台不共存（战斗/奖励期 battleStage 存活，
  // 房间/房内进阶期 roomStage 存活，其余 mapStage），取活舞台的门面；皆空 → null（fx step 告警即收）
  const cutscene = createCutscenePlayer({
    sequencer: dedicatedSequencer,
    wipe: sceneWipe,
    // director 在下方才声明——晚绑定箭头闭包，运行期（首个 fx step）早已就位
    getFxServices: () => director.fxServices(),
  });
  // 切幕统一清算：
  // 每次幕间转场在全黑中点、换台 swap 之前，先把**所有舞台**的全屏模态（获得特写/
  // 选卡/选遗物）一键收起——目的地无论是什么，切幕那一刻还挂在任何舞台上的模态
  // 都是残影（战斗舞台的会被随后 dispose 带走；塔楼是常驻舞台，不清算就会跨进章/
  // 跨房压在新画面上）。包装在 player 实例上，三条域（controller/machines/cutsceneFlows）
  // 的 sceneTransition 调用全部走这一份。
  const rawSceneTransition = cutscene.sceneTransition.bind(cutscene);
  // async 转发 swap 的 Promise：wipe step 会 await atCover——黑幕保持到迁移兑现
  //（battle-entry 的预载就绪揭幕依赖这条链；此前大括号箭头丢返回值，该行为被静默断掉）
  cutscene.sceneTransition = (swap = null, opts = undefined) =>
    rawSceneTransition(async () => {
      director.dismissModals();
      await swap?.();
    }, opts);

  /**
   * transitionStage —— 「阶段迁移 + notify + 换台」的唯一入口（§4.4，P3）。
   * 节拍 = 起幕 → 全黑中点：dismissModals（sceneTransition 包装层）→ migrate()
   * （core 迁移 + 舞台换装；可返回 Promise——黑幕保持到兑现，战斗预载就绪才揭幕；
   * 抛错自兜：揭幕照常，notify 不缺席）→ **notify（中点纪律）**：面板/状态栏/问句
   * 呈现都在黑幕里就位，揭幕即新画面 → 揭幕。migrate 内部**不再手放 notify**。
   * 单飞 = 'run:transition' 家族标签互等：转场全局串行（sceneTransition 不自带单飞，
   * 并发直调即调用方违约——背靠背转场在此被结构性堵住）。
   * 返回 Promise（揭幕拍 resolve）。
   * **唯一成文豁免**：内容幕间的 wipe step atCover（进阶 fromRoom 换台——对话内容
   * 依赖剧本 nextBox 幕后就位，本入口形状表达不了）；豁免方自理中点清算与 notify。
   * 无舞台（headless）时 migrate + notify 同拍直落。
   */
  function transitionStage({ migrate = null, holdMs } = {}) {
    return new Promise((resolve) => {
      const enqueued = enqueueFlowInstruction(dedicatedSequencer, {
        tag: 'transition', meta: { event: 'run:transition' },
        entryOk: () => true,   // 状态门是外层流程的事（各自 entryOk）；本入口只管节拍纪律
        play: async (done) => {
          try {
            // mid 自兜：migrate 抛错不得炸穿 wipe step 的 await（那里不 catch——
            // unhandled rejection + 幕布永不揭）。notify 仍要跑（中点对账不缺席）
            const mid = async () => {
              try { await migrate?.(); }
              catch (err) { console.warn('[transition] migrate 异常（揭幕照常）:', err); }
              settleStageEffects();   // 阶段落定效应（检查点/预热/终局路由）：黑幕中点即阶段落定点
              notify({ force: true });   // 中点纪律 = 揭幕就位契约：面板/问句呈现必须落在黑幕内，揭幕即新画面
            };
            if (stageManager) await cutscene.sceneTransition(mid, holdMs != null ? { holdMs } : undefined);
            else await mid();   // 无舞台：迁移与 notify 同拍直落
            resolve(true);
          } catch (err) {
            console.warn('[transition]', err?.message ?? err);
            resolve(false);
          } finally { done(); }
        },
      });
    });
  }
  // 按当前 run 状态查触发规则并逐条播放（幂等；阻塞靠流程侧 await）。返回实际播放条数——
  // 调用方据此决定要不要补一道"退出切幕"（没播剧本就别多等一次黑幕）。
  const playPendingCutscenes = async () => {
    const ctx = { stage: run.gameStage, floor: run.floor, storyMode: run.storyMode };
    let played = 0;
    for (const id of cutscene.pendingTriggers(ctx)) {
      await cutscene.play(id);
      played += 1;
    }
    return played;
  };
  playPendingCutscenes(); // 开场剧本（故事模式 prep 第 1 层；肉鸽模式/读档不命中）

  // ---- 房间机器流（老虎机/银行机/古尔帕斯/售货机收尾/吞噬）----
  // 各机器的「意图 → core → notify → 附带演出」在 runMachines.js；引用同样全部晚绑定。
  // 注意 ctx.showcase 先于本模块构造（bankDo/spin 要触发获得演出编排）；cutscene 是上面
  // 才初始化的 const，吞噬流要播 dialogue，所以构造点排在 cutscene 之后。
  const machines = createRunMachines({
    run, slot, dedicatedSequencer, cutscene, showcase, scalars,
    notify: (opts) => notify(opts),   // opts 透传（拉杆拍 force：转轮窗内置灰即时）
    panelStage: () => panelStage(),
    roomStage: () => roomStage,
  });

  // ---- 幕间流（随机事件 / 进阶：对话 + 选项 + 同步结算 + 切幕出场）----
  // 编排整体在 runCutsceneFlows.js；lifecycle 是本控制器注入的房间/舞台生命周期动作，
  // 全部箭头晚绑定（swapRoomToMap/exitSceneAfterCutscene 在下方才定义，运行期才取值）。
  const cutsceneFlows = createRunCutsceneFlows({
    run, runCtx, runPresenter, cutscene, showcase, dedicatedSequencer,
    notify: (opts) => notify(opts),
    setRoomScenePending: (v) => { roomScenePending = v; },
    dismissModals: () => director.dismissModals(),   // 内容幕间豁免路径的中点清算自理（见 playAscensionScene atCover 注释）
    panelStage: () => panelStage(),   // 跳过进阶收尾的删卡界面挂点（晚绑定，同 showcase）
    playBossRemoveNow: () => machines.playBossRemoveNow(),   // 跳过进阶的删卡反哺（即时弹，放弃即作废）
    lifecycle: {
      completeRoom: () => completeRoom(run),
      completeRoomSwapToMap: () => { completeRoom(run); swapRoomToMap(); notify({ force: true }); },   // 进阶豁免点：同揭幕就位契约
      // 塔楼在台且楼层已推进 → 排相机爬升（幂等）。不换台的幕间退出（事件房/进阶收尾）
      // 也走这里：升层可能发生在幕间内部（onChoice 同步结算），爬升的排期点统一放在
      // 各条「揭幕回塔楼」的节拍上（1 层事件房升 2 层没有爬升）。
      arriveMapFloor: () => arriveMapFloor(),
      exitSceneAfterCutscene: (fn) => exitSceneAfterCutscene(fn),
    },
  });

  // ---- 调试模式（面板/脚本的唯一入口；见 shell/runDebug.js）----
  // 与 machines/cutsceneFlows 同构：域模块 + 晚绑定 ctx；改 core 状态走 core/debug/ops.js，
  // 本处只管"改完之后前端怎么刷新"（状态栏 / 面板 / 换台 / 进房演出）。
  const runDebug = createRunDebug({
    run,
    notify: (opts) => notify(opts),
    syncMapStatus: () => syncMapStatus(),
    swapAnyToMap: () => swapAnyToMap(),
    settleStageEffects: () => settleStageEffects(),   // 调试 act 的阶段效应刷新（prep 检查点/预热）
    presentRelic: (id) => showcase.presentRelic(id),   // 调试授予遗物的获得特写
    mapStage,
    enterRoomPresentation: () => enterRoomPresentation(),
    getBattleStage: () => battleStage,
    getBattleBridge: () => battleBridge,
    cutscene,
    playAscensionScene: (opts) => cutsceneFlows.playAscensionScene(opts),
  });

  // ---- 静止态断言器（P0 防回归基建，见 quiescence.js 头注）----
  // 调试局安装；状态读口挂 window.__quiescence 供 soak 脚本强断言。只断言不修复。
  let quiescence = null;
  if (isDebug) {
    // battle-span 闸门在队即「战斗进行中」的正常占用——静止判定与卡死谓词都视它为不可见
    const queueIdle = () => !dedicatedSequencer.findPending(i => !i.tags.has('battle-span'));
    quiescence = createQuiescenceChecker({
      isIdle: () => queueIdle() && cutscene.state.mode === 'idle'
        && !panelStage()?.uiBusy,
    });
    quiescence.add('runController', () => [
      // 转场/解说均已指令化（在队 = 队列忙，断言器自然不采样）；这里只留无界簿记
      ...(roomScenePending && !roomStage ? ['roomScenePending 悬空（无房间场景）'] : []),
      ...(pendingClearFx && run.gameStage !== 'reward' ? ['楼层通过素材残留'] : []),
    ]);
    quiescence.add('machines', () => machines.quiescenceFailures());
    quiescence.add('cutsceneFlows', () => cutsceneFlows.quiescenceFailures());
    // showcase 域不注册静止检查：其全部在途状态（出货指令/恶魔链/待播特写）都是
    // dedicatedSequencer 指令（在队 = 队列忙，断言器自然不采样）或 modal 内
    //（uiBusy = 采样窗口关闭）——静止断言管的是无界泄漏，这里没有无界簿记
    // 结束回合锁 staleness（私有字段仅断言读）：新回合快照已落定（key 变化）而锁仍握
    quiescence.add('battleStage', () => {
      const st = battleStage;
      if (!st?._endTurnRequested) return [];
      const key = `${st._snapshot?.turn?.side ?? '?'}:${st._snapshot?.turn?.count ?? -1}`;
      return key === st._endTurnLockKey ? ['结束回合锁未随新回合快照释放'] : [];
    });
    // 战斗卡死谓词（span 闸门保险丝本体）：活着却既不等输入也不推进，连续 3 拍才算
    quiescence.add('battlePredicate', () => {
      const b = battleBridge;
      if (!b || b.isFinished()) return [];
      const stuck = battleQuiescent({
        alive: true,
        pendingInput: b.getProjection()?.pendingInput != null,
        queueCount: queueIdle() ? 0 : 1,
      });
      return stuck ? ['战斗活着但既不等输入也不推进（疑似卡死）'] : [];
    }, { persist: 3 });
    // battle-span 闸门清场：离战后队列里不得再挂着闸门（挂着 = 静止态判定永久失效）
    quiescence.add('spanGate', () => {
      if (run.gameStage === 'battle' || battleBridge) return [];
      return dedicatedSequencer.findPending(i => i.tags.has('battle-span'))
        ? ['离战后 battle-span 闸门未收'] : [];
    });
    if (typeof window !== 'undefined') window.__quiescence = quiescence; // soak 脚本经 sample() 同步断言
  }

  // ---- 战斗 ----
  // 进场：战前剧本（如 preBoss）→ 幕间转场（全黑中点切舞台 + 预载）→ 战斗
  // 单飞纪律归队列（'run:battle-entry' 自家标签互等）：转场 pending 期间连点
  // 「进入战斗」排在队尾，轮到时 gameStage 已翻篇（doSwap 在黑幕中点切 'battle'）即自灭；
  // 入队口的 findPending 挡掉重复入队（连点不积攒僵尸指令）。
  let pendingClearFx = null; // 楼层通过素材（endBattle 胜利时捕获；afterRewardToFloor 消费即清）
  let disarmSpanGate = null; // battle-span 闸门的生命周期句柄（armBattleSpanGate 返回）

  /**
   * battle-span 闸门（幽灵指令，P1 词汇表的首个活体）：战斗开始入队、BATTLE_END
   * 回执（result 随回执带走）。tags 退出 'all'——战斗节拍不等它（否则全队死锁）；
   * 「战中入账、战后播」的指令用 waitTags: ['all','battle-span'] 排队（P2+ 消费）。
   * 保险丝 = 语义谓词（createPredicateFuse）：离战未收 → 清场收闸；战中卡死
   * （活着却既不等输入也无指令推进）→ timeout 引爆并计入 timeoutCount。
   */
  function armBattleSpanGate(bridge) {
    const gateId = dedicatedSequencer.enqueueInstruction({
      owner: bridge,
      tags: ['battle-span'],
      tagAll: false,
      waitTags: [],          // 闸门即刻就位（BATTLE_END 监听不能晚于战斗开始）
      durationMs: Infinity,  // 保险丝由谓词接管（战斗几分钟，墙钟配不出余量）
      meta: { event: 'battle-span-gate' },
      start: ({ id }) => {
        const onEnd = ({ result }) => {
          bridge.backendBus.off(EventNames.BATTLE_END, onEnd);
          stopFuse();
          dedicatedSequencer.finish(id, { reason: 'manual', result });
        };
        bridge.backendBus.on(EventNames.BATTLE_END, onEnd);
      },
    });
    const stopFuse = createPredicateFuse({
      probe: () => {
        if (dedicatedSequencer.findPending(i => i.id === gateId) == null) return false; // 闸门已收：不适用
        if (run.gameStage !== 'battle') return true; // 离战而闸未收（调试硬重置/异常）：清场
        const b = battleBridge;
        if (!b || b.isFinished()) return false;
        // 双 sequencer 后「无活动」须两队列同看：战斗节拍在 battleSequencer（敌方
        // 回合演出期间 pendingInput 为空但队列在跑——漏看会把正常节拍误判成卡死）
        return b.getProjection()?.pendingInput == null
          && battleSequencer.pendingCount === 0
          && !dedicatedSequencer.findPending(i => i.id !== gateId);
      },
      onTrip: () => {
        const gone = run.gameStage !== 'battle';
        dedicatedSequencer.finish(gateId, { reason: gone ? 'manual' : 'timeout' });
      },
    });
    return () => { stopFuse(); dedicatedSequencer.cancelByOwner(bridge); };
  }
  function startBattle() {
    if (run.gameStage !== 'prep') return;
    if (dedicatedSequencer.findPending(i => i.meta?.event === 'run:battle-entry')) return;
    // 素材预载即刻发起（不等黑幕）：立绘/卡图进共享缓存，战前剧本（cutscene）
    // 与黑幕转场的整段窗口都用于加载；BattleStage 建视图时同步命中，不再
    // "占位后补挂"。assembleBattle 是纯读取（encounter/remi/种子派生），
    // 可先于 enterBattle 调用，doSwap 复用同一份装配
    const assembled = assembleBattle(run);
    preloadBattleArt({ deck: run.player.deck, ...assembled });
    const doSwap = async () => {
      enterBattle(run);
      const { enemies, allies, seed } = assembled;
      const bridge = createBridge({ runState: run, enemies, allies, seed, frontendBus: battleBus, sequencer: battleSequencer });
      battleBridge = markRaw(bridge);
      if (stageManager) {
        battleStage?.dispose(); // 上一场舞台即刻释放（场景图 + composer 渲染目标）
        const sceneId = USE_PCG_ROOMS ? sceneIdForFloor(run.floor) : 'dungeon';
        // Boss 房间覆写（敌人 def roomOverride）：Boss 把房间改成自己的
        // 主题房——pyro 全场压暗 + 木质装饰品大增（转段「烧起来」的燃料与明暗落差）
        const roomOverride = enemies.reduce(
          (ovr, u) => mergeRecipeOverride(ovr, getEnemyDefinition(u.defId)?.roomOverride), null);
        // 房间种子 = 战斗种子 + 层号派生：同层同种子恒定同布局，重打同层房间不变
        battleStage = new BattleStage({
          bridge, stageManager, displayModel, scene: sceneId, sceneSeed: `${seed}:room:${run.floor}`,
          roomOverride,
        });
        // 战后奖励面板落在战斗舞台上：意图出口与塔楼层同一套
        battleStage.setPanelIntentHandler(dispatchPanelIntent);
        battleStage.setRunSequencer(dedicatedSequencer);   // 得卡演出的指令化挂点（与切幕/清层串行）
        stageManager.setStage(battleStage);
        playMusic('battleCh1'); // 战斗 BGM 随换场起跑（黑幕期淡入）；新章曲目登记进 audio.js TRACKS 后按 run.floor 选
        duckWind(0);            // 塔楼风声床压暗（不切源，回塔续播）
      }
      disarmSpanGate?.();
      disarmSpanGate = armBattleSpanGate(bridge); // 先武装：闸门 onEnd 须先于 endBattle 注册（mitt 按注册序发射）
      // 战斗生命周期监听：注册序即发射序——闸门先自收（result 落回执），endBattle 再做清场
      bridge.backendBus.on(EventNames.BATTLE_LOG, pushLog);
      bridge.backendBus.on(EventNames.BATTLE_END, ({ result }) => endBattle(result, bridge));
      bridge.start();
      // 黑幕后直接应用首帧投影：战斗演出指令排在队列中的 wipe 指令之后，揭幕前
      // 不会启动——若等首拍 sync，整个黑幕期间场景是空的（单位/卡牌揭幕后才迟到的
      // 根因）。先建好视图，whenReady 才能真实感知在途加载并保持黑幕到就绪；
      // 队列随后重放的更早 sync 节拍（如 battleStart 的空手牌快照）被显示时刻
      // 单调守卫丢弃，显示状态不会倒退（否则手牌"闪没又闪回"）
      battleStage?.applyProjection(bridge.getProjection());
      log.length = 0;
      await battleStage?.whenReady(); // 预载完成信号（超时兜底）→ 揭幕（notify 由 transitionStage 在兑现后补）
    };
    enqueueFlowInstruction(dedicatedSequencer, {
      tag: 'battle-entry', meta: { event: 'run:battle-entry' },
      entryOk: () => run.gameStage === 'prep',
      play: async (done) => {
        try {
          await playPendingCutscenes(); // prep 阶段命中项（Boss 层 = preBoss）
          await transitionStage({ migrate: doSwap, holdMs: 250 });
        } finally { done(); }
      },
    });
  }

  // 退场（调整节拍）：**先落战后奖励、不切幕、也不换舞台** ——
  // 奖励 overlay 直接盖在**战斗房间**上（面板由战斗舞台承载，见 notify 的 reward 分支）；
  // 领完/跳过奖励后（claimReward → afterRewardToFloor）才切幕，并在**黑幕中点**把舞台
  // 换成塔楼层、播"楼层 clear（当前层高亮块长出）"动画。
  function endBattle(result, bridge) {
    // 楼层通过演出的素材捕获（必须在 finishBattle 之前——此后 encounter/楼层语义翻篇）：
    // 胜利才演；编成名称反查定义表（encounter 元素可能是缩放描述符或裸 id）
    if (result === 'victory') {
      const defIdOf = (e) => (typeof e === 'string' ? e : e?.defId);
      pendingClearFx = {
        floor: run.floor,
        boss: isBossFloor(run.floor),
        enemies: (run.encounter ?? []).map(e => {
          const id = defIdOf(e);
          return { defId: id, name: (typeof e === 'object' && e?.name) || getEnemyDefinition(id)?.name || id };
        }).filter(e => e.defId),
      };
    }
    // Boss 掉落遗物的授予源特写：finishBattle 内部起草授予（shell 不可见），前后留影捕获新增
    const relicsBefore = new Set(run.player.relics);
    finishBattle(run, result, bridge.battle); // 回写 run（含瑞米打跑检测）→ gameStage='reward'
    for (const id of run.player.relics) {
      if (!relicsBefore.has(id)) showcase.presentRelic(id);
    }
    if (result !== 'victory') stopMusic({ fadeOut: 2 }); // 战败即收战斗曲；胜利留到回塔（swapBattleToMap）再收
    disarmSpanGate?.();   // 闸门 onEnd（先注册）已自收带 result；此处停保险丝 + cancelByOwner 清残
    disarmSpanGate = null;
    battleBridge = null;
    // 战斗落定即推状态栏：链条末尾的 notify 要等爬塔动画播完，战后血量/金币等不起。
    notify({ force: true });   // 推 reward 面板（契约：奖励 overlay 即刻可交互——不随门控推迟），背景仍是战斗房间
    if (run.gameStage === 'end') void enterEndScreen();   // 败北线：finishBattle 落 'end'（notify 不再背终局路由）
  }

  /**
   * 奖励环节收尾（claimReward 之后）：切幕 → 塔楼 → **楼层 clear 动画** → 战后剧本 → 进房。
   * 节拍要点：玩家点完领取/跳过，才把奖励 overlay 收掉并揭幕塔楼；
   * 阶段迁移（completeRewards）已在 claimReward 里完成，这里只做呈现与演出。
   */
  async function afterRewardToFloor() {
    // ① 切幕：**黑幕中点**换舞台（战斗房 → 塔楼）+ 收起奖励 overlay、换上新阶段面板；
    //    揭幕露出的是塔楼（此前战斗一结束就瞬切塔楼，奖励面板浮在塔楼前，节拍对不上）
    await transitionStage({ migrate: swapBattleToMap });
    // ② 楼层通过：刚清掉那层的敌人残影逐个开裂→灰暗→崩解成灰（与爬升同拍起跑；
    //    本层有房间时 floor 未推进、相机原地不动——残影在静止取景里完整演完）
    if (stageManager && mapStage) {
      const clearFx = pendingClearFx;
      pendingClearFx = null;
      await awaitFloorArrive(dedicatedSequencer, mapStage, {
        floor: run.floor, totalFloors: run.totalFloors, clearFx,
      });
    }
    // ③ 战后剧本（Boss 层 = postBoss）→ 幕间退出也切幕（cutscene 与场景同待遇；
    //    空转场也走 transitionStage 的 dismissModals+notify 中点纪律）
    const played = await playPendingCutscenes();
    if (played) await exitSceneAfterCutscene();
    // ④ 进房演出（事件幕间 / 有配方的房切场景；无房 = 留在战前准备）
    enterRoomPresentation();
  }

  // ---- 终局结算屏（'end'）----
  // 结算屏数据装配：core run → 纯视图对象（EndStage 不反查 core 注册表）。
  function endViewOf() {
    const kills = Object.entries(run.stats?.kills ?? {})
      .map(([defId, count]) => ({ name: getEnemyDefinition(defId)?.name ?? defId, count }));
    kills.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'));
    const victory = run.result === 'victory';
    return {
      result: run.result,
      title: victory ? (import.meta.env.PROD ? '第一章·完' : '登顶成功') : '倒在了塔中',
      subtitle: victory ? `通关全塔 ${run.totalFloors} 层` : `止步于第 ${run.floor} 层（共 ${run.totalFloors} 层）`,
      kills,
      deckCount: run.player.deck.length,
      goldEarned: run.stats?.goldEarned ?? 0,
      relics: (run.player.relics ?? []).map(id => ({ id, name: getRelicDefinition(id)?.name ?? id })),
    };
  }

  /**
   * 切幕进入终局结算屏（幂等；headless 无舞台时跳过——'end' 语义不受影响）。
   * 黑幕中点：拆战斗/房间舞台 → 建 EndStage 换台；揭幕后 startTally 逐条结算。
   * 单飞纪律归队列（'run:end-entry'）：settleStageEffects 的终局兜底分支可能在
   * tally 期间反复调，endStage 已就位即早退；切幕中的重复触发排队尾自灭。
   */
  function enterEndScreen() {
    if (endStage || !stageManager) return;
    if (dedicatedSequencer.findPending(i => i.meta?.event === 'run:end-entry')) return;
    const doSwap = () => {
      stopMusic();  // 战斗 BGM 到此为止（败北线已在 endBattle 收过，幂等）
      duckWind(1);  // 风声床回全量（战斗压暗态的恢复）
      pendingClearFx = null; // 楼层 clear 是回塔楼的演出，结算屏路径不播
      battleStage?.dispose(); battleStage = null;
      roomStage?.dispose(); roomStage = null;
      endStage = markRaw(new EndStage({
        stageManager, bus: animBus, view: endViewOf(),
        onAction: (action) => { if (action === 'restart') onRestart?.(); },
      }));
      endStage.attachInput({ stageManager, bus: animBus });
      stageManager.setStage(endStage);
    };
    enqueueFlowInstruction(dedicatedSequencer, {
      tag: 'end-entry', meta: { event: 'run:end-entry' },
      entryOk: () => run.gameStage === 'end' && !endStage,
      play: async (done) => {
        try {
          await transitionStage({ migrate: doSwap, holdMs: 250 });
          endStage?.startTally();
        } finally { done(); }
      },
    });
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
    if (run.gameStage === 'end') { void enterEndScreen(); notify(); return; } // 登顶终局：直调结算屏路由（不再借 notify 触发），不回塔楼
    if (run.gameStage === 'room') {
      // 将要用幕间/房间场景呈现的房间：先置"待呈现"，notify 与切幕之间塔楼层不再铺房间面板
      if (run.currentRoom === 'event' || restRecipeFor(run.currentRoom)) roomScenePending = true;
    }
    // 奖励环节结束 → （Boss 删卡机会就地弹选卡）→ 切幕回塔楼 → clear 动画 → 战后剧本 → 进房
    // 整条收尾 = 'run:reward-exit' 流程指令（队列单飞）：Boss 删卡是玩家节奏段，没落定
    // 不切幕（选卡不会被黑幕中途吞掉）；afterRewardToFloor 内部的切幕/剧本步骤排同一
    // 队列（流程已退出 'all'，无互等死锁——同 devour/event 的代数）。
    enqueueFlowInstruction(dedicatedSequencer, {
      tag: 'reward-exit', meta: { event: 'run:reward-exit' },
      entryOk: () => run.gameStage === 'room' || run.gameStage === 'prep',
      play: async (done) => {
        try {
          if (run.pendingCardRemoval > 0) await machines.playBossRemoveNow();
          await afterRewardToFloor();
        } finally { done(); }
      },
    });
  }

  // ---- 舞台路由（stageDirector，§4.4）+ 场景式休息房（第一间 = 赌厅 casino）----
  // panel/fx/input/dismiss 四个路由问题从 director 一处派生（引用晚绑定）：
  // 全屏选卡/选遗物/获得物特写画在**当前活动舞台**的 uiScene 上（只有活动舞台会被渲染）。
  // ⚠ 不含 battle 曾是 bug：Boss 遗物在 finishBattle 即入账（gameStage 已是 'reward'），
  // 特写差分播到未渲染的 mapStage 上被无声吞掉。
  const director = createStageDirector({
    battle: () => battleStage, room: () => roomStage,
    map: () => mapStage, end: () => endStage,
  });
  const panelStage = director.panelStage;   // 本控制器内的既有消费面不动，指向一处派生
  // gameStage 落到 'room' 且该房类型有配方（restRecipeFor）时，用**幕间黑幕**切到房间场景
  // （RoomStage）；没有配方的房间类型继续走塔楼层 + 占位面板，不切场景。
  // 离开由玩家**主动**发起（房间右下角「继续前进」箭头）→ 同样走黑幕回塔楼。
  async function enterRestRoomScene() {
    const recipe = restRecipeFor(run.currentRoom);
    if (!recipe || !stageManager) return false;
    const doSwap = () => {
      roomStage?.dispose();
      roomStage = markRaw(new RoomStage({
        recipe,
        seed: `${seed}:rest:${run.floor}`,
        stageManager,
        bus: animBus,
        snap: panelSnapshot(run, panelExtras()),
        // 房间活物：瑞米在场 = 故事模式且未被击退（骑士常驻，无血条；
        // 瑞米是故事模式同伴，肉鸽模式不在营地游荡）
        units: { remi: !!run.storyMode && !run.remi?.drivenOff },
      }));
      roomStage.setPanelIntentHandler(dispatchPanelIntent);
      roomStage.setRunSequencer(dedicatedSequencer);   // 得卡演出的指令化挂点（与离房切幕串行）
      // 篝火推近特写 = 火声放大（拉远回落）：焦点上行只报名字与机器条目，表现侧自己认
      roomStage.setMachineFocusListener((name, entry) => {
        if (entry?.kind === 'camp') duckAmbienceLayer('roomCampfire', name ? 1.9 : 1);
      });
      stageManager.setStage(roomStage);
      duckWind(0);   // 休息房不算塔楼层：进房压暗（不切源，回塔续播）
      playRoomAmbience(run.currentRoom);   // 房间专属氛围组合（audio.js 组合表：商店/老虎机/营地）
      roomScenePending = false;   // 场景已就位：抑制交给 roomStage 这个条件接管
      // 状态栏/资源行由中点 notify 紧随同拍推上（migrate 后立即 notify——transitionStage 纪律）
    };
    // 中点 notify（transitionStage 纪律）让问句呈现/教学在黑幕里就位——揭幕即呈现
    //（恢复档带出的 slotPending 等在读档直入路径上「恢复即重发」由此兑现）
    await transitionStage({ migrate: doSwap, holdMs: 220 });
    return true;
  }
  /**
   * 进房后的**演出派发**（阶段迁移落进 'room' 后调用一次）：
   *   · 事件房 → 播事件幕间（cutscene：CG + 对话 + 选项；不做 3D 场景）
   *   · 有休息房配方的房间 → 幕间黑幕切进房间场景（RoomStage）
   *   · 其余（无配方）→ 留在塔楼层 + 占位面板
   * 两条路各自幂等（事件已在播/场景已切都不重复）。
   */
  function enterRoomPresentation() {
    if (run.gameStage !== 'room') return;
    if (run.currentRoom === 'event') { void cutsceneFlows.playEventScene(); return; }   // 事件房风声由幕间流压暗
    // 赌厅进房钩子：吞噬教学/恶魔解说的电平覆盖（正常触发在机器意图拍；这里兜恢复/重进）
    if (run.currentRoom === 'slot') machines.onSlotRoomEntered();
    // 无配方房（古尔帕斯）：留在塔楼画面 + 面板，但也不算塔楼层——同样压暗；
    // 有配方房的压暗在 enterRestRoomScene 换台那拍
    void maybeEnterRestScene().then((entered) => { if (!entered) duckWind(0); });
  }

  /**
   * 有配方且当前不在房间场景时进入（幂等：并发/重复调用只切一次）。
   * 单飞纪律归队列（'run:room-entry'）：进房切幕期间的重复触发排队尾，轮到时
   * roomStage 已就位（或局面翻篇）即自灭；返回 Promise 在流程收尾拍落定
   * （消费方只有 duckWind 回落兜底，等真值不等切幕也行——但保持旧语义零漂移）。
   */
  function maybeEnterRestScene() {
    if (roomStage || run.gameStage !== 'room' || !restRecipeFor(run.currentRoom)) return Promise.resolve(false);
    if (dedicatedSequencer.findPending(i => i.meta?.event === 'run:room-entry')) return Promise.resolve(false);
    return new Promise((resolve) => {
      const enqueued = enqueueFlowInstruction(dedicatedSequencer, {
        tag: 'room-entry', meta: { event: 'run:room-entry' },
        entryOk: () => !roomStage && run.gameStage === 'room' && !!restRecipeFor(run.currentRoom),
        play: async (done) => {
          let entered = false;
          try { entered = await enterRestRoomScene(); }
          finally { done(); resolve(entered); }
        },
      });
    });
  }
  /**
   * 离开房间场景：黑幕中点换回塔楼层。
   * @param beforeSwap 在**黑幕盖住之后**执行（核心阶段迁移 + notify 都放这里）——这是用户
   *   的节拍：先起幕间切幕演出，再同步 state、转移场景，最后揭幕。
   *   在前端状态必然经历一瞬"旧场景 + 新快照"（面板突变/取景突变）的场合，只有把同步
   *   压进黑幕里才能让那些 invalid 中转帧完全不被看见。
   */
  /**
   * 把**战斗舞台**换回塔楼（不排幕）：战后奖励领完后由切幕中点调用——战斗舞台随换台释放
   * （它的 uiScene 上挂着奖励面板，一并回收）。
   */
  function swapBattleToMap() {
    stopMusic(); // 战斗 BGM 收到此（胜利线；战败已在 endBattle 收过，幂等）
    duckWind(1); // 回塔：风声床恢复全量
    if (stageManager && mapStage) mapStage.setFloor(run.floor, run.totalFloors); // 塔楼先摆到新层；抵达动画随后播
    // 先释放战斗舞台、**后**换台：BattleStage 无 onExit，全部清理在 dispose——其中
    // shake.dispose 会把相机回基位。此前先 setStage 后 dispose，塔楼机位（onEnter 刚摆）
    // 被回退到战斗基准机位：塔/雪原全在雾外，战后揭幕只剩天空穹的灰蓝。
    // 换台发生在黑幕中点，先拆后换并不可见。
    battleStage?.dispose();
    battleStage = null;
    if (stageManager && mapStage) stageManager.setStage(mapStage);
    // 面板/状态栏：transitionStage 的中点 notify 同拍随后推新阶段快照
  }

  /** 把房间舞台换回塔楼（不排幕）：奖励/进阶等"多段演出"共用同一段换台代码。 */
  function swapRoomToMap() {
    duckWind(1); // 回塔楼画面即恢复风声（无配方房离开时 roomStage 本就为空，此调用同样覆盖）
    stopAmbience(); // 房间氛围床随房收掉
    if (stageManager && mapStage) mapStage.setFloor(run.floor, run.totalFloors);
    // 先释放房间舞台、后换台（同 swapBattleToMap）：dispose→onExit 的基准机位还原
    // 不得晚于塔楼 onEnter 的新机位——此前顺序反了，只靠随后的爬升 tween 逐帧覆写
    // 相机侥幸掩盖。
    roomStage?.dispose();
    roomStage = null;
    if (stageManager && mapStage) {
      stageManager.setStage(mapStage);
      // 房间完成推进了楼层 → 排一段相机爬升（fire-and-forget：面板已随 swap 推上，
      // 爬升期间可备战；后续剧本/进房节拍在同一串行队列里自然排在爬升之后；
      // 爬升前 ~1s 在黑幕里起步属预期）
      arriveMapFloor();
    }
    // 状态栏随中点 notify 同拍推上（两条调用路径——transitionStage / completeRoomSwapToMap——都自带）
  }

  /**
   * **调试用**：把当前舞台无条件换回塔楼（战斗/房间舞台全拆，含各自的 uiScene 覆盖层）。
   * 不推进任何 core 阶段——core 状态由 runDebug 的原语负责，这里只管"画面别留在旧场景里"。
   * 转场单飞已归队列：在途的转场指令自会走完/自灭（gameStage 翻篇后 entryOk 拒），
   * 这里只复位面板抑制位与揭示横幅。
   */
  function swapAnyToMap() {
    duckWind(1); // 回塔楼画面即恢复风声（调试硬重置可能发生在战斗压暗态）
    stopAmbience(); // 调试硬重置可能发生在房间氛围态
    // 先清队列再对账：在队的飞行指令若不摘，落地拍会把已清零的 delta 顶成正
    dedicatedSequencer.cancelAll();
    scalars.reconcile(true);   // 显示标量强贴（世界拆除：演出中断不留永久不同步）
    battleStage?.dispose(); battleStage = null;
    roomStage?.dispose(); roomStage = null;
    endStage?.dispose(); endStage = null;
    roomScenePending = false;
    slot.lastSpin = null;
    if (stageManager && mapStage) {
      mapStage.setFloor(run.floor, run.totalFloors);
      stageManager.setStage(mapStage);
    }
    syncMapStatus();
    settleStageEffects();   // 硬重置也是阶段落定点（调试跳层/进房后的检查点与预热由此不缺）
  }

  /**
   * 塔楼在台且 run.floor 已越过相机锚层 → 排一段相机爬升（幂等：未推进/无舞台即无动作）。
   * 所有「阶段迁移后回到塔楼画面」的节拍都调它——换台路径（swapRoomToMap）与不换台的
   * 幕间退出（事件房/进阶收尾，见 lifecycle.arriveMapFloor）同一条规则：升层不只发生在
   * 战后，谁推进了楼层谁负责在揭幕时补爬升。
   */
  function arriveMapFloor() {
    if (!(stageManager && mapStage)) return;
    if (run.floor > mapStage.cameraFloor) {
      void awaitFloorArrive(dedicatedSequencer, mapStage, {
        floor: run.floor, totalFloors: run.totalFloors,
      });
    }
  }

  async function exitRestRoomScene(beforeSwap = null) {
    const migrate = () => { beforeSwap?.(); swapRoomToMap(); };
    if (!roomStage) { migrate(); notify({ force: true }); return false; }   // 无场景（占位路径/无舞台）：同步直落（无幕可等，门控不适用）
    await transitionStage({ migrate });
    return true;
  }

  /**
   * **cutscene 退出回舞台**的切幕（cutscene 回塔楼本质上和场景切换没区别）：
   * 黑幕盖住 → beforeSwap（阶段迁移/面板刷新）→ 揭幕（揭开的就是刷新后的舞台）。
   * 与 exitRestRoomScene 的区别：**不换舞台**——目的地就是当前舞台本身，cutscene 内容层收起即露出。
   * 无舞台（headless）时同步直落（不排黑幕，不影响逻辑）。
   */
  async function exitSceneAfterCutscene(beforeSwap = null) {
    await transitionStage({ migrate: beforeSwap });
    return true;
  }

  // ---- rooms（训练改版：训练必做且先于篝火；进阶在训练开始那一刻房内先行）----
  // 各入口先查 gameStage：连点/迟到点击会让核心变更先落地、completeRoom 再抛错，造成重复结算
  // 训练节拍：开始（beginTraining，达标则切 'ascension' 由进阶幕间接力播完自动回房）→
  // 可选段（4 选 1 抓一张 → 抓了就欠一次升级 pendingUpgrade）→ 篝火解锁（营地/训练各自一次）。
  // roomData 同时承载两个部分的记账，各动作的合法性由 core 守卫兜（已开局/已收束/
  // 尾款未清都有明确报错）——shell 侧只挡 gameStage 与重复 begin。
  const campLocked = () => !!run.roomData?.campUsed || campGateLocked(run);
  // 合并房不自动离房（两部分都要给机会），单房保持原语义「做完即离房」
  function maybeLeaveRoom() {
    if (run.gameStage !== 'room') return;
    if (run.currentRoom === 'campTraining') { notify(); return; }
    completeRoom(run);
    notify();
  }
  // 开始训练（必做阶段的开局）：记一次训练（升阶）。达标 → 进阶幕间当场接棒
  // （playAscensionScene 的「已在 ascension 阶段」路径：wipe → 对话 → 揭幕回房间场景，
  // 阶段已被 completeAscension 切回 'room'，快照随揭幕刷新出可选段）。
  function trainingBegin() {
    if (run.gameStage !== 'room' || run.roomData?.trained) return;
    const ascensionDue = beginTraining(run);
    if (ascensionDue) { void cutsceneFlows.playAscensionScene(); return; }
    notify();
  }
  // 尾款升级自动链（交互迁移）：模式二选一（对话 overlay；只有一种可用直接定）
  // → 全屏选卡（twoC 多选两张一次完，oneB 单选）。整条链在抓牌落地那拍自动唤起——
  // 面板不再摆模式/升级按钮；overlay 被中途关掉时由问句驱动（runQuestions 在 notify 拍
  // diff trainingUpgrade 问句）自动重入本链，读档恢复同理（恢复即重发）。
  // 单飞纪律归队列（同 devour 形态）：流程 = 一条 'training-flow' 指令——退出 'all'
  //（流程内部还要往同一队列排 cutscene 剧本步骤，带 'all' 会互等死锁）+ 自家标签互等
  //（在播期间的再入排队尾）；轮到时若升级选卡已开着（uiBusy）或局面翻篇即自灭。
  // 玩家节奏段（模式对话/选卡长考）不能上墙钟保险丝；start 内 try/finally 兜底 finish。
  function openTrainingUpgradeFlow() {
    // 单飞纪律归队列（壳见 flowInstruction.js；uiBusy 门 = 升级选卡已开着时自灭）
    return enqueueFlowInstruction(dedicatedSequencer, {
      tag: 'training-flow', meta: { event: 'room:training-upgrade-flow' },
      entryOk: () => run.gameStage === 'room' && !!run.roomData?.pendingUpgrade
        && !panelStage()?.uiBusy,
      play: playTrainingUpgradeFlow,
    });
  }
  async function playTrainingUpgradeFlow(done) {
    try {
      const pending = run.roomData.pendingUpgrade;
      if (typeof pending !== 'object' || !pending.mode) {
        const modes = trainUpgradeModes(run);
        const can2C = modes.twoC.length >= 2;
        const can1B = modes.oneB.length >= 1;
        let mode = null;
        if (can2C && can1B) {
          await cutscene.play({
            steps: [{
              type: 'dialogue',
              pages: [{
                speaker: '训练桩',
                text: '训练还差最后一步——升级卡牌。',
                choices: [
                  { id: 'twoC', label: '夯实基础', hint: '选择两张C级卡牌升级。' },
                  { id: 'oneB', label: '精益求精', hint: '选择一张B级卡牌升级。' },
                ],
              }],
              onChoice: (id) => { mode = id; },
            }],
          });
        } else {
          mode = can2C ? 'twoC' : 'oneB';
        }
        // 对话期间局面可能已变（尾款被别的路径清掉/离房）——落 core 前重查
        if (!mode || !run.roomData?.pendingUpgrade || run.gameStage !== 'room') return;
        try { trainUpgradeStart(run, mode); } catch (err) { console.warn('[training]', err.message); return; }
        notify({ force: true });   // 快照新鲜度契约：下一行直开选卡读 _snap（此刻流程指令在队=必忙）
      }
      panelStage()?.openUpgradePicker?.('training');
      // 持有到尾款清账或演出落定：twoC 多选链是逐张「飞行 → 意图 → notify」推进的，
      // 中间拍问句还开着且选卡器已收——此刻放指令，问句驱动会把升级选卡重开一份，
      // 与飞行链的下一张赛跑（会收尾悬空一只没人关的选卡器）。升级/得卡飞行
      // 指令在队 = 链还在走；玩家取消（选卡器收起且无飞行）则正常放行重入。
      await waitFor(() => {
        const busy = panelStage()?.uiBusy
          || !!dedicatedSequencer.findPending(i => i.meta?.event === 'run:card-upgrade' || i.meta?.event === 'run:card-grant');
        return !run.roomData?.pendingUpgrade || run.gameStage !== 'room' || !busy;
      });
    } catch (err) {
      console.warn('[training]', err.message);
    } finally {
      done();
    }
  }
  function trainingUpgrade(uniqueID, targetId = null) {
    if (run.gameStage !== 'room' || !run.roomData?.pendingUpgrade) return;
    trainUpgrade(run, uniqueID, targetId); // 分叉目标由升级子面板传入
    if (run.roomData?.pendingUpgrade) notify();  // twoC 还剩一张：原地刷新候选
    else maybeLeaveRoom();
  }
  // 可选段开局：掷四选一候选 → 问句驱动在 notify 拍自动开全屏 overlay（不再内嵌面板卡阵）。
  // ⚠ 不查 trained——可选抓牌本来就发生在**训练完成之后**（曾因沿用旧「trained=已锁」
  // 语义静默吞掉按钮点击，用户报「抓牌按钮没反应」）；core 守卫兜已开局/已收束。
  function trainingDrawRoll() {
    if (run.gameStage !== 'room' || run.roomData?.pendingUpgrade) return;
    trainDrawChoices(run);
    // force = 快照新鲜度契约：选卡器读 panelHost._snap，候选就在本次变更里；
    // 开界面由 notify 尾的 questions.drive 统一负责（同源单份，不再手动直开）
    notify({ force: true });
  }
  function trainingDraw(defId = null) {
    if (run.gameStage !== 'room' || !run.roomData?.drawChoices) return;
    answerQuestion(run, defId); // 欠升级态没有跳过出口，null 只会是放弃候选（picker 返回）
    // 尾款自动链与离房都由 notify/空闲沿的问句驱动接管（驱动 diff trainingUpgrade →
    // openTrainingUpgradeFlow；无问句且单房做完 → maybeLeaveRoom），此处不再手动 kick
    if (run.roomData?.pendingUpgrade) notify();
    else maybeLeaveRoom();
  }
  function campChoose(option) {
    if (run.gameStage !== 'room' || campLocked()) return;
    if (option === 'rest') {
      campRest(run);
      stopAmbienceLayer('roomCampfire', { fadeOut: 3 });   // 休息过火：篝火层慢淡熄（火把底噪原样续到离房）
    }
    else if (option === 'recoverRemi') campRecoverRemi(run);
    maybeLeaveRoom();
  }
  // 合并房的主动离房（单房由动作自动离房，不需要这个）
  // 恶魔 roll 的两拍获得演出（词条 → 逐张焚毁 → 金币 → 附赠选卡）在 runShowcase.js（指令化）。

  function leaveRoom() {
    if (run.gameStage !== 'room') return;
    // 训练必做 + 尾款未清：不让走（核心同款硬门；这里先不给动作，提示交给房间义务门泡泡）
    if (!run.roomData?.trained && (run.currentRoom === 'campTraining' || run.currentRoom === 'training')) return;
    if (hasOpenQuestion(run)) return; // 问句义务门（包未开/产出未领/训练尾款未清/抓牌候选未决；答案可以是放弃，但必须玩家亲手给）
    // 兜底路径：训练开始时的房内进阶因异常漏播 → 离房时接棒（黑幕中点迁移 + 换台，
    // 揭幕揭开的就是进阶对话）。正常流程到这里 ascensionReady 必为 false。
    if ((run.currentRoom === 'campTraining' || run.currentRoom === 'training') && ascensionReady(run)) {
      void cutsceneFlows.playAscensionScene({ fromRoom: true });
      return;
    }
    // 节拍：幕间黑幕先起 → 黑幕中点做阶段迁移（completeRoom）→ 揭幕时已是塔楼新层。
    // 迁移若发生在黑幕之前，玩家会看到"营地面板/取景突然变成塔楼"的一帧（报过的突变）。
    // 单飞纪律归队列（'run:room-exit'）：completeRoom 压在黑幕中点，上半段 wipe 期间
    // gameStage 还是 'room'——双击会排进第二次切幕/第二次 completeRoom；排队尾后
    // 轮到时阶段已翻篇即自灭。notify 由 transitionStage 中点纪律统一补。
    enqueueRoomExit(() => completeRoom(run));
  }
  function leaveSlot() {
    if (run.gameStage !== 'room') return;
    if (hasOpenQuestion(run)) return; // 问句义务门（产出未领/恶魔词条未选/安慰奖未领；答案可以是放弃，但必须玩家亲手给）
    enqueueRoomExit(() => completeRoom(run));   // 同 leaveRoom：迁移压进黑幕
  }
  function enqueueRoomExit(beforeSwap) {
    if (dedicatedSequencer.findPending(i => i.meta?.event === 'run:room-exit')) return;
    enqueueFlowInstruction(dedicatedSequencer, {
      tag: 'room-exit', meta: { event: 'run:room-exit' },
      entryOk: () => run.gameStage === 'room',
      play: async (done) => {
        try { await exitRestRoomScene(beforeSwap); }
        finally { done(); }
      },
    });
  }

  // ---- prep ----
  // prep 期的遗物操作即时落盘：消耗型（useRelic 烧 usesLeft）若只在阶段落定点存档，
  // 退出重进可无限刷次数（旧 notify 每拍 persist 的行为在此路径上必须保留）
  function equip(relicId) { equipRelic(run, relicId); notify(); persist(); }
  function unequip(relicId) { unequipRelic(run, relicId); notify(); persist(); }
  function useRelic(relicId) { prepUseRelic(run, relicId); notify(); persist(); }

  // ---- 休息阶段面板：意图上行（表驱动）----
  // 意图表 = Stage 上报的 { action, ... } → 处理器：本地条目 + 各域模块自登记的 intents
  // （机器流 runMachines / 幕间流 runCutsceneFlows / 获得演出 runShowcase）。Stage 侧不判断
  // 可用性（enabled 由快照下发），这里只把语义落到既有入口；未知 action 静默忽略（与旧
  // if 链落空同语义）。加新机器/新幕间时在对应域模块里登记，本表不再生长。
  const panelIntentHandlers = {
    equip: (i) => equip(i.relicId),
    unequip: (i) => unequip(i.relicId),
    useRelic: (i) => useRelic(i.relicId),
    startBattle: () => startBattle(),
    chooseRewardPack: (i) => chooseRewardPack(i.packId),
    claimReward: (i) => claimReward(i.defId ?? null),
    trainingBegin: () => trainingBegin(),
    // 尾款重入保险（面板「继续修行…」）：模式未选先弹二选一，已选直接开选卡
    trainingUpgradeResume: () => { openTrainingUpgradeFlow(); },
    // 抓牌候选重开兜底（overlay 被异常关掉时；正常流程掷完即自动开）
    trainingDrawPick: () => { panelStage()?.openTrainingDrawPicker?.(); },
    trainingUpgrade: (i) => trainingUpgrade(i.uniqueID, i.targetId ?? null),
    trainingDrawRoll: () => trainingDrawRoll(),
    trainingDraw: (i) => trainingDraw(i.defId ?? null),
    campChoose: (i) => campChoose(i.option),
    leaveRoom: () => leaveRoom(),
    leaveSlot: () => leaveSlot(),
    // 卡组 build 画廊（「卡组」chip toggle）：开关是舞台本地交互态（不惊动 core），
    // 数据经 core 的 deckViewEntries 显式下发（Stage 不读 run）。战斗内敌方回合/
    // 演出期照常可用——chip 走舞台直达路由，画廊也不在 BattleStage reconcile 的
    // 关闭视野里（zone 查看器才随 sync 收起）。
    deckViewToggle: () => {
      const stage = panelStage();
      if (!stage) return;
      if (stage.deckViewerOpen) stage.closeDeckViewer();
      else stage.openDeckViewer(deckViewEntries(run));
    },
    ...machines.intents,
    ...cutsceneFlows.intents,
    ...showcase.intents,
  };
  function dispatchPanelIntent(intent) { panelIntentHandlers[intent?.action]?.(intent); }
  mapStage?.setPanelIntentHandler(dispatchPanelIntent);
  mapStage?.setRunSequencer(dedicatedSequencer);   // 「择卡得卡」演出的指令化挂点（同 battleStage/roomStage）

  // 离局清理（App.toTitle/newGame 调用）：战斗舞台释放 + 挂起演出瞬落
  // （动画不可序列化——重进/读档由检查点重建稳态）
  function dispose() {
    stopAmbience();         // 房间氛围床随局收掉（模块级单例：不收会一路响进菜单/下一局）
    battleStage?.dispose();
    battleStage = null;
    roomStage?.dispose();
    roomStage = null;
    endStage?.dispose();
    endStage = null;
    showcase.dispose();     // 获得演出的挂起队列：离局清空
    quiescence?.dispose();  // 静止态断言器采样定时器
    if (quiescence && typeof window !== 'undefined' && window.__quiescence === quiescence) {
      delete window.__quiescence; // 摘读口：回标题后旧断言器不可再被打到
    }
    disarmSpanGate?.();     // battle-span 闸门保险丝（闸门本体随 cancelAll 摘除）
    runPresenter.clear();   // 挂起的表现意图属于这一局：离局即弃
    offIdleHousekeeping();  // 先退订空闲沿：离局 cancelAll 不再触发对账/特写补排（舞台已拆）
    dedicatedSequencer.cancelAll();
    scalars.reconcile(true);   // 显示标量强贴（离局：cancel 不落载荷，对账兜住按住的增量）
  }

  // 构造尾的阶段落定（读档落位：检查点/预热/终局路由一次到位）。必须放在构造尾——
  // 'end' 读档会当场入队 end-entry 流程并走到 transitionStage，早于此 cutscene 等依赖
  // 还在 TDZ（流程异常收尾后又被单飞守卫拦住 App.vue 的补偿调用 = 结算屏永不出场）；
  // 构造尾一切就位，流程真正走完，App.vue 的重复调用被单飞幂等吸收。
  settleStageEffects();

  return {
    run, log, slot, cutscene, runCtx,
    sceneWipe,                      // 幕间切幕器（独立一层，App.vue 的 SceneWipeOverlay 渲染）
    sequencer: dedicatedSequencer, animBus, dispose,
    LEINO_DIMENSIONS, SLOT,
    slotView: () => machines.slotView(),
    openDevourFlow: machines.openDevourFlow,
    devourableRelics: () => machines.devourableRelics(),
    devourableCards: () => machines.devourableCards(),
    skillName: (id) => getSkillDefinition(id)?.name ?? id,
    // 升级预览：该卡晋升后的目标定义（过等阶门禁，与 trainUpgrade 缺省取的第一个可用目标一致）
    promoteTargetOf: (rt) => gatedPromotionTargets(run, getSkillDefinition(rt.defId))[0] ?? null,
    // encounter 元素是楼层缩放 descriptor {defId,maxHp,attack}（兼容裸 id 字符串）
    enemyName: (e) => {
      const id = e?.defId ?? e;
      return getEnemyDefinition(id)?.name ?? id;
    },
    isBossFloor,
    upgradableCards: () => upgradableCards(run),
    campOptions: () => campOptions(run),
    getBattleBridge: () => battleBridge,
    getBattleStage: () => battleStage,
    getRoomStage: () => roomStage,   // 场景式休息房舞台（App 的指针路由据此转发）
    getEndStage: () => endStage,     // 终局结算舞台（App 的指针路由据此转发）
    director,                        // 舞台路由一处派生（App.activeStage 等消费）
    scalars,                         // 显示标量通道（§4.6；调试/测试读口）
    enterEndScreen,                  // 显式进入结算屏（读档恢复到 'end' 时用；正常路径由 endBattle/claimReward 直调，settleStageEffects 兜杂径）
    enterRestRoomScene,              // 显式进入场景式休息房（读档/调试/测试用；正常路径由 claimReward 触发）
    startBattle, claimReward, chooseRewardPack,
    trainingBegin, trainingUpgrade, trainingDrawRoll, trainingDraw,
    campChoose, leaveRoom, bankDo: machines.bankDo, gurpasDo: machines.gurpasDo, spin: machines.spin, leaveSlot, triggerEvent: cutsceneFlows.triggerEvent, leaveEvent: cutsceneFlows.leaveEvent,
    playEventScene: cutsceneFlows.playEventScene,                 // 显式播事件幕间（正常路径由进房自动触发；幂等）
    enterRoomPresentation,          // 进房演出派发（事件幕间 / 房间场景；测试与调试可用）
    eventView: () => eventView(run, runCtx),                 // 事件读取（内容与逻辑在 core；测试/调试可用）
    resolveEvent: (id) => resolveEvent(run, id, runCtx),     // 事件结算（只允许一次；效果由内容主动施加）
    chooseAscensionDimension: cutsceneFlows.chooseAscensionDimension, skipAscension: cutsceneFlows.skipAscension,
    playAscensionScene: cutsceneFlows.playAscensionScene,             // 进阶幕间（正常路径由 leaveRoom 接棒；调试/测试可用）
    equip, unequip, useRelic,
    debug: runDebug,               // 调试模式门面（面板/脚本唯一入口；普通局也可开，改动即转调试局）
  };
}
