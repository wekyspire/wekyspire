<template>
  <transition name="slide">
    <div class="breakthrough-reward-panel" v-if="isVisible">
      <h2>突破奖励</h2>
      <p>恭喜！你的角色获得了突破！</p>
      <button @click="claimReward">领取</button>
    </div>
  </transition>
</template>

<script>
import { upgradePlayerTier } from '../data/player.js';
import gameState from '../data/gameState.js';

export default {
  name: 'BreakthroughRewardPanel',
  props: {
    isVisible: {
      type: Boolean,
      default: false
    }
  },
  methods: {
    claimReward() {
      gameState.rewards.breakthrough = false;
      upgradePlayerTier(gameState.player);
      this.$emit('claimed');
    }
  }
}
</script>

<style scoped>
.breakthrough-reward-panel {
  border: 1px solid #ccc;
  padding: 20px;
  background-color: #f9f9f9;
  margin: 20px 0;
  flex: 3;
}

/* 滑动进入和退出动画 */
.slide-enter-active, .slide-leave-active {
  transition: all 0.5s ease;
}

.slide-enter-from {
  transform: translateY(100%);
  opacity: 0;
}

.slide-leave-to {
  transform: translateY(-100%);
  opacity: 0;
}

.slide-enter-to, .slide-leave-from {
  transform: translateY(0);
  opacity: 1;
}
</style>