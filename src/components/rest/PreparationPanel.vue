<template>
  <transition name="overlay-fade" appear>
  <div class="preparation-overlay" v-if="isVisible" @click.self="applyAndClosePanel()">
    <div class="preparation-panel" @click.self="applyAndClosePanel()">
      <h2>战前准备</h2>
      <p class="tip">拖拽卡牌调整出场顺序（左 → 右）。</p>

      <div class="hand-host">
        <SkillsHand
          :skills="internalSkills"
          :draggable="true"
          :is-player-turn="false"
          :is-control-disabled="false"
          @reorder-request="onReorder"
        />
      </div>
    </div>
  </div>
  </transition>
</template>

<script>
import SkillsHand from '../battle/SkillsHand.vue';

export default {
  name: 'PreparationPanel',
  components: { SkillsHand },
  props: {
    skills: {
      type: Array,
      default: () => []
    },
    isVisible: {
      type: Boolean,
      default: false
    }
  },
  data() {
    return {
      internalSkills: []
    };
  },
  watch: {
    skills: {
      immediate: true,
      deep: true,
      handler(newVal) {
        const arr = Array.isArray(newVal) ? newVal.filter(Boolean) : [];
        this.internalSkills = arr;
      }
    }
  },
  methods: {
    onReorder({ from, to }) {
      const list = this.internalSkills.slice();
      const [moved] = list.splice(from, 1);
      list.splice(to, 0, moved);
      this.internalSkills = list;
    },
    applyChanges() {
      this.$emit('apply', this.internalSkills);
    },
    applyAndClosePanel() {
      this.applyChanges();
      this.$emit('close');
    }
  }
}
</script>

<style scoped>
.preparation-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: var(--z-overlay);
  display: flex;
  align-items: stretch;
  justify-content: center;
}

.preparation-panel {
  position: relative;
  margin: auto;
  width: 100%;
  overflow: auto;
}

.preparation-panel h2 {
  margin: 0 0 8px 0;
  color: #ffffff;
}

.tip {
  color: #eaeaea;
  margin: 0 0 12px 0;
  font-size: 0.9em;
}

.hand-host {
  padding-top: 40px;
  min-height: 280px;
  overflow: hidden;
  border-radius: 8px;
}


.overlay-fade-enter-active,
.overlay-fade-leave-active {
  transition: opacity 0.18s ease;
}
.overlay-fade-enter-from,
.overlay-fade-leave-to {
  opacity: 0;
}
</style>
