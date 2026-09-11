<script setup>
// Vue 薄壳：三层场景的最外层编排（README「场景层级」总纲）。
// 菜单层 = 纯 Vue（StartScreen / GameMenu / EndPanel）；
// 大世界层（塔楼层）= MapStage（ThreeJS）+ PrepPanel 等 Vue 面板叠加；
// 战斗层（房间层）= BattleStage（ThreeJS）+ BattleHud / RewardPanel 等叠加。
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
import PrepPanel from './components/PrepPanel.vue';
import BattleHud from './components/BattleHud.vue';
import RewardPanel from './components/RewardPanel.vue';
import RoomPanel from './components/RoomPanel.vue';
import AscensionPanel from './components/AscensionPanel.vue';
import EndPanel from './components/EndPanel.vue';
import MenuPopup from './components/MenuPopup.vue';
import MenuDialog from './components/MenuDialog.vue';
import TooltipOverlay from './components/TooltipOverlay.vue';
import { fitGameFrame } from './frame.js';
import { menuDialogState } from './menuDialog.js';
import CutsceneOverlay from './overlay/CutsceneOverlay.vue';
import { preloadAllArt } from '../stage/art/assetManifest.js';
import './components/runPanels.css'; // 发育阶段 run 面板公共样式（奖励/房间/进阶）

const canvas = ref(null);
const frame = ref(null);
const ctrl = ref(null);
let stageManager = null;
let mapStage = null;

const phase = ref('menu');      // 'menu' | 'game'（菜单级与游戏级的最外层切换）
const menuOpen = ref(false);    // 游戏内弹出菜单（Esc）
const saves = ref({ infinite: readSave(false), story: readSave(true) }); // 两模式存档隔离

const stage = computed(() => ctrl.value?.run.gameStage ?? 'prep');

// 全量美术预载：setup 即启动（与 Vue 挂载/舞台初始化并行）。加载界面挡在开始界面
// 之前——完成才放行（此后所有舞台首拍同步命中素材缓存，无占位闪变）。
const assetsReady = ref(false);
const assetProgress = ref({ loaded: 0, total: 0 });
preloadAllArt({
  onProgress: (loaded, total) => { assetProgress.value = { loaded, total }; },
}).then(() => { assetsReady.value = true; });

// 菜单级全局共享 toast：任意菜单级组件 inject('showMenuPopup') 后调用（跨 phase 可用）。
// 多条 toast 各自 3s 寿命独立消亡；新 toast 从底部进入，旧 toast 被顶起，消亡后其余平滑回落。
const menuToasts = ref([]);
let toastSeq = 0;
provide('showMenuPopup', (title, text = '') => {
  const id = ++toastSeq;
  const list = [...menuToasts.value, { id, title, text }];
  menuToasts.value = list.slice(-4); // 并发上限 4：超出立即挤掉最旧的（转入消亡动画）
  setTimeout(() => {
    menuToasts.value = menuToasts.value.filter(t => t.id !== id);
  }, 3000);
});

// toast 手动关闭（× 按钮）：与 3s 自然寿命同一条移除路径
function dismissMenuToast(id) {
  menuToasts.value = menuToasts.value.filter(t => t.id !== id);
}

function newGame({ storyMode = false, loadSave = null } = {}) {
  ctrl.value?.dispose?.(); // 战斗舞台释放 + 挂起演出瞬落
  mapStage?.dispose?.();
  mapStage = new MapStage({});
  ctrl.value = createRunController({ stageManager, mapStage, save: loadSave, storyMode });
  mapStage.setFloor(ctrl.value.run.floor, ctrl.value.run.totalFloors);
  stageManager.setStage(mapStage);
  phase.value = 'game';
  menuOpen.value = false;
  // 冒烟/控制台钩子
  window.__shell = { ctrl, stageManager, newGame };
}

function onStart({ storyMode, loadSave }) {
  newGame({ storyMode, loadSave });
}

function toTitle() {
  ctrl.value?.dispose?.(); // 战斗舞台释放 + 挂起演出瞬落
  mapStage?.dispose?.();
  mapStage = null;
  ctrl.value = null;
  menuOpen.value = false;
  saves.value = { infinite: readSave(false), story: readSave(true) }; // 回主菜单刷新存档信息
  phase.value = 'menu';
}

function onPointer(type) {
  return (e) => {
    const battleStage = ctrl.value?.getBattleStage();
    if (!battleStage || ctrl.value.run.gameStage !== 'battle') return;
    // 画布在 16:9 取景框内，窗口坐标需减去取景框偏移
    const rect = e.currentTarget.getBoundingClientRect();
    battleStage[type]?.(e.clientX - rect.left, e.clientY - rect.top);
  };
}

// 预生成指针 handler：模板里直接写 onPointer('x') 只会调工厂丢弃闭包，$event 传不进去
const onPointerMove = onPointer('handlePointerMove');
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
  // Esc = 游戏内弹出菜单开关（菜单级界面不响应；全局模态弹窗打开时让位，Esc 归弹窗取消）
  keyHandler = (e) => {
    if (e.key === 'Escape' && phase.value === 'game' && !menuDialogState().open) {
      menuOpen.value = !menuOpen.value;
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
    ></canvas>
    <!-- 菜单层顶层加载门：全量美术预载完成前挡住一切（最高 z-index），完成才放行开始界面 -->
    <AssetLoadingScreen v-if="!assetsReady" :progress="assetProgress" />
    <!-- 菜单级：开始界面（含 changelog 弹层） -->
    <StartScreen v-else-if="phase === 'menu'" :saves="saves" @start="onStart" />
    <template v-else-if="ctrl">
      <!-- 玩家常驻状态：战斗内/地图背景均由 three.js PlayerStatusObject 绘（左下角） -->
      <PrepPanel v-if="stage === 'prep'" :ctrl="ctrl" />
      <BattleHud v-else-if="stage === 'battle'" :ctrl="ctrl" />
      <RewardPanel v-else-if="stage === 'reward'" :ctrl="ctrl" />
      <RoomPanel v-else-if="stage === 'room'" :ctrl="ctrl" />
      <AscensionPanel v-else-if="stage === 'ascension'" :ctrl="ctrl" />
      <EndPanel v-else-if="stage === 'end'" :ctrl="ctrl" @restart="newGame" />
      <!-- 游戏内弹出菜单：Esc 呼出（存档/设置/回主菜单） -->
      <button class="menu-fab" @click="menuOpen = true">菜单</button>
      <GameMenu v-if="menuOpen" :ctrl="ctrl" @close="menuOpen = false" @toTitle="toTitle" />
      <!-- cutscene overlay：对话剧本 + 幕间转场，激活时阻塞一切流程（游戏流程手动驱动） -->
      <CutsceneOverlay v-if="ctrl.cutscene.state.mode !== 'idle'" :player="ctrl.cutscene" />
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
  padding: 5px 16px; font-size: 13px; cursor: pointer; border-radius: 6px;
  background: rgba(10, 14, 26, .7); color: #cdd6f4; border: 1px solid #38415e;
}
.menu-fab:hover { background: rgba(44, 53, 84, .9); }
</style>
