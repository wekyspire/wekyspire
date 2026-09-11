<template>
  <div class="start-screen">
    <!-- 背景常驻同一元素：模式切换只换 class（blur 渐清 + zoom 渐近，暗示距离上靠近），
         transition 被打断时也能平滑续接，支持快速反复切换 -->
    <div class="bg" :class="{ story: isStory }" :style="{ backgroundImage: `url(${startBg})` }"></div>
    <div v-if="isStory" ref="snowLayer" class="snow-layer"></div>
    <div class="contents">
      <!-- 定高槽位：两种模式的元素各占固定高度容器，切换时排版不跳动 -->
      <div class="slot title-slot">
        <Transition name="swing-fade" mode="out-in">
          <h1 v-if="!isStory" key="infinite" class="title">魏启尖塔</h1>
          <h1 v-else key="story" class="title">魏启尖塔 <span class="subtitle">故事</span></h1>
        </Transition>
      </div>
      <div class="dev-banner">开发中版本，内容随时变更</div>
      <div class="slot btn-slot">
        <Transition name="swing-fade" mode="out-in">
          <button v-if="!isStory" key="infinite" class="main-btn-rogue" @click="launch(null)">肉鸽模式</button>
          <button v-else key="story" class="main-btn-story" @click="launch(null)">进入尖塔</button>
        </Transition>
      </div>
      <div class="slot save-slot">
        <!-- 标题与内容作为整体随 Transition 切入切出；key 含模式（两模式存档独立，切换时随标题一起 swing） -->
        <Transition name="swing-fade" mode="out-in">
          <div v-if="canContinue" :key="saveKey" class="save-block">
            <div class="save-title">存档</div>
            <button class="continue-btn" @click="launch(save)">继续存档</button>
            <div v-if="saveText" class="save-info">{{ saveText }}</div>
          </div>
          <div v-else :key="saveKey" class="save-block">
            <div class="save-title">存档</div>
            <div class="save-empty">暂无存档</div>
          </div>
        </Transition>
      </div>
      <div class="story-toggle">
        <input id="story-checkbox" type="checkbox" v-model="isStory" />
        <label for="story-checkbox">故事模式</label>
      </div>
    </div>
    <ChangeLog />
  </div>
</template>

<script setup>
import { ref, computed, watch, inject, onMounted, onBeforeUnmount } from 'vue';
import ChangeLog from './ChangeLog.vue';
import { settings, persistSettings } from '../settings';
import { showMenuDialog } from '../menuDialog';
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

// 模式选择持久化：回主菜单后复选框保持上次选择；默认肉鸽（故事模式未开放）
const isStory = ref(settings.menuStoryMode === true);
watch(isStory, (v) => {
  settings.menuStoryMode = v;
  persistSettings();
  syncAmbience();
});

// 当前模式对应的存档（两模式槽位隔离）
const save = computed(() => isStory.value ? props.saves.story : props.saves.infinite);
const canContinue = computed(() => !!save.value); // readSave 版本不符已归 null，此处只判有无
const saveText = computed(() => {
  const s = save.value;
  if (!s || !canContinue.value) return '';
  const when = s.savedAt ? new Date(s.savedAt).toLocaleString() : '';
  const suffix = s.gameStage === 'end' ? '（已通关）' : '';
  return `存档：第 ${s.floor}/${s.totalFloors} 层${suffix}${when ? ' · ' + when : ''}`;
});
// 存档块 key 含模式：切模式时与标题/主按钮同一节奏切入切出，而非原地不动
const saveKey = computed(() => `${isStory.value ? 'story' : 'infinite'}:${canContinue.value ? 'has' : 'none'}`);

async function launch(loadSave) {
  // 读档以存档自身的模式为准；新开局以当前复选框为准
  const story = loadSave ? loadSave.storyMode !== false : isStory.value;
  if (story) {
    showMenuPopup('故事模式暂未开放');
    return;
  }
  // 新开局且本模式已有存档：确认覆盖（弹窗全局组件的首个使用实例）
  if (!loadSave && canContinue.value) {
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
  emit('start', { storyMode: false, loadSave });
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
.title {
  margin: 0; font-size: 54px; letter-spacing: 8px; color: #ffe7b3;
  text-shadow: 0 2px 18px rgba(255, 180, 80, .35), 0 0 40px rgba(255, 140, 40, .2);
}
.subtitle { font-size: 24px; letter-spacing: 4px; color: #9ad0ff; vertical-align: super; }
.dev-banner {
  font-size: 22px; font-weight: bold; color: #ff3b30; letter-spacing: 4px;
  text-shadow: 0 0 14px rgba(255, 59, 48, .5);
}
.main-btn-rogue, .main-btn-story, .continue-btn {
  font-family: inherit; font-size: 18px; color: #fff; cursor: pointer;
  padding: 10px 44px; border-radius: 10px;
  background: #6b421a; border: 2px solid #c78f3a;
  box-shadow: 0 4px 14px rgba(0, 0, 0, .45);
  transition: filter .15s, transform .15s;
}

.main-btn:hover, .continue-btn:hover { filter: brightness(1.2); transform: translateY(-1px); }
.continue-btn { font-size: 14px; padding: 7px 30px; background: #2c3554; border-color: #56628f; }
.save-info { font-size: 12px; color: #9aa3c0; margin-top: 4px; }
.story-toggle { margin-top: 14px; color: #fff; font-size: 14px; display: flex; gap: 8px; align-items: center; }
.story-toggle input { accent-color: #b3742a; width: 15px; height: 15px; cursor: pointer; }
.story-toggle label { cursor: pointer; }
.swing-fade-enter-active, .swing-fade-leave-active { transition: opacity .35s ease, transform .35s ease; }
.swing-fade-enter-from { opacity: 0; transform: translateY(14px); }
.swing-fade-leave-to { opacity: 0; transform: translateY(-14px); }
</style>

<!-- 雪花为动态创建节点（无 data-v 属性），样式须放在非 scoped 块 -->
<style>
.snow-layer .flake {
  position: absolute; top: -24px; color: #fff; pointer-events: none;
  text-shadow: 0 0 6px rgba(255, 255, 255, .8);
  animation: snow-fall linear forwards;
}
@keyframes snow-fall {
  to { transform: translate(var(--dx, 0), 108vh); opacity: .1; }
}
</style>
