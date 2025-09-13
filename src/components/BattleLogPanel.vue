<template>
  <div class="battle-log" ref="battleLog">
    <div 
      v-for="(log, index) in logs" 
      :key="index"
      :class="getLogClass(log)"
      class="log-entry"
    >
      <span class="log-icon">{{ getLogIcon(log) }}</span>
      <ColoredText :text="typeof log === 'string' ? log : log.log" />
    </div>
  </div>
</template>

<script>
import ColoredText from './ColoredText.vue';

export default {
  name: 'BattleLogPanel',
  components: {
    ColoredText
  },
  props: {
    logs: {
      type: Array,
      default: () => []
    },
    enemy: {
      type: Object,
      default: () => null
    }
  },
  watch: {
    logs: {
      handler() {
        this.$nextTick(() => {
          this.scrollToBottom();
        });
      },
      deep: true
    }
  },
  methods: {
    scrollToBottom() {
      const logContainer = this.$refs.battleLog;
      if (logContainer) {
        logContainer.scrollTop = logContainer.scrollHeight;
      }
    },
    getLogClass(log) {
      // 处理旧的字符串格式和新的对象格式
      if (typeof log === 'string') {
        // 旧的字符串格式，使用简单的文本匹配
        if (log.includes('你')) {
          return 'player-log';
        } else if (log.includes('敌人') || (this.enemy && log.includes(this.enemy.name || '敌人'))) {
          return 'enemy-log';
        } else {
          return 'other-log';
        }
      } else {
        // 新的对象格式，使用type属性
        switch (log.type) {
          case 'player_action':
            return 'player-log';
          case 'enemy_action':
          case 'damage':
          case 'death':
            return 'enemy-log';
          case 'system':
          case 'heal':
          case 'effect':
            return 'other-log';
          default:
            return 'other-log';
        }
      }
    },
    getLogIcon(log) {
      return '📝';
    }
  }
};
</script>

<style scoped>
.battle-log {
  flex: 1;
  border: 1px solid #ccc;
  padding: 10px;
  margin: 10px 0;
  overflow-y: auto;
  max-height: 300px;
  background-color: #f9f9f9;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.battle-log::-webkit-scrollbar {
  width: 8px;
}

.battle-log::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 4px;
}

.battle-log::-webkit-scrollbar-thumb {
  background: #c1c1c1;
  border-radius: 4px;
}

.battle-log::-webkit-scrollbar-thumb:hover {
  background: #a8a8a8;
}

.log-entry {
  padding: 8px 12px;
  margin-bottom: 8px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  animation: fadeIn 0.3s ease-in;
}

.log-entry:last-child {
  margin-bottom: 0;
}

.log-icon {
  margin-right: 8px;
  font-size: 16px;
  min-width: 20px;
}

.player-log {
  background-color: #e3f2fd;
  border-left: 4px solid #2196f3;
}

.enemy-log {
  background-color: #ffebee;
  border-left: 4px solid #f44336;
}

.other-log {
  background-color: #fffde7;
  border-left: 4px solid #ffc107;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>