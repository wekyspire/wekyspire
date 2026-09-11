<script setup>
// 菜单层顶层加载界面：全量美术预载（assetManifest.preloadAllArt）的进度门。
// App.vue 在预载完成前渲染本组件并扣住开始界面——加载没完成进不了开始界面。
// position:fixed 锚定 #game-frame（transform 包含块），z-index 压过一切菜单级 UI。
import { computed } from 'vue';

const props = defineProps({
  // { loaded, total }：每张素材落定一次（App.vue 侧持有并透传）
  progress: { type: Object, default: () => ({ loaded: 0, total: 0 }) },
});

const pct = computed(() =>
  props.progress.total > 0
    ? Math.round((props.progress.loaded / props.progress.total) * 100)
    : 0,
);
</script>

<template>
  <div class="asset-loading" role="status" aria-label="资源加载中">
    <div class="al-title">魏启尖塔</div>
    <div class="al-bar"><div class="al-fill" :style="{ width: pct + '%' }"></div></div>
    <div class="al-text">加载美术资源… {{ progress.loaded }} / {{ progress.total }}</div>
  </div>
</template>

<style scoped>
.asset-loading {
  position: fixed; inset: 0; z-index: 100;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 20px;
  background: #05070d;
  font-family: 'Microsoft YaHei', Arial, sans-serif;
}
.al-title {
  font-size: 44px; letter-spacing: 10px; color: #ffe7b3;
  text-shadow: 0 2px 14px rgba(255, 200, 100, .28);
}
.al-bar {
  width: min(380px, 62%); height: 10px; border-radius: 5px;
  background: #171d2e; border: 1px solid #2c3654; overflow: hidden;
}
.al-fill {
  height: 100%;
  background: linear-gradient(90deg, #5b9fe6, #8ecdf5);
  transition: width .15s ease;
}
.al-text { font-size: 13px; color: #9aa3c0; letter-spacing: 1px; }
</style>
