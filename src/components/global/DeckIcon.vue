<template>
  <div
    class="deck-icon"
    :title="`后备技能：${count} 张`"
    @mouseenter="onEnter"
    @mousemove="onMove"
    @mouseleave="onLeave"
    @click="onClick"
    ref="root"
  >
    <span class="icon">🃏</span>
    <span class="count" v-if="count > 0">{{ count }}</span>

    <!-- 顶部卡牌预览 -->
    <div v-if="showPreview && topSkill" class="preview-wrapper">
      <SkillCard :skill="topSkill" :player="player" :preview-mode="true" />
    </div>
  </div>
</template>

<script>
import frontendEventBus from '../../frontendEventBus.js';
import SkillCard from './SkillCard.vue';

export default {
  name: 'DeckIcon',
  components: { SkillCard },
  props: {
    count: { type: Number, default: 0 },
    names: { type: Array, default: () => [] },
    topSkill: { type: Object, default: null },
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
        name: '牌库',
        text: `后备技能：<strong>${this.count}</strong> 张${listHtml}`,
        color: '#ffd54f',
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
.deck-icon {
  position: absolute;
  right: 16px;
  top: 16px;
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
.deck-icon .icon { font-size: 22px; line-height: 1; }
.deck-icon .count {
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

/* 预览卡牌容器，显示在icon附近 */
.preview-wrapper {
  position: absolute;
  bottom: 26px; /* 显示在图标上方 */
  right: 0;
  z-index: var(--z-tooltip);
  pointer-events: none; /* 不阻挡鼠标，避免影响悬浮区域 */
  transform: translateY(0);
}

/* 让预览卡片稍微小一点（选择性） */
.preview-wrapper :deep(.skill-card) {
  transform: scale(0.9);
  transform-origin: top right;
}
</style>
