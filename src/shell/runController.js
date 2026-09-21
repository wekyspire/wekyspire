import { reactive, markRaw } from 'vue';
import mitt from 'mitt';
import AnimationSequencer from '../core/anim/sequencer.js';
import Player, { PLAYER_BASE_HP, PLAYER_BASE_AP } from '../core/state/player.js';
import { createSkillRuntime } from '../core/state/skillRuntime.js';
import {
  createRun, enterBattle, finishBattle, completeRewards, completeRoom,
  assembleBattle, isBossFloor, advanceFloor,
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
import { restRecipeFor } from '../stage/scenes/rooms/presets.js';
import { RoomStage } from '../stage/stages/RoomStage.js';
import { preloadBattleArt } from '../stage/art/preload.js';
import { upgradableCards, beginTraining, trainUpgrade, trainDrawChoices, trainDraw } from '../core/run/rooms/training.js';
import { campOptions, campRest, campRecoverRemi, campUpgrade, campLocked as campGateLocked } from '../core/run/rooms/camp.js';
import { SLOT } from '../core/run/rooms/slotMachine.js';
import { eventView, resolveEvent } from '../core/run/rooms/event.js';
import { createRunContext } from '../core/run/runContext.js';
import { createRunPresenter } from './runPresenter.js';
import { ascensionReady, LEINO_DIMENSIONS } from '../core/run/ascension.js';
import { equipRelic, unequipRelic, prepUseRelic, refreshRunModifiers } from '../core/run/prep.js';
import { panelSnapshot } from '../core/run/panelSnapshot.js';
import { createRunShowcase } from './runShowcase.js';
import { createRunMachines } from './runMachines.js';
import { DisplayModel } from '../bridge/displayModel.js';
import { BODY_STARTER_DECK } from '../core/content/bodySkills.js';
import { RunEvents } from './runEvents.js';
import { createCutscenePlayer } from './overlay/cutscenePlayer.js';
import { createSceneWipe } from './overlay/sceneWipe.js';
import { createRunCutsceneFlows } from './runCutsceneFlows.js';
import { createRunDebug } from './runDebug.js';
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

export function createRunController({ seed = (Date.now() >>> 0), stageManager = null, mapStage = null, save = null, storyMode = false, debugMode = false } = {}) {
  const runBus = mitt();
  // run 级共享演出队列（S2）：battle / room / tower / cutscene 指令在同一队列定序，
  // 跨层演出链（终局动画 → 幕间黑幕 → 塔楼抵达）由此成为可表达的结构
  const animBus = mitt();
  const runSequencer = new AnimationSequencer({ bus: animBus, finishedEvent: EventNames.ANIMATION_INSTRUCTION_FINISHED });
  // run 级显示状态权威（与 runSequencer 对等的状态面）：被节拍逐步推进的前端真值，
  // 跨场景存活（battle/room/tower），各 Stage 只是它的视图。Phase 1 收编卡牌注册表
  const displayModel = new DisplayModel();
  const isStory = save?.storyMode ?? storyMode; // 读档优先用存档自身的模式
  // 调试局标记：读档以存档自身为准（造档工具产出的档自带 debugMode: true）
  const isDebug = save?.debugMode ?? debugMode;
  const run = reactive(createRun({
    seed: save?.seed ?? seed,
    player: new Player({ maxHp: PLAYER_BASE_HP, maxMana: 3, maxActionPoints: PLAYER_BASE_AP }),
  }));
  if (save) restoreRunFromSave(run, save); // 恢复原语在 core（headless 工具共用同一份）
  else {
    run.player.deck = DEFAULT_DECK.map(id => createSkillRuntime(id));
    // 调试模式（开始界面勾选 / ?debug=1，仅新开局生效）：直发 GM 卡「一拳」（999 群伤固有）
    // ——爬塔流程验证工具；读档不吃（调试局的卡组本身已含此卡，随存档走）
    if (isDebug) run.player.deck.push(createSkillRuntime('onePunch'));
  }
  // 装备遗物的 run 级修正每次从基准重算（增删装备/读档后都对齐；杜绝逐战叠加）
  refreshRunModifiers(run);
  run.storyMode = isStory; // 模式只影响剧情演出（对话剧本）；战斗内瑞米机制两模式一致
  run.debugMode = isDebug; // 调试局：存档走 debug 槽（saves.modeOf）+ 面板可开

  let battleBridge = null;   // markRaw：战斗桥含 kernel/three 引用，不入响应式
  // 房间层舞台侧瞬态（不进 core run）：老虎机演出播放态。
  // 面板快照经 panelExtras() 一并下行（roomSnapshot 的 extra 入参）。
  const slot = reactive({ lastSpin: null, anim: null }); // anim: { id, prize } 播放中（roll 动画）
  // run 级表现上下文：core 内容（事件/剧情）想演出就走它声明意图（见 runPresenter.js）。
  // presenter 只排队，由 runShowcase.flushRunPresentations() 在安全时机（揭幕后）统一播。
  const runPresenter = createRunPresenter();
  const runCtx = createRunContext(run, { presenter: runPresenter });
  let battleStage = null;
  let roomStage = null;   // 场景式休息房舞台（仅 gameStage==='room' 且有配方时存在）
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
  // 每场按满血出战）。满血值借 createUnit 读（内容定义无静态面板字段可查）。
  // （攻/盾横幅已删 2026-09-20 用户定：瑞米意图显示其行动）
  const remiMaxHp = getAllyDefinition('remi')?.createUnit().maxHp ?? null;
  const remiView = () => (!remiMaxHp || run.remi.drivenOff)
    ? { present: false }
    : { present: true, hp: remiMaxHp };
  const syncMapStatus = () => {
    const status = {
      ap: run.player.maxActionPoints, apMax: run.player.maxActionPoints,
      mana: run.player.mana, manaMax: run.player.maxMana,
      money: run.player.money,
      hp: run.player.hp, maxHp: run.player.maxHp,
      relics: equippedRelicViews(),
      remi: remiView(),
    };
    mapStage?.setStatus(status);
    roomStage?.setStatus(status);   // 场景式休息房：同一份数值推给房间舞台的状态栏/顶端资源行
    // 金币/遗物在顶端资源行（状态栏不再显示）；战斗护盾不跨阶段残留
    battleStage?.topBar.setMoney(run.player.money);
    battleStage?.topBar.setRelics(equippedRelicViews());
    battleStage?.statusBar.setPlayerShield(0);
    battleStage?.statusBar.setPlayerHp(run.player.hp, run.player.maxHp);
    battleStage?.statusBar.setRemi(remiView());
  };
  // 面板快照的舞台侧瞬态：老虎机演出播放态不在 core run 里（见 roomSnapshot 注释）
  const panelExtras = () => ({ slot });
  // 存档检查点：只在 prep（层首）与 end（终局）落盘；战斗内退出 = 回到本层战前。
  // 调试局（debugMode，含"改过状态的普通局"）写独立的 debug 槽（saves.modeOf）——
  // 真实存档永不被调试动作污染，这是调试模式的安全边界。
  const persist = () => {
    if (run.gameStage !== 'prep' && run.gameStage !== 'end') return;
    recordSave(run);
  };
  // ---- 获得演出（遗物差分 / 老虎机 / 恶魔 roll / 售货机 / 离开安慰奖）----
  // 「到手那一拍」的编排整体在 runShowcase.js：core 结算已发生，那边只管时序与舞台。
  // 这里的引用全部**晚绑定**（箭头闭包捕获词法绑定，运行期才取值）：panelStage/notify 是
  // 本块之后才初始化的 const，slotTake/slotDecline/leaveRoom 是 hoisted function 声明——
  // 构造期不调用它们，初始化顺序安全。
  const showcase = createRunShowcase({
    run, runPresenter,
    panelStage: () => panelStage(),
    roomStage: () => roomStage,
    notify: () => notify(),
    actions: {
      slotTake: (c) => machines.slotTake(c),
      slotDecline: () => machines.slotDecline(),
      leaveRoom: () => leaveRoom(),
    },
  });
  syncMapStatus(); // 初始同步一次（后续随 notify 自动跟随）
  mapStage?.setPanel?.(panelSnapshot(run, panelExtras())); // 休息阶段面板快照（数据下行唯一通道）
  if (run.gameStage === 'prep' || run.gameStage === 'end') persist(); // 初始即检查点（首层开局/读档落位）  // 该房间是否由**幕间/房间场景**呈现（事件幕间 or 有休息房配方）——呈现中塔楼层**不渲染房间面板**：
  // 否则"选完奖励 → 进房"的瞬间塔楼会先铺一帧房间面板（营地/售货机/老虎机），幕间黑幕随后
  // 才盖住（用户 2026-09-12 报的"营地 UI 错误地闪了一下"）。用"待呈现/已呈现"两个条件判定，
  // 不用"有配方"直接推断——无舞台/占位路径仍要把面板留给塔楼层。
  // 2026-09-18 训练改版：**房内进阶**期间（gameStage 'ascension' 且 roomStage 存活——
  // currentRoom/roomData 原地保留）也按"房间场景呈现中"处理——阶段模态面板（种子包九选三）
  // 画在 RoomStage 上，塔楼不得再建一份不可见的重复面板（指针已路由到 RoomStage，
  // 见 App.vue activeStage）。离房路径的 ascension 已清 currentRoom/roomStage，条件自然不成立。
  let roomScenePending = false;   // 进房演出待/在切换（进房那一刻由 claimReward 置位）
  const roomPresentedOnScene = () => (run.gameStage === 'room' || run.gameStage === 'ascension')
    && !!stageManager
    && (roomScenePending || !!roomStage)
    && (run.currentRoom === 'event' || !!restRecipeFor(run.currentRoom));
  const notify = () => {
    if (run.gameStage !== 'room') roomScenePending = false;
    syncMapStatus(); // 状态栏数值跟随每次迁移（魏启变化/层数推进）
    const snap = panelSnapshot(run, panelExtras()); // 面板内容跟随阶段迁移（同一快照推导）
    // 战后奖励**画在战斗舞台上**（用户定 2026-09-12）：战斗结束后不换舞台，奖励 overlay 直接
    // 盖在战斗房间前；"战斗房 → 塔楼"的场景切换在**领奖后的切幕中点**完成（见 afterRewardToFloor）。
    // 无战斗舞台（headless/降级）时自然落到塔楼层（mapStage）——行为与旧版一致。
    if (run.gameStage === 'reward') battleStage?.setPanel?.(snap);
    else battleStage?.setPanel?.(null);
    mapStage?.setPanel?.(roomPresentedOnScene() ? null : snap);
    roomStage?.setPanel?.(snap);    // 场景式休息房：机器面板与翻牌计数器同源重绘
    // prep 入场即预热下场战斗素材：遭遇已知（advanceFloor 已定）、卡组已定
    // （奖励选卡在 reward 阶段完成）——无 cutscene 的普通层也有整个战前准备
    // 阶段可用作加载窗口（幂等：共享缓存按 url 去重）
    if (run.gameStage === 'prep') preloadBattleArt({ deck: run.player.deck, ...assembleBattle(run) });
    // 存档检查点：prep（层首）与 end（终局）落盘；战斗内退出 = 回到本层战前。
    persist();
    runBus.emit(RunEvents.STAGE_CHANGED, { stage: run.gameStage, floor: run.floor });
    // 新遗物 → 特写（差分见 runShowcase.js）：放在最后，确保面板/资源行已按新状态重绘
    showcase.diffNewRelics();
  };
  let logSeq = 0;
  const pushLog = ({ text, kind }) => {
    log.unshift({ id: ++logSeq, text, kind }); // 稳定 key（unshift 列表用 index key 会全量重渲）
    if (log.length > 30) log.pop();
  };

  // ---- cutscene（游戏流程手动驱动：对话剧本 + 幕间转场）----
  // S3：剧本 step 编译为 run sequencer 指令——与战斗/房间/塔楼演出同一时钟。
  // **切幕器独立于内容播放器**（用户定 2026-09-12）：`sceneWipe` 由 cutscene 播放器驱动、
  // 由 App.vue 的 SceneWipeOverlay 渲染——黑幕的**目的地**可以是 3D 舞台，也可以是一段
  // cutscene 内容（事件房：切幕开始 → 对话/CG 就位 → 切幕结束）。
  const sceneWipe = createSceneWipe();
  const cutscene = createCutscenePlayer({ sequencer: runSequencer, wipe: sceneWipe });
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
    run, slot, runSequencer, cutscene, showcase,
    notify: () => notify(),
    panelStage: () => panelStage(),
    roomStage: () => roomStage,
  });

  // ---- 幕间流（随机事件 / 进阶，用户定 2026-09-12：对话 + 选项 + 同步结算 + 切幕出场）----
  // 编排整体在 runCutsceneFlows.js；lifecycle 是本控制器注入的房间/舞台生命周期动作，
  // 全部箭头晚绑定（swapRoomToMap/exitSceneAfterCutscene 在下方才定义，运行期才取值）。
  const cutsceneFlows = createRunCutsceneFlows({
    run, runCtx, runPresenter, cutscene, showcase,
    notify: () => notify(),
    setRoomScenePending: (v) => { roomScenePending = v; },
    panelStage: () => panelStage(),   // 跳过进阶收尾的删卡界面挂点（晚绑定，同 showcase）
    lifecycle: {
      completeRoom: () => completeRoom(run),
      completeRoomAndNotify: () => { completeRoom(run); notify(); },
      completeRoomSwapToMap: () => { completeRoom(run); swapRoomToMap(); notify(); },
      // 塔楼在台且楼层已推进 → 排相机爬升（幂等）。不换台的幕间退出（事件房/进阶收尾）
      // 也走这里：升层可能发生在幕间内部（onChoice 同步结算），爬升的排期点统一放在
      // 各条「揭幕回塔楼」的节拍上（2026-09-16 用户报：1 层事件房升 2 层没有爬升）。
      arriveMapFloor: () => arriveMapFloor(),
      exitSceneAfterCutscene: (fn) => exitSceneAfterCutscene(fn),
    },
  });

  // ---- 调试模式（面板/脚本的唯一入口；见 shell/runDebug.js）----
  // 与 machines/cutsceneFlows 同构：域模块 + 晚绑定 ctx；改 core 状态走 core/debug/ops.js，
  // 本处只管"改完之后前端怎么刷新"（状态栏 / 面板 / 换台 / 进房演出）。
  const runDebug = createRunDebug({
    run,
    notify: () => notify(),
    syncMapStatus: () => syncMapStatus(),
    swapAnyToMap: () => swapAnyToMap(),
    mapStage,
    enterRoomPresentation: () => enterRoomPresentation(),
    getBattleStage: () => battleStage,
    getBattleBridge: () => battleBridge,
    cutscene,
    playAscensionScene: (opts) => cutsceneFlows.playAscensionScene(opts),
  });

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
        // 战后奖励面板落在战斗舞台上（用户定 2026-09-12）：意图出口与塔楼层同一套
        battleStage.setPanelIntentHandler?.(dispatchPanelIntent);
        battleStage.setRunSequencer?.(runSequencer);   // 得卡演出的指令化挂点（与切幕/清层串行）
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

  // 退场（用户定 2026-09-12 调整节拍）：**先落战后奖励、不切幕、也不换舞台** ——
  // 奖励 overlay 直接盖在**战斗房间**上（面板由战斗舞台承载，见 notify 的 reward 分支）；
  // 领完/跳过奖励后（claimReward → afterRewardToFloor）才切幕，并在**黑幕中点**把舞台
  // 换成塔楼层、播"楼层 clear（当前层高亮块长出）"动画。
  function endBattle(result, bridge) {
    finishBattle(run, result, bridge.battle); // 回写 run（含瑞米打跑检测）→ gameStage='reward'
    battleBridge = null;
    // 状态栏提前同步（用户 2026-09-11 报）：原来只有链条末尾的 notify() 会刷状态栏，
    // 于是爬塔动画播完才看到战后的血量/金币。这里在战斗舞台上先把状态推上去。
    notify();   // 推 reward 面板（落在战斗舞台）→ 奖励 overlay 即刻可交互，背景仍是战斗房间
  }

  /**
   * 奖励环节收尾（claimReward 之后）：切幕 → 塔楼 → **楼层 clear 动画** → 战后剧本 → 进房。
   * 节拍要点（用户定 2026-09-12）：玩家点完领取/跳过，才把奖励 overlay 收掉并揭幕塔楼；
   * 阶段迁移（completeRewards）已在 claimReward 里完成，这里只做呈现与演出。
   */
  async function afterRewardToFloor() {
    // ① 切幕：**黑幕中点**换舞台（战斗房 → 塔楼）+ 收起奖励 overlay、换上新阶段面板；
    //    揭幕露出的是塔楼（此前战斗一结束就瞬切塔楼，奖励面板浮在塔楼前，节拍对不上）
    if (stageManager) await cutscene.sceneTransition(swapBattleToMap);
    else swapBattleToMap();
    // ② 楼层 clear：当前层高亮块自下而上长出（同一队列串行，黑幕已揭）
    if (stageManager && mapStage) {
      await awaitFloorArrive(runSequencer, mapStage, {
        floor: run.floor, totalFloors: run.totalFloors,
      });
    }
    // ③ 战后剧本（Boss 层 = postBoss）→ 幕间退出也切幕（cutscene 与场景同待遇）
    const played = await playPendingCutscenes();
    if (played && stageManager) await exitSceneAfterCutscene(() => notify());
    // ④ 进房演出（事件幕间 / 有配方的房切场景；无房 = 留在战前准备）
    enterRoomPresentation();
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
    if (run.gameStage === 'room') {
      slot.lastSpin = null; slot.anim = null; // 进新房清上一房瞬态
      // 将要用幕间/房间场景呈现的房间：先置"待呈现"，notify 与切幕之间塔楼层不再铺房间面板
      if (run.currentRoom === 'event' || restRecipeFor(run.currentRoom)) roomScenePending = true;
    }
    // 奖励环节结束 → 切幕回塔楼 → clear 动画 → 战后剧本 → 进房（节拍见 afterRewardToFloor）
    void afterRewardToFloor();
  }

  // ---- 场景式休息房（第一间 = 赌厅 casino，用户定 2026-09-11）----
  // 全屏选卡/选遗物/获得物特写都画在**当前活动舞台**的 uiScene 上（只有活动舞台会被渲染）：
  // 房间场景打开时归 RoomStage，否则归塔楼层 MapStage。两个舞台同名同义的接口即此契约。
  const panelStage = () => roomStage ?? mapStage;
  // gameStage 落到 'room' 且该房类型有配方（restRecipeFor）时，用**幕间黑幕**切到房间场景
  // （RoomStage）；没有配方的房间类型继续走塔楼层 + 占位面板，不切场景。
  // 离开由玩家**主动**发起（房间右下角「继续前进」箭头）→ 同样走黑幕回塔楼。
  let restEntering = false;
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
      }));
      roomStage.setPanelIntentHandler(dispatchPanelIntent);
      roomStage.setRunSequencer(runSequencer);   // 得卡演出的指令化挂点（与离房切幕串行）
      stageManager.setStage(roomStage);
      syncMapStatus();   // 状态栏/资源行进房先落位（不等 notify）
      roomScenePending = false;   // 场景已就位：抑制交给 roomStage 这个条件接管
    };
    await cutscene.sceneTransition(doSwap, { holdMs: 220 });
    return true;
  }
  /**
   * 进房后的**演出派发**（阶段迁移落进 'room' 后调用一次）：
   *   · 事件房 → 播事件幕间（cutscene：CG + 对话 + 选项；不做 3D 场景，用户定 2026-09-12）
   *   · 有休息房配方的房间 → 幕间黑幕切进房间场景（RoomStage）
   *   · 其余（无配方）→ 留在塔楼层 + 占位面板
   * 两条路各自幂等（事件已在播/场景已切都不重复）。
   */
  function enterRoomPresentation() {
    if (run.gameStage !== 'room') return;
    if (run.currentRoom === 'event') { void cutsceneFlows.playEventScene(); return; }
    void maybeEnterRestScene();
  }

  /** 有配方且当前不在房间场景时进入（幂等：并发/重复调用只切一次）。 */
  async function maybeEnterRestScene() {
    if (restEntering || roomStage || run.gameStage !== 'room' || !restRecipeFor(run.currentRoom)) return false;
    restEntering = true;
    try { return await enterRestRoomScene(); } finally { restEntering = false; }
  }
  /**
   * 离开房间场景：黑幕中点换回塔楼层。
   * @param beforeSwap 在**黑幕盖住之后**执行（核心阶段迁移 + notify 都放这里）——这是用户
   *   2026-09-12 定的节拍：先起幕间切幕演出，再同步 state、转移场景，最后揭幕。
   *   在前端状态必然经历一瞬"旧场景 + 新快照"（面板突变/取景突变）的场合，只有把同步
   *   压进黑幕里才能让那些 invalid 中转帧完全不被看见。
   */
  /**
   * 把**战斗舞台**换回塔楼（不排幕）：战后奖励领完后由切幕中点调用——战斗舞台随换台释放
   * （它的 uiScene 上挂着奖励面板，一并回收）。
   */
  function swapBattleToMap() {
    if (stageManager && mapStage) mapStage.setFloor(run.floor, run.totalFloors); // 塔楼先摆到新层；抵达动画随后播
    // 先释放战斗舞台、**后**换台：BattleStage 无 onExit，全部清理在 dispose——其中
    // shake.dispose 会把相机回基位。此前先 setStage 后 dispose，塔楼机位（onEnter 刚摆）
    // 被回退到战斗基准机位：塔/雪原全在雾外，战后揭幕只剩天空穹的灰蓝（2026-09-16 用户报）。
    // 换台发生在黑幕中点，先拆后换并不可见。
    battleStage?.dispose();
    battleStage = null;
    if (stageManager && mapStage) stageManager.setStage(mapStage);
    syncMapStatus();          // 面板/状态栏：随后 notify 推新阶段快照
    notify();
  }

  /** 把房间舞台换回塔楼（不排幕）：奖励/进阶等"多段演出"共用同一段换台代码。 */
  function swapRoomToMap() {
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
    syncMapStatus();
  }

  /**
   * **调试用**：把当前舞台无条件换回塔楼（战斗/房间舞台全拆，含各自的 uiScene 覆盖层）。
   * 不推进任何 core 阶段——core 状态由 runDebug 的原语负责，这里只管"画面别留在旧场景里"。
   * 同时复位几个"正在切换"的重入闸（battlePending/restEntering/roomScenePending）：
   * 调试跳层可能发生在切幕中途，闸不放开后续动作会被静默吞掉。
   */
  function swapAnyToMap() {
    battleStage?.dispose(); battleStage = null;
    roomStage?.dispose(); roomStage = null;
    battlePending = false;
    restEntering = false;
    roomScenePending = false;
    slot.lastSpin = null; slot.anim = null;
    if (stageManager && mapStage) {
      mapStage.setFloor(run.floor, run.totalFloors);
      stageManager.setStage(mapStage);
    }
    syncMapStatus();
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
      void awaitFloorArrive(runSequencer, mapStage, {
        floor: run.floor, totalFloors: run.totalFloors,
      });
    }
  }

  async function exitRestRoomScene(beforeSwap = null) {
    const doSwap = () => { beforeSwap?.(); swapRoomToMap(); };
    if (!roomStage) { doSwap(); return false; }   // 无场景（占位路径/无舞台）：同步直落
    if (stageManager) await cutscene.sceneTransition(doSwap);
    else doSwap();
    return true;
  }

  /**
   * **cutscene 退出回舞台**的切幕（用户定 2026-09-12：cutscene 回塔楼本质上和场景切换没区别）：
   * 黑幕盖住 → beforeSwap（阶段迁移/面板刷新）→ 揭幕（揭开的就是刷新后的舞台）。
   * 与 exitRestRoomScene 的区别：**不换舞台**——目的地就是当前舞台本身，cutscene 内容层收起即露出。
   * 无舞台（headless）时同步直落（不排黑幕，不影响逻辑）。
   */
  async function exitSceneAfterCutscene(beforeSwap = null) {
    if (stageManager) await cutscene.sceneTransition(beforeSwap ?? undefined);
    else beforeSwap?.();
    return true;
  }

  // ---- rooms（2026-09-18 训练改版：训练必做且先于篝火；进阶在训练开始那一刻房内先行）----
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
  // 尾款升级：抓卡后欠下的那一次（pendingUpgrade 挂着时的唯一出口）
  function trainingUpgrade(uniqueID, targetId = null) {
    if (run.gameStage !== 'room' || !run.roomData?.pendingUpgrade) return;
    trainUpgrade(run, uniqueID, targetId); // 分叉目标由升级子面板传入
    maybeLeaveRoom();
  }
  // 可选段开局：掷四选一候选。⚠ 不查 trained——可选抓牌本来就发生在**训练完成之后**
  // （曾因沿用旧「trained=已锁」语义静默吞掉按钮点击，用户报「抓牌按钮没反应」）；
  // 是否已开局/已收束由 trainDrawChoices 的 core 守卫兜。
  function trainingDrawRoll() {
    if (run.gameStage !== 'room' || run.roomData?.pendingUpgrade) return;
    trainDrawChoices(run);
    notify();
  }
  function trainingDraw(defId = null) {
    if (run.gameStage !== 'room' || !run.roomData?.drawChoices) return;
    trainDraw(run, defId); // 欠升级态没有跳过出口（UI 不渲染），null 只会是放弃候选
    if (run.roomData?.pendingUpgrade) notify();
    else maybeLeaveRoom();
  }
  function campChoose(option, uniqueID = null, targetId = null) {
    if (run.gameStage !== 'room' || campLocked()) return;
    if (option === 'rest') campRest(run);
    else if (option === 'recoverRemi') campRecoverRemi(run);
    else if (option === 'upgrade') campUpgrade(run, uniqueID, targetId); // 分叉目标由升级子面板传入
    maybeLeaveRoom();
  }
  // 合并房的主动离房（单房由动作自动离房，不需要这个）
  // 恶魔 roll 的两拍获得演出（词条 → 金币）在 runShowcase.js（bankDemonPick/showDemonReward）。

  function leaveRoom() {
    if (run.gameStage !== 'room') return;
    // 训练必做 + 尾款未清：不让走（核心同款硬门；这里先不给动作，提示交给房间义务门泡泡）
    if (!run.roomData?.trained && (run.currentRoom === 'campTraining' || run.currentRoom === 'training')) return;
    if (run.roomData?.pendingUpgrade) return;
    // 兜底路径：训练开始时的房内进阶因异常漏播 → 离房时接棒（黑幕中点迁移 + 换台，
    // 揭幕揭开的就是进阶对话）。正常流程到这里 ascensionReady 必为 false。
    if ((run.currentRoom === 'campTraining' || run.currentRoom === 'training') && ascensionReady(run)) {
      void cutsceneFlows.playAscensionScene({ fromRoom: true });
      return;
    }
    // 节拍：幕间黑幕先起 → 黑幕中点做阶段迁移（completeRoom + notify）→ 揭幕时已是塔楼新层。
    // 迁移若发生在黑幕之前，玩家会看到"营地面板/取景突然变成塔楼"的一帧（用户报过的突变）。
    void exitRestRoomScene(() => { completeRoom(run); notify(); });
  }
  function leaveSlot() {
    if (run.gameStage !== 'room') return;
    if (run.roomData?.pendingUpgrade) return;
    void exitRestRoomScene(() => { completeRoom(run); notify(); });   // 同 leaveRoom：迁移压进黑幕
  }

  // ---- prep ----
  function equip(relicId) { equipRelic(run, relicId); notify(); }
  function unequip(relicId) { unequipRelic(run, relicId); notify(); }
  function useRelic(relicId) { prepUseRelic(run, relicId); notify(); }

  // ---- 休息阶段面板：意图上行（表驱动，2026-09-13 起）----
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
    trainingUpgrade: (i) => trainingUpgrade(i.uniqueID, i.targetId ?? null),
    trainingDrawRoll: () => trainingDrawRoll(),
    trainingDraw: (i) => trainingDraw(i.defId ?? null),
    campChoose: (i) => campChoose(i.option, i.uniqueID ?? null, i.targetId ?? null),
    leaveRoom: () => leaveRoom(),
    leaveSlot: () => leaveSlot(),
    ...machines.intents,
    ...cutsceneFlows.intents,
    ...showcase.intents,
  };
  function dispatchPanelIntent(intent) { panelIntentHandlers[intent?.action]?.(intent); }
  mapStage?.setPanelIntentHandler?.(dispatchPanelIntent);
  mapStage?.setRunSequencer?.(runSequencer);   // 「择卡得卡」演出的指令化挂点（同 battleStage/roomStage）

  // 离局清理（App.toTitle/newGame 调用）：战斗舞台释放 + 挂起演出瞬落
  // （动画不可序列化——重进/读档由检查点重建稳态）
  function dispose() {
    battleStage?.dispose();
    battleStage = null;
    roomStage?.dispose();
    roomStage = null;
    showcase.dispose();     // 获得演出的兜底定时器/挂起队列：离局必须停（不然定时器会开着火离局）
    runPresenter.clear();   // 挂起的表现意图属于这一局：离局即弃
    runSequencer.cancelAll();
  }

  return {
    run, runBus, log, slot, cutscene, runCtx,
    sceneWipe,                      // 幕间切幕器（独立一层，App.vue 的 SceneWipeOverlay 渲染）
    sequencer: runSequencer, animBus, dispose,
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
    enterRestRoomScene,              // 显式进入场景式休息房（读档/调试/测试用；正常路径由 claimReward 触发）
    startBattle, claimReward, chooseRewardPack,
    trainingBegin, trainingUpgrade, trainingDrawRoll, trainingDraw,
    campChoose, leaveRoom, bankDo: machines.bankDo, gurpasDo: machines.gurpasDo, spin: machines.spin, reportSlotAnimDone: machines.reportSlotAnimDone, leaveSlot, triggerEvent: cutsceneFlows.triggerEvent, leaveEvent: cutsceneFlows.leaveEvent,
    playEventScene: cutsceneFlows.playEventScene,                 // 显式播事件幕间（正常路径由进房自动触发；幂等）
    enterRoomPresentation,          // 进房演出派发（事件幕间 / 房间场景；测试与调试可用）
    eventView: () => eventView(run, runCtx),                 // 事件读取（内容与逻辑在 core；测试/调试可用）
    resolveEvent: (id) => resolveEvent(run, id, runCtx),     // 事件结算（只允许一次；效果由内容主动施加）
    chooseAscensionDimension: cutsceneFlows.chooseAscensionDimension, skipAscension: cutsceneFlows.skipAscension, chooseSeedCards: cutsceneFlows.chooseSeedCards, rerollSeedOffering: cutsceneFlows.rerollSeedOffering,
    playAscensionScene: cutsceneFlows.playAscensionScene,             // 进阶幕间（正常路径由 leaveRoom 接棒；调试/测试可用）
    equip, unequip, useRelic,
    debug: runDebug,               // 调试模式门面（面板/脚本唯一入口；普通局也可开，改动即转调试局）
  };
}
