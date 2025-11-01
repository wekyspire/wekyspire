<template>
  <HurtAnimationWrapper :unit="enemy" ref="hurtAnimation">
    <div class="enemy-status-panel" ref="enemyPanel">
      <div class="enemy-avatar">
          <img v-if="enemy.avatarUrl" :src="enemy.avatarUrl" :alt="enemy.name" class="avatar-image" />
          <div v-else class="avatar-placeholder"></div>
          <!-- 敌人意图（悬浮在头像下边沿） -->
          <div class="intention-bar">
            <div v-for="(icon, idx) in intentionIcons" :key="idx" class="intention-item"
                 @mouseenter="onIntentionEnter($event, icon)"
                 @mousemove="onIntentionMove($event)"
                 @mouseleave="onIntentionLeave">
              <span class="intention-emoji">{{ icon.emoji }}</span>
              <span v-if="icon.text" class="intention-text">{{ icon.text }}</span>
            </div>
          </div>
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
import frontendEventBus from '@/frontendEventBus.js';

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
  computed: {
    intentionIcons() {
      const list = (typeof this.enemy.getIntention === 'function') ? (this.enemy.getIntention() || []) : [];
      // Map intentions to visual icons and short texts
      return list.map(int => {
        switch (int.type) {
          case 'attack':
            if((int.times || 1) === 1) {
              return { emoji: '🗡️', text: `${int.damage || '？'}`, detail: `下回合此敌人将攻击，造成 ${int.damage || "？"} 伤害` };
            }
            return { emoji: '🗡️', text: `${int.times || 1}x${int.damage || "？"}`, detail: `下回合此敌人将攻击 ${int.times || 1} 次，每次 ${int.damage || "？"} 伤害` };
          case 'defend':
            return { emoji: '🛡️', text: `${int.amount || ''}`, detail: `下回合此敌人将进行防御` };
          case 'buff':
            return { emoji: '✨', text: '', detail: `下回合此敌人将进行强化` };
          case 'debuff':
            return { emoji: '☠️', text: '', detail: `下回合此敌人将对你施加某种负面效果` };
          default:
            return { emoji: '❓', text: '', detail: '特殊动作' };
        }
      });
    }
  },
  methods: {
    showEnemyInfo(event) {
      // 获取相对于HurtAnimationWrapper的位置
      const wrapper = this.$el.closest('.hurt-animation-wrapper');
      if (wrapper) {
        const wrapperRect = wrapper.getBoundingClientRect();
        const buttonRect = event.target.getBoundingClientRect();
        const relativeX = buttonRect.left - wrapperRect.left + 30;
        const relativeY = buttonRect.top - wrapperRect.top - 10;
        this.enemyInfo = { show: true, x: relativeX, y: relativeY };
      } else {
        this.enemyInfo = { show: true, x: event.clientX + 20, y: event.clientY - 10 };
      }
    },
    hideEnemyInfo() {
      this.enemyInfo.show = false;
    },
    onIntentionEnter(e, icon) {
      const rect = this.$el.getBoundingClientRect();
      frontendEventBus.emit('tooltip:show', {
        name: '意图',
        text: icon.detail || '',
        x: e.clientX,
        y: e.clientY,
        maxWidth: 280
      });
    },
    onIntentionMove(e) {
      frontendEventBus.emit('tooltip:move', { x: e.clientX, y: e.clientY });
    },
    onIntentionLeave() {
      frontendEventBus.emit('tooltip:hide');
    }
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
  position: relative;
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

/* 敌人意图相关样式 */
.intention-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 8px;
  display: flex;
  justify-content: center;
  gap: 8px;
  pointer-events: auto;
}

.intention-item {
  background: rgba(0,0,0,0.55);
  color: #fff;
  border: 1px solid rgba(255,255,255,0.25);
  border-radius: 14px;
  padding: 2px 6px;
  font-size: 23px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.intention-item:hover { background: rgba(0,0,0,0.7); }

.intention-emoji { font-size: 14px; }

.intention-text { font-weight: 600; }
</style>