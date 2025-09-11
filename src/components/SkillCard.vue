<template>
  <div 
    class="skill-card"
  >
    <div :class="['skill-card-panel', 'tier-' + skill.tier, { disabled: disabled }]"
     @click="onClick"
     @mouseenter="onMouseEnter"
     @mouseleave="onMouseLeave">
      <div class="mana-cost" v-if="skill.manaCost > 0">
        <span class="mana-icon">💧</span>
        <span class="mana-value" :class="{ 'insufficient-mana': playerMana < skill.manaCost }">{{ skill.manaCost }}</span>
      </div>
      <div class="action-cost" v-if="skill.actionPointCost > 0">
        <span class="action-icon">⚡</span>
        <span class="action-value">{{ skill.actionPointCost }}</span>
      </div>
      <div class="skill-tier">{{ getSkillTierLabel(skill.tier) }}</div>
      <div class="skill-name">{{ skill.name }}</div>
      <div class="skill-description">
        <ColoredText :text="skillDescription" />
      </div>
      <div class="skill-uses">
        <ColoredText v-if="skill.coldDownTurns != 0 && skill.remainingUses != skill.maxUses && !previewMode" :text="`/named{重整} ${skill.remainingColdDownTurns}/${skill.coldDownTurns}`"></ColoredText>
        <ColoredText v-else-if="skill.coldDownTurns != 0" :text="`/named{重整} ${skill.coldDownTurns} 回合`"></ColoredText>
        <ColoredText v-else-if="skill.remainingUses != Infinity" :text="`/named{消耗}`"></ColoredText>
        <br />
        <strong v-if="skill.maxUses === Infinity">无限</strong>
        <span v-else-if="previewMode">(装填 {{ skill.maxUses }}/{{ skill.maxUses }})</span>
        <span v-else>(装填 {{ skill.remainingUses }}/{{ skill.maxUses }})</span>
      </div>
    </div>
  </div>
</template>

<script>
import ColoredText from './ColoredText.vue';
import { getSkillTierLabel } from '../utils/tierUtils.js';
import eventBus from '../eventBus.js';
import gameState from '../data/gameState.js';

export default {
  name: 'SkillCard',
  components: {
    ColoredText
  },
  props: {
    skill: {
      type: Object,
      required: true
    },
    disabled: {
      type: Boolean,
      default: false
    },
    playerMana: {
      type: Number,
      default: Infinity
    },
    previewMode: {
      type: Boolean,
      default: false
    }
  },
  computed: {
    skillDescription() {
      return this.skill.getDescription();
    }
  },
  mounted() {
    if(!this.previewMode) {
      // 初始化时注册事件监听器
      this.onUpdateSkillDescription();
      eventBus.on('update-skill-descriptions', this.onUpdateSkillDescription);
    }
  },
  beforeUnmount() {
    // 组件卸载时移除事件监听器
    if(!this.previewMode) {
      eventBus.off('update-skill-descriptions', this.onUpdateSkillDescription);
    }
  },
  methods: {
    getSkillTierLabel,
    onUpdateSkillDescription() {
      // 监听update-skill-descriptions事件
      if(this.skill) {
        this.skill.description = 
          this.skill.regenerateDescription(gameState.player);
      }
    },
    onClick(event) {
      if (!this.disabled) {
        // 播放技能激活动画
        this.playActivationAnimation();
        
        this.$emit('skill-card-clicked', this.skill, event);
      }
    },
    
    onMouseEnter() {
      // 发射鼠标进入事件
      eventBus.emit('skill-card-hover-start', this.skill);
    },
    
    onMouseLeave() {
      // 发射鼠标离开事件
      eventBus.emit('skill-card-hover-end');
    },
    // 播放技能激活动画
    playActivationAnimation() {
      const card = this.$el;
      if (!card) return;
      
      // 根据技能tier确定动画强度
      const tier = this.skill.tier || 0;
      const intensity = 2;
      
      // 添加动画类
      card.classList.add('activating');
      
      // 设置动画样式
      card.style.animationDuration = `${0.25 / intensity}s`;
      
      // 播放粒子特效
      this.playParticleEffect(tier, card);
      
      // 动画结束后清理
      setTimeout(() => {
        card.classList.remove('activating');
        card.style.animationDuration = '';
      }, 500 / intensity);
    },
    // 播放粒子特效
    playParticleEffect(tier, card) {
      // 根据tier确定粒子参数
      const tierSettings = {
        '-1': { count: 5, size: 3, color: '#ff0000' },   // S
        '0': { count: 15, size: 3, color: '#000000' },     // D
        '1': { count: 20, size: 4, color: '#41db39' },     // C-
        '2': { count: 30, size: 5, color: '#41db39' },    // C+
        '3': { count: 40, size: 6, color: '#759eff' },    // B-
        '4': { count: 50, size: 7, color: '#759eff' },    // B
        '5': { count: 60, size: 8, color: '#d072ff' },    // B+
        '6': { count: 60, size: 9, color: '#d072ff' },    // A-
        '7': { count: 60, size: 10, color: '#ff9059' },   // A
        '8': { count: 60, size: 11, color: '#ff9059' },   // A+
        '9': { count: 60, size: 12, color: '#ff0000' }    // S
      };
      
      const settings = tierSettings[tier] || tierSettings['0'];
      
      // 创建粒子数组
      const particles = [];
      
      // 获取卡片的绝对位置
      const cardRect = card.getBoundingClientRect();
      
      // 生成粒子
      for (let i = 0; i < settings.count; i++) {
        // 随机运动方向和距离，确保粒子向四周逸散
        const distance = 30 + Math.random() * 70; // 随机距离(30-100px)
        const velocity = 10 + Math.random() * 20; // 随机速度
        
        // 计算卡牌边缘的随机起始位置（相对坐标）
        const edge = Math.floor(Math.random() * 4); // 0:上, 1:右, 2:下, 3:左
        let startX, startY;
        
        switch (edge) {
          case 0: // 上边缘
            startX = Math.random() * cardRect.width; // 使用实际卡片宽度
            startY = 0;
            break;
          case 1: // 右边缘
            startX = cardRect.width;
            startY = Math.random() * cardRect.height; // 使用实际卡片高度
            break;
          case 2: // 下边缘
            startX = Math.random() * cardRect.width;
            startY = cardRect.height;
            break;
          case 3: // 左边缘
            startX = 0;
            startY = Math.random() * cardRect.height;
            break;
        }

        // 计算飞离卡牌的方向
        const deltaCenterX = startX - cardRect.width / 2;
        const deltaCenterY = startY - cardRect.height / 2;
        const angle = Math.random() * 0.2 + Math.atan2(deltaCenterY, deltaCenterX); // 随机角度
        
        // 将相对坐标转换为绝对坐标
        const absoluteX = cardRect.left + startX;
        const absoluteY = cardRect.top + startY;
        
        const particle = {
          x: absoluteX, // 绝对位置
          y: absoluteY, // 绝对位置
          vx: Math.cos(angle) * velocity,
          vy: Math.sin(angle) * velocity,
          life: 1000, // 生命周期1秒
          color: settings.color,
          size: settings.size,
          opacity: 1,
          opacityFade: true,
          gravity: 0, // 可以根据需要添加重力
          zIndex: 0 // 刚好能被skill card panel遮住
        };
        
        particles.push(particle);
      }
      
      // 通过事件总线触发粒子特效
      eventBus.emit('spawn-particles', particles);
    }
  }
}
</script>

<style scoped>
.skill-card-panel {
  z-index: 1;
  width: 150px;
  height: 220px;
  padding: 15px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  transition: all 0.3s ease;
  background-color: white;
  border: 1px solid #eee;
}

.skill-card-panel:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(0,0,0,0.15);
}

.skill-card-panel.disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.skill-name {
  font-weight: bold;
  font-size: 16px;
  margin-bottom: 8px;
}

.skill-description {
  font-size: 14px;
  margin-bottom: 8px;
  text-align: center;
}

.skill-uses {
  font-size: 12px;
  color: #666;
}

.skill-tier {
  position: absolute;
  top: 5px;
  right: 5px;
  font-weight: bold;
  font-size: 18px;
  z-index: 2;
  padding: 2px 6px;
  border-radius: 4px;
  background-color: rgba(255, 255, 255, 0.8);
}

.mana-cost {
  position: absolute;
  top: 5px;
  left: 5px;
  display: flex;
  align-items: center;
  z-index: 2;
  background-color: rgba(255, 255, 255, 0.8);
  padding: 2px 6px;
  border-radius: 4px;
}

.mana-icon {
  font-size: 16px;
  margin-right: 4px;
}

.mana-value {
  font-weight: bold;
  color: #2196f3;
  font-size: 16px;
}

.mana-value.insufficient-mana {
  color: #f44336;
}

.action-cost {
  position: absolute;
  bottom: 5px;
  left: 5px;
  display: flex;
  align-items: center;
  z-index: 2;
  background-color: rgba(255, 255, 255, 0.8);
  padding: 2px 6px;
  border-radius: 4px;
}

.action-icon {
  font-size: 16px;
  margin-right: 4px;
}

.action-value {
  font-weight: bold;
  color: #ff9800;
  font-size: 16px;
}

.skill-card {
  /* width: 150px; */
  min-height: 100px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  /* transition: all 0.3s ease; */
  position: relative;
}

/* 不同等阶的技能卡片样式 */
/* D */
.skill-card-panel.tier-0 { 
  background-color: #ffffff;
  border: 1px solid #000000;
}
/* C- */
.skill-card-panel.tier-1 {
  background-color: #ffffff;
  border: 1px solid #41db39;
}

/* C+ */
.skill-card-panel.tier-2 {
  background-color: #daffbc;
  border: 1px solid #41db39;
}

/* B- */
.skill-card-panel.tier-3 {
  background-color: #ffffff;
  border: 1px solid #759eff;
}

/* B */
.skill-card-panel.tier-4 {
  background-color: #bfebff;
  border: 1px solid #759eff;
}

/* B+ */
.skill-card-panel.tier-5 {
  background-color: #ffffff;
  border: 1px solid #d072ff;
}


/* A- */
.skill-card-panel.tier-6 {
  background-color: #f4daff;
  border: 1px solid #d072ff;
}

/* A */
.skill-card-panel.tier-7 {
  background-color: #ffffff;
  border: 1px solid #ff9059;
}

/* A+ */
.skill-card-panel.tier-8 {
  background-color: #ffe4d0;
  border: 1px solid #ff9059;
}

/* S */
.skill-card-panel.tier-9 {
  background-color: #ffc0c0;
  border: 1px solid #ff0000;
}

/* 技能激活动画关键帧 */
@keyframes skillActivation {
  0% {
    transform: scale(1);
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  }
  50% {
    transform: scale(1.1);
    box-shadow: 0 0 20px rgba(255, 255, 255, 0.8);
    filter: brightness(1.5) drop-shadow(0 0 10px rgba(255, 255, 255, 0.8));
  }
  100% {
    transform: scale(1);
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  }
}

.skill-card.activating {
  z-index: 100;
  animation-name: skillActivation;
  animation-timing-function: ease-in-out;
  animation-fill-mode: forwards;
}
</style>