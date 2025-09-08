<template>
  <div class="start-screen">
    <h1 class="game-title">魏启尖塔</h1>
    <button @click="startGame">无限模式</button>
    <button 
      class="story-mode-button"
      disabled
      @mouseenter="showStoryTooltip = true" 
      @mouseleave="showStoryTooltip = false"
      style="visibility:hidden;"
    >
      故事模式
      <div 
        v-if="showStoryTooltip"
        class="tooltip"
      >
        正在筹备中！
      </div>
    </button>
    
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
</template>

<script>
export default {
  name: 'StartScreen',
  data() {
    return {
      showChangelog: false,
      showStoryTooltip: false,
      changelogData: [
        {
          version: '2025.9.8 [Alpha 0.2]',
          sections: [
            {
              title: '新增',
              items: [
                'Boss开场动画、Cutscene播放',
              ]
            },
            {
              title: '改进',
              items: [
                '技能框架重构，更高效更简洁好玩',
                '移除攻击力、行动点，强化魏启交互',
                '调整了配色，更暗黑！'
              ]
            },
            {
              title: '已知问题',
              items: [
                '商店不工作',
                '部分结算错误'
              ]
            }
          ]
        }
      ]
    }
  },
  methods: {
    startGame() {
      this.$emit('start-game')
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

button {
  padding: 10px 20px;
  font-size: 18px;
  margin-top: 20px;
}

.story-mode-button {
  position: relative;
}

.story-mode-button .tooltip {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  background-color: #333;
  color: white;
  padding: 5px 10px;
  border-radius: 4px;
  white-space: nowrap;
  z-index: 100;
  font-size: 14px;
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