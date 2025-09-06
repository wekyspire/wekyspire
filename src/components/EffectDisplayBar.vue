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
      type: String,
      default: 'player'
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