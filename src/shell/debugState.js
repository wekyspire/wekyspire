// 调试模式的会话级 UI 状态（面板开关/当前页）。
// 与 settings.debugMode 的区别：settings 是"允许调试"的持久开关（开始界面复选框），
// 这里只是"面板此刻开着吗、看哪一页"这种纯界面态，不进存档也不持久化。
import { reactive } from 'vue';

export const debugUi = reactive({
  open: false,
  tab: 'state',
});

export function toggleDebugPanel() {
  debugUi.open = !debugUi.open;
}
