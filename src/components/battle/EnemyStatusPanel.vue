<template>
  <HurtAnimationWrapper :unit="enemy" ref="hurtAnimation">
    <div class="enemy-status-panel" ref="enemyPanel">
      <div class="enemy-avatar">
          <img v-if="enemy.avatarUrl" :src="enemy.avatarUrl" :alt="enemy.name" class="avatar-image" />
          <div v-else class="avatar-placeholder"></div>
      </div>
      <div class="enemy-details">
        <div class="enemy-header">
          <div>
            <h2 style="color: red; display: inline-block;">敌人：{{ enemy.name }}</h2>
            <span v-if="enemy.isBoss" class="enemy-subtitle"> - {{ enemy.subtitle }}</span>
          </div>
          <div class="enemy-info-button" @mouseenter="showEnemyInfo" @mouseleave="hideEnemyInfo">?</div>
        </div>
      
      <div class="enemy-stats">
        <div class="stat">
          <span class="stat-label">⚔️ 攻击:</span>
          <span class="stat-value">{{ enemy.attack }}</span>
        </div>
        <div class="stat">
          <span class="stat-label">🛡️ 防御:</span>
          <span class="stat-value">{{ enemy.defense }}</span>
        </div>
      </div>
      <!-- 效果显示栏 -->
      <EffectDisplayBar 
        :effects="enemy.effects"
        :target="enemy"
        @show-tooltip="$emit('show-tooltip', $event)"
        @hide-tooltip="$emit('hide-tooltip')"
      />
      <HealthBar :unit="enemy" class="enemy" />
      
    </div>
    <!-- 敌人信息悬浮框 -->
    <div 
      v-if="enemyInfo.show" 
      class="enemy-info-tooltip" 
      :style="{ left: enemyInfo.x + 'px', top: enemyInfo.y + 'px' }"
    >
      <div class="enemy-info-content">
        <h3>{{ enemy.name }}</h3>
        <p v-if="enemy.subtitle">{{ enemy.subtitle }}</p>
        <p>{{ enemy.description }}</p>
        <div class="enemy-info-stats">
          <div class="stat">
            <span class="stat-label">⚔️ 攻击力:</span>
            <span class="stat-value">{{ enemy.attack }}</span>
          </div>
          <div class="stat">
            <span class="stat-label">🛡️ 防御力:</span>
            <span class="stat-value">{{ enemy.defense }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
  </HurtAnimationWrapper>
</template>

<script>
import EffectDisplayBar from '../global/EffectDisplayBar.vue';
import HurtAnimationWrapper from '../global/HurtAnimationWrapper.vue';
import HealthBar from '../global/HealthBar.vue';
import Enemy from "../../data/enemy";

export default {
  name: 'EnemyStatusPanel',
  components: {
    EffectDisplayBar,
    HurtAnimationWrapper,
    HealthBar
  },
  props: {
    enemy: {
      type: Object,
      required: true
    }
  },
  data() {
    return {
      enemyInfo: {
        show: false,
        x: 0,
        y: 0
      }
    };
  },
  watch: {

  },
  methods: {
    showEnemyInfo(event) {
      // 获取相对于HurtAnimationWrapper的位置
      const wrapper = this.$el.closest('.hurt-animation-wrapper');
      if (wrapper) {
        const wrapperRect = wrapper.getBoundingClientRect();
        const buttonRect = event.target.getBoundingClientRect();
        
        // 计算相对于wrapper的位置
        const relativeX = buttonRect.left - wrapperRect.left + 30;
        const relativeY = buttonRect.top - wrapperRect.top - 10;
        
        this.enemyInfo = {
          show: true,
          x: relativeX,
          y: relativeY
        };
      } else {
        // 如果没有找到wrapper，使用绝对定位作为fallback
        this.enemyInfo = {
          show: true,
          x: event.clientX + 20,
          y: event.clientY - 10
        };
      }
    },
    
    hideEnemyInfo() {
      this.enemyInfo.show = false;
    },
    

  }
};
</script>

<style scoped>
.enemy-status-panel {
  display: flex;
  align-items: center;
  border: 1px solid #ccc;
  border-radius: 8px;
  background-color: #fff;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  height: 252px;
}

.enemy-details {
  padding-right: 20px;
  padding-left: 20px;
  min-width: 300px;
  height: 230px;
}

.enemy-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.enemy-avatar {
  width: 350px;
  height: 250px;
}

.avatar-image {
  object-fit:cover;
  width: inherit;
  height: inherit;
}

.avatar-placeholder {
  object-fit:cover;
  width: inherit;
  height: inherit;
  background-color: #000;
}

.enemy-info-button {
  cursor: pointer;
  background-color: #f0f0f0;
  border: 1px solid #ccc;
  border-radius: 50%;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  color: #666;
  flex-shrink: 0;
}

.enemy-info-button:hover {
  background-color: #e0e0e0;
}

.enemy-subtitle {
  font-size: 14px;
  color: #666;
  font-weight: normal;
}

.enemy-stats {
  display: flex;
  gap: 20px;
  margin-bottom: 10px;
}

.stat {
  display: flex;
  align-items: center;
  margin-right: 15px;
}

.stat-label {
  font-weight: bold;
  margin-right: 5px;
}

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
  margin-bottom: 10px;
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
  background-color: #f44336;
  transition: width 0.3s ease;
}

.damage-text-container {
  position: relative;
  height: 0;
  overflow: visible;
  pointer-events: none;
}

.damage-text {
  position: absolute;
  font-weight: bold;
  font-size: 24px;
  pointer-events: none;
  z-index: var(--z-tooltip);
  animation: damageFloat 1s ease-out forwards;
}

@keyframes damageFloat {
  0% {
    opacity: 1;
    transform: translateY(0);
  }
  100% {
    opacity: 0;
    transform: translateY(-50px);
  }
}

/* 敌人信息悬浮框 */
.enemy-info-tooltip {
  position: absolute;
  background-color: rgba(0, 0, 0, 0.9);
  color: white;
  padding: 15px;
  border-radius: 8px;
  z-index: var(--z-tooltip);
  min-width: 250px;
  max-width: 400px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  left: v-bind('enemyInfo.x + "px"');
  top: v-bind('enemyInfo.y + "px"');
}

.enemy-info-content h3 {
  margin-top: 0;
  margin-bottom: 10px;
  color: #ff6666;
}

.enemy-info-content p {
  margin: 5px 0;
  font-size: 0.9em;
  line-height: 1.4;
}

.enemy-info-stats {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid #555;
}

.enemy-info-stats .stat {
  margin-right: 20px;
  margin-bottom: 5px;
}
</style>