<script setup>
// 战后奖励面板：金币入账 + **卡包选择** + 包内技能 3 选 1（或跳过）。
// 卡包制（2026-09）：体修包恒开，其余维度需该维度灵脉等级 ≥1；
// 只有一个可开卡包时核心已自动开包（spawnRewards），面板直接进选卡态。
// 卡牌候选用战场同源烘焙卡面（CardFacePreview）——所见即所得。
import CardFacePreview from './CardFacePreview.vue';
import { PACKS } from '../../core/run/rewards.js';

const props = defineProps({ ctrl: { type: Object, required: true } });
const run = props.ctrl.run;
const packMeta = (id) => PACKS[id] ?? { id, name: id, desc: '' };
</script>

<template>
  <div class="run-panel" v-if="run.rewards">
    <h2 class="run-panel-title">战后奖励</h2>
    <div class="money-pill">🪙 金币 +{{ run.rewards.money }}</div>

    <template v-if="!run.rewards.packId">
      <p class="run-panel-hint">选择一个卡包（按该体系灵脉等级出卡）：</p>
      <div class="pack-choices">
        <button
          v-for="id in run.rewards.packs" :key="id"
          class="pack-tile"
          @click="ctrl.chooseRewardPack(id)"
        >
          <span class="pack-name">{{ packMeta(id).name }}</span>
          <span class="pack-desc">{{ packMeta(id).desc }}</span>
        </button>
      </div>
    </template>

    <template v-else>
      <p class="run-panel-hint">
        {{ packMeta(run.rewards.packId).name }} · 择一张技能卡加入牌组
      </p>
      <div class="card-choices">
        <button
          v-for="id in run.rewards.skillChoices" :key="id"
          class="card-choice"
          @click="ctrl.claimReward(id)"
        >
          <CardFacePreview :skill-id="id" :ctx="{ player: run.player }" />
        </button>
      </div>
      <button class="skip-link" @click="ctrl.claimReward(null)">跳过奖励</button>
    </template>
  </div>
</template>

<style scoped>
.pack-choices {
  display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; margin: 12px 0;
}
.pack-tile {
  width: 170px; padding: 14px 10px; cursor: pointer;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  background: linear-gradient(180deg, #242f4e, #1c2444);
  border: 1px solid #4a587f; border-radius: 10px; color: #cdd6f4;
  transition: transform .16s ease, border-color .16s ease;
}
.pack-tile:hover {
  transform: translateY(-3px);
  border-color: #7a8fc0;
  box-shadow: 0 6px 18px rgba(0, 0, 0, .4);
}
.pack-name { font-size: 15px; font-weight: bold; }
.pack-desc { font-size: 12px; color: #9aa3c0; }
</style>
