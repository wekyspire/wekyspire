<script setup>
// cutscene **内容层**：按播放器当前 step 渲染 fade / image / dialogue，全屏阻塞。
// ⚠ 幕间黑幕（wipe）**不在这里**——它是独立的一层（`SceneWipeOverlay.vue` + `sceneWipe.js`），
// 因为黑幕是"场景切换"的呈现、目的地可以是任何东西（包括本层的内容）；同层会导致
// "黑幕播完内容才蹦出来"。
// step 词汇表见 cutscenePlayer.js 头注；image 过渡时长由 step 参数驱动（缺省 fadeIn/out 400ms）。
//
// 事件界面交互：对话框入场/文字渐显/选项错峰入场与确认回拍/
// 继续指示呼吸/CG 缓推。全部纯呈现层（CSS 挂载动画 + 选项确认的 200ms 视觉拍），
// 不改播放器闸门协议——点击推进与 choose 回执时序保持不动。
import { computed, ref, watch } from 'vue';

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

// 选项确认回拍：点选后先亮 200ms（选中项提亮、其余压暗）再 choose 开闸——
// 结算与推进只发生在这之后（核心不感知这段视觉延迟）。同拍重复点击忽略。
const chosenId = ref(null);
watch(() => [state.value.step, state.value.pageIndex], () => { chosenId.value = null; });
function confirmChoice(c) {
  if (chosenId.value || c.disabled) return;
  chosenId.value = c.id;
  setTimeout(() => {
    if (chosenId.value === c.id) props.player.choose(c.id);
  }, 200);
}
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
         该页带 choices 时**不翻页**——必须点某个选项（player.choose 回执开闸）。
         CG 组（黑底衬 + 图 + 纱）不随剧本重挂：换页/换剧本时背景连续过渡，
           只有对白框重播入场拍（.box 按 state.script 重挂）。黑底衬保证 CG 淡入淡出
           窗口里只露黑、不透出底下的塔楼/房间渲染 -->
    <div v-else-if="page" class="dialogue" :class="{ 'has-bg': !!step.bg }" @click="player.advance()">
      <Transition name="bgb">
        <div v-if="step.bg" class="bgblack"></div>
      </Transition>
      <Transition name="bgf">
        <img v-if="step.bg" :key="step.bg" class="bgimg" :src="step.bg" alt="">
      </Transition>
      <div v-if="step.bg" class="scrim"></div>
      <div :key="state.script" class="box">
        <div :key="state.pageIndex" class="page">
          <div class="speaker">
            <span class="speaker-text">{{ page.speaker }}</span>
          </div>
          <div class="text">{{ page.text }}</div>
          <div v-if="page.choices?.length" class="choices" :class="{ locked: !!chosenId }">
            <button v-for="(c, i) in page.choices" :key="c.id" type="button"
              :disabled="c.disabled" :class="{ chosen: chosenId === c.id, dimmed: chosenId && chosenId !== c.id }"
              :style="{ animationDelay: (480 + i * 70) + 'ms' }"
              @click.stop="confirmChoice(c)">
              <span class="label">{{ c.label }}</span>
              <span v-if="c.hint" class="hint2">{{ c.hint }}</span>
            </button>
          </div>
          <div v-else class="hint">点击继续 ▸</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* host：激活期间全屏吸收一切点击 = 阻塞语义 */
.host { position: fixed; inset: 0; z-index: 100; pointer-events: auto; }

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

/* 对话框（**黑色半透明 flat 框**，方角厚边，UI_LANGUAGE） */
.dialogue { position: absolute; inset: 0; cursor: pointer; background: rgba(5, 5, 5, .55); }
.dialogue.has-bg { background: rgba(5, 5, 5, .38); }
/* CG 黑底衬：CG 在场期间垫一层不透明黑——淡入淡出窗口里露的是黑而非游戏场景 */
.bgblack { position: absolute; inset: 0; background: #04060e; }
.bgb-enter-active { transition: opacity 300ms ease; }
.bgb-enter-from { opacity: 0; }
.bgb-leave-active { transition: opacity 460ms ease; }
.bgb-leave-to { opacity: 0; }
/* CG：全屏等比覆盖 + 极缓推近（Ken Burns，14s 收在 1.045——静态图也要有呼吸）；
   换图 = 双图共存交叉淡化（离开图绝对定位铺底，进入图盖上淡入） */
.bgimg {
  position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: 0;
  animation: bgDrift 14s ease-out 600ms forwards;
}
.bgf-enter-active { transition: opacity 600ms ease; }
.bgf-enter-from { opacity: 0; }
.bgf-leave-active { transition: opacity 500ms ease; }
.bgf-leave-to { opacity: 0; }
@keyframes bgDrift { from { transform: scale(1); } to { transform: scale(1.045); } }
/* 底部渐暗纱：保证对话框可读性（CG 亮区压字的问题） */
.scrim {
  position: absolute; inset: 0; z-index: 0; pointer-events: none;
  background: linear-gradient(to top, rgba(4, 5, 8, .78) 0%, rgba(4, 5, 8, .34) 34%, rgba(4, 5, 8, 0) 58%);
  animation: bgIn 600ms ease both;
}
@keyframes bgIn { from { opacity: 0; } to { opacity: 1; } }
/* 对话框入场：上浮 + 淡入（每次 dialogue step 重挂触发——事件主对话与结果页各一拍） */
.box {
  position: absolute; left: 50%; bottom: 12%; transform: translateX(-50%);
  width: min(720px, 82vw); z-index: 1;
  background: rgba(8, 8, 8, .82); border: 2px solid #555555; border-radius: 0; padding: 18px 26px;
  animation: boxIn 380ms cubic-bezier(.22, .8, .32, 1) both;
}
@keyframes boxIn {
  from { opacity: 0; transform: translateX(-50%) translateY(16px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}

/* 页内容（翻页 = 重挂重放渐显）：说话人先出、正文随后、慢一拍错峰 */
.page { animation: pageIn 300ms ease both; }
@keyframes pageIn { from { opacity: 0; } to { opacity: 1; } }
.speaker { color: #d4d4d4; font-size: 15px; margin-bottom: 8px; display: flex; align-items: center; gap: 8px; }
/* 说话人左侧特征条：先撑高再落宽（快出收势），灰阶不引入彩色 */
.speaker::before {
  content: ''; width: 3px; height: 14px; background: #c9c9c9; flex: none;
  animation: barIn 300ms cubic-bezier(.22, .8, .32, 1) 120ms both;
}
@keyframes barIn { from { width: 0; opacity: 0; } to { width: 14px; opacity: 1; } }
.speaker-text { animation: riseIn 320ms cubic-bezier(.22, .8, .32, 1) 60ms both; }
.text {
  color: #ebebeb; font-size: 17px; line-height: 1.7; min-height: 30px;
  animation: riseIn 400ms cubic-bezier(.22, .8, .32, 1) 140ms both;
}
@keyframes riseIn {
  from { opacity: 0; transform: translateY(7px); }
  to { opacity: 1; transform: translateY(0); }
}

/* 继续指示：文字落定后才浮现（500ms 延时 = 延时动画），随后呼吸循环 */
.hint {
  text-align: right; color: #757575; font-size: 12px; margin-top: 10px;
  animation: hintIn 350ms ease 500ms both;
}
.hint::after { content: '▸'; display: inline-block; margin-left: 4px; animation: breathe 1.3s ease-in-out 900ms infinite; }
@keyframes hintIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes breathe { 0%, 100% { opacity: .45; transform: translateX(0); } 50% { opacity: 1; transform: translateX(3px); } }

/* 选项按钮（带 choices 的对话页）：整行按钮 + 右侧小字提示；禁用项置灰不可点。
   入场 = 文字落定后逐条错峰上浮（延时动画）；hover = 左侧灰阶特征条撑出 + 提亮；
   确认 = 选中项白亮一拍、其余压暗（chosenId 视觉拍，200ms 后才真正开闸结算） */
.choices { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
.choices.locked button { pointer-events: none; }
.choices button {
  position: relative; display: flex; align-items: center; justify-content: space-between; gap: 16px;
  width: 100%; padding: 11px 16px; text-align: left; cursor: pointer;
  background: rgba(22, 22, 22, .92); color: #e8e8e8;
  border: 2px solid #606060; border-radius: 0; overflow: hidden;
  font: 600 15px 'WenDaoChaoHei', 'Microsoft YaHei', sans-serif;
  transition: background .12s ease, border-color .12s ease, opacity .25s ease, transform .1s ease;
  animation: choiceIn 300ms cubic-bezier(.22, .8, .32, 1) both;
}
@keyframes choiceIn {
  from { opacity: 0; transform: translateY(9px); }
  to { opacity: 1; transform: translateY(0); }
}
/* hover 特征条（灰阶）：0 → 3px 撑出 */
.choices button::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 0;
  background: #cfcfcf; transition: width .13s ease;
}
.choices button:hover:not(:disabled) { background: rgba(48, 48, 48, .95); border-color: #9a9a9a; }
.choices button:hover:not(:disabled)::before { width: 3px; }
.choices button:active:not(:disabled) { transform: translateY(1px); }
/* 禁用项同款错峰入场但收在置灰透明度（animation fill 会盖静态 opacity，终值须写进关键帧） */
.choices button:disabled { cursor: default; animation-name: choiceInDim; }
@keyframes choiceInDim {
  from { opacity: 0; transform: translateY(9px); }
  to { opacity: .42; transform: translateY(0); }
}
.choices button.chosen { background: rgba(58, 58, 58, .97); border-color: #f0f0f0; }
.choices button.chosen::before { width: 3px; }
.choices button.dimmed { opacity: .3; }
.choices .hint2 { color: #8f8f8f; font-size: 12px; font-weight: 400; }
</style>
