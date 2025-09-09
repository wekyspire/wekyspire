<template>
  <transition name="slide">
    <div class="money-reward-panel" v-if="isVisible">
      <h2>金钱奖励</h2>
      <p>获得金钱: +{{ amount }}</p>
      <button @click="claimReward">领取</button>
    </div>
  </transition>
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
.money-reward-panel {
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