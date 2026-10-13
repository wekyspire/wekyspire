// 音频引擎（Web Audio，零依赖）：多轨并行 / 每轨音量+混响发送 / loop|once 模式。
//   音乐单槽位：切场景 = 等功率交叉淡化（新旧两轨各自保持 loop，旧轨淡到零才停；
//   曲线用 sin/cos 等功率对——线性交叉在中点有可闻响度凹陷）。常用轨预解码常驻内存，
//   切换热路径只动增益包络，反复切不顿挫。
//   混响 = 共享 ConvolverNode（程序化生成的衰减噪声 IR），每轨一条 send 增益控制湿度。
//   总开关 = settings.soundOn → master 增益（短斜坡防爆音）。
//   塔楼风声床（playWind/duckWind/stopWind）：looped 低频噪声曲线骑在增益与混响发送的
//   AudioParam 上（求和语义），模拟阵风时小时大；战斗内 duck 压暗不切源，回塔原样续播。
import { watch } from 'vue';
import { settings } from './settings.js';
import { resolveAudioUrl, loadAudioPack } from './audiopack.js';
import titleMusicUrl from '../assets/sounds/story-mode-intro.mp3';
import battleCh1Url from '../assets/sounds/battle-regular-ch1.mp3';
import windTowerUrl from '../assets/sounds/wind-tower.wav';
import windSoftUrl from '../assets/sounds/wind-tower-soft.wav';
import roomIndoorUrl from '../assets/sounds/room-indoor.wav';
import roomIndoorTorchUrl from '../assets/sounds/room-indoor-torch.wav';
import roomCrtHumUrl from '../assets/sounds/room-crt-hum.wav';
import roomCampfireUrl from '../assets/sounds/room-campfire.wav';
import powerOnUrl from '../assets/sounds/power-on.wav';

// 音轨登记表：volume/reverb 是默认电平（0..1，reverb 为湿声发送量），生成手感不对就改这里；
// bus = 'music'（过音乐总线，吃 MUSIC_BUS_LEVEL 削幅）| 'sfx'（直连 master）
const TRACKS = {
  title:     { url: titleMusicUrl, volume: 0.5, reverb: 0.10, bus: 'music' },
  battleCh1: { url: battleCh1Url, volume: 0.45, reverb: 0.08, bus: 'music' },
  wind:      { url: windTowerUrl, volume: 0.55, reverb: 0.28, bus: 'music' },
  windSoft:  { url: windSoftUrl, volume: 0.45, reverb: 0.34, bus: 'music' },
  // 休息室氛围床（playRoomAmbience 组合播；音量手感不对改这里）
  roomIndoor:     { url: roomIndoorUrl, volume: 0.5, reverb: 0.25, bus: 'music' },        // 塔楼室内底噪（无火把）
  roomIndoorTorch:{ url: roomIndoorTorchUrl, volume: 0.5, reverb: 0.25, bus: 'music' },   // 塔楼室内底噪（带火把）
  roomCrtHum:     { url: roomCrtHumUrl, volume: 0.22, reverb: 0.04, bus: 'music' },       // 显像管电器白噪（干一点，电气感不吃湿声）
  roomCampfire:   { url: roomCampfireUrl, volume: 0.45, reverb: 0.15, bus: 'music' },     // 篝火噼啪
  powerOn:        { url: powerOnUrl, volume: 0.6, reverb: 0.12, bus: 'music' },           // 通电（一次性，老虎机房进房触发）
};

let ctx = null;
let master = null, convolver = null, musicBus = null;
// 背景乐总线固定电平（2026-10-12 用户定：在总音量之外再削 50%，给未来的音效留响度头room）
const MUSIC_BUS_LEVEL = 0.5;
const buffers = new Map();  // key → Promise<AudioBuffer>（预解码常驻）
const live = new Set();     // 在播音轨句柄
let music = null;           // 当前音乐轨（单槽位）
let musicToken = 0;         // 交叉淡化竞态令牌：await 解码期间又来切换时丢弃旧货

// 等功率淡变曲线（单位值 0..1 / 1..0，用时按目标电平缩放）
const CURVE_N = 32;
const CURVE_IN = new Float32Array(CURVE_N), CURVE_OUT = new Float32Array(CURVE_N);
for (let i = 0; i < CURVE_N; i++) {
  const t = i / (CURVE_N - 1);
  CURVE_IN[i] = Math.sin(t * Math.PI / 2);
  CURVE_OUT[i] = Math.cos(t * Math.PI / 2);
}
const scaled = (unit, v) => { const c = new Float32Array(CURVE_N); for (let i = 0; i < CURVE_N; i++) c[i] = unit[i] * v; return c; };

// 程序化混响 IR：指数衰减立体声噪声（无 IR 素材依赖）
function makeImpulse(seconds = 2.2, decay = 2.6) {
  const rate = ctx.sampleRate, len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

function ensureCtx() {
  if (ctx) return ctx;
  ctx = new AudioContext();
  master = ctx.createGain();
  musicBus = ctx.createGain();
  musicBus.gain.value = MUSIC_BUS_LEVEL;
  musicBus.connect(master);
  convolver = ctx.createConvolver();
  convolver.buffer = makeImpulse();
  const wet = ctx.createGain();
  wet.gain.value = 1;
  convolver.connect(wet).connect(musicBus); // 湿声随音乐总线同削（现登记轨全是音乐；音效要混响时拆独立湿路）
  master.connect(ctx.destination);
  const applyMaster = () => {
    master.gain.setTargetAtTime(settings.soundOn ? settings.volume : 0, ctx.currentTime, 0.05);
  };
  applyMaster();
  // 自动播放策略：context 起先 suspended，首次手势放行（suspended 期间排入的音源会在放行时一起响）
  window.addEventListener('pointerdown', () => { if (ctx?.state === 'suspended') ctx.resume(); });
  watch(() => [settings.soundOn, settings.volume], applyMaster);
  return ctx;
}

function load(key) {
  let p = buffers.get(key);
  if (!p) {
    p = fetch(resolveAudioUrl(TRACKS[key].url))
      .then(r => r.arrayBuffer())
      .then(ab => ctx.decodeAudioData(ab))
      .catch((e) => { console.warn('[audio] 解码失败', key, e); return null; });
    buffers.set(key, p);
  }
  return p;
}

function teardown(h) {
  try { h.src.disconnect(); } catch { /* 已断 */ }
  try { h.gain.disconnect(); } catch { /* 已断 */ }
  try { h.send.disconnect(); } catch { /* 已断 */ }
}

/**
 * 播一条轨。返回句柄（stop/trackVolume/trackReverb 用）；once 模式播完自动回收。
 * opts: { loop=false, volume=轨表默认, reverb=轨表默认, fadeIn=0(秒) }
 */
export async function play(key, opts = {}) {
  ensureCtx();
  const def = TRACKS[key];
  if (!def) { console.warn('[audio] 未登记音轨', key); return null; }
  const buf = await load(key);
  if (!buf) return null;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = !!opts.loop;
  const gain = ctx.createGain();
  const send = ctx.createGain();
  src.connect(gain).connect(def.bus === 'sfx' ? master : musicBus);
  gain.connect(send).connect(convolver);
  const h = { key, src, gain, send, loop: !!opts.loop, volume: opts.volume ?? def.volume, fading: false };
  send.gain.value = opts.reverb ?? def.reverb;
  const fadeIn = opts.fadeIn ?? 0;
  if (fadeIn > 0) {
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.setValueCurveAtTime(scaled(CURVE_IN, h.volume), ctx.currentTime, fadeIn);
  } else {
    gain.gain.value = h.volume;
  }
  src.onended = () => { live.delete(h); teardown(h); };
  src.start();
  live.add(h);
  return h;
}

/** 停一条轨（等功率淡出到零再断源；fadeOut=0 立即停）。 */
export function stop(h, { fadeOut = 0.8 } = {}) {
  if (!h || h.fading || !ctx) return;
  h.fading = true;
  if (fadeOut <= 0) { try { h.src.stop(); } catch { /* 未启动 */ } return; }
  const t = ctx.currentTime;
  const cur = Math.max(h.gain.gain.value, 0.0001);
  h.gain.gain.cancelScheduledValues(t);
  h.gain.gain.setValueAtTime(cur, t);
  h.gain.gain.setValueCurveAtTime(scaled(CURVE_OUT, cur), t, fadeOut);
  setTimeout(() => { try { h.src.stop(); } catch { /* 已停 */ } }, fadeOut * 1000 + 60);
}

/** 运行期调音量/混响（setTargetAtTime 短斜坡，ramp 为时间常数）。 */
export function trackVolume(h, v, ramp = 0.1) { if (h && ctx) h.gain.gain.setTargetAtTime(v, ctx.currentTime, ramp); }
export function trackReverb(h, r, ramp = 0.1) { if (h && ctx) h.send.gain.setTargetAtTime(r, ctx.currentTime, ramp); }

/**
 * 音乐槽：切到 key（默认 loop）。同轨在播则不动；异轨 = 等功率交叉淡化，
 * 旧轨保持 loop 淡到零才停——反复切场景无顿挫。
 */
export async function playMusic(key, { fadeIn = 2 } = {}) {
  ensureCtx();
  if (music?.key === key && !music.fading) return;
  const token = ++musicToken;
  const prev = music;
  music = null;
  if (prev) stop(prev, { fadeOut: Math.max(fadeIn * 0.8, 0.8) });
  const h = await play(key, { loop: true, fadeIn });
  if (token !== musicToken) { stop(h, { fadeOut: 0.5 }); return; } // await 期间又被切走
  music = h;
}

/** 收掉当前音乐（回主菜单/战败等无后继曲的场合）。 */
export function stopMusic({ fadeOut = 1.5 } = {}) {
  musicToken++;
  if (music) stop(music, { fadeOut });
  music = null;
}

// ---------- 塔楼风声床 ----------
// 双层 loop 反重复：两段互素长度（13.9s/47s）风声并行，各自挂独立周期/相位的阵风 LFO
// （同一条曲线骑增益+混响发送+playbackRate——噪声无音高概念，速率微飘只漂移谱内容），
// 再加一条超慢 morph 曲线反号骑两层增益、分钟级轮换主导；合成体感周期实质永不重复。
// 控制信号 = 整数倍频正弦叠随机相位（天然首尾闭合）的 1024 点曲线 buffer，以极小
// playbackRate 拉伸到目标周期循环（重采样线性插值天然平滑，内存 4KB 而非全采样率数 MB），
// 经深度缩放后 connect 到 AudioParam（求和语义：基准值 + Σ曲线×深度）。
const WIND_LAYERS = [
  { key: 'wind',     period: 26, mean: 0.85, depth: 0.50, wetDepth: 0.12, rate: 0.025, morph: +1 },
  { key: 'windSoft', period: 37, mean: 0.80, depth: 0.45, wetDepth: 0.14, rate: 0.035, morph: -1 },
];
const MORPH_PERIOD = 53;   // 两层主导权轮换周期（秒）
const MORPH_DEPTH = 0.25;  // 主导轮换幅度（骑在各层 gust 增益上）
let wind = null;           // { morphSrc, layers: [...] } 单实例
let windToken = 0;         // 同 musicToken：await 解码期间的竞态丢弃

function makeGustLfo(period) {
  const N = 1024;
  const pts = new Float32Array(N);
  const comps = [1, 2, 3, 5].map(k => ({ k, a: 1 / k, p: Math.random() * Math.PI * 2 }));
  let peak = 0.001;
  for (let i = 0; i < N; i++) {
    let v = 0;
    for (const c of comps) v += c.a * Math.sin(2 * Math.PI * c.k * (i / N) + c.p);
    pts[i] = v;
    if (Math.abs(v) > peak) peak = Math.abs(v);
  }
  const buf = ctx.createBuffer(1, N, ctx.sampleRate);
  buf.getChannelData(0).set(pts.map(v => v / peak));
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.playbackRate.value = N / (ctx.sampleRate * period);
  return src;
}

function teardownWind(w, stopSrc = false) {
  if (stopSrc) {
    try { w.morphSrc.stop(); } catch { /* 已停 */ }
    for (const l of w.layers) {
      try { l.src.stop(); } catch { /* 已停 */ }
      try { l.lfo.stop(); } catch { /* 已停 */ }
    }
  }
  for (const n of [w.morphSrc, ...w.layers.flatMap(l => [l.src, l.lfo, l.gust, l.duck, l.gain, l.send, l.cg, l.cw, l.cr, l.cm])]) {
    try { n.disconnect(); } catch { /* 已断 */ }
  }
}

/** 风声床起跑（幂等）。每层链 = src → gust(阵风+主导轮换) → duck(战斗/事件压暗) → gain(淡变) → musicBus。 */
export async function playWind({ fadeIn = 3 } = {}) {
  ensureCtx();
  if (wind) return;
  const token = ++windToken;
  const bufs = await Promise.all(WIND_LAYERS.map(l => load(l.key)));
  if (token !== windToken || bufs.some(b => !b)) return;
  const morphSrc = makeGustLfo(MORPH_PERIOD);
  const layers = WIND_LAYERS.map((l, i) => {
    const def = TRACKS[l.key];
    const src = ctx.createBufferSource();
    src.buffer = bufs[i];
    src.loop = true;
    const gust = ctx.createGain(); gust.gain.value = l.mean;
    const duck = ctx.createGain(); duck.gain.value = 1;
    const gain = ctx.createGain();
    const send = ctx.createGain(); send.gain.value = def.reverb;
    src.connect(gust).connect(duck).connect(gain).connect(musicBus);
    gain.connect(send).connect(convolver);
    const lfo = makeGustLfo(l.period);
    const cg = ctx.createGain(); cg.gain.value = l.depth;
    const cw = ctx.createGain(); cw.gain.value = l.wetDepth;
    const cr = ctx.createGain(); cr.gain.value = l.rate;
    lfo.connect(cg).connect(gust.gain);
    lfo.connect(cw).connect(send.gain);
    lfo.connect(cr).connect(src.playbackRate);
    const cm = ctx.createGain(); cm.gain.value = MORPH_DEPTH * l.morph;
    morphSrc.connect(cm).connect(gust.gain);
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.setValueCurveAtTime(scaled(CURVE_IN, def.volume), ctx.currentTime, fadeIn);
    src.start();
    lfo.start();
    return { src, lfo, gust, duck, gain, send, cg, cw, cr, cm };
  });
  layers[0].src.onended = () => { if (wind?.layers[0] === layers[0]) { wind = null; teardownWind({ morphSrc, layers }); } };
  morphSrc.start();
  wind = { morphSrc, layers };
}

/** 战斗/事件房把风声压到 0（不切源：回来 duckWind(1) 原样续播）；ramp = setTargetAtTime 时间常数。 */
export function duckWind(level = 1, ramp = 0.9) {
  if (!wind || !ctx) return;
  for (const l of wind.layers) l.duck.gain.setTargetAtTime(level, ctx.currentTime, ramp);
}

/** 收掉风声床（两层同步淡出后停源拆链）。 */
export function stopWind({ fadeOut = 2 } = {}) {
  windToken++;
  const w = wind;
  wind = null;
  if (!w || !ctx) return;
  const t = ctx.currentTime;
  for (const l of w.layers) {
    const cur = Math.max(l.gain.gain.value, 0.0001);
    l.gain.gain.cancelScheduledValues(t);
    l.gain.gain.setValueAtTime(cur, t);
    l.gain.gain.setValueCurveAtTime(scaled(CURVE_OUT, cur), t, fadeOut);
  }
  setTimeout(() => teardownWind(w, true), fadeOut * 1000 + 60);
}

// ---------- 休息室氛围床 ----------
// 进房按房型组合播（环境层 + 特色层），离房整体收；篝火休息后单独收火层。
// 与风声床同位：素材自带有机起伏，不需要 LFO 雕琢——简单 loop 足够。
let ambience = null;   // Map<key, 句柄> 单实例（同刻只有一个房间在响）
export async function playAmbience(keys, { fadeIn = 1.2 } = {}) {
  ensureCtx();
  stopAmbience({ fadeOut: Math.min(fadeIn, 0.8) });
  const map = new Map();
  ambience = map;
  const handles = await Promise.all(keys.map(k => play(k, { loop: true, fadeIn })));
  for (const [i, k] of keys.entries()) map.set(k, handles[i]);
  if (ambience !== map) {   // await 期间被收/被换床（快速离房再进）：孤儿句柄即刻自收
    for (const h of handles) stop(h, { fadeOut: 0.3 });
  }
}

/** 收掉整张氛围床（离房/换房）。 */
export function stopAmbience({ fadeOut = 1.2 } = {}) {
  if (!ambience) return;
  for (const h of ambience.values()) stop(h, { fadeOut });
  ambience = null;
}

/** 单收一层（篝火休息后火灭音随）：长淡出，其余层原样续播。 */
export function stopAmbienceLayer(key, { fadeOut = 2.5 } = {}) {
  const h = ambience?.get(key);
  if (!h) return;
  ambience.delete(key);
  stop(h, { fadeOut });
}

/** 单层增减益（level 相对该层轨表电平；>1 抬升）：篝火推近特写时火声放大、拉远回落。 */
export function duckAmbienceLayer(key, level = 1, ramp = 0.8) {
  const h = ambience?.get(key);
  if (!h || !ctx) return;
  trackVolume(h, h.volume * level, ramp);
}

/**
 * 房型 → 氛围组合（挂点 = runController 进房换台那拍，与 duckWind(0) 同节拍）：
 *   商店房（瑞米售货机）：室内底噪 + 显像管白噪
 *   老虎机房（含银行机）：进房通一次电（只此一次）+ 室内底噪
 *   营地训练房（篝火+训练桩）：带火把底噪 + 篝火（休息后火层收掉，见 campChoose）
 * 其余房静默（风声已压暗）。未知房型返回 null 不响。
 */
export function playRoomAmbience(roomType) {
  if (roomType === 'shop') return playAmbience(['roomIndoor', 'roomCrtHum']);
  if (roomType === 'slot') {
    void play('powerOn');   // 进房通电一次性（走 TRACKS 默认电平）
    return playAmbience(['roomIndoor']);
  }
  if (roomType === 'campTraining') return playAmbience(['roomIndoorTorch', 'roomCampfire']);
  return null;
}

/** 探针/调试用只读快照。 */
export function _debug() {
  return {
    state: ctx?.state ?? 'uninit', music: music?.key ?? null, wind: !!wind,
    ambience: ambience ? [...ambience.keys()] : null,
    live: live.size, loaded: [...buffers.keys()],
  };
}

/**
 * 开机预载：全部登记轨下载 + 解码进缓存（不播放）。onStats 形状与 preloadAllArt 相同
 * （done/total/loadedBytes/totalBytes），由 App 合并进同一条进度。
 * gate = 与美术包**串行下载**的等待门（小水管服务器：同一时刻只跑一条大流量；
 * App 传入「artpack 下载落定」的 promise）。打包路径：单个 audiopack-*.bin 流式
 * 拉取（字节精确进度，取代 HEAD 逐条探测）；无包/失败回退逐条旧路径。
 * 失败只降级为静音开局（load 已 catch 落 null），不拦加载门。
 */
export async function preloadAudio({ onStats, gate = null } = {}) {
  ensureCtx();
  const keys = Object.keys(TRACKS);
  await gate;
  // 打包路径：单包流式下载（字节精确进度）；解码段沿用包字节报数（分母不回缩，
  // 进度条不回跳）。包下载失败/无包 → packed=false 走逐条回退
  let packGot = 0, packTot = 0;
  const packed = await loadAudioPack({
    onProgress: (got, tot, ms) => {
      packGot = got; packTot = tot;
      onStats?.({
        done: got >= tot ? keys.length : 0, total: keys.length,
        loadedBytes: got, totalBytes: tot, elapsedMs: ms, failed: 0,
      });
    },
  }).catch(() => false);
  let done = 0, failed = 0;
  if (packed) {
    for (const k of keys) {
      const buf = await load(k);
      if (!buf) failed += 1;
      done += 1;
      onStats?.({ done, total: keys.length, loadedBytes: packGot, totalBytes: packTot, failed });
    }
    return { total: keys.length, failed };
  }
  // 逐条回退：HEAD 探测体积（缺席 = 该条不计入分母）
  let loadedBytes = 0, totalBytes = 0;
  const sizes = new Map();
  await Promise.all(keys.map(async (k) => {
    try {
      const res = await fetch(TRACKS[k].url, { method: 'HEAD' });
      const n = Number(res.headers.get('content-length'));
      if (res.ok && Number.isFinite(n) && n > 0) { sizes.set(k, n); totalBytes += n; }
    } catch { /* 缺席 */ }
  }));
  const report = () => onStats?.({ done, total: keys.length, loadedBytes, totalBytes });
  report();
  await Promise.all(keys.map(async (k) => {
    const buf = await load(k);
    if (buf && sizes.has(k)) loadedBytes += sizes.get(k);
    if (!buf) failed += 1;
    done += 1;
    report();
  }));
  return { total: keys.length, failed };
}
