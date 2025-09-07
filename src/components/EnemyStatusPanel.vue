<template>
  <HurtAnimationWrapper :unit="enemy" ref="hurtAnimation">
    <div class="enemy-status-panel" ref="enemyPanel">
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
      <div class="stat">
        <span class="stat-label">🔮 灵能:</span>
        <span class="stat-value">{{ enemy.magic }}</span>
      </div>
    </div>
    
    <div class="health-bar">
      <span>生命值: {{ enemy.hp }}/{{ enemy.maxHp }}</span>
      <div class="bar">
        <div class="fill" :style="{ width: (enemy.hp / enemy.maxHp * 100) + '%' }"></div>
      </div>
    </div>
    
    <!-- 敌人伤害文本容器 -->
    <div class="damage-text-container" ref="enemyDamageTextContainer"></div>
    
    <!-- 效果显示栏 -->
    <EffectDisplayBar 
      :effects="enemy.effects"
      :target="'enemy'"
      @show-tooltip="$emit('show-tooltip', $event)"
      @hide-tooltip="$emit('hide-tooltip')"
    />
    
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
          <div class="stat">
            <span class="stat-label">🔮 灵能强度:</span>
            <span class="stat-value">{{ enemy.magic }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
  </HurtAnimationWrapper>
</template>

<script>
import EffectDisplayBar from './EffectDisplayBar.vue';
import HurtAnimationWrapper from './HurtAnimationWrapper.vue';

export default {
  name: 'EnemyStatusPanel',
  components: {
    EffectDisplayBar,
    HurtAnimationWrapper
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
  methods: {
    showEnemyInfo(event) {
      const rect = event.target.getBoundingClientRect();
      this.enemyInfo = {
        show: true,
        x: rect.left + 20,
        y: rect.top - 10
      };
    },
    
    hideEnemyInfo() {
      this.enemyInfo.show = false;
    },
    
    createDamageText(damage, type = 'damage') {
      const container = this.$refs.enemyDamageTextContainer;
      if (!container) return;

      const damageText = document.createElement('div');
      damageText.className = `damage-text ${type}`;
      damageText.textContent = type === 'heal' ? `+${damage}` : `-${damage}`;
      
      // 随机位置
      const randomX = Math.random() * 40 - 20;
      const randomY = Math.random() * 20 - 10;
      damageText.style.left = `calc(50% + ${randomX}px)`;
      damageText.style.top = `calc(50% + ${randomY}px)`;
      
      container.appendChild(damageText);
      
      // 动画结束后移除
      setTimeout(() => {
        if (damageText.parentNode) {
          damageText.parentNode.removeChild(damageText);
        }
      }, 1000);
    }
  }
};
</script>

<style scoped>
.enemy-status-panel {
  flex: 1;
  border: 1px solid #ccc;
  padding: 15px;
  border-radius: 8px;
  background-color: #fff;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  z-index: 1;
}

.enemy-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
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

.health-bar {
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
  z-index: 1000;
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
  position: fixed;
  background-color: rgba(0, 0, 0, 0.9);
  color: white;
  padding: 15px;
  border-radius: 8px;
  z-index: 1000;
  min-width: 250px;
  max-width: 400px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
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