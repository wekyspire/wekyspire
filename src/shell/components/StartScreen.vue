<template>
  <div class="start-screen">
    
    <!-- 背景常驻同一元素：模式切换只换 class（blur 渐清 + zoom 渐近，暗示距离上靠近），
    transition 被打断时也能平滑续接，支持快速反复切换 -->
    <div class="bg" :class="{ story: isStory }" :style="{ backgroundImage: `url(${startBg})` }"></div>
    <div v-if="isStory" ref="snowLayer" class="snow-layer"></div>
    <div class="contents">
      <div class="dev-banner">开发中版本，内容随时变更</div>
      <!-- 定高槽位：两种模式的元素各占固定高度容器，切换时排版不跳动 -->
      <div class="slot title-slot">
        <Transition name="swing-fade" mode="out-in">
          <h1 v-if="!isStory" key="infinite" class="title">魏启尖塔</h1>
          <h1 v-else key="story" class="title">魏启尖塔 <span class="subtitle">故事</span></h1>
        </Transition>
      </div>
      <div class="slot btn-slot">
        <Transition name="swing-fade" mode="out-in">
          <button v-if="!isStory" key="infinite" class="main-btn-rogue" @click="launch(null)">肉鸽模式</button>
          <button v-else key="story" class="main-btn-story" @click="launch(null)">进入尖塔</button>
        </Transition>
      </div>
      <!-- 开局路线（2026-09-21 D2，杀戮尖塔式选角）：只影响新开局；读档以存档现场为准 -->
      <div class="route-row">
        <button
          v-for="r in routeList" :key="r.id"
          class="route-chip" :class="{ on: route === r.id }"
          :style="route === r.id ? { borderColor: r.color, color: r.color } : {}"
          @click="route = r.id"
        >{{ r.name }}</button>
      </div>
      <div class="route-blurb">{{ routeBlurb }}</div>
      <div class="slot save-slot">
        <!-- 标题与内容作为整体随 Transition 切入切出；key 含模式（两模式存档独立，切换时随标题一起 swing） -->
        <Transition name="swing-fade" mode="out-in">
          <div v-if="canContinue" :key="saveKey" class="save-block">
            <div class="save-title">存档</div>
            <button class="continue-btn" @click="launch(save)">继续存档</button>
            <div v-if="saveText" class="save-info">{{ saveText }}</div>
          </div>
        </Transition>
      </div>
      <!-- 故事/调试两个开关仅线下开发可见（IS_DEV 构建期常量，部署版恒 false 不渲染、恒默认关闭） -->
      <div v-if="IS_DEV" class="story-toggle">
        <input id="story-checkbox" type="checkbox" v-model="isStory" />
        <label for="story-checkbox">故事模式</label>
      </div>
      <!-- 调试模式（仅调试用）：新开局进调试会话——F9 调试面板 / 存档写 debug 槽 / 开局发一拳。
           取代了旧的「无敌模式」复选框：无敌只是这个模式里的一项（面板里随时开关，或直接发一拳） -->
      <div v-if="IS_DEV" class="story-toggle">
        <input id="debug-checkbox" type="checkbox" :checked="settings.debugMode" @change="toggleDebug" />
        <label for="debug-checkbox">调试模式<span style="color: #ff0000;">（仅调试用）</span></label>
      </div>
    </div>
    <ChangeLog />
  </div>
</template>

<script setup>
import { ref, computed, watch, inject, onMounted, onBeforeUnmount } from 'vue';
import ChangeLog from './ChangeLog.vue';
import { settings, persistSettings, setDebugMode } from '../settings';
import { showMenuDialog } from '../menuDialog';
import { readSave } from '../saves';
import { ROUTES, ROUTE_IDS } from '../../core/run/routes.js';
import { fadeInTitleMusic, fadeOutTitleMusic } from '../audio';
import startBg from '../../assets/images/start-screen.webp';
import titleMusicUrl from '../../assets/sounds/story-mode-intro.mp3';

const props = defineProps({
  saves: {
    type: Object,
    default: () => ({ infinite: null, story: null }),
  },
});
const emit = defineEmits(['start']);
const showMenuPopup = inject('showMenuPopup'); // App.vue 挂载的全局共享 popup
const IS_DEV = import.meta.env.DEV; // 构建期常量：故事/调试两开关只在 dev server 渲染

// 模式选择持久化：回主菜单后复选框保持上次选择；默认肉鸽（故事模式未开放）
const isStory = ref(settings.menuStoryMode === true);
// 开局路线（D2）：持久化到 settings，默认体修。
// 木/空灵脉尚未开发完成，部署版屏蔽（IS_DEV 构建期常量）；持久化里残留的旧选择落回体修
const VISIBLE_ROUTE_IDS = IS_DEV ? ROUTE_IDS : ROUTE_IDS.filter(id => id !== 'wood' && id !== 'air');
const route = ref(VISIBLE_ROUTE_IDS.includes(settings.menuRoute) ? settings.menuRoute : 'body');
const ROUTE_COLORS = { body: '#b8894a', fire: '#e85a5a', wood: '#4aa56e', air: '#5aa2e8' };
const routeList = VISIBLE_ROUTE_IDS.map(id => ({ id, name: ROUTES[id].name, color: ROUTE_COLORS[id] }));
const routeBlurb = computed(() => ROUTES[route.value]?.blurb ?? '');
watch(route, (v) => { settings.menuRoute = v; persistSettings(); });
// 「继续」的优先来源：调试模式开着就先看 debug 槽（各槽互不覆盖，见 saves.modeOf）
const debugSave = ref(readSave('debug'));
function toggleDebug(e) {
  setDebugMode(e.target.checked);
  debugSave.value = readSave('debug');   // 切模式时刷新可继续的调试档
}
// 回主菜单后 props.saves 整份换新，调试槽也顺手重读（与另外两槽同一节拍）
watch(() => props.saves, () => { debugSave.value = readSave('debug'); });
watch(isStory, (v) => {
  // 暂时关闭故事模式切换
  if (v) {
    isStory.value = false;
    // 取消checkbox选中状态，提示故事模式尚未制作
    showMenuPopup('故事模式尚未制作');
    return;
  }
  settings.menuStoryMode = v;
  persistSettings();
  syncAmbience();
});

// 当前模式对应的存档（三槽位隔离：肉鸽 / 故事 / 调试）
const isDebug = computed(() => settings.debugMode === true);
const save = computed(() => (isStory.value ? props.saves.story
  : (isDebug.value ? debugSave.value : props.saves.infinite)));
// Story mode不能选择重新开始游戏，进入尖塔即为开始游戏
const canContinue = computed(() => !!save.value && !isStory); // readSave 版本不符已归 null，此处只判有无
const saveText = computed(() => {
  const s = save.value;
  if (!s || !canContinue.value) return '';
  const when = s.savedAt ? new Date(s.savedAt).toLocaleString() : '';
  const suffix = s.gameStage === 'end' ? '（已通关）' : '';
  const tag = s.debugMode ? '调试局 · ' : '';
  return `存档：${tag}第 ${s.floor}/${s.totalFloors} 层${suffix}${when ? ' · ' + when : ''}`;
});
// 存档块 key 含模式：切模式时与标题/主按钮同一节奏切入切出，而非原地不动
const saveKey = computed(() => {
  const mode = isStory.value ? 'story' : (isDebug.value ? 'debug' : 'infinite');
  return `${mode}:${canContinue.value ? 'has' : 'none'}`;
});

async function launch(loadSave) {
  // 读档以存档自身的模式为准；新开局以当前复选框为准
  const story = loadSave ? loadSave.storyMode !== false : isStory.value;
  if (story) {
    showMenuPopup('故事模式尚未制作');
    return;
  }
  // 调试局读档：强制带调试标记（面板/槽位随档走）
  const debug = loadSave ? !!loadSave.debugMode : isDebug.value;
  // 新开局且**真实**槽已有存档：确认覆盖（调试局写独立 debug 槽，不需要问）
  if (!loadSave && canContinue.value && !debug) {
    const { ok } = await showMenuDialog({
      title: '覆盖存档？',
      message: `已有进行中的存档（${saveText.value}），开始新游戏将覆盖它。`,
      mode: 'confirmCancel',
      confirmText: '覆盖并开始',
      cancelText: '取消',
    });
    if (!ok) return; // 取消：留在开始界面，存档不动
  }
  // 肉鸽模式：无开场滚动动画，直接开始
  emit('start', { storyMode: false, loadSave, debugMode: debug, route: route.value });
}

// ---------- 故事模式氛围：雪花粒子 + 标题音乐 ----------
const snowLayer = ref(null);
let snowTimer = null;
let titleMusic = null;

function spawnFlake() {
  const el = snowLayer.value;
  if (!el || el.childElementCount > 80) return;
  const flake = document.createElement('div');
  flake.className = 'flake';
  flake.style.left = Math.random() * 100 + '%';
  flake.style.fontSize = 8 + Math.random() * 10 + 'px';
  flake.style.opacity = 0.4 + Math.random() * 0.6;
  flake.style.setProperty('--dx', (Math.random() * 12 - 6) + 'vw');
  flake.style.animationDuration = 6 + Math.random() * 8 + 's';
  flake.textContent = '❄';
  flake.addEventListener('animationend', () => flake.remove());
  el.appendChild(flake);
}
function startSnow() {
  if (snowTimer) return;
  snowTimer = setInterval(spawnFlake, 130);
}
function stopSnow() {
  if (!snowTimer) return;
  clearInterval(snowTimer);
  snowTimer = null;
  if (snowLayer.value) snowLayer.value.innerHTML = '';
}
function syncAmbience() {
  if (isStory.value) {
    startSnow();
    if (settings.soundOn) titleMusic = fadeInTitleMusic(titleMusicUrl);
  } else {
    stopSnow();
    fadeOutTitleMusic(titleMusic);
    titleMusic = null;
  }
}
watch(() => settings.soundOn, (on) => {
  if (!isStory.value) return;
  if (on) titleMusic = fadeInTitleMusic(titleMusicUrl);
  else { fadeOutTitleMusic(titleMusic); titleMusic = null; }
});
onMounted(() => { if (isStory.value) syncAmbience(); });
onBeforeUnmount(() => {
  stopSnow();
  fadeOutTitleMusic(titleMusic);
  titleMusic = null;
});
</script>

<style scoped>
.start-screen { position: absolute; inset: 0; overflow: hidden; color: #eef7ff; }
/* 背景图常驻；黑色遮罩用伪元素实现，透明度走 transition（可被打断平滑续接） */
/* 肉鸽模式 = 远景（重度模糊 + 去色压暗，接近纯黑）；故事模式 = 近景（清晰 + 轻微放大） */
.bg {
  position: absolute; inset: 0;
  background-size: cover; background-position: center bottom; background-color: #000;
  filter: blur(26px) grayscale(.85) brightness(.3);
  transform: scale(1);
  transition: filter 1.8s ease, transform 1.8s ease;
}
.bg.story { filter: blur(0) grayscale(0) brightness(1); transform: scale(1.1); }
.snow-layer { position: absolute; inset: 0; z-index: 1; pointer-events: none; overflow: hidden; }
.contents {
  position: relative; z-index: 2; height: 100%;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 14px;
  user-select: none;
}
/* 定高槽位：内容在槽内垂直居中，两模式切换/存档有无均不改变槽高 */
.slot { display: flex; flex-direction: column; align-items: center; justify-content: center; }
.title-slot { height: 78px; }
.btn-slot { height: 50px; }
.save-slot { height: 88px; }
.save-block { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.save-title { font-size: 12px; letter-spacing: 3px; color: #7d87a8; }
.save-empty { font-size: 13px; color: #5d6584; padding: 4px 0; }
/* 标题：白字（不再金色发光大字——用户定 2026-09-12 的扁平风格） */
.title {
  margin: 0; font-size: 54px; letter-spacing: 8px; color: #eef4ff;
  text-shadow: 0 2px 10px rgba(0, 0, 0, .55);
}
.subtitle { font-size: 24px; letter-spacing: 4px; color: #ff7b23; vertical-align: super; }
.dev-banner { font-size: 22px; font-weight: bold; color: #ff6b63; letter-spacing: 4px; }

.main-btn-story {
  font-family: inherit; font-size: 18px; color: #eaf1fb; cursor: pointer;
  padding: 10px 44px; border-radius: 5px;
  background: rgba(212, 60, 0, 0.92); border: 1px solid #da7e5a;
  transition: background .15s, border-color .15s, transform .15s;
}

.main-btn-story:hover, .continue-btn:hover { background: rgba(252, 135, 25, 0.95); }

/* 主按钮：白字 + 淡蓝描边 + 深底（扁平，无渐变发光） */
.main-btn-rogue, .continue-btn {
  font-family: inherit; font-size: 18px; color: #eaf1fb; cursor: pointer;
  padding: 10px 44px; border-radius: 5px;
  background: rgba(16, 22, 34, .92); border: 1px solid #3f5f8c;
  transition: background .15s, border-color .15s, transform .15s;
}

.main-btn-rogue:hover, .continue-btn:hover { background: rgba(52, 84, 126, .95); border-color: #8fb6dd; }
/* 开局路线（D2）：小芯片一排，扁平深底白字；选中吃体系色描边 */
.route-row { display: flex; gap: 10px; }
.route-chip {
  font-family: inherit; font-size: 14px; color: #c3cee0; cursor: pointer;
  padding: 6px 18px; border-radius: 4px;
  background: rgba(16, 22, 34, .92); border: 1px solid #3f5f8c;
  transition: background .15s, border-color .15s, color .15s;
}
.route-chip:hover { background: rgba(52, 84, 126, .95); }
.route-chip.on { background: rgba(30, 42, 64, .95); }
.route-blurb { font-size: 12px; color: #9aa3c0; min-height: 16px; }
.continue-btn { font-size: 14px; padding: 7px 30px; }
.save-info { font-size: 12px; color: #9aa3c0; margin-top: 4px; }
.story-toggle { margin-top: 14px; color: #eaf1fb; font-size: 14px; display: flex; gap: 8px; align-items: center; }
.story-toggle input { accent-color: #4d78ad; width: 15px; height: 15px; cursor: pointer; }
.story-toggle label { cursor: pointer; }
.swing-fade-enter-active, .swing-fade-leave-active { transition: opacity .35s ease, transform .35s ease; }
.swing-fade-enter-from { opacity: 0; transform: translateY(14px); }
.swing-fade-leave-to { opacity: 0; transform: translateY(-14px); }
</style>

<!-- 雪花为动态创建节点（无 data-v 属性），样式须放在非 scoped 块 -->
<style>
.snow-layer .flake {
  position: absolute; top: -24px; color: #fff; pointer-events: none;
  animation: snow-fall linear forwards;
}
@keyframes snow-fall {
  to { transform: translate(var(--dx, 0), 108vh); opacity: .1; }
}
</style>
