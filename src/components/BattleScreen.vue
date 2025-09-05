<template>
  <div class="battle-screen">
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
    
    <!-- 战斗日志面板 -->
    <div class="battle-log" ref="battleLog">
      <div 
        v-for="(log, index) in battleLogs" 
        :key="index"
        :class="getLogClass(log)"
        class="log-entry"
      >
        <span class="log-icon">{{ getLogIcon(log) }}</span>
        <ColoredText :text="log" />
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
    
    <!-- 操作面板 -->
    <div class="action-panel" :class="{ 'disabled': !isPlayerTurn }">
      <div class="skills">
        <SkillCard
          v-for="(skill, index) in player.skillSlots.filter(skill => skill !== null)" 
          :key="index"
          :skill="skill"
          :disabled="!canUseSkill(skill) || !isPlayerTurn"
          :player-mana="player.mana"
          @skill-card-clicked="useSkill"
        />
      </div>
      <button @click="endTurn" :disabled="!isPlayerTurn">结束回合</button>
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
import effectDescriptions from '../data/effectDescription.js';

export default {
  name: 'BattleScreen',
  components: {
    ColoredText,
    SkillCard,
    EffectIcon
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
        text: '',
        x: 0,
        y: 0
      },
      // 用于控制敌人信息浮动窗口
      enemyInfo: {
        show: false,
        x: 0,
        y: 0
      },
      // 用于控制操作面板是否可交互
      isPlayerTurn: true
    };
  },
  methods: {
    // 滚动到最新的日志条目
    scrollToBottom() {
      this.$nextTick(() => {
        const battleLog = this.$refs.battleLog;
        if (battleLog) {
          // 确保在DOM更新完成后再执行滚动操作
          setTimeout(() => {
            battleLog.scrollTop = battleLog.scrollHeight;
          }, 0);
        }
      });
    },
    
    // 显示敌人信息
    showEnemyInfo(event) {
      this.enemyInfo.show = true;
      this.enemyInfo.x = event.clientX;
      this.enemyInfo.y = event.clientY;
    },
    
    // 隐藏敌人信息
    hideEnemyInfo() {
      this.enemyInfo.show = false;
    },
    
    // 显示伤害文本
    showDamageText(target, damage) {
      // 创建伤害文本元素
      const damageText = document.createElement('div');
      damageText.className = 'damage-text';
      damageText.textContent = `-${damage}`;
      
      // 根据伤害值设置样式
      if (damage > 20) {
        damageText.style.color = '#ff0000';
        damageText.style.fontSize = '48px';
        damageText.style.fontWeight = 'bold';
      } else if (damage > 10) {
        damageText.style.color = '#ff6600';
        damageText.style.fontSize = '40px';
        damageText.style.fontWeight = 'bold';
      } else {
        damageText.style.color = '#ff0000';
        damageText.style.fontSize = '32px';
        damageText.style.fontWeight = 'bold';
      }
      
      // 将伤害文本添加到对应的容器中
      if (target === 'player') {
        this.$refs.playerDamageTextContainer.appendChild(damageText);
      } else if (target === 'enemy') {
        this.$refs.enemyDamageTextContainer.appendChild(damageText);
      }
      
      // 添加动画效果
      damageText.style.opacity = '1';
      damageText.style.transform = 'translateY(0)';
      
      // 一段时间后淡出并移除
      setTimeout(() => {
        damageText.style.transition = 'opacity 1s, transform 1s';
        damageText.style.opacity = '0';
        damageText.style.transform = 'translateY(-50px)';
        
        // 动画结束后移除元素
        setTimeout(() => {
          if (damageText.parentNode) {
            damageText.parentNode.removeChild(damageText);
          }
        }, 1000);
      }, 1000);
    },

    getEffectColor(effectName) {
      return effectDescriptions[effectName]?.color || '#000000';
    },
    
    // 显示效果变化文本
    showEffectChangeText(target, effectName, deltaStacks) {
      
      // 检查参数是否有效
      if (!effectName || isNaN(deltaStacks)) {
        console.error('Invalid effect parameters:', { target, effectName, deltaStacks });
        return;
      }
      
      // 创建效果变化文本元素
      const effectText = document.createElement('div');
      effectText.className = 'effect-change-text';
      
      // 获取效果颜色
      const effectColor = this.getEffectColor(effectName);
      
      // 根据层数变化设置文本内容和样式
      const stackColor = deltaStacks > 0 ? '#00ff00' : '#ff0000'; // 正数为绿色，负数为红色
      if (deltaStacks > 0) {
        effectText.innerHTML = `获得 <span style="color: ${effectColor}">${effectName}</span> <span style="color: ${stackColor}">x${deltaStacks}</span>`;
      } else {
        effectText.innerHTML = `<span style="color: #cccccc;">失去 <span style="color: ${effectColor}">${effectName}</span> <span style="color: ${stackColor}">x${Math.abs(deltaStacks)}</span></span>`;
      }
      
      // 设置样式
      effectText.style.color = effectColor;
      effectText.style.fontSize = '24px';
      effectText.style.fontWeight = 'bold';
      effectText.style.position = 'absolute';
      effectText.style.zIndex = '1000';
      
      // 将效果变化文本添加到对应的容器中
      if (target === 'player' && this.$refs.playerDamageTextContainer) {
        this.$refs.playerDamageTextContainer.appendChild(effectText);
      } else if (target === 'enemy' && this.$refs.enemyDamageTextContainer) {
        this.$refs.enemyDamageTextContainer.appendChild(effectText);
      }
      
      // 添加动画效果
      effectText.style.opacity = '1';
      effectText.style.transform = 'translateY(0)';
      
      // 一段时间后淡出并移除
      setTimeout(() => {
        effectText.style.transition = 'opacity 1s, transform 1s';
        effectText.style.opacity = '0';
        effectText.style.transform = 'translateY(-50px)';
        
        // 动画结束后移除元素
        setTimeout(() => {
          if (effectText.parentNode) {
            effectText.parentNode.removeChild(effectText);
          }
        }, 1000);
      }, 1000);
    },
    
    // 播放抖动特效
    playShakeAnimation(target) {
      let element;
      if (target === 'player') {
        element = this.$refs.playerHealthBar;
      } else if (target === 'enemy') {
        element = this.$refs.enemyPanel;
      }
      
      if (element) {
        // 添加抖动类
        element.classList.add('shake');
        
        // 一段时间后移除抖动类
        setTimeout(() => {
          element.classList.remove('shake');
        }, 500);
      }
    },
    canUseSkill(skill) {
      return skill && typeof skill.canUse === 'function' && skill.canUse(this.player);
    },
    useSkill(skill) {
      if (this.canUseSkill(skill)) {
        this.$emit('use-skill', skill);
      }
    },
    endTurn() {
      this.$emit('end-turn');
    },
    // 获取技能等阶标签
    getTierLabel(tier) {
      const tierLabels = {
        '-1': 'S',
        '0': 'D',
        '1': 'C-',
        '2': 'C+',
        '3': 'B-',
        '4': 'B',
        '5': 'B+',
        '6': 'A-',
        '7': 'A',
        '8': 'A+',
        '9': 'S'
      };
      return tierLabels[tier] || '';
    },
    // 获取玩家等阶标签
    getPlayerTierLabel(tier) {
      const tierLabels = {
        '0': '见习灵御',
        '2': '普通灵御',
        '3': '中级灵御',
        '5': '高级灵御',
        '7': '准大师灵御',
        '8': '大师灵御',
        '9': '传奇灵御'
      };
      return tierLabels[tier] || '';
    },
    // 获取日志条目类名
    getLogClass(log) {
      if (log.includes('玩家')) {
        return 'player-log';
      } else if (log.includes('敌人') || log.includes(this.enemy.name)) {
        return 'enemy-log';
      } else {
        return 'other-log';
      }
    },
    // 获取日志图标
    getLogIcon(log) {
      if (log.includes('玩家')) {
        return '🔵';
      } else if (log.includes('敌人') || log.includes(this.enemy.name)) {
        return '🔴';
      } else {
        return '🟡';
      }
    },

    
    // 播放结算动画
    playSettlementAnimation() {
      // 这里可以添加结算动画的逻辑
      // 例如：屏幕闪烁、特殊音效等
      console.log('播放结算动画');
      
      // 示例：添加一个特殊的CSS类来实现视觉效果
      const battleScreen = document.querySelector('.battle-screen');
      if (battleScreen) {
        battleScreen.classList.add('settlement-animation');
        
        // 1秒后移除动画类
        setTimeout(() => {
          battleScreen.classList.remove('settlement-animation');
        }, 1000);
      }
    },
  },
  watch: {
    battleLogs: {
      handler() {
        this.scrollToBottom();
      },
      deep: true
    },
    // 监听玩家生命值变化
    'player.hp'(newHp, oldHp) {
      if (newHp < oldHp) {
        const damage = oldHp - newHp;
        this.showDamageText('player', damage);
        this.playShakeAnimation('player');
      }
      this.previousPlayerHp = newHp;
    },
    // 监听敌人生命值变化
    'enemy.hp'(newHp, oldHp) {
      if (newHp < oldHp) {
        const damage = oldHp - newHp;
        this.showDamageText('enemy', damage);
        this.playShakeAnimation('enemy');
      }
      this.previousEnemyHp = newHp;
    }
  },
  mounted() {
    this.scrollToBottom();
    
    // 监听效果变化事件
    import('../eventBus.js').then(eventBus => {
      this.eventBus = eventBus.default;
      this.eventBus.on('effectChange', (params) => {
        this.showEffectChangeText(params.target, params.effectName, params.deltaStacks); 
      });
      // 监听敌人行动结束事件
      this.eventBus.on('enemy-action-end', this.playSettlementAnimation);
      
      // 监听敌人回合开始和结束事件
      this.eventBus.on('enemy-turn-start', () => {
        this.isPlayerTurn = false;
      });
      
      this.eventBus.on('enemy-turn-end', () => {
        this.isPlayerTurn = true;
      });
    });
  },
  beforeUnmount() {
    // 解绑效果变化事件和敌人行动结束事件
    if (this.eventBus) {
      this.eventBus.off('effectChange');
      this.eventBus.off('enemy-action-end', this.playSettlementAnimation);
      this.eventBus.off('enemy-turn-start');
      this.eventBus.off('enemy-turn-end');
    }
  }
}
</script>

<style scoped>
.battle-screen {
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: 20px;
}

.enemy-panel, .player-panel {
  border: 1px solid #ccc;
  padding: 10px;
  margin: 10px 0;
}

.enemy-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.enemy-subtitle {
  color: #666;
  font-size: 0.9em;
  margin-left: 5px;
}

.enemy-info-button {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background-color: #ccc;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-weight: bold;
}

.enemy-stats {
  display: flex;
  justify-content: space-between;
  margin-bottom: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid #eee;
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

.health-bar, .mana-bar, .action-points-bar {
  margin: 10px 0;
}

.bar {
  width: 100%;
  height: 20px;
  background-color: #eee;
  border-radius: 10px;
  overflow: hidden;
  margin-top: 5px;
}

.bar .fill {
  height: 100%;
  background-color: #42b983;
  transition: width 0.3s;
}

/* 抖动动画 */
@keyframes shake {
  0% { transform: translateX(0); }
  25% { transform: translateX(-5px); }
  50% { transform: translateX(5px); }
  75% { transform: translateX(-5px); }
  100% { transform: translateX(0); }
}

.shake {
  animation: shake 0.5s ease-in-out;
}

.mana-bar .fill {
  background-color: #409eff;
}

.action-points-container {
  display: flex;
  gap: 5px;
  margin: 5px 0;
  align-items: center;
  justify-content: center;
}

.action-point {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background-color: #42b983;
}

.action-point.used {
  background-color: #ccc;
}

/* 伤害文本容器 */
.damage-text-container {
  position: relative;
  height: 0;
  overflow: visible;
}

/* 冻结的操作面板样式 */
.action-panel.disabled {
  opacity: 0.6;
  pointer-events: none;
}

.action-panel.disabled button {
  opacity: 0.6;
  cursor: not-allowed;
}

/* 伤害文本 */
.damage-text {
  position: absolute;
  top: -30px;
  left: 50%;
  transform: translateX(-50%);
  font-weight: bold;
  text-shadow: 1px 1px 2px rgba(0,0,0,0.5);
  pointer-events: none;
  z-index: 10;
  opacity: 0;
  transition: opacity 0.3s, transform 0.3s;
  font-size: 32px;
  color: #ff0000;
}

/* 效果变化文本 */
.effect-change-text {
  position: absolute;
  top: -60px;
  left: 50%;
  transform: translateX(-50%);
  font-weight: bold;
  text-shadow: 1px 1px 2px rgba(0,0,0,0.5);
  pointer-events: none;
  z-index: 10;
  opacity: 0;
  transition: opacity 1s, transform 1s;
  font-size: 24px;
  color: #000000;
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

.battle-log {
  flex: 1;
  border: 1px solid #ccc;
  padding: 10px;
  margin: 10px 0;
  overflow-y: auto;
}

.battle-log:deep() {
  /* 滚动到最新的日志条目 */
  scroll-behavior: smooth;
}

.log-entry {
  padding: 8px 12px;
  margin-bottom: 8px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

.log-icon {
  margin-right: 8px;
  font-size: 16px;
}

.player-log {
  background-color: #e3f2fd;
}

.enemy-log {
  background-color: #ffebee;
}

.other-log {
  background-color: #fffde7;
}

.action-panel {
  border: 1px solid #ccc;
  padding: 10px;
  margin: 10px 0;
}

.skills {
  display: flex;
  flex-wrap: wrap;
  gap: 15px;
  margin-bottom: 15px;
}

.skill-card {
  width: 150px;
  min-height: 100px;
  padding: 15px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  transition: all 0.3s ease;
  position: relative;
}

.skill-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(0,0,0,0.15);
}

.skill-card:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.skill-name {
  font-weight: bold;
  font-size: 16px;
  margin-bottom: 8px;
  user-select: none;
}

.skill-description {
  font-size: 14px;
  margin-bottom: 8px;
  text-align: center;
  user-select: none;
}

.skill-uses {
  font-size: 12px;
  color: #666;
  user-select: none;
}

.skill-tier {
  position: absolute;
  top: 5px;
  right: 5px;
  font-weight: bold;
  font-size: 18px;
  z-index: 2;
  padding: 2px 6px;
  border-radius: 4px;
  background-color: rgba(255, 255, 255, 0.8);
}

/* 效果图标 */
.effect-icon {
  display: inline-block;
  font-size: 16px;
  cursor: help;
}

/* 效果描述浮动窗口 */
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

/* 敌人信息悬浮框 */
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
