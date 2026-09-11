// 观战页入口（watch.html）：解析 URL 参数 → 建远端 bridge → 挂 Vue 应用。
// bridge 先于组件创建：BattleHud/TooltipOverlay 在挂载时就订阅总线，
// 晚建会导致它们拿不到 bridge（子组件 onMounted 早于父组件）。
//
// 中继地址的解析（两种部署形态）：
//   · 本机开发：`?port=5199`（可选 ?host=）→ http://127.0.0.1:5199
//   · 公网部署：`?relay=relay/`（同源路径，Apache 反代到本机隧道端口）→
//     https://<站点>/relay —— 同源既免 CORS，也避开 https 页面连 http 的混合内容拦截
//   不传参数时按 hostname 自动选：localhost/127.0.0.1 走本机默认端口，其余走同源 /relay。
import { createApp } from 'vue';
import WatchApp from './WatchApp.vue';
import { createRemoteBridge } from '../../bridge/remoteBridge.js';

const q = new URLSearchParams(location.search);
const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

const host = q.get('host') ?? '127.0.0.1';
const port = q.get('port') ?? '5199';
const session = q.get('session') ?? '';
const mode = q.get('mode') === 'replay' ? 'replay' : 'live';

// 中继基址：显式 ?relay= 优先；否则本机用 host:port，公网站点用同源 relay/。
// 统一折算成绝对 URL 且不带尾斜杠（SpectatorPanel 直接拼 `/sessions`、`/live?...`）。
// 带协议头的值按绝对 URL 解析；不带协议的按同源路径解析（如 relay/ 、/relay/）。
const relayParam = q.get('relay') ?? (isLocalHost ? null : 'relay/');
const relayBase = (relayParam
  ? new URL(relayParam, location.href).href
  : `http://${host}:${port}`).replace(/\/+$/, '');

// 会话切换链接要保留「怎么找到中继」的原始参数（session/mode 由链接自己补）
const linkQuery = new URLSearchParams();
for (const [k, v] of q) if (k !== 'session' && k !== 'mode') linkQuery.set(k, v);
if (!relayParam && !linkQuery.has('port') && !isLocalHost) linkQuery.set('port', port);

const app = createApp(WatchApp, {
  params: { host, port, session, mode, relay: relayParam, query: linkQuery.toString() },
  relayBase,
});

let remote = null;
if (session) {
  remote = createRemoteBridge({
    url: `${relayBase}/live?session=${encodeURIComponent(session)}&mode=${mode}`,
  });
  app.provide('remote', remote);
}
app.mount('#app');
