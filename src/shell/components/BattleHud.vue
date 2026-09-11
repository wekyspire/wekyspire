<script setup>
// 战斗 HUD：左上日志 + 回合计数。tooltip 渲染已上移 App.vue 的 TooltipOverlay
// （两层共享）；本组件只把 3D Picker 的 tooltip:* 事件转发进 tooltipHub（DOM 源
// 直调 hub，两类源汇入同一状态机与浮层）。
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { EventNames } from '../../bridge/index.js';
import { tooltipShow, tooltipMove, tooltipHide } from '../tooltipHub.js';

const props = defineProps({ ctrl: { type: Object, required: true } });
const ctrl = props.ctrl;
const turnText = ref('');
let bridge = null;

const refresh = () => {
  const p = bridge?.getProjection();
  if (p) turnText.value = `回合 ${p.turn.count}（${p.turn.side === 'player' ? '玩家' : '敌方'}）`;
};

const onTooltipShow = ({ kind, payload, x, y }) => tooltipShow(kind, payload, x, y);
const onTooltipMove = ({ x, y }) => tooltipMove(x, y);
const onTooltipHide = () => tooltipHide();

onMounted(() => {
  bridge = ctrl.getBattleBridge();
  if (!bridge) return;
  bridge.backendBus.on(EventNames.STATE_DIRTY, refresh);
  bridge.frontendBus.on(EventNames.TOOLTIP_SHOW, onTooltipShow);
  bridge.frontendBus.on(EventNames.TOOLTIP_MOVE, onTooltipMove);
  bridge.frontendBus.on(EventNames.TOOLTIP_HIDE, onTooltipHide);
  refresh();
});
onBeforeUnmount(() => {
  bridge?.backendBus.off(EventNames.STATE_DIRTY, refresh);
  bridge?.frontendBus.off(EventNames.TOOLTIP_SHOW, onTooltipShow);
  bridge?.frontendBus.off(EventNames.TOOLTIP_MOVE, onTooltipMove);
  bridge?.frontendBus.off(EventNames.TOOLTIP_HIDE, onTooltipHide);
  tooltipHide(); // 卸载兜底收起：浮层宿主常驻，别残留战斗层留下的显示态
});
</script>

<template>
  <div class="hud">
    <div class="turn">{{ turnText }}</div>
    <div class="log">
      <div v-for="l in ctrl.log" :key="l.id" :class="`log-${l.kind}`">{{ l.text }}</div>
    </div>
  </div>
</template>

<style scoped>
.hud { position: fixed; top: 8px; left: 12px; z-index: 20; font-family: sans-serif; pointer-events: none; }
.turn {
  color: #ccd; font-size: 13px; background: rgba(0, 0, 0, .45);
  padding: 4px 10px; border-radius: 4px; display: inline-block;
}
.log { margin-top: 8px; max-width: 340px; color: #aab; font-size: 12px; }
.log .log-combat { color: #e8b; }
.log .log-skill { color: #8ce; }
</style>
