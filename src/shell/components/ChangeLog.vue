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

// 版本行：v{版本} · {最新版本日期}——两者都在构建期注入（编号 = package.json，
// 日期 = changelog 顶部条目 `## YYYY.M.D`，见 vite.config.js 的一致性校验）。
// 旧口径「进页面当天的日期」已废（应显示最新版本日期）。
const APP_DATE = typeof __CHANGELOG_DATE__ !== 'undefined' ? __CHANGELOG_DATE__ : '';
const VERSION_LINE = `v${APP_VERSION}${APP_DATE ? `（${APP_DATE}）` : ''}`;

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
      // 缓存双保险（版本更新后弹层曾仍显示旧日志——Apache 对 public/ 静态
      // 文件无 no-cache 头，浏览器启发式缓存会拿旧副本）：
      //   · URL 挂构建版本号——每次发版换新地址，旧缓存自然旁路；
      //   · cache: 'no-store'——同版本内改日志（热修补丁）也不再吃缓存。文件很小，全量下载无负担。
      const res = await fetch(`${import.meta.env.BASE_URL}changelog.md?v=${APP_VERSION}`, { cache: 'no-store' });
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
  width: 34px; height: 34px; border-radius: 0;
  border: none; color: #e4e4e4;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; cursor: pointer; user-select: none;
  background: transparent; transition: color .2s;
}
.toggle-icon:hover { background: rgba(0, 0, 0, .55); }
/* 版本 + 日期：标题字族，与图标垂直居中 */
.version-line {
  color: #f2f2f2; font-weight: 400; font-size: 13px; letter-spacing: .5px;
  font-family: var(--font-display);
  user-select: none; white-space: nowrap;
}
/* 面板自图标**向上**展开：版本行占了图标右侧，向下展开会压住它 */
.changelog-content {
  position: absolute; left: 0; bottom: 44px;
  width: 340px; max-height: 62vh; overflow-y: auto;
  background: rgba(10, 10, 10, .96); border: 2px solid #555555; border-radius: 0;
  padding: 14px 18px; color: #c2c2c2; font-size: 13px; line-height: 1.6;
  opacity: 1; transform: translateY(0); transition: opacity .25s, transform .25s;
}
.changelog-content.hidden {
  opacity: 0; transform: translateY(8px); pointer-events: none;
}
.changelog-content-inner h2 { margin: 0 0 8px; font-size: 16px; color: #f2f2f2; font-family: var(--font-display); }
.md-body :deep(h3) { margin: 12px 0 4px; font-size: 14px; color: #f2f2f2; font-family: var(--font-display); }
.md-body :deep(h4) { margin: 10px 0 2px; font-size: 13px; color: #b8b8b8; font-family: var(--font-display); }
.md-body :deep(ul) { margin: 4px 0; padding-left: 18px; }
.md-body :deep(p) { margin: 4px 0; color: #a0a0a0; }
.error { color: #ff7875; }
.empty { color: #a0a0a0; }
</style>
