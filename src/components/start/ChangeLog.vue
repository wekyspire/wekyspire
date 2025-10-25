<template>
  <div class="changelog-container">
    <div class="changelog-toggle" @mouseenter="onEnter" @mouseleave="onLeave">
      <div class="toggle-icon">≡</div>
      <div class="changelog-content" :class="{ hidden: !show }">
        <div class="changelog-content-inner">
          <h2>更新日志</h2>
          <div v-if="error" class="error">加载失败：{{ error }}</div>
          <div v-else-if="!contentHtml" class="empty">暂无内容</div>
          <div v-else class="md-body" v-html="contentHtml"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'ChangeLog',
  data() {
    return {
      show: false,
      error: '',
      contentHtml: '',
      hideTimer: null
    };
  },
  methods: {
    onEnter() {
      if (this.hideTimer) {
        clearTimeout(this.hideTimer);
        this.hideTimer = null;
      }
      this.show = true;
    },
    onLeave() {
      if (this.hideTimer) clearTimeout(this.hideTimer);
      this.hideTimer = setTimeout(() => {
        this.show = false;
        this.hideTimer = null;
      }, 600); // 延迟关闭
    },
    // 非常轻量的 Markdown -> HTML 转换（支持标题、无序列表、段落）
    parseMarkdown(md) {
      // 转义 HTML 以避免注入
      const escapeHtml = (s) => s
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');

      const lines = md.replaceAll('\r\n', '\n').split('\n');
      const out = [];
      let inList = false;

      const flushList = () => {
        if (inList) {
          out.push('</ul>');
          inList = false;
        }
      };

      for (let raw of lines) {
        const line = raw.trimEnd();
        if (line.startsWith('### ')) {
          flushList();
          out.push(`<h4>${escapeHtml(line.slice(4))}</h4>`);
        } else if (line.startsWith('## ')) {
          flushList();
          out.push(`<h3>${escapeHtml(line.slice(3))}</h3>`);
        } else if (line.startsWith('# ')) {
          flushList();
          out.push(`<h2>${escapeHtml(line.slice(2))}</h2>`);
        } else if (/^[-*]\s+/.test(line)) {
          if (!inList) {
            out.push('<ul>');
            inList = true;
          }
          out.push(`<li>${escapeHtml(line.replace(/^[-*]\s+/, ''))}</li>`);
        } else if (line.trim() === '') {
          flushList();
          out.push('<br/>');
        } else {
          flushList();
          out.push(`<p>${escapeHtml(line)}</p>`);
        }
      }
      flushList();
      return out.join('\n');
    }
  },
  async mounted() {
    try {
      const res = await fetch('changelog.md', { cache: 'no-cache' });
      if (!res.ok) {
        this.error = `HTTP ${res.status}`;
        return;
      }
      const md = await res.text();
      const trimmed = md.trim();
      if (!trimmed) {
        this.contentHtml = '';
      } else {
        this.contentHtml = this.parseMarkdown(trimmed);
      }
    } catch (e) {
      this.error = String(e?.message || e);
    }
  }
};
</script>

<style scoped>
.changelog-container {
  position: absolute;
  right: 80px;
  top: 20px;
  display: flex;
}

.changelog-toggle {
  display: flex;
  flex-direction: row-reverse;
}

.toggle-icon {
  width: 30px;
  height: 30px;
  background: #6a6a6a;
  border: 1px solid #ccc;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 20px;
  font-weight: bold;
  user-select: none;
  color: white;
}

.changelog-content {
  width: 420px;
  overflow: hidden;
  background: rgb(150, 150, 150);
  margin-right: 10px;
  transition: width 0.3s ease;
  white-space: nowrap;
  text-align: left;
  max-height: 60vh; /* 加入滚动条 */
  overflow-y: auto;
}

.changelog-content.hidden {
  width: 0;
}

.changelog-content-inner {
  margin: 10px;
  width: 420px; /* 固定内容宽度，防止折叠时宽度下降导致的重新排版 */
}

.changelog-content h2 {
  margin-top: 0;
  font-size: 1.2em;
}

/* Markdown 渲染的基础样式 */
.md-body {
  white-space: normal;
}

.md-body :deep() h4, .md-body :deep() h3, .md-body :deep() h2 {
  margin: 0;
}

.error {
  color: #300;
  background: #fdd;
  border: 1px solid #f99;
  padding: 6px 8px;
  border-radius: 4px;
}

.empty {
  color: #222;
}
</style>
