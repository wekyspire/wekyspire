<script setup>
// 菜单级全局 toast：从底部弹出的无阻塞提示。队列与 3s 寿命由 App.vue 持有
// （provide('showMenuPopup') 推入），本组件只负责渲染与进出/回落动画；
// × 关闭按钮经 close 事件交回 App.vue 移除（与自然寿命同一条移除路径）。
defineProps({
  toasts: { type: Array, default: () => [] }, // [{ id, title, text }]
});
const emit = defineEmits(['close']);
</script>

<template>
  <!-- 容器 pointer-events:none：悬浮提示本体不拦截游戏点击；仅 × 按钮自行放开命中 -->
  <div class="toast-stack" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-for="t in toasts" :key="t.id" class="toast">
        <div class="toast-title">{{ t.title }}</div>
        <div v-if="t.text" class="toast-text">{{ t.text }}</div>
        <button class="toast-close" aria-label="关闭" @click="emit('close', t.id)">×</button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-stack {
  /* 居中用左右锚定而非 translateX(-50%)：TransitionGroup 的 .toast-move/.toast-enter
     都以 transform 承载位移，内联 transform 会整体覆盖样式表的水平居中，
     动画结束回弹——正是堆积时旧通知消失抽搐的根源 */
  position: fixed; bottom: 22px; left: 0; right: 0;
  z-index: 40; display: flex; flex-direction: column; align-items: center; gap: 8px;
  pointer-events: none;
  font-family: sans-serif;
}
.toast {
  position: relative; /* × 按钮的定位锚 */
  width: max-content; max-width: min(420px, 86vw);
  padding: 10px 36px 10px 22px; text-align: center;
  background: rgba(10, 14, 26, .92); border: 1px solid #38415e; border-radius: 10px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, .5);
}
.toast-title { font-size: 15px; color: #ffe7b3; }
.toast-text { font-size: 12px; color: #9aa3c0; margin-top: 4px; }
.toast-close {
  position: absolute; top: 4px; right: 6px;
  pointer-events: auto; /* 容器级 none 的唯一例外 */
  padding: 2px 6px; font-size: 14px; line-height: 1; cursor: pointer;
  color: #9aa3c0; background: none; border: none; border-radius: 4px;
}
.toast-close:hover { color: #ffffff; background: rgba(56, 65, 94, .6); }
/* 进入：从屏幕底缘下方升入；消亡：原地纯淡出并脱流（保持居中靠边距而非 transform，
   绝不用 transform 承载消亡位移——那是堆积回落抽搐的另一半根源），
   同伴经 .toast-move 平滑回落 */
.toast-enter-active { transition: opacity .3s ease, transform .3s ease; }
.toast-enter-from { opacity: 0; transform: translateY(24px); }
.toast-leave-active {
  position: absolute; left: 0; right: 0; margin-inline: auto;
  width: max-content;
  transition: opacity .35s ease;
}
.toast-leave-to { opacity: 0; }
.toast-move { transition: transform .4s ease; }
</style>
