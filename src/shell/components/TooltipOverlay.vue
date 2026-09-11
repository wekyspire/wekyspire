<script setup>
// tooltip 唯一渲染宿主（App.vue 顶层挂载，塔楼/房间两层共享）：
// 状态与生命周期在 tooltipHub（同 token 抑制、跟随移动、边缘翻转），本组件纯呈现——
// 内容模型 { title, body, tint?, cardPreview? } 由 shell/tooltip.js 统一解析。
// cardPreview 模型渲染整卡预览（CardFacePreview 战场同源烘焙）；宿主 pointer-events:none
// 天然隔断预览内热区——嵌套 hover 一层即止（用户定）。
// z 层：面板 20 之上、模态弹窗 60 之下（模态期间不悬浮）。
import CardFacePreview from './CardFacePreview.vue';
import { tooltipState } from '../tooltipHub.js';
const s = tooltipState;
</script>

<template>
  <div v-if="s.visible && s.model" class="tooltip" :class="{ 'is-card': s.model.cardPreview }"
    :style="{ left: s.x + 'px', top: s.y + 'px' }">
    <CardFacePreview v-if="s.model.cardPreview" class="tip-card"
      :skill-id="s.model.cardPreview.skillId" :ctx="{ params: s.model.cardPreview.params }" />
    <template v-else>
      <b>{{ s.model.title }}</b>
      <template v-if="s.model.body"><br><span class="tip-body" :style="{ color: s.model.tint }">{{ s.model.body }}</span></template>
    </template>
  </div>
</template>

<style scoped>
.tooltip {
  position: fixed; z-index: 45; max-width: 260px;
  background: rgba(8, 12, 24, .92); border: 1px solid #46507a; border-radius: 6px;
  padding: 8px 12px; color: #dde; font-size: 13px; line-height: 1.5;
  box-shadow: 0 4px 16px rgba(0, 0, 0, .5);
  pointer-events: none;
}
.tooltip b { color: #ffd; }
/* 整卡预览宿主：去 max-width 文本约束，卡宽固定 200（与 tooltip.js CARD_PREVIEW_SIZE 同步） */
.tooltip.is-card { max-width: none; padding: 8px; }
.tip-card { width: 200px; }
</style>
