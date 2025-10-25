<template>
  <div class="dialog-overlay" v-if="isVisible">
    <div class="dialog-screen">
      <div class="character-avatar">
        <img :src="currentDialog.avatar" :alt="currentDialog.character" v-if="currentDialog.avatar">
        <div v-else class="placeholder-avatar">{{ currentDialog.character }}</div>
      </div>
      <div class="dialog-content">
        <h3>{{ currentDialog.character }}</h3>
        <p><ColoredText :text="currentDialog.text" /></p>
        <button @click="nextDialog">继续</button>
      </div>
    </div>
  </div>
</template>

<script>
import frontendEventBus from '../../frontendEventBus.js';
import ColoredText from '../global/ColoredText.vue';

export default {
  name: 'DialogScreen',
  components: {
    ColoredText
  },
  data() {
    return {
      isVisible: false,
      currentDialog: {
        character: '',
        text: '',
        avatar: ''
      },
      dialogSequence: [],
      dialogIndex: 0
    };
  },
  mounted() {
    // 监听display-dialog事件
    frontendEventBus.on('display-dialog', (dialogSequence) => {
      this.dialogSequence = dialogSequence;
      this.dialogIndex = 0;
      this.currentDialog = this.dialogSequence[this.dialogIndex];
      this.isVisible = true;
    });
  },
  beforeUnmount() {
    // 移除事件监听
    frontendEventBus.off('display-dialog', this.onClose);
  },
  methods: {
    nextDialog() {
      // 检查是否还有更多对话
      if (this.dialogIndex < this.dialogSequence.length - 1) {
        // 显示下一个对话
        this.dialogIndex++;
        this.currentDialog = this.dialogSequence[this.dialogIndex];
      } else {
        // 对话结束，隐藏对话框
        this.isVisible = false;
        this.dialogSequence = [];
        this.dialogIndex = 0;
        
        // 触发对话结束事件（前端事件总线）
        frontendEventBus.emit('dialog-ended');
      }
      this.$emit('next-dialog');
    }
  }
};
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: flex-end;
  z-index: var(--z-dialog);
}

.dialog-screen {
  background-color: white;
  width: 80%;
  max-width: 600px;
  border-radius: 10px;
  display: flex;
  padding: 20px;
  margin-bottom: 20px;
}

.character-avatar {
  width: 100px;
  height: 100px;
  margin-right: 20px;
}

.character-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
}

.placeholder-avatar {
  width: 100%;
  height: 100%;
  background-color: #eee;
  border-radius: 50%;
  display: flex;
  justify-content: center;
  align-items: center;
  font-weight: bold;
}

.dialog-content {
  flex: 1;
}

.dialog-content h3 {
  margin-top: 0;
}

button {
  padding: 10px 20px;
  float: right;
}
</style>