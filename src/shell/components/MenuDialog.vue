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
  background: rgba(8, 11, 18, .97);
  border: 1px solid #2f3a52; border-radius: 3px;   /* 扁平：面板不做大圆角 */
  box-shadow: 0 18px 60px rgba(0, 0, 0, .6);
  animation: menu-dialog-in .18s ease-out both;
}
@keyframes menu-dialog-in {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: none; }
}
.menu-dialog-title {
  margin: 0 0 8px; font-size: 17px; color: #eef4ff; letter-spacing: .06em;
}
.menu-dialog-message { margin: 0 0 14px; font-size: 13px; line-height: 1.6; color: #c3cee0; }
.menu-dialog-input {
  width: 100%; box-sizing: border-box; margin-bottom: 14px;
  padding: 8px 12px; font-size: 14px; color: #eef2ff;
  background: #131a29; border: 1px solid #3f5f8c; border-radius: 3px; outline: none;
}
.menu-dialog-input:focus { border-color: #8fb6dd; }
.menu-dialog-actions { display: flex; justify-content: flex-end; gap: 10px; }
.menu-dialog-btn {
  min-width: 88px; padding: 7px 18px; font-size: 14px; cursor: pointer; border-radius: 4px;
  transition: background .15s, border-color .15s;
}
.menu-dialog-btn.confirm {
  background: rgba(52, 84, 126, .95);
  border: 1px solid #8fb6dd; color: #ffffff;
}
.menu-dialog-btn.cancel {
  background: rgba(16, 22, 34, .92); border: 1px solid #3f5f8c; color: #dbe4f4;
}
.menu-dialog-btn:hover { background: rgba(70, 108, 156, .95); border-color: #a8c9ea; }
</style>
