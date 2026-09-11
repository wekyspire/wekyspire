// Shell 入口：Vue 薄壳接管整局流程（替代 debug 页作为主入口）。
import { createApp } from 'vue';
import App from './App.vue';

createApp(App).mount('#app');

// 调试钩子（浏览器控制台 / 冒烟脚本用）：由 App.vue newGame 挂载 window.__shell
