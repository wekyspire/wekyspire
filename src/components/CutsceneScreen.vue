<template>
  <div class="cutscene-overlay" v-if="isVisible">
    <div class="cutscene-screen">
      <img :src="currentImage" :alt="currentImage" class="cutscene-image" />
    </div>
  </div>
</template>

<script>
import eventBus from '../eventBus.js';
import { gameState } from '../data/gameState.js';

export default {
  name: 'CutsceneScreen',
  props: {
    gameState: {
      type: Object,
      required: true
    }
  },
  data() {
    return {
      isVisible: false,
      currentImage: '',
      fadeTimeout: null,
      previousStage: ''
    };
  },
  mounted() {
    // 监听display-cutscene事件
    eventBus.on('display-cutscene', (imagePath) => {
      this.currentImage = imagePath;
      this.isVisible = true;
      
      // 3秒后自动关闭过场动画
      this.fadeTimeout = setTimeout(() => {
        this.isVisible = false;
        eventBus.emit('cutscene-ended');
      }, 3000);
    });
    
    // 监听游戏阶段变化
    this.previousStage = gameState.gameStage;
  },
  beforeUnmount() {
    // 移除事件监听
    eventBus.off('display-cutscene');
    
    // 清除定时器
    if (this.fadeTimeout) {
      clearTimeout(this.fadeTimeout);
    }
  },
  watch: {
    'gameState.gameStage'(newStage, oldStage) {
      // 当游戏阶段发生变化时，显示过场动画
      if (oldStage !== newStage) {
        // 设置过场图片路径（根据阶段变化）
        let imagePath = '';
        if (oldStage === 'start' && newStage === 'battle') {
          imagePath = '/src/assets/images/start_to_battle.svg';
        } else if (oldStage === 'battle' && newStage === 'rest') {
          imagePath = '/src/assets/images/battle_to_rest.svg';
        } else if (oldStage === 'rest' && newStage === 'battle') {
          imagePath = '/src/assets/images/rest_to_battle.svg';
        } else if (oldStage === 'battle' && newStage === 'end') {
          imagePath = '/src/assets/images/battle_to_end.svg';
        } else {
          // 默认图片或不显示过场动画
          return;
        }
        
        // 显示过场动画
        this.currentImage = imagePath;
        this.isVisible = true;
        
        // 3秒后自动关闭过场动画
        this.fadeTimeout = setTimeout(() => {
          this.isVisible = false;
          eventBus.emit('cutscene-ended');
        }, 3000);
      }
    }
  }
};
</script>

<style scoped>
.cutscene-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: black;
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 900; /* 低于DialogScreen的1000 */
  opacity: 0;
  animation: fadeInOut 3s ease-in-out;
}

@keyframes fadeInOut {
  0% { opacity: 0; }
  20% { opacity: 1; }
  80% { opacity: 1; }
  100% { opacity: 0; }
}

.cutscene-screen {
  display: flex;
  justify-content: center;
  align-items: center;
}

.cutscene-image {
  max-width: 90%;
  max-height: 90%;
  object-fit: contain;
}
</style>