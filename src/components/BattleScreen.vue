<template>
  <div class="battle-screen">
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
      :logs="battleLogs" 
      :enemy="enemy"
    />
    
    <!-- 操作面板 -->
    <div class="action-panel" :class="{ 'disabled': !isPlayerTurn || isControlDisabled }">
      <div class="skills">
        <SkillCard
          v-for="(skill, index) in player.skillSlots.filter(skill => skill !== null)" 
          :key="index"
          :skill="skill"
          :disabled="!canUseSkill(skill) || !isPlayerTurn || isControlDisabled"
          :player-mana="player.mana"
          @skill-card-clicked="onSkillCardClicked"
        />
      </div>
      <button @click="onEndTurnButtonClicked" :disabled="!isPlayerTurn || isControlDisabled">结束回合</button>
    </div>
  </div>
</template>

<script>
import BattleLogPanel from './BattleLogPanel.vue';
import EnemyStatusPanel from './EnemyStatusPanel.vue';
import PlayerStatusPanel from './PlayerStatusPanel.vue';
import SkillCard from './SkillCard.vue';
import effectDescriptions from '../data/effectDescription.js';
import { useSkill, endPlayerTurn } from '../data/battle.js';
import gameState from '../data/gameState.js';

export default {
  name: 'BattleScreen',
  components: {
    BattleLogPanel,
    EnemyStatusPanel,
    PlayerStatusPanel,
    SkillCard
  },
  props: {
    player: {
      type: Object,
      required: true
    },
    enemy: {
      type: Object,
      required: true
    },
    battleLogs: {
      type: Array,
      default: () => []
    },
    isControlDisabled: {
      type: Boolean,
      default: false
    }
  },
  data() {
    return {
      // 用于控制效果描述浮动窗口
      tooltip: {
        show: false,
        x: 0,
        y: 0,
        name: '',
        text: '',
        color: '#000'
      }
    };
  },
  computed: {
    isPlayerTurn() {
      return gameState.isPlayerTurn;
    }
  },
  methods: {

    canUseSkill(skill) {
      return skill && skill.canUse(gameState.player) && skill.usesLeft !== 0;
    },

    onSkillCardClicked(skill) {
      if(this.canUseSkill(skill)) {
        useSkill(skill);
      }
    },

    onEndTurnButtonClicked() {
      endPlayerTurn();
    }
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
  height: 100%;
  padding: 20px;
  box-sizing: border-box;
}

/* 顶部状态面板区域 */
.status-panels {
  display: flex;
  gap: 20px;
  margin-bottom: 20px;
  min-height: 200px;
}

/* 操作面板 */
.action-panel {
  border: 1px solid #ccc;
  padding: 15px;
  border-radius: 8px;
  background-color: #fff;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.action-panel.disabled {
  opacity: 0.6;
  pointer-events: none;
}

.skills {
  display: flex;
  flex-wrap: wrap;
  gap: 15px;
  margin-bottom: 15px;
}

</style>
