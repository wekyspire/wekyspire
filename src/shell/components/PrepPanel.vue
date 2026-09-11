<script setup>
// 战前准备面板（左侧爬塔状态 UI + 遭遇预告 + 遗物装卸 + 进入战斗）
import { computed } from 'vue';
import { getRelicDefinition } from '../../core/relics/registry.js';
import { isBossFloor, FLOORS_PER_CHAPTER } from '../../core/run/runFlow.js';

const props = defineProps({ ctrl: { type: Object, required: true } });
const run = props.ctrl.run;

const nextBoss = computed(() => Math.ceil(run.floor / FLOORS_PER_CHAPTER) * FLOORS_PER_CHAPTER);
const toBoss = computed(() => nextBoss.value - run.floor);
const relicDef = (id) => getRelicDefinition(id);
const usesLeft = (id) => run.relicUses[id];
</script>

<template>
  <div class="prep">
    <h2>战前准备</h2>
    <div class="climb">
      <div>层数 <b>{{ run.floor }}</b> / {{ run.totalFloors }}</div>
      <div>距 Boss 层 <b>{{ toBoss }}</b> 层<span v-if="isBossFloor(run.floor)" class="boss">（本层即 Boss！）</span></div>
    </div>
    <div class="section">
      <div class="title">下层敌人预告</div>
      <div v-for="(e, i) in run.encounter" :key="i" class="enemy">{{ ctrl.enemyName(e) }}</div>
    </div>
    <div class="section" v-if="run.player.relics.length">
      <div class="title">遗物（装备位 {{ run.player.equippedRelics.length }}/{{ run.player.relicSlots }}）</div>
      <div v-for="id in run.player.relics" :key="id" class="relic">
        <span>{{ relicDef(id)?.name }}</span>
        <button v-if="!run.player.equippedRelics.includes(id)" @click="ctrl.equip(id)">装备</button>
        <template v-else>
          <button @click="ctrl.unequip(id)">卸下</button>
          <button v-if="relicDef(id)?.prepUse && usesLeft(id) > 0" @click="ctrl.useRelic(id)">使用</button>
        </template>
      </div>
    </div>
    <button class="go" @click="ctrl.startBattle()">进入战斗</button>
  </div>
</template>

<style scoped>
.prep {
  position: fixed; left: 12px; top: 12px; z-index: 20; width: 250px;
  background: rgba(10, 14, 26, .85); border: 1px solid #38415e; border-radius: 8px;
  padding: 12px 16px; color: #cdd6f4; font-family: sans-serif; font-size: 13px;
}
h2 { margin: 0 0 8px; font-size: 16px; color: #ffd75e; }
.climb { line-height: 1.8; }
.boss { color: #ff7875; }
.section { margin-top: 10px; }
.title { color: #8a93b2; margin-bottom: 4px; }
.enemy { color: #f08080; }
.relic { display: flex; gap: 8px; align-items: center; margin: 4px 0; }
button {
  background: #2b3552; color: #cdd6f4; border: 1px solid #4a587f; border-radius: 4px;
  padding: 2px 8px; cursor: pointer; font-size: 12px;
}
button:hover { background: #3a4666; }
.go {
  margin-top: 14px; width: 100%; padding: 8px 0; font-size: 15px;
  background: #7a4b12; border-color: #b3742a; color: #ffe7b3;
}
.go:hover { background: #95601c; }
</style>
