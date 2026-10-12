<script setup>
// 幕间切幕层（独立于 cutscene 内容层，用户 的架构修正）：
// 自占一层、z-index 压过内容层（对话/CG）——黑幕盖住时内容可以在它下面就位/换舞台，
// 揭开时露出的就是目的地本身。状态机见 sceneWipe.js；本组件只负责画。
import { computed } from 'vue';
import { SCENE_TRANSITION_MS } from './sceneWipe.js';

const props = defineProps({ wipe: { type: Object, required: true } });
const s = computed(() => props.wipe.state);
// 过渡时长跟随当前子阶段（enter 无过渡：先屏外落位）
const dur = computed(() => {
  if (s.value.phase === 'cover') return s.value.coverMs ?? SCENE_TRANSITION_MS.cover;
  if (s.value.phase === 'reveal') return s.value.revealMs ?? SCENE_TRANSITION_MS.reveal;
  return 0;
});
// 瑞米涂鸦（UI_LANGUAGE.md 加载涂鸦章）：加载界面与幕间黑屏共用同款序列帧。
// 只在 cover（全黑盖满）段挂上——enter/reveal 滑动期间不露头；
// 挂载/摘除都在全黑瞬时完成，用户看不见跳变。
const REMI_URL = `${import.meta.env.BASE_URL}ui/remi_loader.png`;
</script>

<template>
  <!-- host 在幕间全程吸收一切点击（切幕期间不该有交互） -->
  <div v-if="s.active" class="host">
    <!-- 黑幕：宽 130vw（左 30vw 渐变软边 + 100vw 实体），transform 位移三段
         enter  屏外右侧待命：[100vw, 230vw]
         cover  实体盖满全屏：[-30vw, 100vw]（此中点换景/内容就位）
         reveal 完全移出左侧：[-130vw, 0]（目的地自右缘露出） -->
    <div class="wipe" :class="s.phase" :style="{ transitionDuration: dur + 'ms' }"></div>
    <!-- 瑞米涂鸦：全黑段右下角走路（与加载界面同一条 12 帧 sprite） -->
    <div v-if="s.phase === 'cover'" class="remi" :style="{ backgroundImage: `url('${REMI_URL}')` }"></div>
  </div>
</template>

<style scoped>
.host { position: fixed; inset: 0; z-index: 120; pointer-events: auto; }
.wipe {
  position: absolute; top: 0; bottom: 0; left: 0; width: 130vw;
  background: linear-gradient(to right, rgba(4, 6, 14, 0) 0%, #04060e 23%);
  will-change: transform;
}
.wipe.enter { transform: translateX(100vw); }
/* 时长由内联 transitionDuration 驱动（wipe 状态），这里只定缓动曲线 */
.wipe.cover {
  transform: translateX(-30vw);
  transition-property: transform;
  transition-timing-function: cubic-bezier(.55, .06, .85, .35);
}
.wipe.reveal {
  transform: translateX(-130vw);
  transition-property: transform;
  transition-timing-function: cubic-bezier(.15, .55, .3, .97);
}
/* 尺寸/帧数与 index.html 加载壳同源（12 帧 × 105px 宽，steps 逐帧跳）；
   cover 段开始即挂载，remi-in 淡入衔接黑幕扫过右缘的时刻 */
.remi {
  position: absolute; right: 16px; bottom: 12px;
  width: 105px; height: 61px; pointer-events: none;
  background-position: left top; background-repeat: no-repeat; background-size: 1260px 61px;
  animation: remi-in .25s ease, remi-walk 1s steps(12) infinite;
}
@keyframes remi-walk { to { background-position-x: -1260px; } }
@keyframes remi-in { from { opacity: 0; } }
</style>
