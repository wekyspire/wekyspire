<template>
  <div class="action-points-bar">
    <div class="action-points-text" ref="apText">⚡行动点 {{ player.remainingActionPoints }}/{{ player.maxActionPoints }}</div>
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
import frontendEventBus from '../../frontendEventBus.js';
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
    frontendEventBus.on('skill-card-hover-start', this.onSkillCardHoverStart);
    frontendEventBus.on('skill-card-hover-end', this.onSkillCardHoverEnd);
  },
  beforeUnmount() {
    // 移除事件监听器
    frontendEventBus.off('skill-card-hover-start', this.onSkillCardHoverStart);
    frontendEventBus.off('skill-card-hover-end', this.onSkillCardHoverEnd);
  },
  methods: {
    onSkillCardHoverStart(skill) {
      const p = (this.player && typeof this.player.getModifiedPlayer === 'function') ? this.player.getModifiedPlayer() : this.player;
      if(skill.canUse(p)) {
        this.highlightedActionPointCost = skill.actionPointCost;
      }
    },
    onSkillCardHoverEnd() {
      this.highlightedActionPointCost = 0;
    },

    // 触发缩放动画
    triggerBump(el) {
      if (!el) return;
      el.classList.remove('stat-bump');
      // 强制回流以重启动画
      // eslint-disable-next-line no-unused-expressions
      el.offsetWidth;
      el.classList.add('stat-bump');
      const onEnd = () => {
        el.classList.remove('stat-bump');
        el.removeEventListener('animationend', onEnd);
      };
      el.addEventListener('animationend', onEnd);
    }
  },
  watch: {
    'player.remainingActionPoints'(nv, ov) {
      if (nv !== ov) this.$nextTick(() => this.triggerBump(this.$refs.apText));
    },
    'player.maxActionPoints'(nv, ov) {
      if (nv !== ov) this.$nextTick(() => this.triggerBump(this.$refs.apText));
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

.action-points-text {
  font-size: 14px;
  font-weight: bold;
  width: 100px;
  will-change: transform;
}

/* 使用全局的 .stat-bump 动画（见 src/assets/common.css） */
</style>