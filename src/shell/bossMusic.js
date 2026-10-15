// 第一章 Boss 两段 BGM 状态机（2026-10-13）：单条素材按段落边界运行期切片 +
// 循环段「等功率接缝」烘焙（尾头交叠——in-out 混响式衔接，不硬切）。
//   入场(0→introEnd) → 一阶段循环(introEnd→p1End) →[进二阶段]→ 桥段(p1End→bridgeEnd)
//   → 二阶段循环(bridgeEnd→p2LoopEnd)
// 桥段以鼓点起拍：进二阶段 = 当前循环快淡出 + 桥段即刻满音量进（鼓点压场）；
// 桥段→二阶段为预排无缝续接（同入场→一阶段）。
// 边界是实测默认值（RMS/瞬态分析），bossMusic.html 试听可调后回填这里。
// 测试页：bossMusic.html（dev only）；游戏接线待试听验收后另做
// （战斗起播 / bosses/*P2 剧本 toPhase2 / 终局收束）。
import bossUrl from '../assets/sounds/boss-ch1.mp3';

/** 段落边界（秒）——手调后回填。口径：切点放在事件**前面**的安静/稀疏区，让鼓点完整落在下一段。 */
export const BOSS_MUSIC_DEFAULTS = Object.freeze({
  introEnd: 10.12,    // 入场尾（10.20 满编制起拍前）
  p1End: 104.15,      // 一阶段循环尾（104.20-104.45 鼓组块 = 桥段起拍，划归桥段）
  bridgeEnd: 120.45,  // 桥段尾（120.50 起二阶段持续织体）
  p2LoopEnd: 180.20,  // 二阶段循环尾（180.30 后是全曲自然收尾淡出，不进循环）
  loopXfade: 2.4,     // 循环接缝等功率交叠时长
  toP2Fade: 0.4,      // 进二阶段时一阶段循环的淡出（桥段鼓点即刻进）
});

let ctx = null;
let master = null;
let decoded = null;        // 原始 AudioBuffer（波形绘制/切片源）
let seg = { ...BOSS_MUSIC_DEFAULTS };
let baked = null;          // { intro, p1, bridge, p2 } AudioBuffer（p1/p2 已烘焙循环接缝）
let gen = 0;               // 状态代际令牌：换段使旧链上的排程/回调全部作废
const genSources = new Map(); // 代际 → 在播音源列表（换段/停止时按代际整批收割）
let st = { segment: 'idle', startedAt: 0, loops: 0 };

/** 等功率循环烘焙：段 [s,e] 的尾 loopXfade 秒与头交叠，产出无缝循环体（长 e-s-xfade）。 */
function bakeLoop(buf, startS, endS, xfadeS) {
  const sr = buf.sampleRate;
  const s0 = Math.floor(startS * sr), s1 = Math.floor(endS * sr);
  const xN = Math.min(Math.floor(xfadeS * sr), Math.floor((s1 - s0) / 3));
  const len = s1 - s0 - xN;
  const out = ctx.createBuffer(buf.numberOfChannels, len, sr);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c);
    const dst = out.getChannelData(c);
    dst.set(src.subarray(s0, s1 - xN));
    for (let i = 0; i < xN; i++) {
      const a = i / xN;                       // 等功率：cos/sin
      dst[len - xN + i] = src[s1 - xN + i] * Math.cos(a * Math.PI / 2)
        + src[s0 + i] * Math.sin(a * Math.PI / 2);
    }
  }
  return out;
}

function slice(buf, startS, endS) {
  const sr = buf.sampleRate;
  const s0 = Math.floor(startS * sr), s1 = Math.floor(endS * sr);
  const out = ctx.createBuffer(buf.numberOfChannels, s1 - s0, sr);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    out.getChannelData(c).set(buf.getChannelData(c).subarray(s0, s1));
  }
  return out;
}

function rebake() {
  baked = {
    intro: slice(decoded, 0, seg.introEnd),
    p1: bakeLoop(decoded, seg.introEnd, seg.p1End, seg.loopXfade),
    bridge: slice(decoded, seg.p1End, seg.bridgeEnd),
    p2: bakeLoop(decoded, seg.bridgeEnd, seg.p2LoopEnd, seg.loopXfade),
  };
}

function stopAllSources() {
  for (const [, list] of genSources) {
    for (const s of list) { try { s.src.stop(); } catch { /* 已停 */ } }
  }
  genSources.clear();
}

function playBuffer(g, buffer, { when = 0, loop = false, gain = 1 } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = loop;
  const g2 = ctx.createGain();
  g2.gain.value = gain;
  src.connect(g2).connect(master);
  const startAt = ctx.currentTime + when;
  src.start(startAt);
  const list = genSources.get(g) ?? [];
  list.push({ src, gain: g2, startAt });
  genSources.set(g, list);
  return { src, gain: g2, startAt };
}

/** 加载/重建（幂等）。dest = 目标节点（测试页 destination，游戏接线给音乐总线）。 */
export async function loadBossMusic(audioCtx, dest, { segments = null, url = bossUrl } = {}) {
  ctx = audioCtx;
  if (segments) seg = { ...seg, ...segments };
  if (master) { try { master.disconnect(); } catch { /* 已断 */ } }
  master = ctx.createGain();
  master.connect(dest);
  if (!decoded) {
    const res = await fetch(url);
    decoded = await ctx.decodeAudioData(await res.arrayBuffer());
  }
  gen += 1;
  stopAllSources();
  rebake();
  st = { segment: 'idle', startedAt: 0, loops: 0 };
  return decoded;
}

/** 开演：入场 → 一阶段循环（预排无缝续接）。 */
export function bossMusicStart() {
  if (!baked || st.segment !== 'idle') return;
  const g = ++gen;
  stopAllSources();
  // 停止中重开：master 淡出渐变若在途会抹死新链——先取消回满
  master.gain.cancelScheduledValues(ctx.currentTime);
  master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
  const { intro, p1 } = baked;
  playBuffer(g, intro);
  const h = playBuffer(g, p1, { when: intro.duration, loop: true });   // 预排无缝续接
  st = { segment: 'intro', startedAt: ctx.currentTime, loops: 0, next: { seg: 'p1', at: h.startAt } };
}

/** 进二阶段：当前循环快淡出 + 桥段即刻进（鼓点起拍）→ 预排二阶段循环。 */
export function bossMusicToPhase2() {
  if (!baked) return;
  if (st.segment === 'bridge' || st.segment === 'p2') return;   // 已在桥段/二阶段
  const g = ++gen;
  const now = ctx.currentTime;
  for (const [, list] of genSources) {
    for (const s of list) {   // 旧段淡出让位（桥段满音量进——鼓点不被柔化）
      try {
        s.gain.gain.cancelScheduledValues(now);
        s.gain.gain.setValueAtTime(s.gain.gain.value, now);
        s.gain.gain.linearRampToValueAtTime(0, now + seg.toP2Fade);
      } catch { /* 已断 */ }
      try { s.src.stop(now + seg.toP2Fade + 0.05); } catch { /* 已停 */ }
    }
  }
  genSources.clear();
  const { bridge, p2 } = baked;
  playBuffer(g, bridge);
  const h = playBuffer(g, p2, { when: bridge.duration, loop: true });
  st = { segment: 'bridge', startedAt: now, loops: 0, next: { seg: 'p2', at: h.startAt } };
}

/** 全停（淡出）。 */
export function bossMusicStop({ fadeOut = 1.5 } = {}) {
  if (!master || !ctx) return;
  const now = ctx.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(master.gain.value, now);
  master.gain.linearRampToValueAtTime(0, now + fadeOut);
  const g = ++gen;
  setTimeout(() => {
    if (g !== gen) return;
    stopAllSources();
    st = { segment: 'idle', startedAt: 0, loops: 0 };
    master.gain.setValueAtTime(1, ctx.currentTime);   // 音量回满（下次起播）
  }, fadeOut * 1000 + 80);
  st = { segment: 'stopping', startedAt: now, loops: 0 };
}

/** 音量（测试页滑条/游戏总线口径）。 */
export function bossMusicSetVolume(v, ramp = 0.1) {
  if (!master || !ctx) return;
  master.gain.setTargetAtTime(v, ctx.currentTime, ramp);
}

/** 状态读数：段落、段内位置（秒）、循环圈数。 */
export function bossMusicState() {
  if (!ctx || st.segment === 'idle' || st.segment === 'stopping') return { segment: st.segment, pos: 0, loops: 0 };
  const t = ctx.currentTime;
  if (t < (st.next?.at ?? Infinity)) {
    const base = st.segment === 'intro' ? baked.intro : baked.bridge;
    return { segment: st.segment, pos: t - st.startedAt, loops: 0, segDur: base.duration };
  }
  const key = st.next.seg;
  const buf = key === 'p1' ? baked.p1 : baked.p2;
  const elapsed = t - st.next.at;
  return { segment: key, pos: elapsed % buf.duration, loops: Math.floor(elapsed / buf.duration), segDur: buf.duration };
}

/** 当前边界表（页面读显/回填核对）。 */
export function bossMusicSegments() { return { ...seg }; }

/** 原始解码 buffer（页面画波形用）。 */
export function bossMusicSourceBuffer() { return decoded; }
