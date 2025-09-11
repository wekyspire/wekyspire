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
        <transition-group name="card-movement">
        <SkillCard
          v-for="(skill, index) in player.frontierSkills.filter(skill => skill !== null)" 
          :key="skill.uniqueID"
          :skill="skill"
          :disabled="!canUseSkill(skill) || !isPlayerTurn || isControlDisabled"
          :player-mana="player.mana"
          @skill-card-clicked="onSkillCardClicked"
        />
        </transition-group>
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
import eventBus from '../eventBus.js';
import { Transition } from 'vue';

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

    onSkillCardClicked(skill, event) {
      if(this.canUseSkill(skill)) {
        // 记录技能消耗的魏启和行动点
        const manaCost = skill.manaCost;
        const actionPointCost = skill.actionPointCost;
        
        // 获取鼠标点击位置
        const mouseX = event.clientX;
        const mouseY = event.clientY;
        
        // 使用技能
        useSkill(skill);
        
        // 生成粒子效果
        this.generateParticleEffects(manaCost, actionPointCost, mouseX, mouseY);
      }
    },

    onEndTurnButtonClicked() {
      endPlayerTurn();
    },
    
    /**
     * 生成粒子效果
     * @param {number} manaCost - 魏启消耗
     * @param {number} actionPointCost - 行动点消耗
     * @param {number} mouseX - 鼠标X坐标
     * @param {number} mouseY - 鼠标Y坐标
     */
    generateParticleEffects(manaCost, actionPointCost, mouseX, mouseY) {
      // 生成粒子数组
      const particles = [];
      
      // 生成魏启消耗的蓝色粒子
      if (manaCost > 0) {
        for (let i = 0; i < 2 + manaCost * 8; i++) {
          particles.push({
            x: mouseX,
            y: mouseY,
            vx: (Math.random() - 0.5) * 100, // 随机水平速度
            vy: (Math.random() - 0.5) * 100 - 50, // 随机垂直速度，向上偏移
            color: '#2196f3', // 蓝色
            life: 2000, // 生命周期2秒
            gravity: 400, // 重力
            size: 3 + Math.random() * 2 // 随机大小
          });
        }
      }
      
      // 生成行动点消耗的黄色粒子
      if (actionPointCost > 0) {
        for (let i = 0; i < 2 + actionPointCost * 8; i++) {
          particles.push({
            x: mouseX,
            y: mouseY,
            vx: (Math.random() - 0.5) * 100, // 随机水平速度
            vy: (Math.random() - 0.5) * 100 - 50, // 随机垂直速度，向上偏移
            color: '#FFD700', // 黄色
            life: 2000, // 生命周期2秒
            gravity: 400, // 重力
            size: 3 + Math.random() * 2 // 随机大小
          });
        }
      }
      
      // 发射粒子生成事件
      eventBus.emit('spawn-particles', particles);
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
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 15px;
  margin-bottom: 15px;
  position: relative;
}

.card-movement-enter-from,
.card-movement-leave-to {
  opacity: 0;
  transform: translateY(-50px);
}
.card-movement-move,
.card-movement-enter-active,
.card-movement-leave-active {
  transition: all 0.3s ease;
}
</style>
