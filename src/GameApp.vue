<template>
  <div id="game-app">
    <transition name="screen-transition" mode="out-in">
    <!-- 开始游戏界面 -->
    <StartScreen 
      v-if="gameState.gameStage === 'start'"
      :game-state="gameState"
    />
    <!-- 战斗界面 -->
    <BattleScreen 
      v-else-if="gameState.gameStage === 'battle'"
      :player="gameState.player.getModifiedPlayer()"
      :enemy="gameState.enemy"
      :is-player-turn="!gameState.isEnemyTurn"
      :level="gameState.battleCount"
    />
    <!-- 休整界面 -->
    <RestScreen 
      v-else-if="gameState.gameStage === 'rest'"
      :game-state="gameState"
    />
    <!-- 结束界面 -->
    <EndScreen 
      v-else-if="gameState.gameStage === 'end'"
      :is-victory="gameState.isVictory"
      @restart-game="restartGame"
    />
    </transition>
    
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

    <!-- 全局动画覆盖层（全游戏共享） -->
    <AnimationOverlay ref="animationOverlay" />

    <!-- 全局唯一悬浮提示框 -->
    <FloatingTooltip />
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
import AnimationOverlay from './components/AnimationOverlay.vue'
import FloatingTooltip from './components/FloatingTooltip.vue'

import { displayGameState as gameState, resetAllGameStates } from './data/gameState.js';
import orchestrator from './utils/cardAnimationOrchestrator.js';

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
    MessagePopupScreen,
    AnimationOverlay,
    FloatingTooltip
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
    // 初始化全局动画编排器：注入全局Overlay引用
    const overlayRefs = this.$refs.animationOverlay?.getRefs?.();
    if (overlayRefs) {
      orchestrator.init(overlayRefs);
    }
  },
  methods: {
    restartGame() {
      // 重置两份游戏状态
      resetAllGameStates();
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

.screen-transition-enter-active, .screen-transition-leave-active {
  transition: opacity 0.5s;
}
.screen-transition-enter-from, .screen-transition-leave-to {
  opacity: 0;
}

</style>