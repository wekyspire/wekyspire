<template>
  <HurtAnimationWrapper :unit="player" ref="hurtAnimation">
    <div class="player-status-panel" :class="{ 'rest-mode': restScreen }" 
    :style="restScreen ? { backgroundColor: getPlayerTierColor(player.tier), color: getPlayerTierTextColor(player.tier) } : {}">
      <PlayerBasicStats :player="player" />
    
    <HealthBar :unit="player" ref="playerHealthBar" />
    
    <div class="action-points-bar" v-if="!restScreen">
      <div class="action-points-container">
        <span>行动:</span>
        <div 
          v-for="n in player.maxActionPoints" 
          :key="n" 
          :class="['action-point', { 'used': n > player.actionPoints }]"
        ></div>
        <span>{{ player.actionPoints }}/{{ player.maxActionPoints }}</span>
      </div>
    </div>
  
    
    <!-- 效果显示栏 -->
    <EffectDisplayBar 
      v-if="!restScreen"
      :effects="player.effects"
      :target="player"
      @show-tooltip="$emit('show-tooltip', $event)"
      @hide-tooltip="$emit('hide-tooltip')"
    /></div>
  </HurtAnimationWrapper>
</template>

<script>
import EffectDisplayBar from './EffectDisplayBar.vue';
import { getPlayerTierLabel, getPlayerTierColor } from '../utils/tierUtils.js';
import HurtAnimationWrapper from './HurtAnimationWrapper.vue';
import PlayerBasicStats from './PlayerBasicStats.vue';
import HealthBar from './HealthBar.vue';
import eventBus from '../eventBus.js';

export default {
  name: 'PlayerStatusPanel',
  components: {
    EffectDisplayBar,
    HurtAnimationWrapper,
    PlayerBasicStats,
    HealthBar
  },
  props: {
    player: {
      type: Object,
      required: true
    },
    restScreen: {
      type: Boolean,
      default: false
    }
  },
  data() {
    return {
    };
  },
  methods: {
    getPlayerTierLabel,
    getPlayerTierColor,

    getPlayerTierTextColor() {
      if(this.player.tier >= 9) return 'white';
      return 'black';
    },
    
    
    // 播放升级动画
    playLevelUpAnimation() {
      if (!this.restScreen) return;
      
      // 颜色渐变动画
      const panel = this.$el.querySelector('.player-status-panel');
      if (panel) {
        const originalColor = this.getPlayerTierColor(this.player.tier);
        
        // 闪烁效果
        panel.style.transition = 'background-color 0.5s ease';
        panel.style.backgroundColor = '#ffffff';
        
        setTimeout(() => {
          panel.style.backgroundColor = originalColor;
        }, 250);
        
        setTimeout(() => {
          panel.style.backgroundColor = '#ffffff';
        }, 500);
        
        setTimeout(() => {
          panel.style.backgroundColor = originalColor;
          panel.style.transition = '';
        }, 750);
      }
      
      // 从面板上侧和下侧释放金色粒子
      this.spawnGoldenParticles();
    },
    
    spawnGoldenParticles() {
    // 生成金色粒子
      const panelRect = this.$el.getBoundingClientRect();
      const particles = [];
      const particleCount = 50;
      const particleLifetime = 1500;
      const particleSize = 20;
      const extraStyles = {
        zIndex: 0,
        borderRadius: '50%'
      };
      
      // 从上侧释放粒子
      for (let i = 0; i < particleCount; i++) {
        const relX = Math.random();
        const factorX = 1 - 2 * Math.abs(relX - 0.5) + 0.1;
        const factorX2 = factorX * factorX;
        particles.push({
          x: panelRect.left + relX * panelRect.width,
          y: panelRect.top - 10,
          vx: (Math.random() - 0.5) * 30,
          vy: -((Math.random() - 0.5) * 50 + 50) * factorX2,
          color: '#FFD700', // 金色
          size: (Math.random() * particleSize + 5) * factorX2,
          life: particleLifetime,
          opacityFade: true,
          sizeFade: true,
          extraStyles: extraStyles
        });
      }
      
      // 通过事件总线发送粒子生成请求
      eventBus.emit('spawn-particles', particles);
    }
  },
  
  watch: {
    // 监听玩家等阶变化，播放升级动画
    'player.tier'(newTier, oldTier) {
      if (newTier !== oldTier && this.restScreen) {
        this.playLevelUpAnimation();
      }
    },

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
  transition: background-color 0.3s ease;
}

.player-status-panel.rest-mode {
  border: 2px solid #666;
  box-shadow: 0 4px 8px rgba(0,0,0,0.2);
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

</style>