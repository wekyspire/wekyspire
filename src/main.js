import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import GameApp from './GameApp.vue'
import TestEffectDisplay from './components/TestEffectDisplay.vue'
import './assets/main.css'

// 创建路由
const routes = [
  { path: '/', component: GameApp },
  { path: '/test', component: TestEffectDisplay }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

// 创建应用实例
const app = createApp(App)

// 使用路由
app.use(router)

// 挂载应用
app.mount('#app')