<template>
  <div class="action-points-bar">
    <div class="action-points-text">⚡行动点 {{ player.remainingActionPoints }}/{{ player.maxActionPoints }}</div>
    <div class="action-points-dots">
      <BarPoint
        v-for="(dot, index) in actionPointsDots" 
        :key="index" 
        :filled="dot.filled" 
        :highlighted="dot.highlighted"
        color="#c55c00"
        highlight-color="#ffeb3b"
        lighten-color="#ffff99"
      />
    </div>
  </div>
</template>

<script>
import gameState from '../data/gameState.js';
import eventBus from '../eventBus.js';
import BarPoint from './BarPoint.vue';

export default {
  name: 'ActionPointsBar',
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
    },

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

.action-points-text {
  font-size: 14px;
  font-weight: bold;
  width: 100px;
}
</style>