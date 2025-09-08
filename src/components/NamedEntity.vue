<template>
  <span 
    class="named-entity"
    :style="{ color: entityColor }"
    @mouseenter="showTooltip"
    @mouseleave="hideTooltip"
  >
    {{ entityIcon }}
    {{ entityName }}
  </span>
</template>

<script>
import namedEntities from '../data/namedEntities.js';

export default {
  name: 'NamedEntity',
  props: {
    entityName: {
      type: String,
      required: true
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
      }
    };
  },
  computed: {
    entityInfo() {
      return namedEntities[this.entityName] || {};
    },
    entityIcon() {
      return this.entityInfo.icon || '❓';
    },
    entityColor() {
      return this.entityInfo.color || '#000000';
    },
    entityDescription() {
      return this.entityInfo.description || '未知实体';
    },
    entityDisplayName() {
      return this.entityInfo.name || this.entityName;
    }
  },
  methods: {
    showTooltip(event) {
      // 检查实体是否有描述信息
      if (!this.entityInfo.description) return;
      
      // 获取实体名称和描述
      const entityInfo = namedEntities[this.entityName] || {};
      const entityDisplayName = entityInfo.name || this.entityName;
      const entityDescription = entityInfo.description || '未知实体';
      const entityColor = entityInfo.color || '#000000';
      
      // 设置tooltip内容，包含实体名称和描述
      this.tooltip.text = entityDescription;
      this.tooltip.name = entityDisplayName;
      this.tooltip.color = entityColor;
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
      tooltipElement.className = 'named-entity-tooltip';
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
  beforeUnmount() {
    // 组件销毁前移除tooltip
    this.removeTooltip();
  }
};
</script>

<style scoped>
.named-entity {
  display: inline-block;
  font-size: 16px;
  cursor: help;
  margin: 0 2px;
  font-weight: bold;
}
</style>

<style>
/* 全局样式，确保tooltip显示在最上层 */
.named-entity-tooltip {
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

.named-entity-tooltip .tooltip-name {
  font-weight: bold;
  margin-bottom: 5px;
  font-size: 16px;
}

.named-entity-tooltip .tooltip-description {
  font-size: 14px;
  color: white;
}
</style>