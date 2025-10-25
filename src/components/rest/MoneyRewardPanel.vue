<template>
  <div class="money-reward-panel" key="panel" @click="claimReward">
    <h2>金币！</h2>
    <p>💰 +{{ amount }}</p>
  </div>
</template>

<script>
import backendEventBus, { EventNames } from '../../backendEventBus.js';

export default {
  name: 'MoneyRewardPanel',
  props: {
    amount: {
      type: Number,
      default: 0
    }
  },
  methods: {
    claimReward() {
      backendEventBus.emit(EventNames.PlayerOperations.CLAIM_MONEY);
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
</style>