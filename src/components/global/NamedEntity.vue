<template>
  <span 
    class="named-entity"
    :style="{ color: entityColor }"
    @mouseenter="showTooltip"
    @mousemove="onMouseMove"
    @mouseleave="hideTooltip"
  >
    {{ entityIcon }}
    {{ entityName }}
  </span>
</template>

<script>
import namedEntities from '../../data/namedEntities.js';
import frontendEventBus from '../../frontendEventBus.js';

export default {
  name: 'NamedEntity',
  props: {
    entityName: {
      type: String,
      required: true
    }
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
      if (!this.entityInfo.description) return;
      frontendEventBus.emit('tooltip:show', {
        name: this.entityDisplayName,
        text: this.entityDescription,
        color: this.entityColor,
        x: event.clientX,
        y: event.clientY
      });
    },
    onMouseMove(event) {
      frontendEventBus.emit('tooltip:move', { x: event.clientX, y: event.clientY });
    },
    hideTooltip() {
      frontendEventBus.emit('tooltip:hide');
    }
  },
  beforeUnmount() {
    // 隐藏可能仍在显示的全局tooltip
    frontendEventBus.emit('tooltip:hide');
  }
};
</script>

<style scoped>
.named-entity {
  display: inline-block;
  cursor: help;
  font-weight: bold;
}
</style>
