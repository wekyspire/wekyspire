<script setup>
// 终局面板（占位；正式结算摘要/故事模式合并见 §6.4 后续）
const props = defineProps({ ctrl: { type: Object, required: true } });
const emit = defineEmits(['restart']);
const run = props.ctrl.run;
</script>

<template>
  <div class="panel">
    <h2 :class="run.result">{{ run.result === 'victory' ? '登顶成功' : '倒在了塔中' }}</h2>
    <p>抵达 {{ run.floor }} / {{ run.totalFloors }} 层 ｜ 金币 {{ run.player.money }} ｜ 卡组 {{ run.player.deck.length }}</p>
    <button @click="emit('restart')">再来一局</button>
  </div>
</template>

<style scoped>
.panel {
  position: fixed; left: 50%; top: 44%; transform: translate(-50%, -50%); z-index: 20;
  background: rgba(10, 14, 26, .92); border: 1px solid #38415e; border-radius: 10px;
  padding: 26px 44px; color: #cdd6f4; font-family: sans-serif; text-align: center;
}
h2 { margin: 0 0 10px; font-size: 28px; }
h2.victory { color: #ffd75e; }
h2.defeat { color: #ff7875; }
p { color: #9aa3c0; font-size: 13px; }
button {
  margin-top: 12px; padding: 8px 26px; background: #7a4b12; color: #ffe7b3;
  border: 1px solid #b3742a; border-radius: 6px; cursor: pointer; font-size: 15px;
}
button:hover { background: #95601c; }
</style>
