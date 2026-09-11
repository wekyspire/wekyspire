<script setup>
// cutscene overlay（统一）：按播放器当前 step 渲染对应图层，全屏阻塞。
// step 词汇表见 cutscenePlayer.js 头注；过渡时长由 step 参数驱动：
//   wipe 缺省取 SCENE_TRANSITION_MS；image 缺省 fadeIn/fadeOut 400ms。
import { computed } from 'vue';
import { SCENE_TRANSITION_MS } from './cutscenePlayer.js';

const props = defineProps({ player: { type: Object, required: true } });
const state = computed(() => props.player.state);
const step = computed(() => state.value.step);
const page = computed(() => (step.value?.type === 'dialogue')
  ? step.value.pages[state.value.pageIndex] ?? null
  : null);
// CG 过渡时长跟随当前子阶段（必须与播放器 step 参数一致）
const cgDur = computed(() => {
  const s = step.value;
  if (s?.type !== 'image') return 0;
  if (state.value.phase === 'fadeIn') return s.fadeInMs ?? 400;
  if (state.value.phase === 'fadeOut') return s.fadeOutMs ?? 400;
  return 0;
});
// wipe 过渡时长跟随当前子阶段（cover/reveal；参数与播放器编译侧同源缺省）
const wipeDur = computed(() => {
  const s = step.value;
  if (s?.type !== 'wipe') return 0;
  if (state.value.phase === 'cover') return s.coverMs ?? SCENE_TRANSITION_MS.cover;
  if (state.value.phase === 'reveal') return s.revealMs ?? SCENE_TRANSITION_MS.reveal;
  return 0;
});
</script>

<template>
  <div class="host">
    <!-- fade：全屏颜色层渐变（to=1 渐黑 / to=0 渐亮；animation 挂载即播，时长 = step.ms） -->
    <div v-if="step?.type === 'fade'" class="fade" :class="step.to >= 1 ? 'toBlack' : 'toClear'"
      :style="{ animationDuration: step.ms + 'ms' }"></div>

    <!-- wipe：自右向左的渐变黑幕（enter 落位 → cover 盖屏[atCover 换景/预载] → reveal 露出）；
         时长由 step 参数驱动（缺省同 SCENE_TRANSITION_MS），atCover 等待预载期间黑幕保持 -->
    <div v-else-if="step?.type === 'wipe'" class="wipe" :class="state.phase"
      :style="{ transitionDuration: wipeDur + 'ms' }"></div>

    <!-- image：CG/插图（enter 落位 → fadeIn 淡入 → hold 停留 → fadeOut 淡出；缺省各 400ms） -->
    <img v-else-if="step?.type === 'image'" class="cg" :class="state.phase"
      :style="{ transitionDuration: cgDur + 'ms' }" :src="step.src" alt="">

    <!-- dialogue：点击任意处翻页；末页点击推进时间轴下一步 -->
    <div v-else-if="page" class="dialogue" @click="player.advance()">
      <div class="box">
        <div class="speaker">{{ page.speaker }}</div>
        <div class="text">{{ page.text }}</div>
        <div class="hint">点击继续 ▸</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* host：激活期间全屏吸收一切点击 = 阻塞语义 */
.host { position: fixed; inset: 0; z-index: 100; pointer-events: auto; font-family: sans-serif; }

/* fade 层：用 animation 而非 transition（元素挂载即终值时 transition 不会触发）；
   fill-mode forwards 保持终态，播放器在 step.ms 后推进下一步 */
.fade {
  position: absolute; inset: 0; background: #04060e;
  animation-timing-function: ease; animation-fill-mode: forwards;
}
.fade.toBlack { animation-name: fadeToBlack; }
.fade.toClear { animation-name: fadeToClear; }
@keyframes fadeToBlack { from { opacity: 0; } to { opacity: 1; } }
@keyframes fadeToClear { from { opacity: 1; } to { opacity: 0; } }

/* 黑幕：宽 130vw（左 30vw 渐变软边 + 100vw 实体），transform 位移三段
   enter  屏外右侧待命：[100vw, 230vw]
   cover  实体盖满全屏：[-30vw, 100vw]（此中点换景）
   reveal 完全移出左侧：[-130vw, 0]（新场景自右缘露出） */
.wipe {
  position: absolute; top: 0; bottom: 0; left: 0; width: 130vw;
  background: linear-gradient(to right, rgba(4, 6, 14, 0) 0%, #04060e 23%);
  will-change: transform;
}
.wipe.enter { transform: translateX(100vw); }
/* 时长由内联 transitionDuration 驱动（step 参数），这里只定缓动曲线 */
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

/* CG：全屏等比覆盖；opacity 三段（enter 落位无过渡；fadeIn/fadeOut 时长由内联 style 给，
   缺省 .4s 见 cutscenePlayer.js execStep('image')） */
.cg {
  position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;
  transition-property: opacity; transition-timing-function: ease;
}
.cg.enter { opacity: 0; }
.cg.fadeIn { opacity: 1; }
.cg.hold { opacity: 1; }
.cg.fadeOut { opacity: 0; }

.dialogue { position: absolute; inset: 0; cursor: pointer; background: rgba(4, 6, 14, .72); }
.box {
  position: absolute; left: 50%; bottom: 12%; transform: translateX(-50%);
  width: min(720px, 82vw); background: rgba(12, 16, 30, .95);
  border: 1px solid #55618a; border-radius: 10px; padding: 18px 26px;
}
.speaker { color: #ffd75e; font-size: 15px; margin-bottom: 8px; }
.text { color: #e6ecff; font-size: 17px; line-height: 1.7; min-height: 30px; }
.hint { text-align: right; color: #6a7394; font-size: 12px; margin-top: 10px; }
</style>
