<template>
  <transition name="overlay-fade" appear @after-leave="onAfterLeave">
    <div v-if="visible" class="deck-overlay" @click="onClose">
      <transition name="panel-scale" appear>
        <div class="deck-content">
          <h2 class="title">{{ title }}（{{ skills.length }}）</h2>
          <div class="grid">
            <SkillCard
              v-for="s in skills"
              :key="s.uniqueID || s.name"
              :skill="s"
              :player="player"
              :preview-mode="true"
              :can-click="false"
            />
          </div>
          <div class="tooltip">点击空白处或按 Esc 关闭</div>
        </div>
      </transition>
    </div>
  </transition>
</template>

<script>
import SkillCard from '../global/SkillCard.vue';

export default {
  name: 'CardsDisplayOverlayPanel',
  components: { SkillCard },
  props: {
    skills: { type: Array, default: () => [] },
    player: { type: Object, default: null },
    title: { type: String, default: '牌库' }
  },
  emits: ['close'],
  data() {
    return { visible: true };
  },
  mounted() {
    window.addEventListener('keydown', this.onKeydown);
  },
  beforeUnmount() {
    window.removeEventListener('keydown', this.onKeydown);
  },
  methods: {
    onClose() {
      // 先触发关闭动画，动画结束后再真正通知父组件
      this.visible = false;
    },
    onAfterLeave() {
      this.$emit('close');
    },
    onKeydown(e) {
      const key = e.key || e.code;
      if (key === 'Escape' || key === 'Esc') {
        e.preventDefault();
        this.onClose();
      }
    }
  }
};
</script>

<style scoped>
.deck-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: var(--z-overlay);
  display: flex;
  align-items: stretch;
  justify-content: center;
}
.deck-content {
  position: relative;
  margin: 48px 24px;
  padding: 16px 16px 64px;
  width: min(1200px, 96vw);
  overflow: auto;
}
.title {
  margin: 8px 0 16px;
  color: #fff;
  text-align: left;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 16px;
}
.tooltip {
  position: sticky;
  bottom: 0;
  margin-top: 12px;
  padding: 8px 10px;
  color: rgba(255,255,255,0.9);
  text-align: center;
}

.overlay-fade-enter-active,
.overlay-fade-leave-active {
  transition: opacity 0.18s ease;
}
.overlay-fade-enter-from,
.overlay-fade-leave-to {
  opacity: 0;
}
.panel-scale-enter-active,
.panel-scale-leave-active {
  transition: transform 0.2s ease, opacity 0.2s ease;
}
.panel-scale-enter-from,
.panel-scale-leave-to {
  transform: translateY(-6px) scale(0.97);
  opacity: 0;
}
</style>

