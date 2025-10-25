<template>
  <transition name="fade">
    <div v-if="visible" class="floating-card-tooltip" :style="tooltipStyle">
      <SkillCard
        v-if="skill"
        :skill="skill"
        :disabled="false"
        :preview-mode="true"
        :auto-register-in-registry="false"
      />
    </div>
  </transition>
</template>

<script>
import frontendEventBus from '../../frontendEventBus.js';
import SkillCard from './SkillCard.vue';

export default {
  name: 'FloatingCardTooltip',
  components: { SkillCard },
  data() {
    return {
      visible: false,
      skill: null,
      x: 0,
      y: 0,
      offset: { x: 18, y: 20 },
      width: 198,
      height: 266
    };
  },
  computed: {
    tooltipStyle() {
      const margin = 8;
      const vw = window.innerWidth || 0;
      const vh = window.innerHeight || 0;
      let left = this.x + this.offset.x;
      let top = this.y + this.offset.y;
      if (left + this.width + margin > vw) left = Math.max(margin, vw - this.width - margin);
      if (top + this.height + margin > vh) top = Math.max(margin, vh - this.height - margin);
      return { left: left + 'px', top: top + 'px', width: this.width + 'px', height: this.height + 'px' };
    }
  },
  mounted() {
    frontendEventBus.on('card-tooltip:show', this.onShow);
    frontendEventBus.on('card-tooltip:move', this.onMove);
    frontendEventBus.on('card-tooltip:hide', this.onHide);
  },
  beforeUnmount() {
    frontendEventBus.off('card-tooltip:show', this.onShow);
    frontendEventBus.off('card-tooltip:move', this.onMove);
    frontendEventBus.off('card-tooltip:hide', this.onHide);
  },
  methods: {
    onShow(payload) {
      if (!payload) return;
      this.skill = payload.skill || null;
      this.x = payload.x ?? this.x;
      this.y = payload.y ?? this.y;
      this.visible = !!this.skill;
    },
    onMove(payload) {
      if (!payload) return;
      if (typeof payload.x === 'number') this.x = payload.x;
      if (typeof payload.y === 'number') this.y = payload.y;
    },
    onHide() { this.visible = false; }
  }
};
</script>

<style scoped>
.floating-card-tooltip { position: fixed; z-index: calc(var(--z-tooltip) + 1); pointer-events: none; }
.fade-enter-active, .fade-leave-active { transition: opacity 0.15s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>

