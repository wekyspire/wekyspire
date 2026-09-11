<script setup>
// 奖励房面板：训练场 / 营地 / 老虎机 / 事件。
// 四房共用 runPanels.css 的选择卡/选项瓦片语言；图标位（emoji 占位）后续可直接换美术图。
// 卡牌候选直接用战场同源烘焙卡面（CardFacePreview）——所见即所得。
import { getSkillDefinition } from '../../core/skills/registry.js';
import CardFacePreview from './CardFacePreview.vue';

const props = defineProps({ ctrl: { type: Object, required: true } });
const ctrl = props.ctrl;
const run = ctrl.run;
const skillDef = (id) => getSkillDefinition(id);
const ROOM_NAMES = { training: '训练场', camp: '营地', slot: '老虎机', event: '事件房' };
const ROOM_ICONS = { training: '🏋️', camp: '⛺', slot: '🎰', event: '❓' };
const ROOM_HINTS = {
  training: '磨砺技艺——每层训练记录在案，达标即可进阶',
  camp: '暂作休整，选择一件好事发生',
  slot: '命运转轮，愿者上钩',
  event: '一间弥漫着迷雾的房间……',
};
// 房间副标题（事件房在探索后不再保留悬念文案）
const roomHint = () => (
  run.currentRoom === 'event' && ctrl.eventRoom.result ? '迷雾散去……' : ROOM_HINTS[run.currentRoom]
);
// 训练场升级行：当前卡 →（箭头）晋升目标；目标取法与 trainUpgrade 缺省一致
const promoteTargetOf = ctrl.promoteTargetOf;
// 抓牌候选区副文案：升级后的强制尾款 vs 退化模式的自由选择
const drawChoicesHint = () => (run.roomData?.forced ? '升级完成！必须择一张加入牌组：' : '择一张加入牌组：');

const prizeText = (p) => ({
  nothing: '什么也没发生……',
  money: `金币 +${p.money}`,
  fruit: '获得remi升级果 ×1',
  training: '训练次数 +1',
  card: `获得卡牌：${skillDef(p.defId)?.name}`,
  relic: `获得遗物：${p.relicId}`,
}[p.type]);
const eventText = (r) => ({
  moneyBag: `捡到钱袋：金币 +${r.money}`,
  spring: `治愈泉：回复 ${r.heal} 点生命`,
}[r.eventId]);
</script>

<template>
  <div class="run-panel">
    <div class="room-head">
      <span class="icon-slot">{{ ROOM_ICONS[run.currentRoom] }}</span>
      <h2 class="run-panel-title">{{ ROOM_NAMES[run.currentRoom] }}</h2>
    </div>
    <p class="run-panel-hint">{{ roomHint() }}</p>

    <!-- 训练场：先升后抓强绑——升级动作只挂起强制三选一不离房；抓牌完成/跳过才离房 -->
    <template v-if="run.currentRoom === 'training'">
      <!-- 候选抉择中（升级后的强制尾款 / 退化模式已开局）：差别只在有无跳过入口 -->
      <template v-if="run.roomData?.drawChoices">
        <p>{{ drawChoicesHint() }}</p>
        <div class="card-choices">
          <button
            v-for="id in run.roomData.drawChoices" :key="id"
            class="card-choice"
            @click="ctrl.trainingDraw(id)"
          >
            <CardFacePreview :skill-id="id" :ctx="{ player: run.player }" />
          </button>
        </div>
        <button v-if="!run.roomData.forced" class="skip-link" @click="ctrl.trainingDraw(null)">跳过</button>
      </template>
      <!-- 免费升一（可跳过）：升级行不即时离房，等待强制抓牌尾款 -->
      <template v-else-if="ctrl.trainingMode() === 'upgrade'">
        <p>免费升级一张卡（完成后须再择一张加入牌组）：</p>
        <div class="pick-list">
          <button v-for="rt in ctrl.upgradableCards()" :key="rt.uniqueID" class="pick-row" @click="ctrl.trainingUpgrade(rt.uniqueID)">
            <span>{{ skillDef(rt.defId)?.name }}</span>
            <template v-if="promoteTargetOf(rt)">
              <span class="arrow">→</span>
              <span class="to-name">{{ promoteTargetOf(rt)?.name }}</span>
            </template>
            <span style="flex:1"></span>
            <span class="cost-chip ap">升一级</span>
          </button>
        </div>
        <br>
        <button class="skip-link" @click="ctrl.trainingSkip()">跳过</button>
      </template>
      <!-- 退化模式：无可升级卡 → 可选抓一（未 roll 前跳过也放行，训练照记一次） -->
      <template v-else>
        <p>暂无可升级的卡牌，本次改为抓一张（可跳过）。</p>
        <button class="action-btn" @click="ctrl.trainingDrawRoll()">抓牌</button>
        <br>
        <button class="skip-link" @click="ctrl.trainingSkip()">跳过</button>
      </template>
    </template>

    <!-- 营地 -->
    <template v-else-if="run.currentRoom === 'camp'">
      <div class="option-tiles">
        <button v-if="ctrl.campOptions().includes('recoverRemi')" class="option-tile" @click="ctrl.campChoose('recoverRemi')">
          <span class="tile-icon">🐾</span>
          <div class="tile-title">找回瑞米</div>
          <div class="tile-desc">那位老朋友回到了身边</div>
        </button>
        <button v-if="ctrl.campOptions().includes('rest')" class="option-tile" @click="ctrl.campChoose('rest')">
          <span class="tile-icon">🔥</span>
          <div class="tile-title">休整</div>
          <div class="tile-desc">回复 35% 最大生命，魏启全部回满</div>
        </button>
      </div>
      <template v-if="ctrl.campOptions().includes('upgrade')">
        <p>或免费升级一张卡：</p>
        <div class="pick-list">
          <button v-for="rt in ctrl.upgradableCards()" :key="rt.uniqueID" class="pick-row" @click="ctrl.campChoose('upgrade', rt.uniqueID)">
            <span>{{ skillDef(rt.defId)?.name }}</span>
            <template v-if="promoteTargetOf(rt)">
              <span class="arrow">→</span>
              <span class="to-name">{{ promoteTargetOf(rt)?.name }}</span>
            </template>
            <span style="flex:1"></span>
            <span class="cost-chip ap">升一级</span>
          </button>
        </div>
      </template>
    </template>

    <!-- 老虎机（S4 pilot：roll 动画经 run sequencer 编排，animationend 回执开闸；
         结果文字在动画落定后揭示——渐进揭示，连点多次依次串行播出） -->
    <template v-else-if="run.currentRoom === 'slot'">
      <div class="money-pill">🎴 单抽 {{ ctrl.SLOT_PLACEHOLDER.spinCost }} 金币｜持有 {{ run.player.money }}</div>
      <button class="action-btn" :class="{ rolling: ctrl.slot.anim }" @click="ctrl.spin()">拉杆！</button>
      <div v-if="ctrl.slot.anim" :key="ctrl.slot.anim.id" class="rolling" @animationend="ctrl.reportSlotAnimDone(ctrl.slot.anim.id)">🎰</div>
      <div v-else-if="ctrl.slot.lastSpin" class="result-banner">{{ prizeText(ctrl.slot.lastSpin) }}</div>
      <br>
      <button class="skip-link" @click="ctrl.leaveSlot()">离开</button>
    </template>

    <!-- 事件房 -->
    <template v-else-if="run.currentRoom === 'event'">
      <template v-if="!ctrl.eventRoom.result">
        <button class="action-btn" @click="ctrl.triggerEvent()">探索</button>
      </template>
      <template v-else>
        <div class="result-banner">{{ eventText(ctrl.eventRoom.result) }}</div>
        <br>
        <button class="skip-link" @click="ctrl.leaveEvent()">离开</button>
      </template>
    </template>
  </div>
</template>

<style scoped>
/* 老虎机 roll 摇摆动画（本房特有演出；其余样式复用 runPanels.css） */
.rolling {
  margin: 12px auto 0; font-size: 40px; line-height: 1;
  animation: slot-roll 1.1s cubic-bezier(.36, .07, .19, .97) both;
}
@keyframes slot-roll {
  0% { transform: translateY(0) rotate(0deg); }
  15% { transform: translateY(-14px) rotate(-16deg); }
  40% { transform: translateY(4px) rotate(12deg); }
  70% { transform: translateY(-6px) rotate(-8deg); }
  100% { transform: translateY(0) rotate(0deg); }
}
</style>
