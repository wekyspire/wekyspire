<script setup>
// cutscene **内容层**：按播放器当前 step 渲染 fade / image / dialogue，全屏阻塞。
// ⚠ 幕间黑幕（wipe）**不在这里**——它是独立的一层（`SceneWipeOverlay.vue` + `sceneWipe.js`），
// 因为黑幕是"场景切换"的呈现、目的地可以是任何东西（包括本层的内容）；同层会导致
// "黑幕播完内容才蹦出来"（用户 2026-09-12 报的架构问题）。
// step 词汇表见 cutscenePlayer.js 头注；image 过渡时长由 step 参数驱动（缺省 fadeIn/out 400ms）。
import { computed } from 'vue';

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
</script>

<template>
  <div class="host">
    <!-- fade：全屏颜色层渐变（to=1 渐黑 / to=0 渐亮；animation 挂载即播，时长 = step.ms） -->
    <div v-if="step?.type === 'fade'" class="fade" :class="step.to >= 1 ? 'toBlack' : 'toClear'"
      :style="{ animationDuration: step.ms + 'ms' }"></div>

    <!-- image：CG/插图（enter 落位 → fadeIn 淡入 → hold 停留 → fadeOut 淡出；缺省各 400ms） -->
    <img v-else-if="step?.type === 'image'" class="cg" :class="state.phase"
      :style="{ transitionDuration: cgDur + 'ms' }" :src="step.src" alt="">

    <!-- dialogue：点击任意处翻页；末页点击推进时间轴下一步。
         该页带 choices 时**不翻页**——必须点某个选项（player.choose 回执开闸） -->
    <div v-else-if="page" class="dialogue" :class="{ 'has-bg': !!step.bg }" @click="player.advance()">
      <img v-if="step.bg" class="bgimg" :src="step.bg" alt="">
      <div class="box">
        <div class="speaker">{{ page.speaker }}</div>
        <div class="text">{{ page.text }}</div>
        <div v-if="page.choices?.length" class="choices">
          <button v-for="c in page.choices" :key="c.id" type="button"
            :disabled="c.disabled" @click.stop="player.choose(c.id)">
            <span class="label">{{ c.label }}</span>
            <span v-if="c.hint" class="hint2">{{ c.hint }}</span>
          </button>
        </div>
        <div v-else class="hint">点击继续 ▸</div>
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

/* CG：全屏等比覆盖；opacity 三段（enter 落位无过渡；fadeIn/fadeOut 时长由内联 style 给） */
.cg {
  position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;
  transition-property: opacity; transition-timing-function: ease;
}
.cg.enter { opacity: 0; }
.cg.fadeIn { opacity: 1; }
.cg.hold { opacity: 1; }
.cg.fadeOut { opacity: 0; }

/* 对话框（用户定 2026-09-12：**黑色半透明 flat 框**，除按钮外不滥用圆角） */
.dialogue { position: absolute; inset: 0; cursor: pointer; background: rgba(4, 6, 14, .55); }
.dialogue.has-bg { background: rgba(4, 6, 14, .38); }
.bgimg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: 0; }
.box {
  position: absolute; left: 50%; bottom: 12%; transform: translateX(-50%);
  width: min(720px, 82vw); z-index: 1;
  background: rgba(6, 8, 14, .82); border: 1px solid #2f3a52; border-radius: 2px; padding: 18px 26px;
}
.speaker { color: #cfe0f5; font-size: 15px; margin-bottom: 8px; }
.text { color: #e6ecff; font-size: 17px; line-height: 1.7; min-height: 30px; }
.hint { text-align: right; color: #6a7394; font-size: 12px; margin-top: 10px; }

/* 选项按钮（带 choices 的对话页）：整行按钮 + 右侧小字提示；禁用项置灰不可点。
   按钮保留圆角（用户定：除按钮外不滥用圆角），走"白字淡蓝"扁平风格 */
.choices { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
.choices button {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  width: 100%; padding: 11px 16px; text-align: left; cursor: pointer;
  background: rgba(18, 24, 38, .92); color: #dfe9f8;
  border: 1px solid #33507a; border-radius: 4px;
  font: 600 15px/1.4 sans-serif; transition: background .12s ease, border-color .12s ease;
}
.choices button:hover:not(:disabled) { background: rgba(34, 48, 74, .95); border-color: #4d78ad; }
.choices button:disabled { opacity: .42; cursor: default; }
.choices .hint2 { color: #8d97b5; font-size: 12px; font-weight: 400; }
</style>
