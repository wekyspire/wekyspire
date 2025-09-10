<template>
  <transition-group name="slide" tag="div" class="breakthrough-reward-panel-wrapper">
    <div class="breakthrough-reward-panel" v-if="isVisible" key="panel" @click="claimReward">
      <h2>🥇突破！</h2>
    </div>
  </transition-group>
</template>

<script>
import { upgradePlayerTier } from '../data/player.js';
import { gameState } from '../data/gameState.js';

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
  border: 1px solid #f44336; /* 红色边框 */
  padding: 20px;
  background: linear-gradient(135deg, #ffebee, #ffcdd2); /* 红色渐变背景 */
  margin: 20px 0;
  flex: 3;
  box-shadow: 0 4px 8px rgba(244, 67, 54, 0.3);
  border-radius: 8px;
}

.breakthrough-reward-panel h2 {
  text-align: center;
  margin-bottom: 20px;
  color: rgb(255, 255, 255); /* 白色文字 */
}

.current-tier {
  font-size: 1.5em;
  font-weight: bold;
  margin-bottom: 20px;
  color: #666;
}

.breakthrough-reward-panel {
  border: 1px solid #540600; /* 红色边框 */
  padding: 20px;
  background: #9f0018; /* 红色背景 */
  margin: 20px 0;
  flex: 3;
  box-shadow: 0 4px 8px rgba(153, 10, 0, 0.5);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s ease;
  position: relative;
  overflow: hidden;
}

.breakthrough-reward-panel:hover {
  background: red;
  box-shadow: 0 6px 12px rgba(232, 15, 0, 0.5);
  transform: translateY(-2px);
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

/* 为transition-group添加样式 */
.breakthrough-reward-panel-wrapper {
  display: flex;
  justify-content: center;
}
</style>