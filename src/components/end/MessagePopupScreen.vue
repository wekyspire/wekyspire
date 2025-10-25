<template>
  <div class="message-popup-container">
    <transition-group name="message-popup" tag="div">
      <div 
        v-for="message in messages" 
        :key="message.id" 
        class="message-popup"
        :class="message.type"
      >
        {{ message.text }}
      </div>
    </transition-group>
  </div>
</template>

<script>
import frontendEventBus from '../../frontendEventBus.js';

export default {
  name: 'MessagePopupScreen',
  data() {
    return {
      messages: [],
      messageId: 0
    };
  },
  mounted() {
    // 监听pop-message事件
    frontendEventBus.on('pop-message', (message) => {
      this.addMessage(message);
    });
  },
  beforeUnmount() {
    // 移除事件监听
    frontendEventBus.off('pop-message');
  },
  methods: {
    addMessage(message) {
      const id = this.messageId++;
      const newMessage = {
        id,
        text: message.text,
        type: message.type || 'info', // 默认为info类型
        duration: message.duration || 3000 // 默认持续3秒
      };
      
      this.messages.push(newMessage);
      
      // 设置自动移除
      setTimeout(() => {
        this.removeMessage(id);
      }, newMessage.duration);
    },
    removeMessage(id) {
      const index = this.messages.findIndex(msg => msg.id === id);
      if (index !== -1) {
        this.messages.splice(index, 1);
      }
    }
  }
};
</script>

<style scoped>
.message-popup-container {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: var(--z-message);
  display: flex;
  flex-direction: column-reverse; /* 新消息显示在上面 */
  align-items: center;
  pointer-events: none; /* 防止阻挡其他元素的交互 */
}

.message-popup {
  padding: 10px 20px;
  margin: 5px 0;
  border-radius: 5px;
  color: white;
  font-weight: bold;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
  opacity: 0.9;
  pointer-events: auto; /* 允许消息本身的交互 */
  transition: all 0.3s ease;
}

.message-popup.info {
  background-color: #2196F3; /* 蓝色 */
}

.message-popup.success {
  background-color: #4CAF50; /* 绿色 */
}

.message-popup.warning {
  background-color: #FF9800; /* 橙色 */
}

.message-popup.error {
  background-color: #F44336; /* 红色 */
}

/* 进入和离开动画 */
.message-popup-enter-active, .message-popup-leave-active {
  transition: all 0.3s ease;
}

.message-popup-enter-from {
  opacity: 0;
  transform: translateY(20px);
}

.message-popup-leave-to {
  opacity: 0;
  transform: translateY(-20px);
}
</style>