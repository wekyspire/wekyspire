<template>
  <div id="game-app">
    <!-- 全屏Pixi背景（z=0，最底层） -->
    <GameBackgroundScreen />
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

    <!-- Boss登场特效界面，之后会逐渐移植到Pixi webgl实现上 -->
    <BossShowupAnimation />

    <!-- 过场动画界面，之后会逐渐移植到Pixi webgl实现上 -->
    <CutsceneScreen :game-state="gameState" />

    <!-- 音频控制界面 -->
    <AudioControllerScreen />

    <!-- 粒子效果管理器，之后会逐渐移植到Pixi webgl实现上 -->
    <ParticleEffectManager />

    <!-- 消息弹出框界面 -->
    <MessagePopupScreen />

    <!-- 动画锚点生成器 -->
    <AnimationAnchors ref="animationAnchors" />
    <!-- 全局唯一悬浮提示框（文字/效果/命名） -->
    <FloatingTooltip />
    <FloatingCardTooltip />
    <!-- 动画卡牌容器 (DOM) -->
    <AnimatableElementContainer />
    <!-- 新增：Pixi 卡牌覆盖层（高于 animatable elements 层） -->
    <GamePixiOverlay />
    <!-- 新增：全局玩家输入控制器（处理结算期的异步输入） -->
    <PlayerInputController />
  </div>
</template>

<script>
import StartScreen from './components/start/StartScreen.vue'
import BattleScreen from './components/battle/BattleScreen.vue'
import RestScreen from './components/rest/RestScreen.vue'
import EndScreen from './components/end/EndScreen.vue'
import DialogScreen from './components/end/DialogScreen.vue'
import BossShowupAnimation from './components/battle/BossShowupAnimation.vue'
import CutsceneScreen from './components/end/CutsceneScreen.vue'
import AudioControllerScreen from './components/global/AudioControllerScreen.vue'
import ParticleEffectManager from './components/global/ParticleEffectManager.vue'
import MessagePopupScreen from './components/end/MessagePopupScreen.vue'
import AnimationAnchors from './components/global/AnimationAnchors.vue'
import FloatingTooltip from './components/global/FloatingTooltip.vue'
import FloatingCardTooltip from './components/global/FloatingCardTooltip.vue'
import AnimatableElementContainer from './components/global/AnimatableElementContainer.vue'
import PlayerInputController from './components/global/PlayerInputController.vue'
import GameBackgroundScreen from './components/global/GameBackgroundScreen.vue'
import GamePixiOverlay from './components/global/GamePixiOverlay.vue'

import { displayGameState as gameState, resetAllGameStates } from './data/gameState.js';
import animator from './utils/animator.js';
import { initInteractionHandler } from './utils/interactionHandler.js';

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
    AnimationAnchors,
    FloatingTooltip,
    FloatingCardTooltip,
    AnimatableElementContainer,
    PlayerInputController,
    GameBackgroundScreen,
    GamePixiOverlay
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
    const anchorRefs = this.$refs.animationAnchors?.getRefs?.();
    if (anchorRefs) {
      // 初始化新动画系统
      animator.init(anchorRefs);
      console.log('[GameApp] Animator initialized with anchor refs:', anchorRefs);
    }
    
    // 初始化交互处理器
    initInteractionHandler();
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