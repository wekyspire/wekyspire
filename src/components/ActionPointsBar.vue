<template>
  <div class="action-points-bar">
    <div class="action-points-text">⚡行动点 {{ player.remainingActionPoints }}/{{ player.maxActionPoints }}</div>
    <div class="action-points-dots">
      <span 
        v-for="(dot, index) in actionPointsDots" 
        :key="index" 
        class="action-point-dot" 
        :class="{ 'filled': dot.filled, 'empty': !dot.filled, 'highlighted': dot.highlighted }"
      ></span>
    </div>
  </div>
</template>

<script>
import gameState from '../data/gameState.js';
import eventBus from '../eventBus.js';

export default {
  name: 'ActionPointsBar',
  props: {
    player: {
      type: Object,
      required: true
    }
  },
  data() {
    return {
      highlightedActionPointCost: 0
    };
  },
  computed: {
    // 计算行动点圆点
    actionPointsDots() {
      const dots = [];
      for (let i = 0; i < this.player.maxActionPoints; i++) {
        const isFilled = i < this.player.remainingActionPoints;
        const isHighlighted = isFilled && i >= this.player.remainingActionPoints - this.highlightedActionPointCost;
        dots.push({
          filled: isFilled,
          highlighted: isHighlighted
        });
      }
      return dots;
    }
  },
  mounted() {
    // 监听技能卡片悬停事件
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
        this.highlightedActionPointCost = skill.actionPointCost;
      }
    },
    onSkillCardHoverEnd() {
      this.highlightedActionPointCost = 0;
    }
  }
};
</script>

<style scoped>
.action-points-bar {
  display: flex;
  align-items: center;
  margin-bottom: 10px;
}

.action-points-dots {
  display: flex;
  margin-right: 10px;
}

.action-point-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  margin-right: 3px;
  border: 1px solid #ccc;
}

.action-point-dot.filled {
  background-color: #c55c00; /* 橙黄色 */
}

.action-point-dot.empty {
  background-color: #000; /* 黑色 */
}

.action-point-dot.highlighted {
  background-color: #ffeb3b; /* 亮黄色 */
  box-shadow: 0 0 5px #ffeb3b;
  animation: pulse 1s infinite;
}

@keyframes pulse {
  0% {
    box-shadow: 0 0 5px #ffeb3b;
  }
  50% {
    box-shadow: 0 0 15px #ffeb3b;
  }
  100% {
    box-shadow: 0 0 5px #ffeb3b;
  }
}

.action-points-text {
  font-size: 14px;
  font-weight: bold;
  width: 100px;
}
</style>