<template>
  <div class="boss-showup-overlay" v-if="showAnimation">
    <img :src="bossCoverImageUrl" class="boss-cover-image" />
  </div>
</template>

<script>
import frontendEventBus from '../../frontendEventBus.js';

export default {
  name: 'BossShowupAnimation',
  data() {
    return {
      showAnimation: false,
      bossCoverImageUrl: '',
    };
  },
  mounted() {
    frontendEventBus.on('play-boss-showup-animation', (bossClass, bossCoverImageUrl) => {
      this.playAnimation(bossClass, bossCoverImageUrl);
    });
  },
  beforeUnmount() {
    frontendEventBus.off('play-boss-showup-animation', this.onAnimationEnd);
  },
  methods: {
    playAnimation(bossClass, bossCoverImageUrl) {
      this.bossCoverImageUrl = bossCoverImageUrl;
      this.showAnimation = true;
      
      // 播放动画，3秒后隐藏
      setTimeout(() => {
        this.showAnimation = false;
      }, 3000);
    }
  }
}
</script>

<style scoped>
.boss-showup-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.8);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: var(--z-boss);
}

.boss-cover-image {
  max-width: 90%;
  max-height: 90%;
  object-fit: contain;
  animation: fadeIn 0.5s ease-in-out, fadeOut 0.5s ease-in-out 2.5s forwards;
}

@keyframes fadeIn {
  from { opacity: 0; transform: scale(0.8); }
  to { opacity: 1; transform: scale(1); }
}

@keyframes fadeOut {
  from { opacity: 1; }
  to { opacity: 0; }
}
</style>