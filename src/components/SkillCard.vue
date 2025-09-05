<template>
  <div 
    :class="['skill-card', 'tier-' + skill.tier, { disabled: disabled }]"
    @click="onClick"
  >
    <div class="mana-cost" v-if="skill.manaCost > 0">
      <span class="mana-icon">🔮</span>
      <span class="mana-value" :class="{ 'insufficient-mana': playerMana < skill.manaCost }">{{ skill.manaCost }}</span>
    </div>
    <div class="skill-tier">{{ getTierLabel(skill.tier) }}</div>
    <div class="skill-name">{{ skill.name }}</div>
    <div class="skill-description">
      <ColoredText :text="skill.description" />
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
    <ParticleEffect ref="particleEffect" />
  </div>
</template>

<script>
import ColoredText from './ColoredText.vue';
import ParticleEffect from './ParticleEffect.vue';

export default {
  name: 'SkillCard',
  components: {
    ColoredText,
    ParticleEffect
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
  methods: {
    onClick() {
      if (!this.disabled) {
        // 播放技能激活动画
        this.playActivationAnimation();
        
        // 延迟触发事件，以匹配动画时间
        setTimeout(() => {
          this.$emit('skill-card-clicked', this.skill);
        }, 300);
      }
    },
    getTierLabel(tier) {
      const tierLabels = {
        '-1': 'S',
        '0': 'D',
        '1': 'C-',
        '2': 'C+',
        '3': 'B-',
        '4': 'B',
        '5': 'B+',
        '6': 'A-',
        '7': 'A',
        '8': 'A+',
        '9': 'S'
      };
      return tierLabels[tier] || '';
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
      this.playParticleEffect(tier);
      
      // 动画结束后清理
      setTimeout(() => {
        card.classList.remove('activating');
        card.style.animationDuration = '';
      }, 500 / intensity);
    },
    // 播放粒子特效
    playParticleEffect(tier) {
      // 根据tier确定粒子参数
      const tierSettings = {
        '-1': { count: 5, size: 3, color: '#ff0000' },   // S
        '0': { count: 100, size: 3, color: '#000000' },     // D
        '1': { count: 8, size: 4, color: '#41db39' },     // C-
        '2': { count: 10, size: 5, color: '#41db39' },    // C+
        '3': { count: 12, size: 6, color: '#759eff' },    // B-
        '4': { count: 15, size: 7, color: '#759eff' },    // B
        '5': { count: 18, size: 8, color: '#d072ff' },    // B+
        '6': { count: 20, size: 9, color: '#d072ff' },    // A-
        '7': { count: 25, size: 10, color: '#ff9059' },   // A
        '8': { count: 30, size: 11, color: '#ff9059' },   // A+
        '9': { count: 35, size: 12, color: '#ff0000' }    // S
      };
      
      const settings = tierSettings[tier] || tierSettings['0'];
      
      // 获取卡片位置和尺寸
      const card = this.$el;
      if (card) {
        const rect = card.getBoundingClientRect();
        const containerRect = card.parentElement.getBoundingClientRect();
        
        // 计算相对位置百分比，增加5%的内边距确保粒子在卡片内可见
        const padding = 5;
        const spawnRect = {
          x: ((rect.left - containerRect.left + rect.width * 0.1) / containerRect.width) * 100,
          y: ((rect.top - containerRect.top + rect.height * 0.1) / containerRect.height) * 100,
          width: (rect.width * 0.8 / containerRect.width) * 100,
          height: (rect.height * 0.8 / containerRect.height) * 100
        };
        
        // 触发粒子特效
        if (this.$refs.particleEffect) {
          this.$refs.particleEffect.play(settings.count, settings.size, settings.color, 1000, spawnRect);
        }
      }
    }
  }
}
</script>

<style scoped>
.skill-card {
  width: 150px;
  min-height: 100px;
  padding: 15px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  transition: all 0.3s ease;
  position: relative;
  background-color: white;
  border: 1px solid #eee;
}

.skill-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(0,0,0,0.15);
}

.skill-card.disabled {
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

/* 不同等阶的技能卡片样式 */
/* D */
.skill-card.tier-0 { 
  background-color: #ffffff;
  border: 1px solid #000000;
}
/* C- */
.skill-card.tier-1 {
  background-color: #ffffff;
  border: 1px solid #41db39;
}

/* C+ */
.skill-card.tier-2 {
  background-color: #daffbc;
  border: 1px solid #41db39;
}

/* B- */
.skill-card.tier-3 {
  background-color: #ffffff;
  border: 1px solid #759eff;
}

/* B */
.skill-card.tier-4 {
  background-color: #bfebff;
  border: 1px solid #759eff;
}

/* B+ */
.skill-card.tier-5 {
  background-color: #ffffff;
  border: 1px solid #d072ff;
}


/* A- */
.skill-card.tier-6 {
  background-color: #f4daff;
  border: 1px solid #d072ff;
}

/* A */
.skill-card.tier-7 {
  background-color: #ffffff;
  border: 1px solid #ff9059;
}

/* A+ */
.skill-card.tier-8 {
  background-color: #ffe4d0;
  border: 1px solid #ff9059;
}

/* S */
.skill-card.tier-9 {
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