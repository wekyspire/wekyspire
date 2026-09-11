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

export const settings = reactive({
  soundOn: saved.soundOn !== false, // 默认开启
  menuStoryMode: saved.menuStoryMode === true, // 开始界面模式选择（默认肉鸽：故事模式未开放），回主菜单后保持
});

export function persistSettings() {
  writeJson(KEY, { soundOn: settings.soundOn, menuStoryMode: settings.menuStoryMode });
}

export function toggleSound() {
  settings.soundOn = !settings.soundOn;
  persistSettings();
}
