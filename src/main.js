import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import GameApp from './GameApp.vue'
import DebugApp from './DebugApp.vue'
import TestEffectDisplay from './components/TestEffectDisplay.vue'
import NamedEntityTest from './components/NamedEntityTest.vue'
import './assets/main.css'
import './assets/common.css'
import SkillManager from './data/skillManager.js'

// 创建路由
const routes = [
  { path: '/', component: GameApp },
  { path: '/debug', component: DebugApp },
  { path: '/test', component: TestEffectDisplay },
  { path: '/named-test', component: NamedEntityTest }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

// 创建应用实例
const app = createApp(App)

// 使用路由
app.use(router)

// 加载所有技能
SkillManager.loadAllSkills().then(skillManager => {
  // 将skillManager实例添加到全局属性中，以便在应用中使用
  app.config.globalProperties.$skillManager = skillManager;
  
  // 挂载应用
  app.mount('#app');
});