<script setup>
// 菜单级全局模态弹窗（渲染层）：App.vue 全局挂载一次，状态/语义见 menuDialog.js。
// 遮罩 + 居中窗口；visual 语言沿用 run-panel（暗板/金色调按钮）。打开时自动聚焦输入框。
import { ref, watch, nextTick, onBeforeUnmount } from 'vue';
import { menuDialogState, confirmMenuDialog, cancelMenuDialog } from '../menuDialog.js';

const s = menuDialogState();
const inputEl = ref(null);

function onKey(e) {
  if (e.key === 'Escape') cancelMenuDialog();
  else if (e.key === 'Enter' && s.mode !== 'input') confirmMenuDialog(); // input 模式 Enter 由输入框接
}

watch(() => s.open, (open) => {
  if (open) {
    window.addEventListener('keydown', onKey);
    nextTick(() => inputEl.value?.focus());
  } else {
    window.removeEventListener('keydown', onKey);
  }
});
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div v-if="s.open" class="menu-dialog-mask" @click.self="cancelMenuDialog()">
    <div class="menu-dialog" role="dialog" :aria-label="s.title || '确认'">
      <h3 v-if="s.title" class="menu-dialog-title">{{ s.title }}</h3>
      <p v-if="s.message" class="menu-dialog-message">{{ s.message }}</p>
      <input
        v-if="s.mode === 'input'" ref="inputEl" v-model="s.inputValue"
        class="menu-dialog-input" :placeholder="s.placeholder" spellcheck="false"
        @keydown.enter.prevent="confirmMenuDialog()"
      />
      <div class="menu-dialog-actions">
        <button v-if="s.mode !== 'confirm'" class="menu-dialog-btn cancel" @click="cancelMenuDialog()">
          {{ s.cancelText }}
        </button>
        <button class="menu-dialog-btn confirm" @click="confirmMenuDialog()">{{ s.confirmText }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.menu-dialog-mask {
  position: fixed; inset: 0; z-index: 60;
  background: rgba(4, 6, 12, .55);
  display: flex; align-items: center; justify-content: center;
  font-family: sans-serif;
}
.menu-dialog {
  width: min(420px, 88vw); padding: 20px 26px 18px;
  background: rgba(10, 14, 26, .96);
  border: 1px solid #38415e; border-radius: 14px;
  box-shadow: 0 18px 60px rgba(0, 0, 0, .6), inset 0 1px 0 rgba(255, 255, 255, .04);
  animation: menu-dialog-in .18s ease-out both;
}
@keyframes menu-dialog-in {
  from { opacity: 0; transform: translateY(10px) scale(.97); }
  to { opacity: 1; transform: none; }
}
.menu-dialog-title {
  margin: 0 0 8px; font-size: 17px; color: #ffd75e; letter-spacing: .08em;
  text-shadow: 0 0 14px rgba(255, 215, 94, .22);
}
.menu-dialog-message { margin: 0 0 14px; font-size: 13px; line-height: 1.6; color: #cdd6f4; }
.menu-dialog-input {
  width: 100%; box-sizing: border-box; margin-bottom: 14px;
  padding: 8px 12px; font-size: 14px; color: #eef2ff;
  background: #171d31; border: 1px solid #4a587f; border-radius: 8px; outline: none;
}
.menu-dialog-input:focus { border-color: #ffd75e; }
.menu-dialog-actions { display: flex; justify-content: flex-end; gap: 10px; }
.menu-dialog-btn {
  min-width: 88px; padding: 7px 18px; font-size: 14px; cursor: pointer; border-radius: 8px;
  transition: filter .15s;
}
.menu-dialog-btn.confirm {
  background: linear-gradient(180deg, #95601c, #7a4b12);
  border: 1px solid #b3742a; color: #ffe7b3; letter-spacing: .06em;
}
.menu-dialog-btn.cancel {
  background: #2c3554; border: 1px solid #56628f; color: #cdd6f4;
}
.menu-dialog-btn:hover { filter: brightness(1.18); }
</style>
