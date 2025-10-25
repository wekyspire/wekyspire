<template>
  <div
      class="burnt-skills-icon"
      :title="`焚毁技能：${count} 张`"
      @mouseenter="onEnter"
      @mousemove="onMove"
      @mouseleave="onLeave"
      @click="onClick"
      ref="root"
  >
    <span class="icon">🕳️</span>
    <span class="count" v-if="count > 0">{{ count }}</span>
  </div>
</template>

<script>
import frontendEventBus from '../../frontendEventBus.js';

export default {
  name: 'BurntSkillsIcon',
  props: {
    count: { type: Number, default: 0 },
    player: { type: Object, default: null }
  },
  emits: ['click'],
  data() {
    return { showPreview: false };
  },
  watch: {
    count(nv, ov) {
      if (nv !== ov) this.$nextTick(() => this.triggerBump(this.$refs.root));
    }
  },
  methods: {
    // 重启动画，使整个组件有一个缩放跳动
    triggerBump(el) {
      if (!el) return;
      el.classList.remove('stat-bump');
      // 强制回流
      // eslint-disable-next-line no-unused-expressions
      el.offsetWidth;
      el.classList.add('stat-bump');
      el.addEventListener('animationend', () => {
        el.classList.remove('stat-bump');
      }, { once: true });
    },
    onEnter(e) {
      this.showPreview = true;
      const listHtml = this.names && this.names.length
          ? `<ul style='padding-left:16px;margin:6px 0;'>${this.names.map(n => `<li>${n}</li>`).join('')}</ul>`
          : '';
      frontendEventBus.emit('tooltip:show', {
        name: '坟地',
        text: `已焚毁技能：<strong>${this.count}</strong> 张${listHtml}`,
        color: '#cd00c3',
        x: e.clientX,
        y: e.clientY,
        maxWidth: 260
      });
    },
    onMove(e) {
      frontendEventBus.emit('tooltip:move', { x: e.clientX, y: e.clientY });
    },
    onLeave() {
      this.showPreview = false;
      frontendEventBus.emit('tooltip:hide');
    },
    onClick() {
      this.$emit('click');
    }
  }
};
</script>

<style scoped>
.burnt-skills-icon {
  position: absolute;
  right: 16px;
  top: -32px;
  width: 44px;
  height: 44px;
  border-radius: 8px;
  background: rgba(0,0,0,0.35);
  color: #ffd54f;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  cursor: pointer;
  user-select: none;
  z-index: var(--z-overlay);
  will-change: transform;
}
.burnt-skills-icon .icon { font-size: 22px; line-height: 1; }
.burnt-skills-icon .count {
  position: absolute;
  bottom: -6px;
  right: -6px;
  min-width: 20px;
  height: 20px;
  padding: 0 4px;
  background: #ff9800;
  color: #000;
  border-radius: 10px;
  font-size: 12px;
  font-weight: bold;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 4px rgba(0,0,0,0.4);
}
</style>
