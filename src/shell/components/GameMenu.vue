<script setup>
// 游戏中弹出菜单（Esc 呼出）：继续/查看存档/设置（音效开关）/回到主菜单。
// 存档为检查点制（层首/终局自动落盘），此处只读展示。
import { computed, inject } from 'vue';
import { settings, toggleSound } from '../settings.js';
import { readSave } from '../saves.js';

const props = defineProps({ ctrl: { type: Object, required: true } });
const emit = defineEmits(['close', 'toTitle']);
// App.vue 挂载的全局共享 popup，菜单内需要提示时直接调用（如读档失败等）
const showMenuPopup = inject('showMenuPopup', null);

const save = readSave(props.ctrl.run.storyMode); // 只看当前模式自己的存档槽
const savedAtText = computed(() => save ? new Date(save.savedAt).toLocaleString() : '');
const resultText = save?.result === 'victory' ? '登顶成功' : save?.result === 'defeat' ? '倒在塔中' : '';
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <div class="menu">
      <h2>菜单</h2>

      <div class="section">
        <div class="title">存档（层首/终局自动记录）</div>
        <template v-if="save">
          <div class="row">第 {{ save.floor }} / {{ save.totalFloors }} 层 · {{ savedAtText }}</div>
          <div class="row dim">金币 {{ save.player.money }} ｜ 卡组 {{ save.player.deck.length }} 张<span v-if="resultText"> ｜ {{ resultText }}</span></div>
        </template>
        <div v-else class="row dim">暂无存档</div>
      </div>

      <div class="section">
        <div class="title">设置</div>
        <label class="row toggle">
          <input type="checkbox" :checked="settings.soundOn" @change="toggleSound()" />
          音效
        </label>
      </div>

      <div class="actions">
        <button class="primary" @click="emit('close')">继续游戏</button>
        <button @click="emit('toTitle')">回到主菜单</button>
      </div>
      <div class="hint">Esc 呼出/关闭</div>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed; inset: 0; z-index: 30;
  background: rgba(4, 6, 14, .62);
  display: flex; align-items: center; justify-content: center;
  font-family: sans-serif;
}
.menu {
  width: 340px; background: rgba(10, 14, 26, .96);
  border: 1px solid #38415e; border-radius: 12px;
  padding: 22px 26px; color: #cdd6f4;
}
h2 { margin: 0 0 14px; font-size: 22px; color: #ffe7b3; text-align: center; }
.section { margin: 14px 0; }
.section .title { font-size: 12px; color: #7d87a8; margin-bottom: 6px; }
.row { font-size: 14px; padding: 3px 0; }
.row.dim { color: #9aa3c0; font-size: 12px; }
.toggle { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.toggle input { accent-color: #b3742a; width: 15px; height: 15px; cursor: pointer; }
.actions { display: flex; gap: 10px; margin-top: 18px; }
button {
  flex: 1; padding: 9px 0; font-size: 15px; cursor: pointer; border-radius: 7px;
  background: #2c3554; color: #fff; border: 2px solid #56628f;
}
button:hover { filter: brightness(1.25); }
button.primary { background: #6b421a; border-color: #c78f3a; color: #fff; }
.hint { margin-top: 12px; text-align: center; font-size: 11px; color: #626c8f; }
</style>
