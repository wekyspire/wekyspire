<template>
  <div class="mana-bar">
    <div class="mana-text" ref="manaText">💧魏启 {{ player.mana }}/{{ player.maxMana }}</div>
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
import frontendEventBus from '../../frontendEventBus.js';
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
        this.highlightedManaCost = skill.manaCost;
      }
    },
    onSkillCardHoverEnd() {
      this.highlightedManaCost = 0;
    },

    // 触发缩放动画
    triggerBump(el) {
      if (!el) return;
      el.classList.remove('stat-bump');
      // 强制回流
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
    'player.mana'(nv, ov) {
      if (nv !== ov) this.$nextTick(() => this.triggerBump(this.$refs.manaText));
    },
    'player.maxMana'(nv, ov) {
      if (nv !== ov) this.$nextTick(() => this.triggerBump(this.$refs.manaText));
    }
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

.mana-text {
  font-size: 14px;
  font-weight: bold;
  width: 100px;
  will-change: transform;
}

/* 使用全局的 .stat-bump 动画（见 src/assets/common.css） */
</style>