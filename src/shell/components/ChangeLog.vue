<script setup>
// 更新日志弹层（沿用旧版交互）：悬停 "?" 展开，fetch public/changelog.md，
// 轻量 markdown → HTML（标题/列表/段落，转义防注入）。
import { ref } from 'vue';
import { APP_VERSION } from '../version';

const show = ref(false);
const error = ref('');
const contentHtml = ref('');
let hideTimer = null;
let loading = null;

// 版本行：v{版本} · {进入页面的当天日期}（版本取自 package.json，见 shell/version.js）
const pad2 = (n) => String(n).padStart(2, '0');
const now = new Date();
const VERSION_LINE = `v${APP_VERSION} · ${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

function escapeHtml(s) {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function parseMarkdown(md) {
  const lines = md.replaceAll('\r\n', '\n').split('\n');
  const out = [];
  let inList = false;
  const flushList = () => {
    if (inList) { out.push('</ul>'); inList = false; }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith('### ')) { flushList(); out.push(`<h4>${escapeHtml(line.slice(4))}</h4>`); }
    else if (line.startsWith('## ')) { flushList(); out.push(`<h3>${escapeHtml(line.slice(3))}</h3>`); }
    else if (line.startsWith('# ')) { flushList(); out.push(`<h2>${escapeHtml(line.slice(2))}</h2>`); }
    else if (/^[-*]\s+/.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${escapeHtml(line.replace(/^[-*]\s+/, ''))}</li>`);
    } else if (line.trim() === '') {
      flushList();
    } else {
      flushList();
      out.push(`<p>${escapeHtml(line)}</p>`);
    }
  }
  flushList();
  return out.join('\n');
}

async function ensureLoaded() {
  loading ??= (async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}changelog.md`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      contentHtml.value = parseMarkdown(await res.text());
    } catch (e) {
      error.value = e.message || String(e);
    }
  })();
  return loading;
}

function onEnter() {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  ensureLoaded();
  show.value = true;
}
function onLeave() {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { show.value = false; hideTimer = null; }, 400); // 延迟关闭防抖
}
</script>

<template>
  <div class="changelog-container" @mouseenter="onEnter" @mouseleave="onLeave">
    <div class="toggle-icon">?</div>
    <div class="version-line">{{ VERSION_LINE }}</div>
    <div class="changelog-content" :class="{ hidden: !show }">
      <div class="changelog-content-inner">
        <h2>更新日志</h2>
        <div v-if="error" class="error">加载失败：{{ error }}</div>
        <div v-else-if="!contentHtml" class="empty">加载中…</div>
        <div v-else class="md-body" v-html="contentHtml"></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.changelog-container {
  position: absolute; left: 26px; bottom: 22px; z-index: 5;
  display: flex; align-items: center; gap: 10px; /* 图标 + 版本行同一行 */
}
.toggle-icon {
  width: 34px; height: 34px; border-radius: 50%;
  border: 1px solid rgba(255, 231, 179, .55); color: #ffe7b3;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; cursor: pointer; user-select: none;
  background: rgba(20, 24, 44, .55); transition: background .2s;
}
.toggle-icon:hover { background: rgba(60, 52, 30, .8); }
/* 版本 + 日期：白色普通字体（不带粗体/描边），与图标垂直居中 */
.version-line {
  color: #fff; font-weight: 400; font-size: 13px; letter-spacing: .5px;
  user-select: none; white-space: nowrap;
}
/* 面板自图标**向上**展开：版本行占了图标右侧，向下展开会压住它 */
.changelog-content {
  position: absolute; left: 0; bottom: 44px;
  width: 340px; max-height: 62vh; overflow-y: auto;
  background: rgba(10, 14, 26, .95); border: 1px solid #38415e; border-radius: 10px;
  padding: 14px 18px; color: #cdd6f4; font-size: 13px; line-height: 1.6;
  opacity: 1; transform: translateY(0); transition: opacity .25s, transform .25s;
}
.changelog-content.hidden {
  opacity: 0; transform: translateY(8px); pointer-events: none;
}
.changelog-content-inner h2 { margin: 0 0 8px; font-size: 16px; color: #ffe7b3; }
.md-body :deep(h3) { margin: 12px 0 4px; font-size: 14px; color: #ffd75e; }
.md-body :deep(h4) { margin: 10px 0 2px; font-size: 13px; color: #9ad0ff; }
.md-body :deep(ul) { margin: 4px 0; padding-left: 18px; }
.md-body :deep(p) { margin: 4px 0; color: #9aa3c0; }
.error { color: #ff7875; }
.empty { color: #9aa3c0; }
</style>
