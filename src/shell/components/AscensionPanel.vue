<script setup>
// 进阶事件面板：两条路径。
//   ① 常规：选择一条主维度升级（可升级维度见 LEINO_DIMENSIONS，木/空内容待实装暂屏蔽）。
//   ② 种子包（维度首次 0→1）：九选三 + 一次刷新——让新体系一次拿到可用的卡组骨架。
// 瓦片配色是面板本地的表现配置；素材到位后 .dim-icon 换美术图即可。
import { ref, computed, watch } from 'vue';
import {
  ASCENSION_PLACEHOLDER, totalLeino, LEINO_DIMENSIONS, SEED_OFFERING,
  FIRST_ASCENSION_GRANT,
} from '../../core/run/ascension.js';
import { getSkillDefinition } from '../../core/skills/registry.js';
import { getAbilityDefinition } from '../../core/abilities/registry.js';
import CardFacePreview from './CardFacePreview.vue';

const props = defineProps({ ctrl: { type: Object, required: true } });
const ctrl = props.ctrl;
const run = ctrl.run;

const DIM_META = {
  fire: { key: 'fire', label: '火灵脉', glyph: '炎', color: '#e85a5a' },
  wood: { key: 'wood', label: '木灵脉', glyph: '木', color: '#4aa56e' },
  air: { key: 'air', label: '空灵脉', glyph: '风', color: '#5aa2e8' },
  body: { key: 'body', label: '体修', glyph: '武', color: '#b8894a' },
};
const DIMS = LEINO_DIMENSIONS.map(k => DIM_META[k]);

// 种子包选择态（本地）；刷新/结算后清空
const selected = ref([]);
watch(() => run.cardOffering, (off) => { if (!off) selected.value = []; });

// 首次点亮获赠（FIRE_VEIN_CARDS §0）：基石卡直入牌组 + 体系能力，然后才开种子包。
const entryGrant = computed(() => {
  const off = run.cardOffering;
  if (!off) return null;
  const g = FIRST_ASCENSION_GRANT[off.dimension];
  return g && run.player.leino[off.dimension] === 1 ? g : null;
});
const grantCardNames = computed(() => entryGrant.value
  ? entryGrant.value.cards.map(id => getSkillDefinition(id)?.name ?? id).join('、') : '');
const grantAbility = computed(() => entryGrant.value?.ability
  ? getAbilityDefinition(entryGrant.value.ability) : null);

function toggleSeed(id) {
  const i = selected.value.indexOf(id);
  if (i >= 0) selected.value.splice(i, 1);
  else if (selected.value.length < SEED_OFFERING.picks) selected.value.push(id);
}
function confirmSeed() {
  if (selected.value.length !== SEED_OFFERING.picks) return;
  ctrl.chooseSeedCards([...selected.value]);
  selected.value = [];
}
function rerollSeed() {
  ctrl.rerollSeedOffering();
  selected.value = [];
}
</script>

<template>
  <div class="run-panel">
    <!-- ① 种子包：首次点亮某维度 -->
    <template v-if="run.cardOffering">
      <h2 class="run-panel-title">种子包 · {{ DIM_META[run.cardOffering.dimension]?.label }}</h2>
      <p class="run-panel-hint">
        <template v-if="entryGrant">
          初次点亮该体系——已获赠 <b>{{ grantCardNames }}</b> 直入牌组，
          并获得体系能力<b>「{{ grantAbility?.name }}」</b>（{{ grantAbility?.description }}）<br>
        </template>
        再从九张基石卡中任选 {{ SEED_OFFERING.picks }} 张加入牌组
        （已选 {{ selected.length }}/{{ SEED_OFFERING.picks }}）
      </p>
      <div class="seed-grid">
        <button
          v-for="id in run.cardOffering.cards" :key="id"
          class="card-choice" :class="{ picked: selected.includes(id) }"
          @click="toggleSeed(id)"
        >
          <CardFacePreview :skill-id="id" :ctx="{ player: run.player }" />
          <span v-if="selected.includes(id)" class="picked-tag">已选</span>
        </button>
      </div>
      <div class="seed-actions">
        <button
          class="action-btn" :disabled="selected.length !== SEED_OFFERING.picks"
          @click="confirmSeed"
        >
          确认（{{ selected.length }}/{{ SEED_OFFERING.picks }}）
        </button>
        <button
          class="skip-link" :disabled="run.cardOffering.rerollsLeft <= 0"
          @click="rerollSeed"
        >
          刷新九张（剩余 {{ run.cardOffering.rerollsLeft }} 次）
        </button>
      </div>
    </template>

    <!-- ② 常规：选一条主维度升级 -->
    <template v-else>
      <h2 class="run-panel-title">进阶事件</h2>
      <p class="run-panel-hint">灵力涌动——择一条主维度突破：</p>
      <div class="dims">
        <button
          v-for="dim in DIMS" :key="dim.key"
          class="dim-tile" :style="{ '--dim': dim.color }"
          @click="ctrl.chooseAscensionDimension(dim.key)"
        >
          <span class="dim-icon">{{ dim.glyph }}</span>
          <span class="dim-label">{{ dim.label }}</span>
          <span class="lv">{{ run.player.leino[dim.key] }}</span>
        </button>
      </div>
      <button class="skip-ascend" @click="ctrl.skipAscension()">跳过</button>
      <p class="note">
        总进阶 {{ run.player.ascensionCount }}/{{ ASCENSION_PLACEHOLDER.maxAscensions }}
        ｜ 突破后恢复{{ ASCENSION_PLACEHOLDER.healAmount }}点生命且魏启上限 +{{ ASCENSION_PLACEHOLDER.manaGain }}
        ｜ 首次点亮火灵脉：获赠点火、火弹术与体系能力「火灵脉」，并开启种子包（九选三）
      </p>
    </template>
  </div>
</template>

<style scoped>
.dims { display: flex; gap: 12px; margin: 14px 0; flex-wrap: wrap; justify-content: center; }
.dim-tile {
  width: 96px; padding: 12px 0 9px; cursor: pointer;
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  background:
    radial-gradient(circle at 50% 22%, color-mix(in srgb, var(--dim) 28%, transparent), transparent 68%),
    linear-gradient(180deg, #242f4e, #1c2444);
  border: 1px solid #4a587f; border-radius: 10px; color: #cdd6f4; font-size: 13px;
  transition: transform .16s ease, border-color .16s ease;
}
.dim-tile:hover {
  transform: translateY(-3px);
  border-color: var(--dim);
  box-shadow: 0 6px 18px rgba(0, 0, 0, .4), 0 0 10px color-mix(in srgb, var(--dim) 40%, transparent);
}
.dim-icon {
  width: 38px; height: 38px; line-height: 36px; font-size: 19px; border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--dim) 60%, transparent);
  background: color-mix(in srgb, var(--dim) 18%, transparent);
  /* 美术图标到位后此字槽直接替换为背景图 */
}
.dim-label { margin-top: 4px; }
.lv { color: var(--dim); font-size: 17px; font-weight: bold; }
.note { font-size: 12px; color: #9aa3c0; }
.skip-ascend {
  display: block; margin: 4px auto 10px; padding: 7px 26px; cursor: pointer;
  background: linear-gradient(180deg, #2a2f42, #1e2233);
  border: 1px dashed #5a6485; border-radius: 10px; color: #b9c1da; font-size: 13px;
  transition: border-color .16s ease, color .16s ease;
}
.skip-ascend:hover { border-color: #8b97c0; color: #e6ebf7; }

/* ---- 种子包 ---- */
.seed-grid {
  display: grid; gap: 10px; margin: 12px auto 4px;
  grid-template-columns: repeat(auto-fit, 150px);
  justify-content: center; max-width: 720px;
}
.seed-grid .card-choice { position: relative; }
.seed-grid .card-choice.picked {
  outline: 2px solid #ffd75e;
  outline-offset: -2px;
  filter: brightness(1.1);
}
.picked-tag {
  position: absolute; top: 4px; right: 4px; z-index: 2;
  padding: 1px 7px; border-radius: 999px; font-size: 11px;
  background: #ffd75e; color: #2a2208; font-weight: bold;
}
.seed-actions {
  display: flex; gap: 18px; align-items: center; justify-content: center; margin-top: 12px;
}
.seed-actions .action-btn[disabled] { opacity: .45; cursor: not-allowed; }
.seed-actions .skip-link[disabled] { opacity: .4; cursor: not-allowed; text-decoration: none; }
</style>
