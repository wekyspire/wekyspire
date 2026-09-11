<script setup>
// 观战页：连 headless 直播中继（SSE），用真 Stage 播 agent 的对局。
// 渲染层与正式壳**同一批组件**：StageManager + BattleStage（3D 战场/手牌/血环/按钮/
// 区域查看器）+ BattleHud（回合与战斗日志）+ TooltipOverlay（含悬停整卡预览）+
// AssetLoadingScreen（全量美术预载门）。差别只在数据来源是「远端 bridge」
// （src/bridge/remoteBridge.js）而非本地 core——面板读的 ctrl 是个只读假壳。
import { inject, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import '../../core/content/index.js';
import { StageManager } from '../../stage/StageManager.js';
import { BattleStage } from '../../stage/stages/BattleStage.js';
import { preloadBattleArt } from '../../stage/art/preload.js';
import { preloadAllArt } from '../../stage/art/assetManifest.js';
import { EventNames } from '../../bridge/events.js';
import { fitGameFrame } from '../frame.js';
import BattleHud from '../components/BattleHud.vue';
import TooltipOverlay from '../components/TooltipOverlay.vue';
import AssetLoadingScreen from '../components/AssetLoadingScreen.vue';
import SpectatorPanel from './SpectatorPanel.vue';

const props = defineProps({
  params: { type: Object, required: true },
  relayBase: { type: String, required: true },
});
const remote = inject('remote', null);
const params = props.params;
const relayBase = props.relayBase;

const canvas = ref(null);
const frameEl = ref(null);
const assetsReady = ref(false);
const assetProgress = ref({ loaded: 0, total: 0 });
const status = ref(remote ? 'connecting' : 'idle'); // idle = 没给 session（显示会话选择）
const meta = ref(null);
const runState = ref(null);
const feed = ref([]);          // agent 出招流（旧→新）
const log = reactive([]);      // 战斗日志（新→旧，供 BattleHud）
const errorText = ref('');     // 会话内错误（重放失败等）
const relayError = ref('');    // 中继连接错误（列表拉取失败）
const banner = ref('');
const buffered = ref(0);
const moment = ref(null);      // 当前展示的「过渡时刻」（选卡/进阶/奖励房/战斗结果）
const sessionList = ref(null);

// 过渡时刻的本地节拍事件名（不进 core，也不上线：纯粹是观战页自己的演出）
const MOMENT_EVENT = 'watch:moment';
const MOMENT_HOLD_MS = 2400;   // 每张过渡卡的停留时长（节拍内占位，读完为止）

/**
 * 把中继推来的过渡时刻排进**本地队列**按时长播放——与战斗节拍同一条队列，
 * 因此顺序与真实流程一致，不会插队/抢拍。
 *
 * 刻意**不做「落后就跳过」**：丢弃队列里的节拍会让后续 anim 落在过期的 sync
 * 快照上（观感即各种跳变/残留），这正是 sequencer.cancelAll 只用于离场的原因。
 * 落后时就让队列慢慢补（侧栏的出招流与局况始终是最新的，可先看那边）。
 */
function queueMoment(m) {
  const seq = remote?.bridge?.sequencer;
  if (!seq) return;
  seq.enqueueInstruction({
    durationMs: MOMENT_HOLD_MS + 5000, // 宽保险丝：正常由下面的定时器自完结（避免节拍超时告警）
    meta: { event: MOMENT_EVENT },
    start: ({ id }) => {
      moment.value = m;
      setTimeout(() => seq.finish(id), MOMENT_HOLD_MS);
    },
  });
}

// BattleHud 只要这两样：拿到 bridge（订 STATE_DIRTY / 转发 tooltip）、读 log
const fakeCtrl = { log, getBattleBridge: () => remote?.bridge ?? null };

let stageManager = null;
let battleStage = null;
let fitHandler = null;
let listTimer = null;
let corpseTimer = null;
let logSeq = 0;

const SIDEBAR_PX = 300; // 与 SpectatorPanel 的 width 一致（取景框让位用）

// ---------- 连接控制（面板里的「连接地址」窗）----------
// 连接 = 换 URL 参数并重载页面：SSE 连接与舞台都干净重建，避免在应用内管理重连状态机。
const relayInput = ref(relayBase);

/** 把用户输入的地址规整成可解析形式：带协议原样；host:port 补 http://；其余当同源路径。 */
function normalizeRelay(input) {
  const s = String(input ?? '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[\w.-]+:\d+$/.test(s)) return `http://${s}`;
  return s;
}

/** 当前「去哪儿找中继」的原始参数（保留在切换会话的链接里）。 */
function locatorQuery() {
  const q = new URLSearchParams();
  if (params.relay) q.set('relay', params.relay);
  else {
    q.set('port', params.port);
    if (params.host && params.host !== '127.0.0.1') q.set('host', params.host);
  }
  return q;
}

function gotoQuery(extra = null) {
  const q = extra ?? locatorQuery();
  location.search = q.toString();
}

function onConnect(address) {
  const relay = normalizeRelay(address);
  if (!relay) { errorText.value = '请填写中继地址，例如 http://127.0.0.1:5199 或 https://wekyspire.hineven.site/relay'; return; }
  const q = new URLSearchParams();
  q.set('relay', relay); // 连接后回到会话列表（不带 session）
  gotoQuery(q);
}

function onDisconnect() {
  gotoQuery(); // 保留中继定位参数，仅退出当前会话 → 回到列表
}

/** 会话切换链接（保留当前中继定位参数） */
function linkFor(name, replay = false) {
  const q = locatorQuery();
  q.set('session', name);
  if (replay) q.set('mode', 'replay');
  return `?${q.toString()}`;
}

function pushLog({ text, kind }) {
  log.unshift({ id: ++logSeq, text, kind }); // 与 runController.pushLog 同款：新→旧 + 上限 30
  if (log.length > 30) log.pop();
}

function startBattle(rec) {
  // 先预取素材（立绘/卡图进共享缓存），再建舞台——首拍同步命中，无占位闪变。
  // 必须**同步**建好：舞台构造函数里订阅总线，晚一拍就会漏掉开头几条演出指令。
  preloadBattleArt({
    deck: (rec.roster?.deck ?? []).map(defId => ({ defId })),
    enemies: (rec.enemies ?? []).map(e => ({ defId: e.defId })),
    allies: (rec.allies ?? []).map(a => ({ defId: a.defId })),
  });
  battleStage?.dispose();
  banner.value = '';
  moment.value = null; // 进战斗即收起过渡卡
  log.length = 0;
  battleStage = new BattleStage({
    bridge: remote.bridge, stageManager, scene: rec.scene, sceneSeed: rec.sceneSeed,
  });
  stageManager.setStage(battleStage);
}

function onRecord(rec) {
  switch (rec.t) {
    case 'hello': meta.value = rec; break;
    case 'run': runState.value = rec; break;
    case 'act':
      feed.value.push(rec);
      if (feed.value.length > 80) feed.value.shift();
      break;
    case 'battle': if (rec.phase === 'begin') startBattle(rec); break;
    case 'moment': queueMoment(rec); break;
    case 'buffered': buffered.value = rec.count; break;
    case 'error': errorText.value = rec.message; break;
    case 'reset': banner.value = '会话被重写，重新接入…'; moment.value = null; break;
    case 'replay-end': banner.value = '整局重放结束'; break;
    default: break;
  }
}

// 指针：与 App.vue 同款换算（画布在 16:9 取景框内，减框偏移）。观战端 intent 是桩，
// 但 hover/框选/区域查看器这些只读交互照常可用。
const framePoint = (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
};
const onPointerMove = (e) => battleStage?.handlePointerMove(...framePoint(e));
const onPointerDown = (e) => battleStage?.handlePointerDown(...framePoint(e));
const onPointerUp = (e) => battleStage?.handlePointerUp(...framePoint(e));

async function loadSessionList() {
  try {
    const res = await fetch(`${relayBase}/sessions`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    sessionList.value = await res.json();
    relayError.value = '';
  } catch (err) {
    relayError.value = `连不上直播中继 ${relayBase}（${err.message}）——本机的话先启动 node tools/broadcast.mjs`;
  }
}

onMounted(() => {
  preloadAllArt({
    onProgress: (loaded, total) => { assetProgress.value = { loaded, total }; },
  }).then(() => { assetsReady.value = true; });

  stageManager = new StageManager();
  stageManager.attach(canvas.value);
  // 右侧 300px 是观战侧栏：取景框为它让位（否则最右敌人的身体会被面板压住）
  const fit = () => fitGameFrame({ frame: frameEl.value, stageManager, reserveRight: SIDEBAR_PX });
  fitHandler = fit;
  fit();
  window.addEventListener('resize', fit);
  stageManager.start();

  // 尸体收殓兜底：中途接入/跳段时死亡演出节拍不在队列里，只剩快照的 isDead——
  // 不补的话尸体会带着 0/xx 站着（幂等，正常路径下无事发生）
  corpseTimer = setInterval(() => battleStage?.settleCorpses?.(), 500);

  // 会话列表常驻（连上中继就能随时切会话/看进度）；中继不可达时给出可读报错
  loadSessionList();
  listTimer = setInterval(loadSessionList, 8000);

  if (!remote) return;
  remote.setRecordHandler(onRecord);
  remote.setStatusHandler((s) => { status.value = s; });
  remote.bridge.backendBus.on(EventNames.BATTLE_LOG, pushLog);
  remote.bridge.backendBus.on(EventNames.BATTLE_END, ({ result }) => {
    banner.value = result === 'victory' ? '⚔ 战斗胜利' : '💀 战斗失败';
  });
  // 调试钩子（与 debug/main.js 的 window.__debug 同款）：控制台/自动化排查用
  window.__watch = {
    remote, get snapshot() { return remote.bridge.getProjection(); },
    get stage() { return battleStage; }, get stageManager() { return stageManager; },
  };
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', fitHandler);
  clearInterval(listTimer);
  clearInterval(corpseTimer);
  battleStage?.dispose();
  stageManager?.dispose();
  remote?.close();
});
</script>

<template>
  <!-- 16:9 取景框（fitFrame 定尺寸）：tooltip 落点与指针坐标数学依赖它 -->
  <div id="game-frame" ref="frameEl">
    <canvas
      id="stage-canvas" ref="canvas"
      @pointermove="onPointerMove" @pointerdown="onPointerDown" @pointerup="onPointerUp"
    ></canvas>
    <AssetLoadingScreen v-if="!assetsReady" :progress="assetProgress" />
    <template v-else>
      <BattleHud v-if="remote && runState?.stage === 'battle'" :ctrl="fakeCtrl" />
      <!-- 过渡时刻卡：塔楼/选卡/进阶这些「没有演出节拍」的阶段，在这里按时长停留，
           让观战者看清选了什么（候选行里 ✓ 标出所选，只服务观战页） -->
      <Transition name="moment">
        <div v-if="moment" class="moment">
          <div class="moment-head">
            <span class="moment-tag">{{ moment.stageCn }}</span>
            <span class="moment-title">{{ moment.title }}</span>
          </div>
          <div v-if="moment.candidates" class="moment-cands">
            <div
              v-for="(c, i) in moment.candidates" :key="i"
              class="cand" :class="{ taken: c.taken }"
            >
              <span class="tick">{{ c.taken ? '✓' : '' }}</span>
              <span class="cand-name">{{ c.name }}</span>
              <span class="cand-tier">{{ c.tier }}阶</span>
            </div>
          </div>
          <div v-if="moment.card" class="moment-cardface">
            <b>{{ moment.card.name }}</b>
            <span class="cand-tier">{{ moment.card.tier }}阶 · {{ moment.card.costText }}</span>
            <div class="cardface-text">{{ moment.card.text }}</div>
          </div>
          <ul class="moment-lines">
            <li v-for="(l, i) in moment.lines" :key="i">{{ l }}</li>
          </ul>
        </div>
      </Transition>
    </template>
    <TooltipOverlay />
  </div>
  <!-- 观战侧栏放在取景框**外面**：帧有 transform（fixed 后代的包含块），
       放在帧内 right:0 会压在战斗画面上；放在帧外才是窗口右侧整条 -->
  <SpectatorPanel
    v-if="assetsReady"
    :params="params" :relay-base="relayBase" :relay-input="relayInput"
    :status="status" :meta="meta" :run-state="runState" :feed="feed"
    :error="errorText" :relay-error="relayError" :banner="banner"
    :buffered="buffered" :session-list="sessionList"
    :link-for="linkFor" @connect="onConnect" @disconnect="onDisconnect"
  />
</template>

<style>
html, body { margin: 0; padding: 0; overflow: hidden; background: #000; }
#game-frame { position: absolute; background: #000; transform: translateZ(0); }
#stage-canvas { display: block; position: absolute; inset: 0; }

/* 过渡时刻卡：居中偏左（右侧 300px 是观战侧栏），可读性优先 */
.moment {
  position: fixed; left: 38%; top: 46%; transform: translate(-50%, -50%);
  z-index: 30; min-width: 260px; max-width: 420px; padding: 12px 16px;
  background: rgba(10, 14, 26, .9); border: 1px solid #3a4a6e; border-radius: 8px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, .6); color: #dbe4f5;
  font: 13px/1.6 sans-serif; pointer-events: none;
}
.moment-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; }
.moment-tag {
  font-size: 11px; padding: 1px 7px; border-radius: 4px;
  background: #26406b; color: #bfd4ff;
}
.moment-title { font-weight: 600; color: #f0f4ff; }
.moment-cands { display: flex; flex-direction: column; gap: 3px; margin: 6px 0; }
.cand { display: flex; align-items: baseline; gap: 6px; padding: 2px 6px; border-radius: 4px; background: #131a2b; color: #8d9ab5; }
.cand.taken { background: #24402c; color: #d6ffe4; outline: 1px solid #3f7a52; }
.cand .tick { width: 10px; color: #6ee7a0; }
.cand-name { flex: 1; }
.cand-tier { font-size: 11px; color: #7f8ba6; }
.moment-cardface { margin: 6px 0; padding: 6px 8px; background: #16203a; border-radius: 5px; }
.cardface-text { color: #a9b8d6; font-size: 12px; }
.moment-lines { margin: 6px 0 0; padding-left: 16px; color: #b9c6de; }
.moment-lines li { margin: 1px 0; }
.moment-enter-active, .moment-leave-active { transition: opacity .35s ease, transform .35s ease; }
.moment-enter-from, .moment-leave-to { opacity: 0; transform: translate(-50%, -44%); }
</style>
