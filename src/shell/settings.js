import { reactive } from 'vue';

// 设置（菜单级）：localStorage 持久化，无浏览器存储时退化为内存（可测试）。
// 音效开关目前仅为开关位；声音管线接入时在此订阅即可。

const KEY = 'wekyspire:settings';

const memory = new Map(); // 无 localStorage 环境（vitest node）的回退存储

function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    const raw = memory.get(key);
    return raw ? JSON.parse(raw) : null;
  }
}
function writeJson(key, value) {
  const raw = JSON.stringify(value);
  try { localStorage.setItem(key, raw); } catch { memory.set(key, raw); }
}

const saved = readJson(KEY) ?? {};

// 调试/故事两个开关只活在线下开发（import.meta.env.DEV 构建期常量，部署版恒 false）：
// 部署版不渲染这两个复选框，持久化里的旧勾选也一律不落回（默认关闭）。
// 线上排障仍可用 ?debug=1 显式打开（运行时赋值，不受此门控）。
const IS_DEV = import.meta.env.DEV;

export const settings = reactive({
  soundOn: saved.soundOn !== false, // 默认开启
  menuStoryMode: IS_DEV && saved.menuStoryMode === true, // 开始界面模式选择（默认肉鸽：故事模式未开放），回主菜单后保持
  // 调试模式（仅调试用）：开 = 新开局进调试会话（F9 面板 / 存档写 debug 槽 / 开局发一拳）。
  // 持久化只是开发期省事（每次手勾很烦）；调试会话**永不写真实存档槽**，
  // 所以「忘关」也不会污染正常局——与旧「无敌模式」不持久化的取舍一致。
  debugMode: IS_DEV && saved.debugMode === true,
});

export function persistSettings() {
  writeJson(KEY, {
    soundOn: settings.soundOn, menuStoryMode: settings.menuStoryMode, debugMode: settings.debugMode,
  });
}

export function toggleSound() {
  settings.soundOn = !settings.soundOn;
  persistSettings();
}

export function setDebugMode(on) {
  settings.debugMode = !!on;
  persistSettings();
}
