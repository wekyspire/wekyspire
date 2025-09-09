<template>
  <div class="start-screen" :style="{ backgroundPositionY: backgroundYOffset - 300 + 'px' }">
    <transition name="fade">
    <div class="start-screen-contents" v-if="!isGameStarting">
      <h1 class="game-title">魏启尖塔</h1>
      <button class="infini-mode-button" @click="onStartGameButtonClicked" v-if="!isRemiPresent">无限模式</button>
      <button class="story-mode-button"  @click="onStartGameButtonClicked" v-if="isRemiPresent">进入尖塔</button>
      <input 
        type="checkbox"
        id="remi-checkbox"
        v-model="isRemiPresent"
      />
      <label for="remi-checkbox" style="color: white;">
        带上瑞米！
      </label>
      
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
      backgroundYOffset: 0,
      changelogData: [
        {
          version: '2025.9.9 [Alpha 0.3]',
          sections: [
            {
              title: '新增',
              items: [
                '美术更新、Cutscene播放',
                'Github Action自动部署，滚动更新'
              ]
            },
            {
              title: '改进',
              items: [
                '技能框架重构，更简单直观',
                '移除攻击力、行动点，强化魏启交互',
                '调整了配色，更暗黑！',
                '暂时关闭瑞米，正在开发'
              ]
            },
            {
              title: '已知问题',
              items: [
                '商店依然不工作',
                '部分结算错误'
              ]
            }
          ]
        }
      ]
    }
  },
  methods: {
    onStartGameButtonClicked() {
      if(this.isGameStarting) return ;
      if(this.isRemiPresent) {
        // 瑞米还没开发好
        eventBus.emit('pop-message', {
          id: 'remi-not-ready',
          text: 'Hineven已经把瑞米带走了，所以你无法带上瑞米！（此功能未开发完善）'
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
  background: url('@assets/images/start-screen.png') no-repeat center center fixed;
  background-position: bottom;
  background-color:#0b0b12;
  background-size: cover;
}

.fade-enter-active, .fade-leave-active {
  transition: opacity 1s ease;
}
.fade-enter, .fade-leave-to {
  opacity: 0;
}

button {
  padding: 10px 20px;
  font-size: 18px;
  margin-top: 20px;
}

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
  right: 20px;
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
</style>