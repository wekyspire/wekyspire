<template>
  <transition name="fade">
    <div class="cutscene-overlay" v-if="isVisible">
      <div class="cutscene-screen">
        <transition name="image-fade" mode="out-in">
          <img :src="currentImage" :alt="currentImage" class="cutscene-image" v-if="showImage" :key="currentImage" />
        </transition>
      </div>
    </div>
  </transition>
</template>

<script>
import frontendEventBus from '../../frontendEventBus.js';

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
      cutsceneImageIndex: 0,
      cutsceneEvent: null,
      fadeTimeout: null,
      previousStage: '',
      showImage: true
    };
  },
  mounted() {
    // 监听display-cutscene事件
    frontendEventBus.on('display-cutscene', (cutsceneEvent) => {
      if(this.cutsceneEvent) {
        console.error('CutsceneScreen: 尝试显示新的cutscene事件时，当前已存在一个cutscene事件');
        return ;
      }
      this.cutsceneEvent = cutsceneEvent;
      this.currentImage = '';
      this.cutsceneImageIndex = 0;
      this.isVisible = true;
    
      setTimeout(()=>{
        this.currentImage = this.cutsceneEvent.images[this.cutsceneImageIndex];
        this.showImage = true;
        const interval = setInterval(()=>{
          this.showImage = false;
          setTimeout(() => {
            this.cutsceneImageIndex++;
            if(this.cutsceneImageIndex < this.cutsceneEvent.images.length){
              this.currentImage = this.cutsceneEvent.images[this.cutsceneImageIndex];
            } else {
              this.cutsceneImageIndex = 0;
              this.currentImage = '';
              clearInterval(interval);
              setTimeout(()=> {
                this.cutsceneEvent?.onEnd?.();
                this.cutsceneEvent = null;
                this.isVisible = false;
              }, 1000);
              return;
            }
            this.showImage = true;
          }, 500);
        }, this.cutsceneEvent.interval || 3000);
      }, 1000);
    });
    
    // 监听游戏阶段变化（如需）
    this.previousStage = this.gameState.gameStage;
  },
  beforeUnmount() {
    // 移除事件监听
    frontendEventBus.off('display-cutscene', this.onCutsceneEnd);
    // 清除定时器
    if (this.fadeTimeout) {
      clearTimeout(this.fadeTimeout);
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
  z-index: var(--z-cutscene);
}

.fade-enter-active, .fade-leave-active {
  transition: opacity 1s ease;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}

.image-fade-enter-active, .image-fade-leave-active {
  transition: opacity 0.5s ease;
}
.image-fade-enter-from, .image-fade-leave-to {
  opacity: 0;
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