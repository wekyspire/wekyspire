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
  background: rgba(8, 11, 18, .94); border: 1px solid #2f3a52; border-radius: 3px;
  padding: 26px 44px; color: #dbe4f4; font-family: sans-serif; text-align: center;
}
h2 { margin: 0 0 10px; font-size: 28px; color: #eef4ff; }
h2.victory { color: #cfe6ff; }   /* 扁平冷色（金色只留金钱相关内容，用户定 2026-09-12） */
h2.defeat { color: #ff8f88; }
p { color: #9aa3c0; font-size: 13px; }
button {
  margin-top: 12px; padding: 8px 26px; background: rgba(16, 22, 34, .92); color: #eaf1fb;
  border: 1px solid #3f5f8c; border-radius: 4px; cursor: pointer; font-size: 15px;
}
button:hover { background: rgba(52, 84, 126, .95); border-color: #8fb6dd; }
</style>
