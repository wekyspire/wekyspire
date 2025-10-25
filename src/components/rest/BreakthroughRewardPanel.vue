<template>
  <div class="breakthrough-reward-panel" key="panel" @click="claimReward">
    <h2>🏇突破！</h2>
  </div>
</template>

<script>
import backendEventBus, { EventNames } from '../../backendEventBus.js';

export default {
  name: 'BreakthroughRewardPanel',
  props: {
  },
  methods: {
    claimReward() {
      backendEventBus.emit(EventNames.PlayerOperations.CLAIM_BREAKTHROUGH);
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
</style>