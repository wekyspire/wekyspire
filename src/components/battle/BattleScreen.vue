<template>
  <div class="battle-screen">
    <!-- 战斗场次 -->
    <h3 style="color: white;"> 第{{ level }}层 </h3>
    <!-- 顶部状态面板区域 -->
    <div class="status-panels">
      <!-- 敌人状态面板 -->
      <EnemyStatusPanel 
        :enemy="enemy"
        :z-index="2"
        ref="enemyStatusPanel"
      />

      <!-- 玩家状态面板 -->
      <PlayerStatusPanel 
        :player="player"
        ref="playerStatusPanel"
      />
    </div>

    <!-- 战斗日志面板 -->
    <BattleLogPanel 
      :logs="logs"
      :enemy="enemy"
    />

    <!-- 操作面板 -->
    <ActionPanel
      :player="player"
      :is-player-turn="isPlayerTurn"
    />

    <!-- 新增：临时技能覆盖容器（用于新发现技能动画、未来战斗中选牌等） -->
    <OverlaySkillsPanel :player="player" />
  </div>
</template>

<script>
import BattleLogPanel from './BattleLogPanel.vue';
import EnemyStatusPanel from './EnemyStatusPanel.vue';
import PlayerStatusPanel from '../global/PlayerStatusPanel.vue';
import ActionPanel from './ActionPanel.vue';
import OverlaySkillsPanel from './OverlaySkillsPanel.vue';
import frontendEventBus from '../../frontendEventBus.js';

export default {
  name: 'BattleScreen',
  components: {
    BattleLogPanel,
    EnemyStatusPanel,
    PlayerStatusPanel,
    ActionPanel,
    OverlaySkillsPanel,
  },
  props: {
    player: { type: Object, required: true },
    enemy: { type: Object, required: true },
    isPlayerTurn: { type: Boolean, default: true },
    level: { type: Number, default: 1 }
  },
  data() {
    return {
      logs: [],
    };
  },
  mounted() {
    frontendEventBus.on('add-battle-log', this.onAddBattleLog);
    frontendEventBus.on('clear-battle-log', this.onClearBattleLog);
  },
  beforeUnmount() {
    frontendEventBus.off('add-battle-log', this.onAddBattleLog);
    frontendEventBus.off('clear-battle-log', this.onClearBattleLog);
  },
  methods: {
    onAddBattleLog(value) {
      // 兼容字符串与对象格式
      this.logs.push(value);
    },
    onClearBattleLog() {
      this.logs = [];
    },
  }
};
</script>

<style scoped>
.battle-screen {
  margin: 0 auto;
  max-width: 1200px;
  height:100vh;
  display: flex;
  flex-direction: column;
  padding: 20px;
  box-sizing: border-box;
  position: relative;
}

/* 顶部状态面板区域 */
.status-panels {
  display: flex;
  justify-content: space-between; /* 左右贴边对齐 */
  align-items: flex-start;
  gap: 20px;
  margin-bottom: 20px;
  min-height: 200px;
}
/* 确保面板保持各自的固定宽度，不被拉伸或压缩 */
.status-panels > * {
  flex: 0 0 auto;
}
</style>
