// 战斗调试页：单场战斗前端冒烟（非正式 Shell）。
// 组成：全屏 canvas（Stage）+ 简易 DOM 覆盖层（tooltip / 日志 / 计数 / 终局提示）。
// 正式 Shell（Vue 薄壳）开工前，本页是 BattleStage 的验收工具。

import '../core/content/index.js';
import Player from '../core/state/player.js';
import { createRunState } from '../core/state/runState.js';
import { createSkillRuntime } from '../core/state/skillRuntime.js';
import { getEnemyDefinition } from '../core/enemies/registry.js';
import { getAllyDefinition } from '../core/allies/registry.js';
import { createBridge, EventNames } from '../bridge/index.js';
import { tooltipModel } from '../shell/tooltip.js';
import { StageManager } from '../stage/StageManager.js';
import { BattleStage } from '../stage/stages/BattleStage.js';

// ---- Bridge：一场测试战斗（多敌人 + 瑞米 + 体修牌组展示） ----
const runState = createRunState({
  player: new Player({ maxHp: 40, maxMana: 3, maxActionPoints: 3 }),
});
runState.player.deck = [
  'punch', 'punch', 'punch', 'punch', 'duckHead', 'duckHead', 'guard', 'guard',
  'slash', 'flyingDagger', 'agileCombo', 'breakStance',
].map(id => createSkillRuntime(id));

const bridge = createBridge({
  runState,
  enemies: ['bigSlime', 'pyro'].map(id => getEnemyDefinition(id).createUnit()),
  allies: [getAllyDefinition('remi').createUnit()],
  seed: Date.now() % 100000,
});

// ---- Stage ----
const canvas = document.createElement('canvas');
canvas.id = 'stage-canvas';
document.body.appendChild(canvas);

const stageManager = new StageManager();
stageManager.attach(canvas);
const stage = new BattleStage({ bridge, stageManager });
stageManager.setStage(stage);

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  stageManager.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();
stageManager.start();

canvas.addEventListener('pointermove', (e) => stage.handlePointerMove(e.clientX, e.clientY));
canvas.addEventListener('pointerdown', (e) => stage.handlePointerDown(e.clientX, e.clientY));
canvas.addEventListener('pointerup', (e) => stage.handlePointerUp(e.clientX, e.clientY));

// ---- DOM 覆盖层 ----
const overlay = document.createElement('div');
overlay.id = 'debug-overlay';
overlay.innerHTML = `
  <div id="debug-counts"></div>
  <div id="debug-log"></div>
  <div id="debug-tooltip" style="display:none"></div>
  <div id="debug-end" style="display:none"></div>
`;
document.body.appendChild(overlay);

const countsEl = overlay.querySelector('#debug-counts');
const logEl = overlay.querySelector('#debug-log');
const tooltipEl = overlay.querySelector('#debug-tooltip');
const endEl = overlay.querySelector('#debug-end');

function refreshCounts() {
  const p = bridge.getProjection();
  countsEl.textContent =
    `回合 ${p.turn.count}(${p.turn.side}) ｜ 牌库 ${p.counts.deck} 焚 ${p.counts.burnt}`
    + ` ｜ 换牌费 ${p.swapCost}`
    + (p.pendingInput ? ` ｜ 等待输入: ${p.pendingInput.request.kind}` : '');
}
bridge.backendBus.on(EventNames.STATE_DIRTY, refreshCounts);

bridge.backendBus.on(EventNames.BATTLE_LOG, ({ text, kind }) => {
  const line = document.createElement('div');
  line.className = `log-${kind}`;
  line.textContent = text;
  logEl.prepend(line);
  while (logEl.childElementCount > 30) logEl.lastChild.remove();
});

bridge.backendBus.on(EventNames.BATTLE_END, ({ result }) => {
  endEl.textContent = `战斗结束：${result}`;
  endEl.style.display = 'block';
});

// tooltip（Stage Picker → Shell 协议事件的调试呈现）——内容契约与正式 Shell 共享
// （tooltipModel；正式页渲染在 App.vue 的 TooltipOverlay，本页自组 HTML）
const renderTooltip = ({ kind, payload, x, y }) => {
  const m = tooltipModel(kind, payload);
  const delta = m.delta != null ? `（威力 ${m.delta > 0 ? '+' : ''}${m.delta}）` : '';
  const body = m.body ? `<br><span style="color:${m.tint ?? '#dde'}">${m.body}</span>` : '';
  tooltipEl.innerHTML = `<b>${m.title}</b>${delta}${body}`;
  tooltipEl.style.display = 'block';
  tooltipEl.style.left = `${x + 12}px`;
  tooltipEl.style.top = `${y + 12}px`;
};
bridge.frontendBus.on(EventNames.TOOLTIP_SHOW, renderTooltip);
bridge.frontendBus.on(EventNames.TOOLTIP_MOVE, ({ x, y }) => {
  tooltipEl.style.left = `${x + 12}px`;
  tooltipEl.style.top = `${y + 12}px`;
});
bridge.frontendBus.on(EventNames.TOOLTIP_HIDE, () => {
  tooltipEl.style.display = 'none';
});

// ---- 开打 ----
bridge.start();
refreshCounts();

// 调试钩子（playwright / 控制台用）
window.__debug = { bridge, stage, stageManager };
