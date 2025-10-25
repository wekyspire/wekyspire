<template>
  <div class="rest-control-panel">
    <h3 class="title">休整操作</h3>
    <div class="controls">
      <button ref="deckBtn" @click="$emit('toggle-preparation-panel')">
        牌库
      </button>
      <!-- 预留：未来可以在此添加更多休整操作按钮 -->
    </div>
  </div>
</template>

<script>
import frontendEventBus from '../../frontendEventBus.js';
import animator from '../../utils/animator.js';
export default {
  name: 'RestControlPanel',
  props: {
    preparationPanelVisible: { type: Boolean, default: false },
  },
  emits: ['toggle-preparation-panel'],
  mounted() {
    // 监听来自动画序列的“飞入牌库”完成提示，播放按钮缩放动画
    this._onDeckBump = () => {
      this.triggerBump(this.$refs.deckBtn);
    };
    frontendEventBus.on('rest-deck-bump', this._onDeckBump);
    // 将全局“牌库”锚点定位到该按钮，便于后端动画使用 toAnchor:'deck'
    animator.setGlobalAnchorEl('restDeck', this.$refs.deckBtn);
  },
  beforeUnmount() {
    if (this._onDeckBump) frontendEventBus.off('rest-deck-bump', this._onDeckBump);
    animator.setGlobalAnchorEl('restDeck', null);
  },
  methods: {
    // 返回“牌库”按钮的中心点（用于作为动画目标）
    getDeckButtonCenterPoint() {
      const el = this.$refs.deckBtn;
      if (!el || !el.getBoundingClientRect) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    },
    // 播放缩放跳动动画
    triggerBump(el) {
      if (!el) return;
      el.classList.remove('stat-bump');
      // 强制回流
      // eslint-disable-next-line no-unused-expressions
      el.offsetWidth;
      el.classList.add('stat-bump');
      const onEnd = () => {
        el.classList.remove('stat-bump');
        el.removeEventListener('animationend', onEnd);
      };
      el.addEventListener('animationend', onEnd);
    }
  }
}
</script>

<style scoped>
.rest-control-panel {
  width: 360px;
  box-sizing: border-box;
  padding: 12px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  color: #eef7ff;
}
.title {
  margin: 0 0 8px 0;
  font-size: 16px;
  font-weight: 600;
}
.controls {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
button {
  padding: 8px 12px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 6px;
  background: rgba(66, 185, 131, 0.9);
  color: #fff;
  cursor: pointer;
  will-change: transform;
}
button:hover {
  background: rgba(53, 156, 109, 0.95);
}
/* 使用全局的 .stat-bump 动画（见 src/assets/common.css） */
</style>
