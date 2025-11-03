import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import GameApp from './GameApp.vue'
import DebugApp from './DebugApp.vue'
import './assets/main.css'
import './assets/common.css'
import './assets/zLayers.css'
import SkillManager from './data/skillManager.js'
// 保证单例初始化
import animationSequencer from "./data/animationSequencer";
// state sync watcher
import {registerBackendStateWatcher} from "./data/animationInstructionHelpers";
import {initGameFlowListeners} from "./game";
import AbilityManager from "./data/abilityManager";
import { initDisabledEffectWatcher } from './renderers/disabledEffectWatcher.js';
import { initCooldownEffectWatcher } from './renderers/cooldownEffectWatcher.js';

// 创建路由
const routes = [
  { path: '/', component: GameApp },
  { path: '/debug', component: DebugApp },
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

  // 加载所有ability
  AbilityManager.loadAllAbilities().then(abilityManager => {
    app.config.globalProperties.$abilityManager = abilityManager;
    app.mount('#app');
  });
  // 挂载应用
});

// 初始化后端状态观察者
registerBackendStateWatcher();

// 初始化前端禁用效果观察者（Pixi 卡牌状态灰显）
initDisabledEffectWatcher();
// 初始化冷却脉冲效果观察者（桥接 skill-card-overlay-effect 到 Pixi 效果）
initCooldownEffectWatcher();

// 初始化后端游戏流程在backendEventBus上的监听器
initGameFlowListeners();