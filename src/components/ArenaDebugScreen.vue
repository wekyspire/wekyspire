<template>
  <div class="arena-debug-screen">
    <!-- 战斗界面 -->
    <div class="battle-area">
      <BattleScreen 
        :player="player"
        :enemy="enemy"
        :battle-logs="battleLogs"
        :is-control-disabled="isControlDisabled"
      />
    </div>
    
    <!-- 作弊菜单栏 -->
    <div class="cheat-menu">
      <div class="cheat-menu-header">
        <h2>竞技场调试面板</h2>
        <button @click="closeDebugScreen" class="close-button">×</button>
      </div>
      
      <!-- 重启战斗 -->
      <div class="cheat-section">
        <h3>战斗控制</h3>
        <button @click="restartBattle">重启战斗</button>
      </div>
      
      <!-- 配置角色信息 -->
      <div class="cheat-section">
        <h3>角色配置</h3>
        <div class="config-item">
          <label>生命值:</label>
          <input v-model.number="player.hp" type="number" />
        </div>
        <div class="config-item">
          <label>最大生命值:</label>
          <input v-model.number="player.maxHp" type="number" />
        </div>
        <div class="config-item">
          <label>魏启值:</label>
          <input v-model.number="player.mana" type="number" />
        </div>
        <div class="config-item">
          <label>最大魏启值:</label>
          <input v-model.number="player.maxMana" type="number" />
        </div>
        <div class="config-item">
          <label>行动力:</label>
          <input v-model.number="player.actionPoints" type="number" />
        </div>
        <div class="config-item">
          <label>最大行动力:</label>
          <input v-model.number="player.maxActionPoints" type="number" />
        </div>
        <div class="config-item">
          <label>攻击力:</label>
          <input v-model.number="player.baseAttack" type="number" />
        </div>
        <div class="config-item">
          <label>灵能强度:</label>
          <input v-model.number="player.baseMagic" type="number" />
        </div>
        <div class="config-item">
          <label>防御力:</label>
          <input v-model.number="player.baseDefense" type="number" />
        </div>
        <div class="config-item">
          <label>金钱:</label>
          <input v-model.number="player.money" type="number" />
        </div>
        <div class="config-item">
          <label>等阶:</label>
          <input v-model.number="player.tier" type="number" />
        </div>
        <button @click="applyPlayerConfig">应用角色配置</button>
      </div>
      
      <!-- 配置敌人 -->
      <div class="cheat-section">
        <h3>敌人配置</h3>
        <div class="config-item">
          <label>敌人类型:</label>
          <select v-model="selectedEnemyType">
            <option value="史莱姆">史莱姆</option>
            <option value="魔化瑞米">瑞米</option>
            <option value="雪狼">雪狼</option>
            <option value="MEFM-3">MEFM-3</option>
          </select>
        </div>
        <div class="config-item">
          <label>战斗强度:</label>
          <input v-model.number="battleIntensity" type="number" min="1" />
        </div>
        <button @click="generateEnemy">生成敌人</button>
      </div>
      
      <!-- 配置技能 -->
      <div class="cheat-section">
        <h3>技能配置</h3>
        <div class="skill-slots">
          <div v-for="(slot, index) in player.skillSlots" :key="index" class="skill-slot">
            <label>技能槽 {{ index + 1 }}:</label>
            <select v-model="selectedSkills[index]">
              <option value="">空</option>
              <option v-for="skillName in availableSkills" :key="skillName" :value="skillName">
                {{ skillName }}
              </option>
            </select>
            <button @click="applySkillToSlot(index)">应用</button>
          </div>
        </div>
        <button @click="clearAllSkills">清空所有技能</button>
      </div>
    </div>
  </div>
</template>

<script>
import BattleScreen from './BattleScreen.vue';
import { Player } from '../data/player.js';
import EnemyFactory from '../data/enemyFactory.js';
import SkillManager from '../data/skillManager.js';
import { startBattle } from '../data/battle.js';
import eventBus from '../eventBus.js';

export default {
  name: 'ArenaDebugScreen',
  components: {
    BattleScreen
  },
  data() {
    return {
      player: this.initializePlayer(),
      enemy: {},
      battleLogs: [],
      isControlDisabled: false,
      selectedEnemyType: '史莱姆',
      battleIntensity: 1,
      selectedSkills: Array(5).fill(''),
      availableSkills: []
    };
  },
  mounted() {
    // 初始化敌人
    this.generateEnemy();
    
    // 获取可用技能列表
    this.loadAvailableSkills();
    
    // 初始化战斗
    this.initBattle();
  },
  methods: {
     // 初始化玩家
     initializePlayer() {
       const player = new Player();
       // 确保skillSlots正确初始化
       player.skillSlots = Array(5).fill(null);
       // 给很高数值
       player.hp = 1000;
       player.maxHp = 1000;
       player.mana = 10;
       player.maxMana = 10;
       player.baseMagic = 10;
       player.baseDefense = 1;
       player.money = 1000000;
       player.tier = 9;
       return player;
     },
    // 重启战斗
    restartBattle() {
      this.battleLogs = [];
      this.generateEnemy();
      this.initBattle();
    },
    
    // 初始化战斗
    initBattle() {
      // 重置玩家回合
      this.player.actionPoints = this.player.maxActionPoints;
      
      // 添加战斗日志
      this.battleLogs.push('战斗开始！');
      this.battleLogs.push(`遭遇了 ${this.enemy.name}！`);
    },
    
    // 生成敌人
    generateEnemy() {
      try {
        // 使用EnemyFactory生成指定类型的敌人
        this.enemy = EnemyFactory.createEnemy(this.selectedEnemyType, this.battleIntensity);
        this.enemy.init();
      } catch (error) {
        console.error('Failed to generate enemy:', error);
      }
    },
    
    // 加载可用技能列表
    loadAvailableSkills() {
      const skillManager = SkillManager.getInstance();
      this.availableSkills = Array.from(skillManager.skillRegistry.keys());
    },
    
    // 应用角色配置
    applyPlayerConfig() {
      // 确保玩家属性在有效范围内
      this.player.hp = Math.max(0, this.player.hp);
      this.player.mana = Math.max(0, this.player.mana);
      this.player.actionPoints = Math.max(0, this.player.actionPoints);
      
      // 触发更新事件
      this.$forceUpdate();
    },
    
    // 关闭调试页面
    closeDebugScreen() {
      eventBus.emit('close-arena-debug');
    },
    
    // 应用技能到技能槽
    applySkillToSlot(index) {
      const skillManager = SkillManager.getInstance();
      if (this.selectedSkills[index]) {
        try {
          const skill = skillManager.createSkill(this.selectedSkills[index]);
          this.player.skillSlots[index] = skill;
        } catch (error) {
          console.error('Failed to create skill:', error);
        }
      } else {
        this.player.skillSlots[index] = null;
      }
    },
    
    // 清空所有技能
    clearAllSkills() {
      this.player.skillSlots = Array(5).fill(null);
      this.selectedSkills = Array(5).fill('');
    }
  }
};
</script>

<style scoped>
.arena-debug-screen {
  display: flex;
  height: 100vh;
  width: 100%;
}

.battle-area {
  flex: 3;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.battle-area > div {
  flex: 1;
  height: 100%;
}

.cheat-menu {
  flex: 1;
  background-color: #f5f5f5;
  padding: 20px;
  overflow-y: auto;
  border-left: 1px solid #ccc;
  display: flex;
  flex-direction: column;
}

.cheat-menu > div {
  flex: 1 1 auto;
}

.cheat-menu-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.cheat-menu-header h2 {
  margin: 0;
}

.close-button {
  background-color: #ff6b6b;
  color: white;
  border: none;
  border-radius: 50%;
  width: 30px;
  height: 30px;
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.close-button:hover {
  background-color: #ff5252;
}

.cheat-section {
  margin-bottom: 20px;
  padding: 15px;
  background-color: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.cheat-section h3 {
  margin-top: 0;
  border-bottom: 1px solid #eee;
  padding-bottom: 5px;
}

.config-item {
  margin-bottom: 10px;
  display: flex;
  align-items: center;
}

.config-item label {
  width: 120px;
  font-weight: bold;
}

.config-item input, .config-item select {
  flex: 1;
  padding: 5px;
  border: 1px solid #ccc;
  border-radius: 4px;
}

.skill-slots {
  margin-bottom: 15px;
}

.skill-slot {
  display: flex;
  align-items: center;
  margin-bottom: 10px;
  gap: 10px;
}

.skill-slot label {
  width: 80px;
  font-weight: bold;
}

.skill-slot select {
  flex: 1;
  padding: 5px;
  border: 1px solid #ccc;
  border-radius: 4px;
}

button {
  padding: 8px 15px;
  background-color: #42b983;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-weight: bold;
}

button:hover {
  background-color: #359c6d;
}
</style>