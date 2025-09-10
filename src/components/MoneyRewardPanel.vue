<template>
  <transition-group name="slide" tag="div" class="money-reward-panel-wrapper">
    <div class="money-reward-panel" v-if="isVisible" key="panel" @click="claimReward">
      <h2>金币！</h2>
      <p>💰 +{{ amount }}</p>
    </div>
  </transition-group>
</template>

<script>
import { claimMoney } from '../data/rest.js';

export default {
  name: 'MoneyRewardPanel',
  props: {
    isVisible: {
      type: Boolean,
      default: false
    },
    amount: {
      type: Number,
      default: 0
    }
  },
  methods: {
    claimReward() {
      claimMoney();
      this.$emit('claimed');
    }
  }
}
</script>

<style scoped>

.money-reward-panel h2 {
  color: #853300; /* 金色文字 */
  text-align: center;
  margin-bottom: 15px;
}

.money-reward-panel p {
  color: #b8860b; /* 深金色文字 */
  font-size: 1.1em;
  text-align: center;
  margin-bottom: 15px;
}

.money-reward-panel {
  border: 1px solid #df7700; /* 金色边框 */
  padding: 20px;
  background: linear-gradient(135deg, #e8bf73, #e5db7a); /* 金色渐变背景 */
  margin: 20px 0;
  flex: 3;
  border-radius: 8px;
  box-shadow: 0 4px 8px rgba(212, 175, 55, 0.3);
  cursor: pointer;
  transition: all 0.3s ease;
}

.money-reward-panel:hover {
  background: linear-gradient(135deg, #ffd587, #f0e68c);
  box-shadow: 0 6px 12px rgba(212, 175, 55, 0.5);
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
.money-reward-panel-wrapper {
  display: flex;
  justify-content: center;
}
</style>