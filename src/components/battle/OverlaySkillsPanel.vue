<template>
  <div class="overlay-skills-panel" v-if="overlaySkills.length || selectableComputed" :class="{'selecting': selectableComputed}" ref="root">
    <!-- 半透明遮罩层：在选择模式下阻挡其它交互 -->
    <div v-if="selectableComputed" class="overlay-skill-mask"></div>

    <!-- 选择指示器（悬浮在卡牌上方，不再渲染卡牌本身） -->
    <div v-for="(skill, idx) in overlaySkills" :key="skill.uniqueID"
         class="overlay-skill-indicator"
         :class="{'selected': isSelected(skill)}"
         :style="indicatorStyle(idx)"
         @click="onSkillClick(skill)">
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
import frontendEventBus from '../../frontendEventBus.js';
import backendEventBus, { EventNames } from '../../backendEventBus.js';
import animator from '../../utils/animator.js';
import { displayGameState } from '../../data/gameState.js';

export default {
  name: 'OverlaySkillsPanel',
  components: {},
  props: {
    player: { type: Object, required: true },
    containerKey: { type: String, default: 'overlay-skills' },
    selectable: { type: Boolean, default: false },
    maxSelectable: { type: Number, default: 1 },
  },
  data() {
    return {
      selectedIds: [],
      internalSelecting: false,
      internalMaxSelectable: 1,
      selectionToken: null,
    };
  },
  computed: {
    overlaySkills() {
      return (displayGameState.player?.overlaySkills || []).filter(Boolean);
    },
    selectableComputed() {
      return this.selectable || this.internalSelecting;
    },
    effectiveMaxSelectable() {
      return this.internalSelecting ? this.internalMaxSelectable : this.maxSelectable;
    },
    selectedCount() { 
      return this.selectedIds.length; 
    },
    canConfirm() { 
      return this.selectedCount > 0; 
    },
    maxSelectableLabel() { 
      return this.effectiveMaxSelectable === Infinity ? '∞' : this.effectiveMaxSelectable; 
    },
    anchorsMap() {
      const map = new Map();
      const gap = 34;
      const cardW = 198;
      const cardH = 266;
      const count = this.overlaySkills.length;
      if (count === 0) return map;
      
      const totalW = count * cardW + (count - 1) * gap;
      const startX = window.innerWidth / 2 - totalW / 2;
      const top = 140;
      
      this.overlaySkills.forEach((skill, idx) => {
        const x = startX + idx * (cardW + gap) + cardW / 2; // 中心点
        const y = top + cardH / 2; // 中心点
        
        map.set(skill.uniqueID, {
          x,
          y,
          scale: 1.0,
          rotation: 0
        });
      });
      
      return map;
    }
  },
  mounted() {
    frontendEventBus.on('start-card-selection', this.onStartCardSelection);
    
    this.$nextTick(() => {
      if (this.anchorsMap.size > 0) {
        animator.updateAnchors(this.containerKey, this.anchorsMap);
      }
    });
  },
  beforeUnmount() {
    frontendEventBus.off('start-card-selection', this.onStartCardSelection);
  },
  watch: {
    anchorsMap: {
      deep: true,
      immediate: true,
      handler(newMap) {
        if (newMap && newMap.size > 0) {
          animator.updateAnchors(this.containerKey, newMap);
        }
      }
    },
    selectable(val) {
      if (!val && !this.internalSelecting) this.clearSelection();
    },
    internalSelecting(val) {
      if (!val && !this.selectable) this.clearSelection();
    }
  },
  methods: {
    onStartCardSelection(payload = {}) {
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
      this.clearSelection();
    },
    indicatorStyle(idx) {
      const gap = 34;
      const cardW = 198;
      const cardH = 266;
      const count = this.overlaySkills.length;
      const totalW = count * cardW + (count - 1) * gap;
      const startX = - totalW / 2;
      const x = startX + idx * (cardW + gap);
      const top = 140;
      
      return { 
        transform: `translate(${x}px, ${top}px)`,
        width: `${cardW}px`,
        height: `${cardH}px`
      };
    },
    onSkillClick(skill) {
      if (!this.selectableComputed) return;
      const id = skill.uniqueID;
      const idx = this.selectedIds.indexOf(id);
      if (idx >= 0) {
        this.selectedIds.splice(idx, 1);
      } else {
        if (this.selectedCount >= this.effectiveMaxSelectable) return;
        this.selectedIds.push(id);
      }
    },
    isSelected(skill) { 
      return this.selectedIds.includes(skill.uniqueID); 
    },
    selectionIndex(skill) {
      const i = this.selectedIds.indexOf(skill.uniqueID);
      return i === -1 ? '' : (i + 1);
    },
    clearSelection() { 
      this.selectedIds = []; 
    },
    confirmSelection() {
      if (!this.canConfirm) return;
      const selectedSkills = this.overlaySkills.filter(s => this.selectedIds.includes(s.uniqueID));
      try {
        backendEventBus.emit(EventNames.PlayerOperations.CONFIRM_OVERLAY_SKILL_SELECTIONS, {
          selected: [...this.selectedIds],
          skills: selectedSkills
        });
      } catch (_) {}
      
      if (this.internalSelecting) {
        this.finishInternalSelection();
      } else {
        this.clearSelection();
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
.overlay-skills-panel.selecting { 
  z-index: 70; 
}
.overlay-skill-mask {
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,0.45);
  pointer-events: auto;
}
.overlay-skill-indicator {
  position: absolute;
  left: 50%;
  top: 0;
  transition: transform .25s ease;
  pointer-events: auto;
  cursor: pointer;
}
.overlay-skill-indicator.selected { 
  outline: 3px solid #ffd54f; 
  outline-offset: 2px; 
  filter: brightness(1.08); 
}
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
.selection-toolbar .info { 
  color: #fff; 
  font-size: 14px; 
}
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
.selection-toolbar .btn[disabled] { 
  opacity: 0.4; 
  cursor: not-allowed; 
}
.selection-toolbar .btn.secondary { 
  background: linear-gradient(135deg,#777,#555); 
}
</style>
