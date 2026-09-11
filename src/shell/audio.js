// 音频最小封装（无 howler 依赖）：HTMLAudioElement + 音量渐入渐出。
// 目前仅故事模式标题界面 BGM 一条；后续音效管线在此扩展（统一尊重 settings.soundOn）。

let titleAudio = null;
let fadeTimer = null;
let gestureRetry = null; // 浏览器自动播放策略兜底：首次用户手势后重试

function ramp(audio, to, ms, onDone) {
  clearInterval(fadeTimer);
  const from = audio.volume;
  const t0 = performance.now();
  fadeTimer = setInterval(() => {
    const k = Math.min(1, (performance.now() - t0) / ms);
    audio.volume = from + (to - from) * k;
    if (k >= 1) {
      clearInterval(fadeTimer);
      fadeTimer = null;
      onDone?.();
    }
  }, 30);
}

export function fadeInTitleMusic(url, { fadeMs = 2500, target = 0.5 } = {}) {
  if (!titleAudio) {
    titleAudio = new Audio(url);
    titleAudio.loop = true;
  }
  if (titleAudio.paused) titleAudio.volume = 0;
  const start = () => ramp(titleAudio, target, fadeMs);
  titleAudio.play().then(start).catch(() => {
    // 无用户手势时自动播放被拒：挂一次性手势监听重试
    if (gestureRetry) return;
    gestureRetry = () => {
      gestureRetry = null;
      window.removeEventListener('pointerdown', gestureRetry);
      fadeInTitleMusic(url, { fadeMs, target });
    };
    window.addEventListener('pointerdown', gestureRetry);
  });
}

// options 容忍 null（标题界面 titleMusic 未初始化时也会被无条件调用）
export function fadeOutTitleMusic(options = null) {
  const { fadeMs = 800 } = options ?? {};
  if (gestureRetry) {
    window.removeEventListener('pointerdown', gestureRetry);
    gestureRetry = null;
  }
  if (!titleAudio || titleAudio.paused) return;
  ramp(titleAudio, 0, fadeMs, () => titleAudio.pause());
}
