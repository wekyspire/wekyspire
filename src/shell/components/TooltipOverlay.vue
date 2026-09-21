<script setup>
// tooltip 唯一渲染宿主（App.vue 顶层挂载，塔楼/房间两层共享）：
// 状态与生命周期在 tooltipHub（同 token 抑制、跟随移动、边缘翻转），本组件纯呈现——
// 内容模型 { title, body, tint?, markup?, cardPreview? } 由 shell/tooltip.js 统一解析。
// cardPreview 模型渲染整卡预览（CardFacePreview 战场同源烘焙）；宿主 pointer-events:none
// 天然隔断预览内热区——嵌套 hover 一层即止（用户定）。
// **markup 正文**（model.markup）：遗物/效果/术语描述里的 /card{} /named{} /effect{}
// 由 RichTextInline 渲染成图标 + 特征色名称（不再把 markup 原样印出来）。它是**纯呈现**，
// 不挂热区——tooltip 全局唯一、随叫随到，不带嵌套最省事（用户 2026-09-19 定）。
// z 层：面板 20 之上、模态弹窗 60 之下（模态期间不悬浮）。
import CardFacePreview from './CardFacePreview.vue';
import RichTextInline from './RichTextInline.vue';
import { tooltipState } from '../tooltipHub.js';
const s = tooltipState;
</script>

<template>
  <div v-if="s.visible && s.model" class="tooltip" :class="{ 'is-card': s.model.cardPreview || s.model.cardPreviews }"
    :style="{ left: s.x + 'px', top: s.y + 'px' }">
    <CardFacePreview v-if="s.model.cardPreview" class="tip-card"
      :skill-id="s.model.cardPreview.skillId" :ctx="{ params: s.model.cardPreview.params }" />
    <div v-else-if="s.model.cardPreviews" class="tip-cards">
      <CardFacePreview v-for="p in s.model.cardPreviews" :key="p.skillId" class="tip-card"
        :skill-id="p.skillId" :ctx="{ params: p.params }" />
    </div>
    <template v-else>
      <b>{{ s.model.title }}</b>
      <template v-if="s.model.body">
        <br>
        <!-- 富文本正文：markup 交给 RichTextInline；纯文本仍是原来的 span（tint 生效、
             pre-line 分段），两条路的外壳样式完全一致 -->
        <RichTextInline v-if="s.model.markup" class="tip-body" :text="s.model.body" />
        <span v-else class="tip-body" :style="{ color: s.model.tint }">{{ s.model.body }}</span>
      </template>
    </template>
  </div>
</template>

<style scoped>
.tooltip {
  position: fixed; z-index: 45; max-width: 260px;
  background: rgba(8, 11, 18, .95); border: 1px solid #2f3a52; border-radius: 3px;
  padding: 8px 12px; color: #dde; font-size: 13px; line-height: 1.5;
  box-shadow: 0 4px 16px rgba(0, 0, 0, .5);
  pointer-events: none;
}
.tooltip b { color: #eef4ff; }
/* 正文允许 \n 分段（如遗物铭刻 flavor 接在效果描述后） */
.tip-body { white-space: pre-line; }
/* 整卡预览宿主：去 max-width 文本约束，卡宽固定 200（与 tooltip.js CARD_PREVIEW_SIZE 同步） */
.tooltip.is-card { max-width: none; padding: 8px; }
.tip-card { width: 200px; }
/* 多卡并列预览（升级分叉 hover）：横排、间距 8（与 cardsModel.size 的估算同步） */
.tip-cards { display: flex; gap: 8px; }
</style>
