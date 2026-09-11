import { reactive } from 'vue';

// 菜单级全局模态弹窗（单例，同时至多一个）。供菜单层各组件（开始界面/游戏菜单/结算面板）
// 做设置变更与确认操作使用；Promise 化调用侧写法：
//   const { ok, text } = await showMenuDialog({ title, message, mode, ... });
// 三种模式：
//   'confirm'       —— 只有确认键（提示性确认）
//   'confirmCancel' —— 确认 + 取消
//   'input'         —— 单行文本输入 + 确认/取消（空输入不允许确认；返回 text 为去首尾空格后的值）
// Esc / 点击遮罩 = 取消（resolve { ok:false }）；confirm 模式无取消键，Esc 同样只是关闭。
// 渲染层见 MenuDialog.vue（App.vue 全局挂载一次）。

const state = reactive({
  open: false,
  title: '',
  message: '',
  mode: 'confirm',
  inputValue: '',
  placeholder: '',
  confirmText: '确认',
  cancelText: '取消',
});

let resolver = null;

/** 打开弹窗并等待用户答复；已有弹窗打开时后来者直接以取消兑现（菜单级串行足够）。 */
export function showMenuDialog({
  title = '', message = '', mode = 'confirm',
  placeholder = '', defaultValue = '',
  confirmText = '确认', cancelText = '取消',
} = {}) {
  if (state.open) return Promise.resolve({ ok: false });
  state.title = title;
  state.message = message;
  state.mode = mode;
  state.inputValue = defaultValue;
  state.placeholder = placeholder;
  state.confirmText = confirmText;
  state.cancelText = cancelText;
  state.open = true;
  return new Promise((resolve) => { resolver = resolve; });
}

/** 只读状态（MenuDialog.vue / App.vue 绑定用，勿直接改写）。 */
export function menuDialogState() { return state; }

function settle(ok, text) {
  if (!state.open || !resolver) return;
  state.open = false;
  const r = resolver;
  resolver = null;
  r(text !== undefined ? { ok, text } : { ok });
}

/** 确认（确认键 / Enter）。input 模式下空输入不落地（视为未确认）。 */
export function confirmMenuDialog() {
  if (!state.open) return;
  if (state.mode === 'input') {
    const text = state.inputValue.trim();
    if (!text) return;
    settle(true, text);
    return;
  }
  settle(true);
}

/** 取消（取消键 / Esc / 遮罩点击）。 */
export function cancelMenuDialog() {
  settle(false);
}
