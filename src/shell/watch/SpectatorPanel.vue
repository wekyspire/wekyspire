<script setup>
// 观战侧栏：中继连接窗 / 连接状态 / 局况条 / agent 出招流 / 会话选择。
// 只读——不放任何下单控件（观战端 intent 全是桩）。
import { computed, ref } from 'vue';

const props = defineProps({
  params: { type: Object, required: true },
  relayBase: { type: String, required: true },
  relayInput: { type: String, default: '' },
  status: { type: String, default: 'idle' },
  meta: { type: Object, default: null },
  runState: { type: Object, default: null },
  feed: { type: Array, default: () => [] },
  error: { type: String, default: '' },
  relayError: { type: String, default: '' },
  banner: { type: String, default: '' },
  buffered: { type: Number, default: 0 },
  sessionList: { type: Array, default: null },
  linkFor: { type: Function, required: true }, // (会话名, 是否整局重放) => 链接
});
const emit = defineEmits(['connect', 'disconnect']);

const address = ref(props.relayInput ?? '');
const editing = ref(false);

const STATUS_CN = {
  idle: '未指定会话', connecting: '连接中…', open: '直播中', error: '连接断开（重连中）', closed: '已断开',
};
const dot = computed(() => (props.relayError ? 'error' : props.status));

const connected = computed(() => !!props.meta);
const sessions = computed(() => props.sessionList ?? []);
const watchUrl = (name) => props.linkFor(name, false);
const replayUrl = (name) => props.linkFor(name, true);

const hpPct = computed(() => {
  const r = props.runState;
  return r ? Math.max(0, Math.min(100, Math.round((r.hp / r.maxHp) * 100))) : 0;
});
// 出招流倒序显示（最新在上）
const feedDesc = computed(() => [...props.feed].reverse().slice(0, 40));

function submit() {
  editing.value = false;
  emit('connect', address.value);
}
</script>

<template>
  <aside class="spectator">
    <header>
      <span class="dot" :class="dot"></span>
      <b>{{ meta?.session || params.session || '魏启尖塔 · 观战' }}</b>
      <span class="tag">{{ STATUS_CN[status] ?? status }}</span>
      <span v-if="meta?.mode === 'replay'" class="tag replay">整局重放</span>
      <button v-if="connected" class="mini-btn" @click="emit('disconnect')">断开</button>
    </header>

    <!-- 连接窗：填中继地址 → 连接（本机 http://127.0.0.1:5199；公网 https://wekyspire.hineven.site/relay） -->
    <section class="connect">
      <div class="title">连接中继</div>
      <form class="row" @submit.prevent="submit">
        <input
          v-model="address" spellcheck="false" placeholder="http://127.0.0.1:5199"
          @focus="editing = true"
        />
        <button type="submit">连接</button>
      </form>
      <p class="muted">
        当前：<code>{{ relayBase }}</code>
        <template v-if="meta"> · 种子 {{ meta.seed }}<template v-if="buffered"> · 已回放 {{ buffered }} 拍</template></template>
      </p>
      <p v-if="relayError" class="err">{{ relayError }}</p>
    </section>

    <!-- 会话选择：连上中继即可随时切会话（每 8s 自动刷新进度） -->
    <section class="picker">
      <div class="title">会话（{{ sessions.length }}）</div>
      <p v-if="!sessions.length" class="muted">中继上没有会话（先用 tools/headlessPlay.mjs new 建档）</p>
      <ul>
        <li v-for="s in sessions" :key="s.name">
          <a :href="watchUrl(s.name)">{{ s.name }}</a>
          <span class="muted">
            <template v-if="s.seed != null">种子 {{ s.seed }}</template>
            <template v-if="s.floor"> · 第{{ s.floor }}/{{ s.totalFloors }}层 {{ s.stage }}</template>
            <template v-if="s.result">（{{ s.result }}）</template>
            <template v-else-if="!s.loaded"> · 未载入</template>
          </span>
          <a class="mini" :href="replayUrl(s.name)">重放</a>
        </li>
      </ul>
    </section>

    <section v-if="runState" class="run">
      <div class="title">
        第 {{ runState.floor }}/{{ runState.totalFloors }} 层 · {{ runState.stageCn }}
        <span v-if="runState.result" class="tag">{{ runState.result === 'victory' ? '登顶' : '战败' }}</span>
      </div>
      <div class="hpbar"><i :style="{ width: hpPct + '%' }"></i><span>HP {{ runState.hp }}/{{ runState.maxHp }}</span></div>
      <div class="stats">
        护盾 {{ runState.shield }} ｜ 魏启 {{ runState.mana }}/{{ runState.maxMana }} ｜ AP {{ runState.actionPoints }}/{{ runState.maxActionPoints }}
        ｜ 金币 {{ runState.money }}
      </div>
      <div class="stats">
        灵脉 火{{ runState.leino?.fire ?? 0 }} ｜ 体修 {{ runState.bodyLevel }} ｜ 训练 {{ runState.trainingCount }} ｜ 进阶 {{ runState.ascensionCount }}
      </div>
      <div v-if="runState.encounter?.length" class="stats">
        本层遭遇：{{ runState.encounter.map(e => `${e.name}(${e.maxHp})`).join(' + ') }}
      </div>
      <details class="deck">
        <summary>牌组 {{ runState.deck?.length ?? 0 }} 张</summary>
        <div class="decklist">{{ (runState.deck ?? []).map(c => c.name).join('、') }}</div>
      </details>
    </section>

    <section class="feed">
      <div class="title">
        agent 出招流
        <span v-if="banner" class="banner">{{ banner }}</span>
      </div>
      <p v-if="error" class="err">{{ error }}</p>
      <ol>
        <li v-for="a in feedDesc" :key="a.index">
          <span class="idx">#{{ a.index + 1 }}</span>
          <code>{{ a.action }}</code>
          <span class="out">{{ a.outcome }}</span>
          <span class="floor">L{{ a.floor }}</span>
        </li>
        <li v-if="!feedDesc.length" class="muted">还没有动作——agent 每次出招都会出现在这里</li>
      </ol>
    </section>
  </aside>
</template>

<style scoped>
.spectator {
  position: fixed; top: 0; right: 0; width: 300px; height: 100%;
  box-sizing: border-box; padding: 10px 12px; overflow-y: auto;
  background: rgba(8, 11, 20, .82); border-left: 1px solid #26304a;
  color: #c7d0e4; font: 12px/1.6 sans-serif; pointer-events: auto;
}
header { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #e6ecf8; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #6b7280; }
.dot.open { background: #4ade80; box-shadow: 0 0 6px #4ade80; }
.dot.error { background: #f87171; }
.dot.connecting { background: #facc15; }
.tag { font-size: 11px; padding: 1px 6px; border-radius: 4px; background: #1e2740; color: #9fb0d0; }
.tag.replay { background: #3b2a4a; color: #d8b4fe; }
.mini-btn {
  margin-left: auto; padding: 2px 8px; font-size: 11px; cursor: pointer;
  background: #1e2740; color: #c7d0e4; border: 1px solid #38415e; border-radius: 4px;
}
.mini-btn:hover { background: #2c3554; }
.connect .row { display: flex; gap: 4px; }
.connect input {
  flex: 1; min-width: 0; padding: 3px 6px; font: 11px monospace;
  background: #0e1424; color: #cfe1ff; border: 1px solid #38415e; border-radius: 4px;
}
.connect button {
  padding: 3px 10px; font-size: 11px; cursor: pointer; white-space: nowrap;
  background: #26406b; color: #dbe7ff; border: 1px solid #3d5c94; border-radius: 4px;
}
.connect button:hover { background: #325189; }
section { margin-bottom: 12px; }
.title { font-size: 12px; color: #9fb0d0; margin-bottom: 4px; display: flex; gap: 6px; align-items: center; }
.banner { font-size: 11px; color: #ffd88a; }
.hpbar { position: relative; height: 16px; background: #1b2134; border-radius: 3px; overflow: hidden; }
.hpbar i { display: block; height: 100%; background: linear-gradient(90deg, #b91c1c, #ef4444); }
.hpbar span { position: absolute; inset: 0; text-align: center; font-size: 11px; color: #fff; }
.stats { color: #a9b4c9; font-size: 11px; }
.deck summary { cursor: pointer; color: #9fb0d0; }
.decklist { color: #8d9ab5; font-size: 11px; margin-top: 4px; }
.feed ol { list-style: none; margin: 0; padding: 0; }
.feed li { display: flex; gap: 5px; align-items: baseline; padding: 2px 0; border-bottom: 1px dashed #1d2437; }
.idx { color: #5d6a85; font-size: 10px; min-width: 26px; }
code { color: #cfe1ff; background: #131a2b; border-radius: 3px; padding: 0 4px; font-size: 11px; }
.out { color: #8d9ab5; flex: 1; font-size: 11px; }
.floor { color: #5d6a85; font-size: 10px; }
.err { color: #f87171; font-size: 11px; }
.muted { color: #6b7690; font-size: 11px; }
.picker ul { list-style: none; margin: 0; padding: 0; }
.picker li { padding: 3px 0; border-bottom: 1px dashed #1d2437; font-size: 11px; }
.picker a { color: #8ab4f8; text-decoration: none; }
.picker a:hover { text-decoration: underline; }
.picker .mini { margin-left: 6px; color: #a78bfa; }
</style>
