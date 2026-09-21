<script setup>
// RichTextInline：把一行 markup 渲染成 DOM 文本（tooltip 正文 / 任何 Vue 浮层里的富文本）。
// 与 Three 侧共用同一份「片段」口径（stage/richtext/inline.js 的 inlineSegments）——
// 颜色、图标、显示名不会两头漂移。
//
// **纯呈现，没有热区**（用户 2026-09-19 定）：tooltip 全局唯一、随叫随到，不带嵌套后
// 结构最简单也不会出 bug（"hover 浮层里的引用再弹浮层"当年因自激振荡被放弃）。
// 所以这里的引用段只表达"这是一张卡 / 一个术语"：特征色 + 图标 + 系列字形徽章，
// 不挂任何指针处理器，也不需要放开 pointer-events。
// 真正带热区的引用在**卡面**（CardObject 3D 拾取 / CardFacePreview DOM 命中）与
// 选卡/选遗物界面上——那些地方引用就印在卡面上，hover 弹整卡预览是老约定。
import { computed } from 'vue';
import { inlineSegments } from '../../stage/richtext/inline.js';

const props = defineProps({
  text: { type: String, default: '' },
});

// 片段表是纯函数产物（markup 变才重算）
const segments = computed(() => inlineSegments(props.text));
</script>

<template>
  <span class="rich-inline">
    <template v-for="(seg, i) in segments" :key="i">
      <span v-if="seg.type === 'text'" :style="seg.color ? { color: seg.color } : null">{{ seg.text }}</span>
      <span v-else class="rich-ref" :style="{ color: seg.color ?? undefined }">
        <span v-if="seg.icon" class="rich-icon">{{ seg.icon }}</span>
        <span v-else-if="seg.glyph" class="rich-glyph">{{ seg.glyph }}</span>{{ seg.label }}
      </span>
    </template>
  </span>
</template>

<style scoped>
/* 正文里的引用段：只靠颜色/图标表达"这是个实体"，不是可点物（无下划线、无 help 光标） */
.rich-icon { margin-right: 1px; }
/* 卡牌引用的系列字形徽章：小方片，色随卡面主题色（currentColor） */
.rich-glyph {
  display: inline-block;
  min-width: 11px;
  margin-right: 3px;
  padding: 0 2px;
  font-size: 10px;
  line-height: 13px;
  text-align: center;
  border: 1px solid currentColor;
  border-radius: 2px;
  opacity: .9;
}
</style>
