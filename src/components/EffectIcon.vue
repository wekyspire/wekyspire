<template>
  <span 
    class="effect-icon"
    :style="{ color: effectColor }"
    @mouseenter="showTooltip"
    @mouseleave="hideTooltip"
    :class="{ 'scale-animation': isScaling }"
  >
    {{ effectIcon }}
    {{ effectName }}
    <strong v-if="stack !== 0" :style="{color: this.getStackColor()}">{{ stack }}</strong>
  </span>
</template>

<script>
import effectDescriptions from '../data/effectDescription.js';

export default {
  name: 'EffectIcon',
  props: {
    effectName: {
      type: String,
      required: true
    },
    stack: {
      type: Number,
      default: 0
    },
    previewMode: {
      type: Boolean,
      default: true
    }
  },
  data() {
    return {
      tooltip: {
        show: false,
        text: '',
        name: '',
        color: '',
        x: 0,
        y: 0
      },
      isScaling: false
    };
  },
  watch: {
    stack(newVal, oldVal) {
      if(newVal !== oldVal && !this.previewMode) {
        this.playScaleAnimation();
      }
    }
  },
  computed: {
    effectInfo() {
      return effectDescriptions[this.effectName] || {};
    },
    effectIcon() {
      return this.effectInfo.icon || '❓';
    },
    effectColor() {
      return this.effectInfo.color || '#000000';
    },
    effectDescription() {
      return this.effectInfo.description || '未知效果';
    },
    effectDisplayName() {
      return this.effectInfo.name || this.effectName;
    }
  },
  methods: {
    playScaleAnimation() {
      this.isScaling = true;
      setTimeout(() => {
        this.isScaling = false;
      }, 500);
    },
    getStackColor() {
      if(this.stack == 0) return this.effectColor;
      if(this.stack > 0) return 'green';
      if(this.stack < 0) return 'red'; 
      return 'gray'; 
    },
    showTooltip(event) {
      // 获取效果名称和描述
      const effectInfo = effectDescriptions[this.effectName] || {};
      const effectDisplayName = effectInfo.name || this.effectName;
      const effectDescription = effectInfo.description || '未知效果';
      const effectColor = effectInfo.color || '#000000';
      
      // 设置tooltip内容，包含效果名称和描述
      this.tooltip.text = effectDescription;
      this.tooltip.name = effectDisplayName;
      this.tooltip.color = effectColor;
      this.tooltip.x = event.clientX;
      this.tooltip.y = event.clientY;
      
      // 创建并显示tooltip元素
      this.createTooltip();
    },
    hideTooltip() {
      // 移除tooltip元素
      this.removeTooltip();
    },
    createTooltip() {
      // 移除已存在的tooltip
      this.removeTooltip();
      
      // 创建tooltip元素
      const tooltipElement = document.createElement('div');
      tooltipElement.className = 'effect-tooltip';
      tooltipElement.innerHTML = `
        <div class="tooltip-name" style="color: ${this.tooltip.color}">${this.tooltip.name}</div>
        <div class="tooltip-description">${this.tooltip.text}</div>
      `;
      tooltipElement.style.left = this.tooltip.x + 'px';
      tooltipElement.style.top = this.tooltip.y + 'px';
      
      // 添加到body中
      document.body.appendChild(tooltipElement);
      
      // 保存引用以便后续移除
      this.tooltip.element = tooltipElement;
    },
    removeTooltip() {
      if (this.tooltip.element && this.tooltip.element.parentNode) {
        this.tooltip.element.parentNode.removeChild(this.tooltip.element);
        this.tooltip.element = null;
      }
    }
  },
  mounted() {
    // 如果初始stack不为0，播放动画
    if(this.stack !== 0 && !this.previewMode) {
      this.playScaleAnimation();
    }
  },
  beforeUnmount() {
    // 组件销毁前移除tooltip
    this.removeTooltip();
  }
};
</script>

<style scoped>
.effect-icon {
  display: inline-block;
  font-size: 16px;
  cursor: help;
  margin: 0 2px;
  transition: transform 0.5s ease;
}

.effect-icon.scale-animation {
  animation: scaleEffect 0.5s ease;
}

@keyframes scaleEffect {
  0% { transform: scale(1); }
  50% { transform: scale(1.3); }
  100% { transform: scale(1); }
}
</style>

<style>
/* 全局样式，确保tooltip显示在最上层 */
.effect-tooltip {
  position: fixed;
  background-color: rgba(0, 0, 0, 0.8);
  color: white;
  padding: 10px;
  border-radius: 4px;
  font-size: 14px;
  z-index: 10000;
  max-width: 300px;
  word-wrap: break-word;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.effect-tooltip .tooltip-name {
  font-weight: bold;
  margin-bottom: 5px;
  font-size: 16px;
}

.effect-tooltip .tooltip-description {
  font-size: 14px;
}
</style>