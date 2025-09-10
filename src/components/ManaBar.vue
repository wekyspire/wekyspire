<template>
  <div class="mana-bar">
    <div class="mana-text">💧魏启 {{ player.mana }}/{{ player.maxMana }}</div>
    <div class="mana-dots">
      <BarPoint
        v-for="(dot, index) in manaDots" 
        :key="index" 
        :filled="dot.filled" 
        :highlighted="dot.highlighted"
        color="#0068be"
        highlight-color="#88d9ff"
        lighten-color="#aaddff"
      />
    </div>
  </div>
</template>

<script>
import gameState from '../data/gameState.js';
import eventBus from '../eventBus.js';
import BarPoint from './BarPoint.vue';

export default {
  name: 'ManaBar',
  components: {
    BarPoint
  },
  props: {
    player: {
      type: Object,
      required: true
    }
  },
  data() {
    return {
      highlightedManaCost: 0
    };
  },
  computed: {
    // 计算魏启圆点
    manaDots() {
      const dots = [];
      for (let i = 0; i < this.player.maxMana; i++) {
        const isFilled = i < this.player.mana;
        const isHighlighted = isFilled && i >= this.player.mana - this.highlightedManaCost;
        dots.push({
          filled: isFilled,
          highlighted: isHighlighted
        });
      }
      return dots;
    }
  },
  mounted() {
    // 监听技能悬停事件
    eventBus.on('skill-card-hover-start', this.onSkillCardHoverStart);
    eventBus.on('skill-card-hover-end', this.onSkillCardHoverEnd);
  },
  beforeUnmount() {
    // 移除事件监听器
    eventBus.off('skill-card-hover-start', this.onSkillCardHoverStart);
    eventBus.off('skill-card-hover-end', this.onSkillCardHoverEnd);
  },
  methods: {
    onSkillCardHoverStart(skill) {
      if(skill.canUse(gameState.player)) {
        this.highlightedManaCost = skill.manaCost;
      }
    },
    onSkillCardHoverEnd() {
      this.highlightedManaCost = 0;
    },

  }
};
</script>

<style scoped>
.mana-bar {
  display: flex;
  align-items: center;
  margin-bottom: 10px;
}

.mana-dots {
  display: flex;
  margin-right: 10px;
}

.mana-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  margin-right: 3px;
  border: 1px solid #ccc;
  transition: opacity 0.8s ease-in-out;
  opacity: 0;
  animation: fadeInOut 0.8s ease-in-out forwards;
}

.mana-dot.filled {
  background-color: #0068be; /* 蓝色 */
  opacity: 1;
}

.mana-dot.empty {
  background-color: #000; /* 黑色 */
  opacity: 0.3;
}

.mana-dot.highlighted {
  background-color: #88d9ff; /* 淡蓝色 */
  box-shadow: 0 0 5px #b6f8ff;
  animation: pulse 1s infinite, colorShift 2s infinite ease-in-out;
}

@keyframes fadeInOut {
  0% { opacity: 0; }
  50% { opacity: 1; }
  100% { opacity: 0; }
}

@keyframes colorShift {
  0% { background-color: #88d9ff; }
  50% { background-color: #aaddff; }
  100% { background-color: #88d9ff; }
}

@keyframes pulse {
  0% {
    box-shadow: 0 0 5px #b6f8ff;
  }
  50% {
    box-shadow: 0 0 15px #b6f8ff;
  }
  100% {
    box-shadow: 0 0 5px #b6f8ff;
  }
}

.mana-text {
  font-size: 14px;
  font-weight: bold;
  width: 100px;
}
</style>