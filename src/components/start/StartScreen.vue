<template>
  <div class="start-screen">
    <transition name="fade">
    <div class="start-screen-contents" v-if="!isGameStarting">
      <transition name="swing-fade" mode="out-in">
        <div class="game-title infinite-mode" v-if="!isRemiPresent"><h1>魏启尖塔</h1></div>
        <div class="game-title story-mode" v-else><h1>魏启尖塔</h1><span class="subtitle">故事</span></div>
      </transition>
      <transition name="swing-fade" mode="out-in">
        <button class="infini-mode-button" @click="onStartGameButtonClicked" v-if="!isRemiPresent">无限模式</button>
        <button class="story-mode-button"  @click="onStartGameButtonClicked" v-else>进入尖塔</button>
      </transition>
      <br />
      <div style="padding: 20px;">
        <input 
          type="checkbox"
          id="remi-checkbox"
          v-model="isRemiPresent"
        />
        <label for="remi-checkbox" style="color: white;">
          故事模式
        </label>
      </div>
      <ChangeLog />
    </div>
    </transition>
    <div class="start-screen-background" :class="{'non-story-mode': !isRemiPresent, 'story-mode': isRemiPresent}"
     :style="{ backgroundPositionY: backgroundYOffset - 300 + 'px'}"></div>
  </div>
</template>

<script>

import frontendEventBus from '../../frontendEventBus.js';
import ChangeLog from './ChangeLog.vue';
import {backendGameState} from "../../data/gameState";
import backendEventBus, { EventNames } from "../../backendEventBus";

export default {
  name: 'StartScreen',
  components: { ChangeLog },
  props: {
    gameState: {
      type: Object,
      required: true
    }
  },
  data() {
    return {
      isRemiPresent: false,
      isGameStarting: false,
      snowParticlesEnabled: false,
      backgroundYOffset: 0,
      snowParticlesInterval: null
    }
  },
  watch: {
    isRemiPresent(newVal, oldVal) {
      if(newVal !== oldVal) {
        // 同步到显示层状态（允许修改对象prop的子字段）
        this.gameState.isRemiPresent = newVal;
        if(newVal === true) {
          // Play intro music
          frontendEventBus.emit('play-sound', {
            soundFile: new URL('../assets/sounds/story-mode-intro.mp3', import.meta.url),
            soundTrack: 0
          });
          // 启动雪花粒子特效
          this.setSnowParticles(true);
        } else {
          // Stop playing intro music
          frontendEventBus.emit('play-sound', {soundFile: null, soundTrack: 0});
          // 关闭雪花粒子特效
          this.setSnowParticles(false);
        }
      }
    }
  },
  computed: {
    gameTitle() {
      return this.isRemiPresent ? "魏启尖塔" : "魏启尖塔：无限";
    }
  },
  mounted() {
    // 启动雪花粒子定时器
    this.snowParticlesInterval = setInterval(()=>{
      if(this.snowParticlesEnabled) {
        this.spawnSnowParticles();
      }
    }, 100);
  },
  beforeUnmount() {
    // 组件卸载时关闭雪花粒子定时器
    clearInterval(this.snowParticlesInterval);
    this.snowParticlesInterval = null;
  },
  methods: {
    setSnowParticles(enabled) {
      this.snowParticlesEnabled = enabled;
    },
    onStartGameButtonClicked() {
      const debugMode = false;//true;
      if(this.isGameStarting) return ;
      if(!debugMode && this.isRemiPresent) {
        // 瑞米还没开发好
        frontendEventBus.emit('pop-message', {
          id: 'remi-not-ready',
          text: '未完成开发'
        });
        return false;
      }
      // isRemiPresent 已在watch中同步到显示状态
      if(this.isRemiPresent) {
        this.isGameStarting = true;
        
        // 画面慢慢上移
        const offsInterval = setInterval(()=>{
          this.backgroundYOffset += 2;
          if(this.backgroundYOffset >= 300) {
            this.backgroundYOffset = 0;
            clearInterval(offsInterval);
          }
        }, 50);
        // 延迟启动cutscene
        setTimeout(()=> {
        frontendEventBus.emit('display-cutscene', {
          images: [
            new URL('../assets/cutscenes/opening-1.png', import.meta.url),
            new URL('../assets/cutscenes/opening-2.png', import.meta.url)
          ],
          interval: 3500,
          onEnd: ()=>{
            backendEventBus.emit(EventNames.Game.GAME_START);
            this.isGameStarting = false;
          }
        })}, 4000);
      } else {
        // 不搞些花里胡哨的，直接开始
        backendEventBus.emit(EventNames.Game.GAME_START);
      }
    },
    
    /**
     * 触发雪花粒子特效
     */
    spawnSnowParticles() {
      
      // 创建雪花粒子
      const snowParticles = [];
      const particleCount = 4; // 雪花数量
      
      for (let i = 0; i < particleCount; i++) {
        // 从全屏幕随机位置发射
        const centerX = Math.random() * window.innerWidth;
        const centerY = Math.random() * window.innerHeight;
        // 随机角度和速度
        const angle = Math.random() * Math.PI * 2;
        const speed = 20 + Math.random() * 30; // 慢速飘荡

        snowParticles.push({
          absoluteX: centerX,
          absoluteY: centerY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 3 + Math.random() * 4, // 雪花大小
          color: '#ffffff', // 白色雪花
          life: 3000 + Math.random() * 2000, // 生命周期3-5秒
          gravity: 10, // 轻微重力
          drag: 0.2, // 空气阻力
          fadeIn: true,
          opacityFade: true,
          sizeFade: false,
          zIndex: 999, // 最高层级
          extraStyles: {
            borderRadius: '50%',
            boxShadow: '0 0 5px rgba(255, 255, 255, 0.8)'
          }
        });
      }
      
      // 触发粒子
      frontendEventBus.emit('spawn-particles', snowParticles);
    }
  }
}
</script>

<style scoped>
.start-screen {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  position: relative;
}

.start-screen-background {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: url('@assets/images/start-screen.png') no-repeat center center fixed;
  background-position: bottom;
  background-color:#0b0b12;
  background-size: cover;
}

.start-screen-background.non-story-mode {
  filter: blur(30px) grayscale(80%) brightness(30%);
  transition: filter 3s ease-in-out;
}
.start-screen-background.story-mode {
  filter: blur(0px);
  transition: filter 3s ease-in-out;
}

.start-screen-contents {
  z-index: 1;
}

.fade-enter-active, .fade-leave-active {
  transition: opacity 1s ease;
}
.fade-enter, .fade-leave-to {
  opacity: 0;
}

.infini-mode-button {
  background-color: #008CBA;
  color: white;
}

.story-mode-button {
  background-color: orange;
  color: white;
}

.story-mode-button:hover {
  background-color: #e8560d;
  color: white;
}


.game-title {
  font-size: 2em;
  margin-bottom: 20px;
  color: #eef7ff;
  display: flex;
  flex-direction: row;
}

.subtitle {
  margin: auto auto 50px 10px;
  padding: 5px;
  font-size: 0.5em;
  background-color: orange;
  border-radius: 10px;
}

.swing-fade-leave-active {
  transition: opacity 1s ease, transform 1s ease;
}
.swing-fade-enter-active {
  transition: opacity 1s ease, transform 1s ease;
}

.swing-fade-enter-from {
  opacity: 0;
  transform: translateY(20px);
}

.swing-fade-leave-to {
  opacity: 0;
  transform: translateY(-20px);
}
</style>