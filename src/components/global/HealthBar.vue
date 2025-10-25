<template>
  <div class="health-bar-container">
    <div class="shield-display" :class="{ 'scale-animation': shieldChanged }">
      🛡️ {{ unit.shield }}
    </div>
    <div class="health-bar">
      <span>生命值: {{ unit.hp }}/{{ unit.maxHp }}</span>
      <div class="bar">
        <div class="fill" :style="{ width: (unit.hp / unit.maxHp * 100) + '%' }"></div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'HealthBar',
  props: {
    unit: {
      type: Object,
      required: true
    }
  },
  data() {
    return {
      shieldChanged: false
    };
  },
  watch: {
    // 监听护盾值变化，播放缩放动画
    'unit.shield'(newShield, oldShield) {
      if (newShield !== oldShield) {
        this.playShieldChangeAnimation();
      }
    }
  },
  methods: {
    // 播放护盾变化动画
    playShieldChangeAnimation() {
      this.shieldChanged = true;
      setTimeout(() => {
        this.shieldChanged = false;
      }, 300);
    }
  }
};
</script>

<style scoped>
.health-bar-container {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.shield-display {
  font-size: 16px;
  font-weight: bold;
  color: #1E90FF;
  padding: 4px 8px;
  background-color: rgba(30, 144, 255, 0.1);
  border-radius: 4px;
  border: 1px solid #1E90FF;
  transition: transform 0.3s ease;
}

.shield-display.scale-animation {
  animation: shield-pulse 0.3s ease;
}

@keyframes shield-pulse {
  0% { transform: scale(1); }
  50% { transform: scale(1.2); }
  100% { transform: scale(1); }
}

.health-bar {
  flex: 1;
}

.bar {
  width: 100%;
  height: 20px;
  background-color: #f0f0f0;
  border-radius: 10px;
  overflow: hidden;
  margin-top: 5px;
}

.fill {
  height: 100%;
  background-color: #4caf50;
  transition: width 0.3s ease;
}

/* 特殊样式用于敌人生命条 */
.health-bar.enemy .fill {
  background-color: #f44336;
}
</style>