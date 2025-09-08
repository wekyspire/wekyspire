<template>
  <div class="start-screen">
    <h1>魏启尖塔</h1>
    <button @click="startGame">开始游戏</button>
    
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
      changelogData: [
        {
          version: '2025.9.8 [Alpha 0.2]',
          sections: [
            {
              title: '新增',
              items: [
                '更名为魏启尖塔',
                '重做交互体验，增加受击、获得和失去反馈、以及粒子特效。',
                '重构大量代码，提高代码质量和可维护性，方便后续扩展'
              ]
            },
            {
              title: '改进',
              items: [
                '增强数值平衡，提升了前期难度，削弱锻体流'
              ]
            },
            {
              title: '已知问题',
              items: [
                '商店不工作',
                '部分结算错误',
                'MEFM-3能量耦合卡住'
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
  background: #f0f0f0;
  border: 1px solid #ccc;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 20px;
  font-weight: bold;
  user-select: none;
}

.changelog-content {
  width: 0;
  overflow: hidden;
  background: white;
  /* border: 1px solid #ccc; */
  /* border-radius: 4px; */
  margin-right: 10px;
  transition: width 0.3s ease;
  white-space: nowrap;
  text-align: left;
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
</style>