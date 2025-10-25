<template>
  <div class="effect-display-bar">
    <div class="effects">
      <div v-for="(value, key) in effects" :key="key">
        <EffectIcon
          v-if="value !== 0" 
          :effect-name="key"
          :stack="value"
          :preview-mode="false"
          @mouseenter="showTooltip($event, key)"
          @mouseleave="hideTooltip()"
        />
      </div>
    </div>
  </div>
</template>

<script>
import EffectIcon from './EffectIcon.vue';
import effectDescriptions from '../../data/effectDescription.js';
import frontendEventBus from "../../frontendEventBus";

export default {
  name: 'EffectDisplayBar',
  components: {
    EffectIcon
  },
  props: {
    effects: {
      type: Object,
      default: () => ({})
    },
    target: {
      type: Object,
      default: null
    }
  },
  data() {
    return {
      previousEffects: JSON.parse(JSON.stringify(this.effects))
    };
  },
  watch: {
    effects: {
      deep: true,
      handler(newVal) {
        this.handleEffectsChanged(newVal, this.previousEffects);
        this.previousEffects = JSON.parse(JSON.stringify(newVal));
      }
    }
  },
  methods: {
    showTooltip(event, effectName) {
      this.$emit('show-tooltip', {
        event,
        effectName,
        target: this.target
      });
    },
    
    hideTooltip() {
      this.$emit('hide-tooltip');
    },

    // 基于effects对象变化触发动画（取代 effect-change 事件）
    handleEffectsChanged(curr, prev) {
      // 只处理当前目标的效果变化（组件级别即对应当前目标）
      const prevKeys = Object.keys(prev || {});
      for (const effectName of prevKeys) {
        const previousStacks = prev[effectName] || 0;
        const currStacks = (curr && curr[effectName]) || 0;
        if (previousStacks > 0 && currStacks === 0) {
          this.playEffectExpiredAnimation(effectName);
        }
      }
    },
    
    // 播放效果过期动画
    playEffectExpiredAnimation(effectName) {
      // 获取效果信息
      const effectInfo = effectDescriptions[effectName] || {};
      const effectColor = effectInfo.color || '#000000';
      const effectIcon = effectInfo.icon || '❓';
      
      // 查找对应的EffectIcon元素
      const effectElements = this.$el.querySelectorAll('.effect-icon');
      let targetElement = null;
      
      for (const element of effectElements) {
        if (element.textContent.includes(effectName)) {
          targetElement = element;
          break;
        }
      }
      
      if (!targetElement) return;
      
      // 获取元素位置
      const rect = targetElement.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      
      // 创建效果过期粒子
      const particles = [{
        absoluteX: centerX,
        absoluteY: centerY,
        vx: (Math.random() - 0.5) * 30, // 轻微的水平随机偏移
        vy: -50, // 初始向上速度
        gravity: 50, // 下坠重力
        life: 1500,
        text: `${effectIcon} 消失`,
        extraStyles: {
          color: effectColor,
          fontWeight: 'bold',
          fontSize: '16px',
          textShadow: '0 0 3px rgba(0, 0, 0, 0.5)',
          fontFamily: 'Arial, sans-serif',
          userSelect: 'none',
          pointerEvents: 'none',
          zIndex: '20'
        }
      }];
      
      // 立刻触发粒子生成
      frontendEventBus.emit('spawn-particles',  particles );
    }
  }
};
</script>

<style scoped>
.effect-display-bar {
  margin-top: 10px;
}

.effects {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  min-height: 35px;
}

/* 效果图标 */
.effect-icon {
  display: inline-block;
  font-size: 16px;
  cursor: help;
  transition: transform 0.2s;
}

.effect-icon:hover {
  transform: scale(1.2);
}
</style>