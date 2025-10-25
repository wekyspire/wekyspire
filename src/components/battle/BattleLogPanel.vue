<template>
  <div :class="['battle-log', {'hide-scrool-bar': !isHovered}]" ref="battleLog"
  @mouseenter="isHovered = true" @mouseleave="isHovered = false">
    <transition-group name="vertical-popup" appear>
      <div
        v-for="(item, index) in displayedLogs"
        :key="item.key"
        :class="getLogClass(item.value)"
        class="log-entry"
        :style="{opacity: getEntryOpacity(index)}"
      >
        <span class="log-icon">{{ getLogIcon(item.value) }}</span>
        <ColoredText :text="typeof item.value === 'string' ? item.value : item.value.log" />
      </div>
    </transition-group>
  </div>
</template>

<script>
import ColoredText from '../global/ColoredText.vue';

export default {
  name: 'BattleLogPanel',
  components: { ColoredText },
  props: {
    logs: { type: Array, default: () => [] },
    enemy: { type: Object, default: () => null }
  },
  data() {
    return {
      displayedLogs: [],       // [{ value: 原始日志, key: 唯一键 }]
      isHovered: false,       // 鼠标悬停时显示滚动条且不自动滚动
      // 逐条显示相关状态
      _revealQueue: [],        // 等待显示的日志队列（按时间顺序）
      _revealing: false,       // 是否正在逐条显示
      _revealTimer: null,      // 计时器句柄
      revealIntervalMs: 200,   // 每条日志出现的间隔
      _idCounter: 0,           // 用于为每条日志分配稳定的 key
    };
  },
  mounted() {
    // 初始渲染：最新在最上，因此反转顺序并分配稳定 key
    this.displayedLogs = this.wrapWithKeys([...this.logs].reverse());
    this.$nextTick(this.scrollToTop);
  },
  beforeUnmount() {
    this.clearRevealTimer();
  },
  watch: {
    logs: {
      handler(newLogs) {
        this.onLogsPropChanged(newLogs);
      },
      deep: true
    }
  },
  methods: {
    wrapWithKeys(arr) {
      return arr.map(v => ({ value: v, key: ++this._idCounter }));
    },
    // 处理外部日志变更：newLogs 是按时间顺序（旧->新）
    // 组件内部 displayedLogs 是最新在最上（新->旧）。
    onLogsPropChanged(newLogs) {
      // 当前内部列表还原为时间顺序（旧->新）以比较前缀
      const currChrono = this.displayedLogs.map(d => d.value).slice().reverse();
      const prefixLen = this.commonPrefixLen(currChrono, newLogs);
      // 若大小变小或前缀不一致（重置/清空/替换），直接同步渲染
      if (newLogs.length < currChrono.length || prefixLen < currChrono.length) {
        this.displayedLogs = this.wrapWithKeys([...newLogs].reverse());
        this._revealQueue = [];
        this._revealing = false;
        this.clearRevealTimer();
        this.$nextTick(this.scrollToTop);
        return;
      }
      // 仅对“追加到末尾”的部分做逐条展示
      const toAppend = newLogs.slice(currChrono.length);
      if (toAppend.length === 0) return;
      this._revealQueue.push(...toAppend);
      if (!this._revealing) this.processRevealQueue();
    },
    getEntryOpacity(index) {
      if(this.isHovered) return 1.0; // 鼠标悬停时全部不透明
      // 最新在最上（index 越小越新），越旧的日志越透明
      const maxVisible = 1; // 顶部多少条完全不透明
      const fadeRange = 5;  // 渐隐范围
      if (index < maxVisible) return 1.0;
      const opacity = Math.max(1 - (index - maxVisible + 1) / fadeRange, 0);
      return opacity;
    },
    commonPrefixLen(a, b) {
      const n = Math.min(a.length, b.length);
      for (let i = 0; i < n; i++) {
        if (!this.isSameLog(a[i], b[i])) return i;
      }
      return n;
    },
    isSameLog(a, b) {
      if (typeof a === 'string' && typeof b === 'string') return a === b;
      if (typeof a === 'object' && typeof b === 'object' && a && b) {
        // 尽量轻量的比较：同 type 且同 log 文本即视为相同
        return a.type === b.type && a.log === b.log;
      }
      return false;
    },
    processRevealQueue() {
      if (this._revealQueue.length === 0) {
        this._revealing = false;
        return;
      }
      this._revealing = true;
      const next = this._revealQueue.shift();
      // 最新的插入到顶部
      this.displayedLogs.unshift({ value: next, key: ++this._idCounter });
      if (!this.isHovered) this.$nextTick(this.scrollToTop);
      this._revealTimer = setTimeout(() => this.processRevealQueue(), this.revealIntervalMs);
    },
    clearRevealTimer() {
      if (this._revealTimer) {
        clearTimeout(this._revealTimer);
        this._revealTimer = null;
      }
    },
    scrollToTop() {
      const logContainer = this.$refs.battleLog;
      if (logContainer) logContainer.scrollTop = 0;
    },
    getLogClass(log) {
      // 处理旧的字符串格式和新的对象格式
      if (typeof log === 'string') {
        if (log.includes('你')) return 'player-log';
        else if (log.includes('敌人') || (this.enemy && log.includes(this.enemy.name || '敌人'))) return 'enemy-log';
        else return 'other-log';
      } else {
        switch (log.type) {
          case 'player_action': return 'player-log';
          case 'enemy_action':
          case 'damage':
          case 'death': return 'enemy-log';
          case 'system':
          case 'heal':
          case 'effect': return 'other-log';
          default: return 'other-log';
        }
      }
    },
    getLogIcon() {
      return '📝';
    }
  }
};
</script>

<style scoped>
.battle-log {
  flex: 1;
  justify-content: center;
  flex-direction: column;
  padding: 10px;
  margin: 10px 0;
  overflow-y: auto;
  max-height: 300px;
}

.battle-log.hide-scrool-bar::-webkit-scrollbar { display: none; }
.battle-log.hide-scrool-bar { -ms-overflow-style: none; scrollbar-width: none; }

.battle-log::-webkit-scrollbar { width: 8px; }
.battle-log::-webkit-scrollbar-track { background: #f1f1f1; border-radius: 4px; }
.battle-log::-webkit-scrollbar-thumb { background: #c1c1c1; border-radius: 4px; }
.battle-log::-webkit-scrollbar-thumb:hover { background: #a8a8a8; }

.log-entry {
  padding: 8px 12px;
  margin-bottom: 8px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  width: fit-content;
  transition: opacity 0.5s ease;
}
.log-entry:last-child { margin-bottom: 0; }

.log-icon { margin-right: 8px; font-size: 16px; min-width: 20px; }

.player-log { background-color: #e3f2fd; border-left: 4px solid #2196f3; }
.enemy-log { background-color: #ffebee; border-left: 4px solid #f44336; }
.other-log { background-color: #fffde7; border-left: 4px solid #ffc107; }

/* 使用 transition-group 控制入场/离场动画，从顶部下滑出现 */
.vertical-popup-enter-active, .vertical-popup-leave-active {
  transition: opacity 0.5s ease, transform 0.5s ease;
}
/* 使用 !important 覆盖内联样式中的 opacity，保证过渡生效 */
.vertical-popup-enter-from, .vertical-popup-leave-to {
  opacity: 0 !important;
  transform: translateY(-10px);
}
.vertical-popup-enter-to, .vertical-popup-leave-from {
  opacity: 1 !important;
  transform: translateY(0);
}
</style>