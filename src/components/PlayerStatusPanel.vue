<template>
  <HurtAnimationWrapper :unit="player" ref="hurtAnimation">
    <div class="player-status-panel">
      <div class="player-stats">
        <div class="stat">
          <span class="stat-label">💰 金钱:</span>
          <span class="stat-value">{{ player.money }}</span>
        </div>
      <div class="stat">
        <span class="stat-label">🔮 魏启:</span>
        <span class="stat-value">{{ player.mana }}/{{ player.maxMana }}</span>
      </div>
      <div class="stat">
        <span class="stat-label">⚔️ 攻击力:</span>
        <span class="stat-value">{{ player.attack }}</span>
      </div>
      <div class="stat">
        <span class="stat-label">🛡️ 防御力:</span>
        <span class="stat-value">{{ player.defense }}</span>
      </div>
      <div class="stat">
        <span class="stat-label">🏅 等阶:</span>
        <span class="stat-value">{{ getPlayerTierLabel(player.tier) }}</span>
      </div>
    </div>
    
    <div class="health-bar" ref="playerHealthBar">
      <span>生命值: {{ player.hp }}/{{ player.maxHp }}</span>
      <div class="bar">
        <div class="fill" :style="{ width: (player.hp / player.maxHp * 100) + '%' }"></div>
      </div>
    </div>
    
    <div class="action-points-bar">
      <div class="action-points-container">
        <span>行动点数:</span>
        <div 
          v-for="n in player.maxActionPoints" 
          :key="n" 
          :class="['action-point', { 'used': n > player.actionPoints }]"
        ></div>
        <span>{{ player.actionPoints }}/{{ player.maxActionPoints }}</span>
      </div>
    </div>
    
    <!-- 玩家伤害文本容器 -->
    <div class="damage-text-container" ref="playerDamageTextContainer"></div>
    
    <!-- 效果显示栏 -->
    <EffectDisplayBar 
      :effects="player.effects"
      :target="'player'"
      @show-tooltip="$emit('show-tooltip', $event)"
      @hide-tooltip="$emit('hide-tooltip')"
    /></div>
  </HurtAnimationWrapper>
</template>

<script>
import EffectDisplayBar from './EffectDisplayBar.vue';
import { getPlayerTierLabel } from '../utils/tierUtils.js';
import HurtAnimationWrapper from './HurtAnimationWrapper.vue';

export default {
  name: 'PlayerStatusPanel',
  components: {
    EffectDisplayBar,
    HurtAnimationWrapper
  },
  props: {
    player: {
      type: Object,
      required: true
    }
  },
  methods: {
    getPlayerTierLabel,
    
    createDamageText(damage, type = 'damage') {
      const container = this.$refs.playerDamageTextContainer;
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
.player-status-panel {
  flex: 1;
  border: 1px solid #ccc;
  padding: 15px;
  border-radius: 8px;
  background-color: #fff;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.player-stats {
  display: flex;
  justify-content: space-between;
  margin-bottom: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid #eee;
  flex-wrap: wrap;
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
  background-color: #4caf50;
  transition: width 0.3s ease;
}

.action-points-bar {
  margin-bottom: 10px;
}

.action-points-container {
  display: flex;
  align-items: center;
  gap: 10px;
}

.action-point {
  width: 20px;
  height: 20px;
  background-color: #2196f3;
  border-radius: 50%;
  transition: background-color 0.3s;
}

.action-point.used {
  background-color: #ccc;
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
</style>