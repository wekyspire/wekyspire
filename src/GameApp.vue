<template>
  <div id="game-app">
    <!-- 开始游戏界面 -->
    <StartScreen 
      v-if="gameState.gameStage === 'start'"
    />
    
    <!-- 战斗界面 -->
    <BattleScreen 
      v-if="gameState.gameStage === 'battle'"
      :player="gameState.player"
      :enemy="gameState.enemy"
      :battle-logs="gameState.battleLogs"
      :is-control-disabled="gameState.controlDisableCount > 0"
    />
    <!-- 休整界面 -->
    <RestScreen 
      v-if="gameState.gameStage === 'rest'"
    />

    <!-- 结束界面 -->
    <EndScreen 
      v-if="gameState.gameStage === 'end'" 
      :is-victory="gameState.isVictory"
      @restart-game="restartGame"
    />
    
    <!-- 对话界面 -->
    <DialogScreen />
    
    <!-- Boss登场特效界面 -->
    <BossShowupAnimation />
    
    <!-- 过场动画界面 -->
    <CutsceneScreen :game-state="gameState" />
    
    <!-- 音频控制界面 -->
    <AudioControllerScreen />
    
    <!-- 粒子效果管理器 -->
    <ParticleEffectManager />
    
    <!-- 消息弹出框界面 -->
    <MessagePopupScreen />
  </div>
</template>

<script>
import StartScreen from './components/StartScreen.vue'
import BattleScreen from './components/BattleScreen.vue'
import RestScreen from './components/RestScreen.vue'
import EndScreen from './components/EndScreen.vue'
import DialogScreen from './components/DialogScreen.vue'
import BossShowupAnimation from './components/BossShowupAnimation.vue'
import CutsceneScreen from './components/CutsceneScreen.vue'
import AudioControllerScreen from './components/AudioControllerScreen.vue'
import ParticleEffectManager from './components/ParticleEffectManager.vue'
import MessagePopupScreen from './components/MessagePopupScreen.vue'
import SkillManager from './data/skillManager.js'

import eventBus from './eventBus.js'
import * as dialogues from './data/dialogues.js'
import { gameState, resetGameState } from './data/gameState.js';
import { startBattle } from './data/battle.js'

export default {
  name: 'App',
  components: {
    StartScreen,
    BattleScreen,
    RestScreen,
    EndScreen,
    DialogScreen,
    BossShowupAnimation,
    CutsceneScreen,
    AudioControllerScreen,
    ParticleEffectManager,
    MessagePopupScreen
  },
  computed: {
    isPlayerTurn() {
      return !gameState.isEnemyTurn;
    }
  },
  data() {
    return {
      gameState: gameState
    }
  },
  mounted() {
    // 初始化玩家效果管理器
    // 玩家初始化已在Player类的构造函数中完成
    this.eventBus = eventBus;
    // 监听add-battle-log
    this.eventBus.on('add-battle-log', (value) => {
        // 兼容旧的字符串格式和新的对象格式
        if (typeof value === 'string') {
            gameState.battleLogs.push(value);
        } else {
            gameState.battleLogs.push(value);
        }
    });
    // 注册对话对事件总线的监听
    dialogues.registerListeners(eventBus);
    // 监听start-game
    this.eventBus.on('start-game', () => {
        this.startGame();
    });
    },
  beforeUnmount() {
    if(this.eventBus) {
      this.eventBus.off('add-battle-log');
      this.eventBus.off('start-game');
      dialogues.unregisterListeners(eventBus);
    }
  },
  methods: {
    
    startGame() {
      // 触发开场事件
      eventBus.emit('before-game-start');
      
      // 为玩家添加初始技能到技能槽
      const initialSkill1 = SkillManager.getInstance().createSkill('拳打脚踢');
      gameState.player.skillSlots[0] = initialSkill1;
      const initialSkill2 = SkillManager.getInstance().createSkill('活动筋骨');
      gameState.player.skillSlots[1] = initialSkill2;
      const initialSkill3 = SkillManager.getInstance().createSkill('打滚');
      gameState.player.skillSlots[2] = initialSkill3;
      const initialSkill4 = SkillManager.getInstance().createSkill('抱头防御');
      gameState.player.skillSlots[3] = initialSkill4;
      
      gameState.gameStage = 'battle';

      // 开始第一场战斗
      startBattle();
    },
    restartGame() {
      // 重置游戏状态
      resetGameState();

    },
  }
}
</script>

<style>
#game-app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  /* color: #eef7ff; */
  /* margin-top: 60px; */
  user-select: none;
  position: relative;
  height:100vh;
}

</style>