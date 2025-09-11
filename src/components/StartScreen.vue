<template>
  <div class="start-screen">
    <transition name="fade">
    <div class="start-screen-contents" v-if="!isGameStarting">
      <transition name="swing-fade" mode="out-in">
        <h1 class="game-title infinite-mode" v-if="!isRemiPresent">魏启尖塔</h1>
        <h1 class="game-title story-mode" v-else>魏启尖塔：故事</h1>
      </transition>
      <transition name="swing-fade" mode="out-in">
        <button class="infini-mode-button" @click="onStartGameButtonClicked" v-if="!isRemiPresent">开始游戏</button>
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
      <div class="changelog-container">
        <div 
          class="changelog-toggle" 
        >
          <div class="toggle-icon"
          @mouseenter="showChangelog = true" 
          @mouseleave="showChangelog = false"
          >≡</div>
          <div 
            class="changelog-content" 
            :class="{ 'expanded': showChangelog }"
          >
            <h2>更新日志</h2>
            <div v-for="(version, index) in changelogData" :key="index">
              <h3>{{ version.version }}</h3>
              <div v-for="(section, sectionIndex) in version.sections" :key="sectionIndex">
                <h4>{{ section.title }}</h4>
                <ul>
                  <li v-for="(item, itemIndex) in section.items" :key="itemIndex">
                    {{ item }}
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    </transition>
    <div class="start-screen-background" :class="{'non-story-mode': !isRemiPresent, 'story-mode': isRemiPresent}"
     :style="{ backgroundPositionY: backgroundYOffset - 300 + 'px'}"></div>
  </div>
</template>

<script>

import gameState from '../data/gameState.js';
import eventBus from '../eventBus.js';

export default {
  name: 'StartScreen',
  data() {
    return {
      showChangelog: false,
      isRemiPresent: false,
      isGameStarting: false,
      snowParticlesEnabled: false,
      backgroundYOffset: 0,
      snowParticlesInterval: null,
      changelogData: [
        {
          version: '2025.9.11 [Alpha 0.3.1]',
          sections: [
            {
              title: '新增',
              items: [
                '交互更新，增加音效系统'
              ]
            },
            {
              title: '改进',
              items: [
                '调整若干平衡',
              ]
            },
            {
              title: '已知问题',
              items: [
                '商店结算错误',
                '部分结算错误',
                '敌人头像错乱'
              ]
            }
          ]
        }
      ]
    }
  },
  watch: {
    isRemiPresent(newVal, oldVal) {
      if(newVal !== oldVal) {
        if(newVal === true) {
          // Play intro music
          eventBus.emit('play-sound', {
            soundFile: new URL('../assets/sounds/story-mode-intro.mp3', import.meta.url),
            soundTrack: 0
          });
          // 启动雪花粒子特效
          this.setSnowParticles(true);
        } else {
          // Stop playing intro music
          eventBus.emit('play-sound', {soundFile: null, soundTrack: 0});
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
        eventBus.emit('pop-message', {
          id: 'remi-not-ready',
          text: '未完成开发'
        });
        return false;
      }
      gameState.isRemiPresent = this.isRemiPresent;
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
        eventBus.emit('display-cutscene', {
          images: [
            new URL('../assets/cutscenes/opening-1.png', import.meta.url),
            new URL('../assets/cutscenes/opening-2.png', import.meta.url)
          ],
          interval: 3500,
          onEnd: ()=>{
            eventBus.emit('start-game');
            this.isGameStarting = false;
          }
        })}, 4000);
      } else {
        // 不搞些花里胡哨的，直接开始
        eventBus.emit('start-game');
      }
    },
    
    /**
     * 发射雪花粒子特效
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
        const distance = 50 + Math.random() * 100; // 发射距离
        
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
      
      // 发射粒子
      eventBus.emit('spawn-particles', snowParticles);
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

/* button {
  padding: 10px 20px;
  font-size: 18px;
  margin-top: 20px;
} */

.infini-mode-button {
  background-color: #008CBA;
  color: white;
}

.story-mode-button {
  background-color: orange;
  color: white;
}

.changelog-container {
  position: absolute;
  right: 80px;
  top: 20px;
  display: flex;
}

.changelog-toggle {
  display: flex;
  flex-direction: row-reverse;
}

.toggle-icon {
  width: 30px;
  height: 30px;
  background: #6a6a6a;
  border: 1px solid #ccc;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 20px;
  font-weight: bold;
  user-select: none;
  color:white;
}

.changelog-content {
  width: 0;
  overflow: hidden;
  background: rgb(150, 150, 150);
  margin-right: 10px;
  transition: width 0.3s ease;
  white-space: nowrap;
  text-align: left;
  /* color: white!important; */
}

.changelog-content.expanded {
  width: 400px;
  padding: 10px;
}

.changelog-content h2 {
  margin-top: 0;
  font-size: 1.2em;
}

.changelog-content h3 {
  font-size: 1.1em;
  margin: 10px 0 5px 0;
}

.changelog-content h4 {
  font-size: 1em;
  margin: 8px 0 4px 0;
}

.changelog-content ul {
  margin: 0 0 0 20px;
  padding: 0;
}

.changelog-content li {
  margin: 2px 0;
  font-size: 0.9em;
}

.game-title {
  font-size: 4em;
  margin-bottom: 20px;
  color: #eef7ff;
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