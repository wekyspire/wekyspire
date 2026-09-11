<script setup>
// 卡面预览（战斗同源）：直接调战场牌面烘焙器 bakeCardFace 出 dataURL，
// 与战场卡走同一渲染管线（等阶边框/费用徽章/富文本正文/卡图）——所见即所得，
// 无需在 Vue 面板里维护第二套卡面样式。
// 富文本热区（named/effect/card）与战斗共用同一 tooltip 契约：命中判定走
// layout.hitTestRegions（与 CardObject 3D 拾取同一实现），内容与浮层走
// tooltipHub（App.vue 的 TooltipOverlay 统一渲染）。
// 卡图异步加载：未命中先按无图出卡，加载完成订阅重出（与战场 addOnLoad 重烘同语言）。
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import { getSkillDefinition } from '../../core/skills/registry.js';
import { cardViewFromDef } from '../../core/skills/cardView.js';
import { bakeCardFace } from '../../stage/richtext/cardFace.js';
import { hitTestRegions } from '../../stage/richtext/layout.js';
import { sharedCardArtCache } from '../../stage/art/cardArtCache.js';
import { sharedUnitArtCache } from '../../stage/art/unitArt.js';
import { KEYWORD_LABELS } from '../../bridge/projection.js';
import { tooltipShow, tooltipHide, framePoint } from '../tooltipHub.js';

const props = defineProps({
  skillId: { type: String, required: true },
  // describe 上下文：run 级面板传 { player }（应用前口径，与旧面板文案一致）
  ctx: { type: Object, default: () => ({}) },
});

// 卡面视图：与休息阶段面板共用 core 的 cardViewFromDef（战斗无关口径），
// 关键词 id → 卡面页脚中文标签的映射在本层做（标签表在 bridge，core 不得反向依赖）。
const view = computed(() => {
  const v = cardViewFromDef(getSkillDefinition(props.skillId), props.ctx);
  return v ? { ...v, keywords: v.keywords.map(k => KEYWORD_LABELS[k] ?? k) } : null;
});

// 卡图取值：cache.get 未命中会发起异步加载并返回 null（先按无图出卡）
const art = ref(view.value ? sharedCardArtCache.get(view.value) : null);
let unsub = null;
const stopListen = () => { unsub?.(); unsub = null; };
watch(view, (v) => {
  art.value = v ? sharedCardArtCache.get(v) : null;
  stopListen();
  if (!art.value && v && sharedCardArtCache.resolveUrl(v)) {
    const expected = sharedCardArtCache.resolveUrl(v);
    unsub = sharedCardArtCache.addOnLoad((url) => {
      if (url === expected) art.value = sharedCardArtCache.get(v);
    });
  }
}, { immediate: true });
onBeforeUnmount(stopListen);

// 魏启水晶素材（开销徽章）：未就位先蓝色圆回落，到图后重烘补真图
// （构建产物 URL 带 hash 后缀，匹配用文件名片段而非后缀）
const MANA_CRYSTAL_MARK = 'mana_crystal_full';
const manaCrystal = ref(sharedUnitArtCache.getFile('mana_crystal_full.png') ?? null);
let unsubCrystal = null;
if (!manaCrystal.value) {
  unsubCrystal = sharedUnitArtCache.addOnLoad((url) => {
    if (url?.includes(MANA_CRYSTAL_MARK)) {
      manaCrystal.value = sharedUnitArtCache.getFile('mana_crystal_full.png');
    }
  });
}
onBeforeUnmount(() => unsubCrystal?.());

// 视图/卡图任一变化即整面重烘；热区随烘焙产出（布局逻辑坐标，与 scale 无关）
const face = computed(() => (
  view.value
    ? bakeCardFace(view.value, { scale: 2, art: art.value, manaCrystal: manaCrystal.value })
    : null
));
const url = computed(() => face.value?.canvas.toDataURL() ?? '');

// 富文本热区悬浮（DOM 源直调 tooltipHub）：img 显示像素 → 烘焙布局逻辑坐标，
// 命中判定与 3D 卡面同实现；坐标经 framePoint 换算（浮层 fixed 于 #game-frame）
const onMove = (e) => {
  const f = face.value;
  if (!f) { tooltipHide(); return; }
  const rect = e.currentTarget.getBoundingClientRect();
  const lx = ((e.clientX - rect.left) / rect.width) * f.width;
  const ly = ((e.clientY - rect.top) / rect.height) * f.height;
  const region = hitTestRegions(f.hitRegions, lx, ly);
  if (!region) { tooltipHide(); return; }
  const p = framePoint(e);
  tooltipShow(region.type, region.payload, p.x, p.y);
};
const onLeave = () => tooltipHide();
</script>

<template>
  <img v-if="url" class="card-face-preview" :src="url" alt="" draggable="false"
    @mousemove="onMove" @mouseleave="onLeave">
</template>

<style scoped>
/* 尺寸交给宿主容器约束；比例随烘焙画布 200x270 */
.card-face-preview {
  display: block;
  width: 100%;
  height: auto;
  border-radius: 8px;
  user-select: none;
}
</style>
