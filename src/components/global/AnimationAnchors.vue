<template>
  <div class="animation-anchors" aria-hidden="true">
    <!-- 中心舞台锚点：用于卡牌飞向中心播放动画 -->
    <div ref="centerAnchor" class="animation-anchor center-anchor"></div>
    <!-- 牌库入口锚点：用于卡牌飞入牌库（可根据你的UI具体位置再调整） -->
    <div ref="deckAnchor" class="animation-anchor deck-anchor"></div>
    <!-- 幽灵元素容器（克隆的卡牌等） -->
    <div ref="ghostContainer" class="ghost-container"></div>
  </div>
</template>

<script>
export default {
  name: 'AnimationAnchors',
  methods: {
    getRefs() {
      return {
        centerAnchorEl: this.$refs.centerAnchor,
        deckAnchorEl: this.$refs.deckAnchor,
        ghostContainerEl: this.$refs.ghostContainer,
      };
    }
  }
};
</script>

<style scoped>
.animation-anchors {
  position: fixed;
  inset: 0;
  pointer-events: none; /* 不阻断交互 */
  z-index: var(--z-animation);
}
.animation-anchor {
  position: absolute;
  width: 0;
  height: 0;
}
/* 中心舞台：屏幕正中（略上移以对齐 center-cards 展示区） */
.center-anchor {
  left: 50%;
  top: 50%;
  transform: translate(-50%, -40%);
}
/* 牌库锚点：屏幕右下，适当留边距 */
.deck-anchor {
  right: 24px;
  bottom: 24px;
}
.ghost-container {
  position: absolute;
  inset: 0;
  overflow: visible;
  z-index: var(--z-animation);
}
/* 防止任何CSS动画/过渡影响幽灵元素，保证GSAP独占控制；并用border-box确保宽高包含边框，避免尺寸偏差 */
.ghost-container :global(.animation-ghost) {
  box-sizing: border-box;
  animation: none !important;
  transition: none !important;
  will-change: transform, opacity;
}
</style>
