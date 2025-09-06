<template>
  <div class="battle-screen">
    <!-- 顶部状态面板区域 -->
    <div class="status-panels">
      <!-- 敌人面板 -->
      <div class="enemy-panel" ref="enemyPanel">
        <div class="enemy-header">
          <div>
            <h2 style="color: red; display: inline-block;">敌人：{{ enemy.name }}</h2>
            <span v-if="enemy.isBoss" class="enemy-subtitle"> - {{ enemy.subtitle }}</span>
          </div>
          <div class="enemy-info-button" @mouseenter="showEnemyInfo" @mouseleave="hideEnemyInfo">?</div>
        </div>
        <div class="enemy-stats">
          <div class="stat">
            <span class="stat-label">⚔️ 攻击力:</span>
            <span class="stat-value">{{ enemy.attack }}</span>
          </div>
          <div class="stat">
            <span class="stat-label">🛡️ 防御力:</span>
            <span class="stat-value">{{ enemy.defense }}</span>
          </div>
        </div>
        <div class="health-bar">
          <span>生命值: {{ enemy.hp }}/{{ enemy.maxHp }}</span>
          <div class="bar">
            <div class="fill" :style="{ width: (enemy.hp / enemy.maxHp * 100) + '%' }"></div>
          </div>
        </div>
        <!-- 敌人伤害文本容器 -->
        <div class="damage-text-container" ref="enemyDamageTextContainer"></div>
        <div class="effects">
          <div v-for="(value, key) in enemy.effects">
            <EffectIcon
              v-if="value !== 0" 
              :key="key" 
              :effect-name="key"
              :stack="value"
            />
          </div>
        </div>
      </div>

      <!-- 玩家面板 -->
      <div class="player-panel">
        <div class="player-stats">
          <div class="stat">
            <span class="stat-label">💰 金钱:</span>
            <span class="stat-value">{{ player.money }}</span>
          </div>
          <div class="stat">
            <span class="stat-label">🔮 魏启:</span>
            <span class="stat-value">{{ player.mana }}/{{ player.maxMana }}</span>
          </div>
          <div class="stat">
            <span class="stat-label">⚔️ 攻击力:</span>
            <span class="stat-value">{{ player.attack }}</span>
          </div>
          <div class="stat">
            <span class="stat-label">🛡️ 防御力:</span>
            <span class="stat-value">{{ player.defense }}</span>
          </div>
          <div class="stat">
            <span class="stat-label">🏅 等阶:</span>
            <span class="stat-value">{{ getPlayerTierLabel(player.tier) }}</span>
          </div>
        </div>
        <div class="health-bar" ref="playerHealthBar">
          <span>生命值: {{ player.hp }}/{{ player.maxHp }}</span>
          <div class="bar">
            <div class="fill" :style="{ width: (player.hp / player.maxHp * 100) + '%' }"></div>
          </div>
        </div>
        <!-- 玩家伤害文本容器 -->
        <div class="damage-text-container" ref="playerDamageTextContainer"></div>
        <div class="action-points-bar">
          <div class="action-points-container">
            <span>行动点数:</span>
            <div 
              v-for="n in player.maxActionPoints" 
              :key="n" 
              :class="['action-point', { 'used': n > player.actionPoints }]"
            >
            </div>
            <span>{{ player.actionPoints }}/{{ player.maxActionPoints }}</span>
          </div>
        </div>
        <div class="effects">
          <div v-for="(value, key) in player.effects">
            <EffectIcon
              v-if="value !== 0" 
              :key="key" 
              :effect-name="key"
              :stack="value"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- 战斗日志面板 -->
    <BattleLogPanel 
      :logs="battleLogs" 
      @add-log="addLog"
      @clear-logs="clearLogs"
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
          @skill-card-clicked="useSkill"
        />
      </div>
      <button @click="endTurn" :disabled="!isPlayerTurn || isControlDisabled">结束回合</button>
    </div>
    <div 
      v-if="tooltip.show" 
      class="tooltip" 
      :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }"
    >
      <div class="tooltip-name" :style="{ color: tooltip.color }">{{ tooltip.name }}</div>
      <div class="tooltip-description">{{ tooltip.text }}</div>
    </div>
    
    <!-- 敌人信息悬浮框 -->
    <div 
      v-if="enemyInfo.show" 
      class="enemy-info-tooltip" 
      :style="{ left: enemyInfo.x + 'px', top: enemyInfo.y + 'px' }"
    >
      <div class="enemy-info-content">
        <h3>{{ enemy.name }}</h3>
        <p v-if="enemy.subtitle">{{ enemy.subtitle }}</p>
        <p>{{ enemy.description }}</p>
        <div class="enemy-info-stats">
          <div class="stat">
            <span class="stat-label">⚔️ 攻击力:</span>
            <span class="stat-value">{{ enemy.attack }}</span>
          </div>
          <div class="stat">
            <span class="stat-label">🛡️ 防御力:</span>
            <span class="stat-value">{{ enemy.defense }}</span>
          </div>
          <div class="stat">
            <span class="stat-label">🔮 灵能强度:</span>
            <span class="stat-value">{{ enemy.magic }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import ColoredText from './ColoredText.vue';
import SkillCard from './SkillCard.vue';
import EffectIcon from './EffectIcon.vue';
import BattleLogPanel from './BattleLogPanel.vue';
import effectDescriptions from '../data/effectDescription.js';

export default {
  name: 'BattleScreen',
  components: {
    ColoredText,
    SkillCard,
    EffectIcon,
    BattleLogPanel
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
      // 用于存储上一次的生命值，以便计算伤害
      previousPlayerHp: this.player.hp,
      previousEnemyHp: this.enemy.hp,
      // 用于控制效果描述浮动窗口
      tooltip: {
        show: false,
        x: 0,
        y: 0,
        name: '',
        text: '',
        color: '#000'
      },
      // 用于控制敌人信息悬浮窗口
      enemyInfo: {
        show: false,
        x: 0,
        y: 0
      }
    };
  },
  computed: {
    isPlayerTurn() {
      return this.$parent.isPlayerTurn;
    }
  },
  methods: {
    // 添加日志方法
    addLog(message) {
      this.$emit('update:battle-logs', [...this.battleLogs, message]);
    },
    
    // 清空日志方法
    clearLogs() {
      this.$emit('update:battle-logs', []);
    },

    getPlayerTierLabel(tier) {
      const tierMap = {
        1: '一阶',
        2: '二阶',
        3: '三阶',
        4: '四阶',
        5: '五阶',
        6: '六阶',
        7: '七阶',
        8: '八阶',
        9: '九阶',
        10: '十阶'
      };
      return tierMap[tier] || `${tier}阶`;
    },

    canUseSkill(skill) {
      return skill && skill.canUse && skill.usesLeft !== 0;
    },

    useSkill(skill) {
      this.$emit('use-skill', skill);
    },

    endTurn() {
      this.$emit('end-turn');
    },

    showEnemyInfo(event) {
      const rect = event.target.getBoundingClientRect();
      this.enemyInfo = {
        show: true,
        x: rect.left + 20,
        y: rect.top - 10
      };
    },

    hideEnemyInfo() {
      this.enemyInfo.show = false;
    },

    showTooltip(event, effectName) {
      const description = effectDescriptions[effectName];
      if (description) {
        this.tooltip = {
          show: true,
          x: event.clientX + 10,
          y: event.clientY + 10,
          name: description.name,
          text: description.description,
          color: description.color
        };
      }
    },

    hideTooltip() {
      this.tooltip.show = false;
    },

    // 创建伤害文本动画
    createDamageText(target, damage, type = 'damage') {
      const container = target === 'player' ? 
        this.$refs.playerDamageTextContainer : 
        this.$refs.enemyDamageTextContainer;
      
      if (!container) return;

      const damageText = document.createElement('div');
      damageText.className = `damage-text ${type}`;
      damageText.textContent = type === 'heal' ? `+${damage}` : `-${damage}`;
      
      // 随机位置
      const randomX = Math.random() * 40 - 20;
      const randomY = Math.random() * 20 - 10;
      damageText.style.left = `calc(50% + ${randomX}px)`;
      damageText.style.top = `calc(50% + ${randomY}px)`;
      
      container.appendChild(damageText);
      
      // 动画结束后移除
      setTimeout(() => {
        if (damageText.parentNode) {
          damageText.parentNode.removeChild(damageText);
        }
      }, 1000);
    },

    // 更新战斗日志
    updateBattleLog(newLogs) {
      this.$emit('update:battle-logs', newLogs);
    }
  }
};
</script>

<style scoped>
.battle-screen {
  display: flex;
  flex-direction: column;
  height: 100vh;
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

.enemy-panel {
  flex: 1;
  border: 1px solid #ccc;
  padding: 15px;
  border-radius: 8px;
  background-color: #fff;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.player-panel {
  flex: 1;
  border: 1px solid #ccc;
  padding: 15px;
  border-radius: 8px;
  background-color: #fff;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.enemy-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.enemy-info-button {
  cursor: pointer;
  background-color: #f0f0f0;
  border: 1px solid #ccc;
  border-radius: 50%;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  color: #666;
}

.enemy-info-button:hover {
  background-color: #e0e0e0;
}

.enemy-subtitle {
  font-size: 14px;
  color: #666;
  font-weight: normal;
}

.enemy-stats {
  display: flex;
  gap: 20px;
  margin-bottom: 10px;
}

.player-stats {
  display: flex;
  justify-content: space-between;
  margin-bottom: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid #eee;
  flex-wrap: wrap;
}

.stat {
  display: flex;
  align-items: center;
  margin-right: 15px;
}

.stat-label {
  font-weight: bold;
  margin-right: 5px;
}

.health-bar {
  margin-bottom: 10px;
}

.bar {
  width: 100%;
  height: 20px;
  background-color: #f0f0f0;
  border-radius: 10px;
  overflow: hidden;
  margin-top: 5px;
}

.fill {
  height: 100%;
  background-color: #4caf50;
  transition: width 0.3s ease;
}

.enemy-panel .fill {
  background-color: #f44336;
}

.action-points-bar {
  margin-bottom: 10px;
}

.action-points-container {
  display: flex;
  align-items: center;
  gap: 10px;
}

.action-point {
  width: 20px;
  height: 20px;
  background-color: #2196f3;
  border-radius: 50%;
  transition: background-color 0.3s;
}

.action-point.used {
  background-color: #ccc;
}

.effects {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.damage-text-container {
  position: relative;
  height: 0;
  overflow: visible;
  pointer-events: none;
}

.damage-text {
  position: absolute;
  font-weight: bold;
  font-size: 24px;
  pointer-events: none;
  z-index: 1000;
  animation: damageFloat 1s ease-out forwards;
}

.damage-text.red {
  color: #ff0000;
  font-size: 48px;
  font-weight: bold;
}

.damage-text.orange {
  color: #ff6600;
  font-size: 40px;
  font-weight: bold;
}

.damage-text.white {
  color: #ff0000;
  font-size: 32px;
  font-weight: bold;
}

@keyframes damageFloat {
  0% {
    opacity: 1;
    transform: translateY(0);
  }
  100% {
    opacity: 0;
    transform: translateY(-50px);
  }
}

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

.tooltip {
  position: fixed;
  background-color: rgba(0, 0, 0, 0.8);
  color: white;
  padding: 10px;
  border-radius: 4px;
  font-size: 14px;
  z-index: 1000;
  max-width: 300px;
  word-wrap: break-word;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.enemy-info-tooltip {
  position: fixed;
  background-color: rgba(0, 0, 0, 0.9);
  color: white;
  padding: 15px;
  border-radius: 8px;
  z-index: 1000;
  min-width: 250px;
  max-width: 400px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}

.enemy-info-content h3 {
  margin-top: 0;
  margin-bottom: 10px;
  color: #ff6666;
}

.enemy-info-content p {
  margin: 5px 0;
  font-size: 0.9em;
  line-height: 1.4;
}

.enemy-info-stats {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid #555;
}

.enemy-info-stats .stat {
  margin-right: 20px;
  margin-bottom: 5px;
}

/* 结算动画 */
.settlement-animation {
  animation: settlementFlash 1s ease-in-out;
}

@keyframes settlementFlash {
  0% { opacity: 1; }
  50% { opacity: 0.5; background-color: rgba(255, 255, 0, 0.2); }
  100% { opacity: 1; }
}

/* 效果名称样式 */
.tooltip-name {
  font-weight: bold;
  margin-bottom: 5px;
  font-size: 16px;
}

/* 效果描述样式 */
.tooltip-description {
  font-size: 14px;
}
</style>
