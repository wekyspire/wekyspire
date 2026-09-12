<script setup>
// 菜单层顶层加载界面：全量美术预载（assetManifest.preloadAllArt）的进度门。
// App.vue 在预载**全部成功**前渲染本组件并扣住开始界面。
// ⚠ 失败不放行（用户定 2026-09-12）：终止下载/断网导致 onerror 时，进度**卡住**并给出
// 失败提示与重试键——早期 onerror 只计数就 resolve，于是"掐掉下载也能进游戏"（缺图跑）。
// position:fixed 锚定 #game-frame（transform 包含块），z-index 压过一切菜单级 UI。
// 视觉：扁平（白字淡蓝按钮、细描边、小圆角）——与全局 UI 风格一致。
import { computed } from 'vue';

const props = defineProps({
  // { loaded, total, loadedBytes, totalBytes, elapsedMs, failed }
  progress: { type: Object, default: () => ({ loaded: 0, total: 0 }) },
  // 失败项数（>0 = 卡在加载界面，只给重试）
  failed: { type: Number, default: 0 },
});
const emit = defineEmits(['retry']);

// 进度条按**下载体积**驱动（用户定 2026-09-13：按张数时大量小图瞬间刷满、大图干等，观感像坏了）：
// 字节来自 HEAD 探测，个别条目探测缺席会让字节停在 9x%——故"全部落定"强制 100%；
// 整段探测失败（totalBytes=0）退化为按张数。
const pct = computed(() => {
  const p = props.progress;
  const loaded = p.loaded ?? 0;
  if (p.total > 0 && loaded >= p.total) return 100;
  if (p.totalBytes > 0) return Math.min(100, Math.round(((p.loadedBytes ?? 0) / p.totalBytes) * 100));
  return p.total > 0 ? Math.round((loaded / p.total) * 100) : 0;
});

const fmtBytes = (n) => {
  if (!n || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

// 总大小 / 已下载（HEAD 探测拿到 Content-Length 才有值；拿不到退化为"按张数"）
const sizeText = computed(() => {
  const { loadedBytes = 0, totalBytes = 0 } = props.progress;
  if (!totalBytes) return null;
  return `${fmtBytes(loadedBytes)} / ${fmtBytes(totalBytes)}`;
});
// 平均网速（自开始预载起算；字节未知时为 null）
const speedText = computed(() => {
  const { loadedBytes = 0, elapsedMs = 0 } = props.progress;
  if (!loadedBytes || elapsedMs < 300) return null;
  const bps = loadedBytes / (elapsedMs / 1000);
  if (bps < 1024) return `${bps.toFixed(0)} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${(bps / 1024 / 1024).toFixed(1)} MB/s`;
});
// 剩余时间：优先按字节算；字节未知则按"张数 × 平均单张耗时"估算
const etaText = computed(() => {
  const { loaded = 0, total = 0, loadedBytes = 0, totalBytes = 0, elapsedMs = 0 } = props.progress;
  if (elapsedMs < 500 || loaded >= total) return null;
  let ms = null;
  if (totalBytes > 0 && loadedBytes > 0) {
    const speed = loadedBytes / elapsedMs;                 // bytes/ms
    ms = speed > 0 ? (totalBytes - loadedBytes) / speed : null;
  } else if (loaded > 0) {
    ms = (elapsedMs / loaded) * (total - loaded);
  }
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  const s = Math.round(ms / 1000);
  return s < 60 ? `约 ${s} 秒` : `约 ${Math.floor(s / 60)} 分 ${s % 60} 秒`;
});
</script>

<template>
  <div class="asset-loading" role="status" aria-label="资源加载中">
    <div class="al-title">魏启尖塔</div>
    <div class="al-bar"><div class="al-fill" :style="{ width: pct + '%' }"></div></div>
    <div class="al-text">
      加载美术资源… {{ progress.loaded ?? 0 }} / {{ progress.total }}
      <span v-if="sizeText"> ｜ {{ sizeText }}</span>
    </div>
    <div class="al-sub">
      <span v-if="speedText">{{ speedText }}</span>
      <span v-if="speedText && etaText"> ｜ </span>
      <span v-if="etaText">剩余 {{ etaText }}</span>
    </div>
    <!-- 失败：不放行（用户定 2026-09-12——掐断下载不得进入游戏），给重试 -->
    <div v-if="failed > 0" class="al-fail">
      <div class="al-fail-text">资源加载失败 {{ failed }} 项——请检查网络后重试</div>
      <button class="al-retry" type="button" @click="emit('retry')">重试</button>
    </div>
  </div>
</template>

<style scoped>
.asset-loading {
  position: fixed; inset: 0; z-index: 100;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px;
  background: #05070d;
  font-family: 'Microsoft YaHei', Arial, sans-serif;
}
.al-title { font-size: 44px; letter-spacing: 10px; color: #eef4ff; }
.al-bar {
  width: min(380px, 62%); height: 8px; border-radius: 2px;
  background: #131a29; border: 1px solid #2f3a52; overflow: hidden;
}
.al-fill {
  height: 100%; background: #4d78ad;   /* 扁平：纯色填充（无渐变自发光） */
  transition: width .15s ease;
}
.al-text { font-size: 13px; color: #c3cee0; letter-spacing: 1px; }
.al-sub { font-size: 12px; color: #7d87a8; min-height: 16px; letter-spacing: .5px; }
.al-fail { display: flex; flex-direction: column; align-items: center; gap: 10px; margin-top: 6px; }
.al-fail-text { font-size: 13px; color: #ff8f88; }
.al-retry {
  padding: 6px 26px; font-size: 14px; cursor: pointer; border-radius: 4px;
  background: rgba(16, 22, 34, .92); color: #eaf1fb; border: 1px solid #3f5f8c;
}
.al-retry:hover { background: rgba(52, 84, 126, .95); border-color: #8fb6dd; }
</style>
