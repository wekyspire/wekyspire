<template>
  <transition name="fade">
    <div
      v-if="visible"
      class="floating-tooltip"
      :style="tooltipStyle"
    >
      <div class="tooltip-name" :style="{ color: color }">{{ name }}</div>
      <div class="tooltip-description" v-html="text"></div>
    </div>
  </transition>
</template>

<script>
import frontendEventBus from '../../frontendEventBus.js';

export default {
  name: 'FloatingTooltip',
  data() {
    return {
      visible: false,
      name: '',
      text: '',
      color: '#ffffff',
      x: 0,
      y: 0,
      offset: { x: 12, y: 16 },
      maxWidth: 300
    };
  },
  computed: {
    tooltipStyle() {
      // Clamp position within viewport with a small margin
      const margin = 8;
      const vw = window.innerWidth || 0;
      const vh = window.innerHeight || 0;

      let left = this.x + this.offset.x;
      let top = this.y + this.offset.y;

      // Account for tooltip width/height by using maxWidth and a basic line-height estimate.
      // We can't measure actual element here in computed easily, but we can keep it within viewport using maxWidth margin.
      if (left + this.maxWidth + margin > vw) {
        left = Math.max(margin, vw - this.maxWidth - margin);
      }
      if (top + 120 + margin > vh) {
        // 120 is a reasonable default height for most tooltips; they'll still clamp further due to fixed positioning
        top = Math.max(margin, vh - 120 - margin);
      }

      return {
        left: left + 'px',
        top: top + 'px',
        maxWidth: this.maxWidth + 'px'
      };
    }
  },
  mounted() {
    frontendEventBus.on('tooltip:show', this.onShow);
    frontendEventBus.on('tooltip:move', this.onMove);
    frontendEventBus.on('tooltip:hide', this.onHide);
  },
  beforeUnmount() {
    frontendEventBus.off('tooltip:show', this.onShow);
    frontendEventBus.off('tooltip:move', this.onMove);
    frontendEventBus.off('tooltip:hide', this.onHide);
  },
  methods: {
    onShow(payload) {
      if (!payload) return;
      const { name, text, color, x, y, maxWidth } = payload;
      this.name = name || '';
      this.text = text || '';
      this.color = color || '#ffffff';
      if (typeof maxWidth === 'number') this.maxWidth = maxWidth;
      this.x = x ?? this.x;
      this.y = y ?? this.y;
      this.visible = true;
    },
    onMove(payload) {
      if (!payload) return;
      const { x, y } = payload;
      if (typeof x === 'number') this.x = x;
      if (typeof y === 'number') this.y = y;
    },
    onHide() {
      this.visible = false;
    }
  }
};
</script>

<style scoped>
.floating-tooltip {
  position: fixed;
  background-color: rgba(0, 0, 0, 0.85);
  color: white;
  padding: 10px 12px;
  border-radius: 6px;
  font-size: 14px;
  z-index: var(--z-tooltip);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
  pointer-events: none; /* don't block mouse */
}

.tooltip-name {
  font-weight: bold;
  margin-bottom: 6px;
  font-size: 16px;
}

.tooltip-description {
  font-size: 14px;
  color: white;
}

.fade-enter-active, .fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}
</style>

