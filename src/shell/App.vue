<script setup>
// Vue 薄壳：三层场景的最外层编排（README「场景层级」总纲）。
// 菜单层 = 纯 Vue（StartScreen / GameMenu / EndPanel）；
// 大世界层（塔楼层）= MapStage（ThreeJS）+ Three 面板（prep 等，见 stage/panels/）；
// 战斗层（房间层）= BattleStage（ThreeJS）+ BattleHud 等叠加；休息阶段面板见 stage/panels/。
// dialogue / cutscene overlay 由 Vue 渲染，跨后两层（CutsceneOverlay）。
import { onMounted, onBeforeUnmount, ref, computed, provide } from 'vue';
import '../core/content/index.js'; // 注册全部最小内容
import { StageManager } from '../stage/StageManager.js';
import { MapStage } from '../stage/stages/MapStage.js';
import { createRunController } from './runController.js';
import { readSave } from './saves.js';
import StartScreen from './components/StartScreen.vue';
import AssetLoadingScreen from './components/AssetLoadingScreen.vue';
import GameMenu from './components/GameMenu.vue';
import BattleHud from './components/BattleHud.vue';
import EndPanel from './components/EndPanel.vue';
import MenuPopup from './components/MenuPopup.vue';
import MenuDialog from './components/MenuDialog.vue';
import TooltipOverlay from './components/TooltipOverlay.vue';
import { fitGameFrame } from './frame.js';
import { attachTooltipForwarding } from './tooltipForward.js';
import { menuDialogState } from './menuDialog.js';
import CutsceneOverlay from './overlay/CutsceneOverlay.vue';
import SceneWipeOverlay from './overlay/SceneWipeOverlay.vue';
import DebugOverlay from './components/DebugOverlay.vue';
import { debugUi, toggleDebugPanel } from './debugState.js';
import { settings } from './settings.js';
import { preloadAllArt } from '../stage/art/assetManifest.js';

const canvas = ref(null);
const frame = ref(null);
const ctrl = ref(null);
let stageManager = null;
let mapStage = null;
let detachTooltipForward = null; // 常驻 3D→tooltip 转发（随 ctrl 生命周期）

const phase = ref('menu');      // 'menu' | 'game'（菜单级与游戏级的最外层切换）
const menuOpen = ref(false);    // 游戏内弹出菜单（Esc）
const saves = ref({ infinite: readSave(false), story: readSave(true) }); // 两模式存档隔离

const stage = computed(() => ctrl.value?.run.gameStage ?? 'prep');

// 全量美术预载：setup 即启动（与 Vue 挂载/舞台初始化并行）。加载界面挡在开始界面之前
// ——**全部成功才放行**（此后所有舞台首拍同步命中素材缓存，无占位闪变）。
// ⚠ 失败不放行（用户定 2026-09-12）：终止下载/断网会让 onerror 落定，早期实现照常放行
// →"掐掉下载也能带着缺图进游戏"；现在失败计数进 `assetFailed`，界面卡住并给重试键。
const assetsReady = ref(false);
const assetFailed = ref(0);
const assetProgress = ref({ loaded: 0, total: 0, loadedBytes: 0, totalBytes: 0, elapsedMs: 0, failed: 0 });
function startAssetPreload() {
  assetsReady.value = false;
  assetFailed.value = 0;
  assetProgress.value = { loaded: 0, total: 0, loadedBytes: 0, totalBytes: 0, elapsedMs: 0, failed: 0 };
  preloadAllArt({
    onProgress: (loaded, total) => { assetProgress.value = { ...assetProgress.value, loaded, total }; },
    // stats 的计数字段叫 done——必须映射回 loaded，否则整条替换会把 loaded 抹成 undefined
    //（进度条 NaN%、计数文本空白，用户 2026-09-13 报的"进度条 broken"）
    onStats: (s) => { assetProgress.value = { ...s, loaded: s.done }; },
  }).then((r) => {
    if (r.failed > 0) { assetFailed.value = r.failed; return; }   // 卡住：只给重试
    assetsReady.value = true;
  });
}
startAssetPreload();

// 菜单级全局共享 toast：任意菜单级组件 inject('showMenuPopup') 后调用（跨 phase 可用）。
// 多条 toast 各自 3s 寿命独立消亡；新 toast 从底部进入，旧 toast 被顶起，消亡后其余平滑回落。
const menuToasts = ref([]);
let toastSeq = 0;
function showPopup(title, text = '') {
  const id = ++toastSeq;
  const list = [...menuToasts.value, { id, title, text }];
  menuToasts.value = list.slice(-4); // 并发上限 4：超出立即挤掉最旧的（转入消亡动画）
  setTimeout(() => {
    menuToasts.value = menuToasts.value.filter(t => t.id !== id);
  }, 3000);
}
provide('showMenuPopup', showPopup);

// toast 手动关闭（× 按钮）：与 3s 自然寿命同一条移除路径
function dismissMenuToast(id) {
  menuToasts.value = menuToasts.value.filter(t => t.id !== id);
}

function newGame({ storyMode = false, loadSave = null, debugMode = false } = {}) {
  ctrl.value?.dispose?.(); // 战斗舞台释放 + 挂起演出瞬落
  detachTooltipForward?.();
  detachTooltipForward = null;
  mapStage?.dispose?.();
  mapStage = new MapStage({});
  ctrl.value = createRunController({ stageManager, mapStage, save: loadSave, storyMode, debugMode });
  ctrl.value.debug.setToast((text) => showPopup('调试', text));   // 调试回执同时进全局 toast
  // 地图舞台的输入通道 + 常驻 tooltip 转发：装配点在此（同时持有 stageManager 与 animBus）
  mapStage.attachInput({ stageManager, bus: ctrl.value.animBus });
  detachTooltipForward = attachTooltipForwarding(ctrl.value.animBus);
  mapStage.setFloor(ctrl.value.run.floor, ctrl.value.run.totalFloors);
  stageManager.setStage(mapStage);
  phase.value = 'game';
  menuOpen.value = false;
  // 调试档可能是"房内现场"（造档工具产出）：补一次进房派发（幂等：已在房内则只刷演出）
  if (ctrl.value.run.gameStage === 'room') ctrl.value.enterRoomPresentation?.();
  if (settings.debugMode) debugUi.open = true;   // 调试模式开着就默认把面板摆出来（省一次 F9）
  // 冒烟/控制台钩子
  window.__shell = { ctrl, stageManager, newGame };
}

function onStart({ storyMode, loadSave, debugMode }) {
  newGame({ storyMode, loadSave, debugMode });
}

/** 调试面板的「重载局面/导入 JSON」：以给定快照重开一局（调试面板发起 → 恒为调试局）。 */
function onDebugRestart({ loadSave } = {}) {
  newGame({ loadSave, debugMode: loadSave?.debugMode ?? true });
}

/**
 * URL 起跑（调试用）：`?debug=1` 打开调试模式；`?save=<名>` 取 /debug-saves/<名>.json
 * （tools/saveForge.mjs 产出，dev 中间件提供）并**直接从该存档开局**——这是「快速复现
 * 任意 bug」的入口：不用逐层打过去，一次跳转就在现场，前后端链路全真实。
 * 失败不阻塞正常流程（提示后落在开始界面）。
 */
async function autoStartFromUrl() {
  const params = new URLSearchParams(location.search);
  const wantDebug = params.get('debug') === '1';
  const saveName = params.get('save');
  if (!wantDebug && !saveName) return;
  if (wantDebug) settings.debugMode = true;
  debugUi.open = true;
  if (!saveName) return;
  try {
    const res = await fetch(`./debug-saves/${saveName}.json`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const save = await res.json();
    if (!save?.player?.deck) throw new Error('不是一份合法存档');
    console.log('[debug] 从存档起跑：', saveName, save);
    newGame({ loadSave: { ...save, debugMode: true }, debugMode: true });
  } catch (err) {
    showPopup('调试起跑失败', `${saveName}：${err?.message ?? err}（先跑 tools/saveForge.mjs --out ${saveName}）`);
  }
}

function toTitle() {
  ctrl.value?.dispose?.(); // 战斗舞台释放 + 挂起演出瞬落
  detachTooltipForward?.();
  detachTooltipForward = null;
  mapStage?.dispose?.();
  mapStage = null;
  ctrl.value = null;
  menuOpen.value = false;
  saves.value = { infinite: readSave(false), story: readSave(true) }; // 回主菜单刷新存档信息
  phase.value = 'menu';
}

// 当前接受指针输入的舞台：战斗层 = BattleStage（**战后奖励也还在这里** —— 奖励 overlay
// 画在战斗舞台的 uiScene 上，背景保持战斗房间，直到领奖后的切幕中点才换回塔楼）；
// 休息房 = 场景式 RoomStage（仅赌厅这类有休息房配方的房间才有，占位房间回退 MapStage）；
// 其余阶段（prep/ascension/end）都是地图舞台上的 Three 面板。
// ⚠ 房内进阶（2026-09-18 训练改版）期间 gameStage 是 'ascension' 但 RoomStage 仍存活
// 且仍是**渲染中的舞台**——种子包等阶段模态面板画在它的 uiScene 上。此时指针必须继续
// 喂 RoomStage，否则会喂给不可见的 MapStage（它也建了同一份面板：tooltip 走全局总线
// 照常弹、点击却在操作看不见的副本——用户报「种子包 hover/点选失效」的病灶）。
// 离房路径的 ascension（completeRoom 已拆 roomStage）不满足 roomStage 存活条件，自然回地图。
function activeStage() {
  const c = ctrl.value;
  if (!c) return null;
  const battle = c.getBattleStage();
  if (battle) return battle;   // 战斗 / 战后奖励：战斗舞台存在期间由它接管指针
  const room = c.getRoomStage();
  if (room && (c.run.gameStage === 'room' || c.run.gameStage === 'ascension')) return room;
  return mapStage;
}

function onPointer(type) {
  return (e) => {
    const stage = activeStage();
    if (!stage?.[type]) return;
    // 画布在 16:9 取景框内，窗口坐标需减去取景框偏移
    const rect = e.currentTarget.getBoundingClientRect();
    stage[type](e.clientX - rect.left, e.clientY - rect.top);
  };
}

// 预生成指针 handler：模板里直接写 onPointer('x') 只会调工厂丢弃闭包，$event 传不进去
const onPointerMove = onPointer('handlePointerMove');
// 滚轮专用：通用 onPointer 传的是指针坐标，而 handleWheel 要的是 **e.deltaY**
// （原实现把 clientX 当 deltaY 传进去，导致只能向下滚、无法向上——交互 bug 已修）。
// 方向保持浏览器原生语义（向下滚 deltaY > 0 = 内容上移/看后面的卡）。
function onWheel(e) {
  const stage = activeStage();
  if (!stage?.handleWheel) return;
  e.preventDefault();
  stage.handleWheel(e.deltaY);
}
const onPointerDown = onPointer('handlePointerDown');
const onPointerUp = onPointer('handlePointerUp');

// 16:9 取景框（尺寸计算抽到 frame.js，观战页共用；框带 translateZ，内部一切
// position:fixed 的 UI（面板/菜单/toast）以框为包含块，编排只依赖 16:9 画布）
const fitFrame = () => fitGameFrame({ frame: frame.value, stageManager });

let resizeHandler = null;
let keyHandler = null;
onMounted(() => {
  stageManager = new StageManager();
  stageManager.attach(canvas.value);
  fitFrame();
  window.addEventListener('resize', fitFrame);
  stageManager.start();
  void autoStartFromUrl();
  // Esc = 游戏内弹出菜单开关（菜单级界面不响应；全局模态弹窗打开时让位，Esc 归弹窗取消）；
  // F9 = 调试面板开关（仅调试模式开着时响应——面板本身在同一条件下才渲染）
  keyHandler = (e) => {
    if (e.key === 'Escape' && phase.value === 'game' && !menuDialogState().open) {
      menuOpen.value = !menuOpen.value;
      return;
    }
    if (e.key === 'F9' && settings.debugMode && phase.value === 'game') {
      e.preventDefault();
      toggleDebugPanel();
    }
  };
  window.addEventListener('keydown', keyHandler);
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', fitFrame);
  window.removeEventListener('keydown', keyHandler);
  stageManager?.dispose();
});
</script>

<template>
  <!-- 16:9 取景框：JS 定尺寸（fitFrame），所有游戏 UI 都框在内部编排 -->
  <div id="game-frame" ref="frame">
    <canvas
      id="stage-canvas" ref="canvas"
      @pointermove="onPointerMove"
      @pointerdown="onPointerDown"
      @pointerup="onPointerUp"
      @wheel="onWheel"
    ></canvas>
    <!-- 菜单层顶层加载门：全量美术预载**全部成功**前挡住一切（最高 z-index）；
         失败时卡住并给重试（用户定 2026-09-12：不准带缺图进游戏） -->
    <AssetLoadingScreen v-if="!assetsReady" :progress="assetProgress" :failed="assetFailed"
      @retry="startAssetPreload" />
    <!-- 菜单级：开始界面（含 changelog 弹层） -->
    <StartScreen v-else-if="phase === 'menu'" :saves="saves" @start="onStart" />
    <template v-else-if="ctrl">
      <!-- 玩家常驻状态：战斗内/地图背景均由 three.js PlayerStatusObject 绘（左下角） -->
      <!-- prep / reward 面板已迁入 Three（MapStage 的 PanelObject；数据经 core/run/panelSnapshot 下行） -->
      <BattleHud v-if="stage === 'battle'" :ctrl="ctrl" />
      <EndPanel v-else-if="stage === 'end'" :ctrl="ctrl" @restart="newGame" />
      <!-- 游戏内弹出菜单：Esc 呼出（存档/设置/回主菜单） -->
      <button class="menu-fab" @click="menuOpen = true">菜单</button>
      <!-- 调试面板入口（仅调试模式）：F9 或点这里开合；面板 z 压过幕间层，卡住时也能用 -->
      <button v-if="settings.debugMode" class="menu-fab debug-fab" @click="toggleDebugPanel()">
        调试<template v-if="ctrl.run.debugMode">*</template>
      </button>
      <DebugOverlay v-if="settings.debugMode && debugUi.open" :ctrl="ctrl"
        @close="debugUi.open = false" @restart="onDebugRestart" />
      <GameMenu v-if="menuOpen" :ctrl="ctrl" @close="menuOpen = false" @toTitle="toTitle" />
      <!-- cutscene 内容层：对话/CG/渐变剧本，激活时阻塞一切流程（游戏流程手动驱动） -->
      <CutsceneOverlay v-if="ctrl.cutscene.state.mode !== 'idle'" :player="ctrl.cutscene" />
      <!-- 幕间切幕层（独立于内容层，用户 2026-09-12）：黑幕的**目的地**可以是 3D 舞台、也可以是
           一段 cutscene——所以它自占一层、盖在内容之上（切幕开始 → 目的地就位 → 切幕结束） -->
      <SceneWipeOverlay :wipe="ctrl.sceneWipe" />
    </template>
    <!-- 菜单级全局 toast 提示（两 phase 均可用，无阻塞，3s 自然消亡 / × 手动关闭） -->
    <MenuPopup :toasts="menuToasts" @close="dismissMenuToast" />
    <!-- 菜单级全局模态弹窗（confirm / confirmCancel / input，语义见 menuDialog.js） -->
    <MenuDialog />
    <!-- tooltip 唯一渲染宿主：塔楼/房间两层共享（状态机见 tooltipHub.js） -->
    <TooltipOverlay />
  </div>
</template>

<style>
html, body { margin: 0; padding: 0; overflow: hidden; background: #000; }
#game-frame {
  /* transform 使本框成为内部 position:fixed 后代的包含块：全部 UI 锁定 16:9 编排 */
  position: absolute; background: #000;
  transform: translateZ(0);
}
#stage-canvas { display: block; position: absolute; inset: 0; }
.menu-fab {
  position: fixed; top: 14px; right: 14px; z-index: 25;
  padding: 5px 16px; font-size: 13px; cursor: pointer; border-radius: 4px;
  background: rgba(16, 22, 34, .9); color: #eaf1fb; border: 1px solid #3f5f8c;
}
.menu-fab:hover { background: rgba(52, 84, 126, .95); border-color: #8fb6dd; }
/* 调试入口与「菜单」并排（menu-fab 是 right:14px，这里让到它左边） */
.debug-fab { right: 84px; color: #ffd479; border-color: #8c7a3f; }
.debug-fab:hover { border-color: #ffd479; }
</style>
