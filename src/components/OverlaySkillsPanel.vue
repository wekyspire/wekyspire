<template>
  <div class="overlay-skills-panel" v-if="overlaySkills.length || selectableComputed" :class="{'selecting': selectableComputed}" ref="root">
    <!-- 半透明遮罩层：在选择模式下阻挡其它交互 -->
    <div v-if="selectableComputed" class="overlay-skill-mask"></div>

    <!-- 技能卡槽 -->
    <div v-for="(skill, idx) in overlaySkills" :key="skill.uniqueID"
         class="overlay-skill-slot"
         :class="{'leaving': leaving[skill.uniqueID], 'selected': isSelected(skill)}"
         :style="slotStyle(idx, skill)"
         @click="onSkillClick(skill)">
      <SkillCard :skill="skill"
                 :player="player"
                 :disabled="false"
                 :player-mana="player?.mana ?? Infinity"
                 :preview-mode="false"
                 :auto-register-in-registry="true"
                 :ref="el => setCardRef(el, skill.uniqueID)" />
      <div v-if="selectableComputed" class="select-indicator">{{ selectionIndex(skill) }}</div>
    </div>

    <!-- 选择确认栏 -->
    <div v-if="selectableComputed" class="selection-toolbar">
      <div class="info">已选 {{ selectedCount }}/{{ maxSelectableLabel }}</div>
      <button class="btn" :disabled="!canConfirm" @click="confirmSelection">确认</button>
      <button class="btn secondary" :disabled="selectedCount === 0" @click="clearSelection">清除</button>
    </div>
  </div>
</template>

<script>
import SkillCard from './SkillCard.vue';
import frontendEventBus from '../frontendEventBus.js';
import backendEventBus, { EventNames } from '../backendEventBus.js';
import { registerCardEl, unregisterCardEl } from '../utils/cardDomRegistry.js';

export default {
  name: 'OverlaySkillsPanel',
  components: { SkillCard },
  props: {
    player: { type: Object, required: true },
    containerKey: { type: String, default: 'overlay-skills' },
    selectable: { type: Boolean, default: false }, // 外部可控（兼容旧接口）
    maxSelectable: { type: Number, default: 1 },   // 外部指定最大数（兼容）
  },
  data() {
    return {
      cardRefs: {},
      leaving: {},
      selectedIds: [], // 按选择顺序存储
      prevOverlayIds: new Set(),
      // 新增：内部覆盖模式（由动画指令触发）
      internalSelecting: false,
      internalMaxSelectable: 1,
      selectionToken: null,
    };
  },
  computed: {
    overlaySkills() {
      // 由状态同步驱动：直接读取 player.overlaySkills
      return (this.player?.overlaySkills || []).filter(Boolean);
    },
    selectableComputed() {
      return this.selectable || this.internalSelecting;
    },
    effectiveMaxSelectable() {
      return this.internalSelecting ? this.internalMaxSelectable : this.maxSelectable;
    },
    selectedCount() { return this.selectedIds.length; },
    canConfirm() { return this.selectedCount > 0; },
    maxSelectableLabel() { return this.effectiveMaxSelectable === Infinity ? '∞' : this.effectiveMaxSelectable; }
  },
  watch: {
    overlaySkills: {
      handler(newList) { this.syncRegistrations(newList); },
      immediate: true
    },
    selectable(val) { // 外部模式关闭时，若没有内部模式也清理
      if (!val && !this.internalSelecting) this.clearSelection();
    },
    internalSelecting(val) { // 内部模式关闭时，如果外部也未开启则清理
      if (!val && !this.selectable) this.clearSelection();
    }
  },
  mounted() {
    frontendEventBus.on('card-transfer-start', this.onTransferStart);
    frontendEventBus.on('card-transfer-end', this.onTransferEnd);
    frontendEventBus.on('start-card-selection', this.onStartCardSelection);
  },
  beforeUnmount() {
    frontendEventBus.off('card-transfer-start', this.onTransferStart);
    frontendEventBus.off('card-transfer-end', this.onTransferEnd);
    frontendEventBus.off('start-card-selection', this.onStartCardSelection);
    for (const id of Object.keys(this.cardRefs)) unregisterCardEl(id, 'overlay-skills-panel');
  },
  methods: {
    onStartCardSelection(payload = {}) {
      // payload: { token, maxSelectable }
      this.internalSelecting = true;
      this.internalMaxSelectable = payload?.maxSelectable ?? 1;
      this.selectionToken = payload?.token || null;
      this.clearSelection();
    },
    finishInternalSelection() {
      if (!this.internalSelecting) return;
      if (this.selectionToken) {
        frontendEventBus.emit('card-selection-finished', { token: this.selectionToken });
      }
      this.internalSelecting = false;
      this.selectionToken = null;
      // 不清空 overlaySkills，由后端状态驱动；只清除本地选择
      this.clearSelection();
    },
    syncRegistrations(newList) {
      const currentIds = new Set(newList.map(s => s.uniqueID));
      // 新增注册
      for (const skill of newList) {
        if (!this.cardRefs[skill.uniqueID]) {
          // 等待下一帧 DOM 渲染后再注册（避免 $refs 尚未建立）
          this.$nextTick(() => {
            const refEl = this.cardRefs[skill.uniqueID];
            if (!refEl) return; // setCardRef 会处理
          });
        }
      }
      // 移除不存在的
      for (const id of Object.keys(this.cardRefs)) {
        if (!currentIds.has(id)) {
          unregisterCardEl(id, 'overlay-skills-panel');
          delete this.cardRefs[id];
          this.selectedIds = this.selectedIds.filter(x => x !== id);
        }
      }
      this.prevOverlayIds = currentIds;
    },
    setCardRef(el, id) {
      if (el) {
        if (this.cardRefs[id] === el) return;
        this.cardRefs[id] = el;
        const dom = el.$el ? el.$el : el;
        registerCardEl(id, dom, 'overlay-skills-panel');
      } else {
        unregisterCardEl(id, 'overlay-skills-panel');
        delete this.cardRefs[id];
      }
    },
    slotStyle(idx) {
      const gap = 34;
      const cardW = 198;
      const count = this.overlaySkills.length;
      const totalW = count * cardW + (count - 1) * gap;
      const startX = - totalW / 2;
      const x = startX + idx * (cardW + gap);
      const top = 140;
      return { transform: `translate(${x}px, ${top}px)` };
    },
    onSkillClick(skill) {
      if (!this.selectableComputed) return;
      const id = skill.uniqueID;
      const idx = this.selectedIds.indexOf(id);
      if (idx >= 0) {
        this.selectedIds.splice(idx, 1);
      } else {
        if (this.selectedCount >= this.effectiveMaxSelectable) return; // 达上限
        this.selectedIds.push(id);
      }
    },
    isSelected(skill) { return this.selectedIds.includes(skill.uniqueID); },
    selectionIndex(skill) {
      const i = this.selectedIds.indexOf(skill.uniqueID);
      return i === -1 ? '' : (i + 1);
    },
    clearSelection() { this.selectedIds = []; },
    confirmSelection() {
      if (!this.canConfirm) return;
      const selectedSkills = this.overlaySkills.filter(s => this.selectedIds.includes(s.uniqueID));
      try {
        backendEventBus.emit(EventNames.PlayerOperations.CONFIRM_OVERLAY_SKILL_SELECTIONS, {
          selected: [...this.selectedIds],
          skills: selectedSkills
        });
      } catch (_) {}
      // 如果是内部触发的选牌模式，结束动画指令
      if (this.internalSelecting) {
        this.finishInternalSelection();
      } else {
        this.clearSelection();
      }
    },
    onTransferStart(payload = {}) {
      if (payload.from === this.containerKey) {
        const id = payload.id;
        if (id != null) this.leaving[id] = true;
      }
    },
    onTransferEnd(payload = {}) {
      if (payload.from === this.containerKey) {
        const id = payload.id;
        if (id != null) this.leaving[id] = false; // 由后端移除 overlaySkills 实际删除
      }
    }
  }
};
</script>

<style scoped>
.overlay-skills-panel {
  position: absolute;
  left: 50%;
  top: 0;
  width: 0;
  height: 100%;
  pointer-events: none;
  z-index: 45;
}
.overlay-skills-panel.selecting { z-index: 70; }
.overlay-skill-mask {
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,0.45);
  pointer-events: auto; /* 阻挡底层点击 */
}
.overlay-skill-slot {
  position: absolute;
  left: 50%;
  top: 0;
  transition: transform .25s ease;
  pointer-events: auto;
}
.overlay-skill-slot.selected { outline: 3px solid #ffd54f; outline-offset: 2px; filter: brightness(1.08); }
.overlay-skill-slot.leaving { opacity: 0.6; filter: brightness(0.85); }
.select-indicator {
  position: absolute;
  top: 4px;
  left: 6px;
  background: rgba(0,0,0,0.55);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 6px;
  pointer-events: none;
}
.selection-toolbar {
  position: absolute;
  bottom: 40px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 12px;
  align-items: center;
  background: rgba(20,24,28,0.85);
  padding: 10px 18px;
  border-radius: 10px;
  backdrop-filter: blur(4px);
  box-shadow: 0 4px 14px rgba(0,0,0,0.35);
  pointer-events: auto;
}
.selection-toolbar .info { color: #fff; font-size: 14px; }
.selection-toolbar .btn {
  background: linear-gradient(135deg,#3fa656,#2d8643);
  border: none;
  color: #fff;
  font-weight: 600;
  padding: 6px 14px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}
.selection-toolbar .btn[disabled] { opacity: 0.4; cursor: not-allowed; }
.selection-toolbar .btn.secondary { background: linear-gradient(135deg,#777,#555); }
</style>
