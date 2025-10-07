<template>
  <div class="activated-skills-bar" ref="barRoot">
    <div class="activated-slot" v-for="(skill, idx) in visibleSkills" :key="skill.uniqueID"
         :style="slotDynamicStyle(idx, skill)"
         :class="{'leaving': leaving[skill.uniqueID], 'chanting': isChanting(skill) && !leaving[skill.uniqueID]}"
         @click="onSkillClick(skill)">
      <SkillCard :skill="skill"
                 :player="player"
                 :disabled="!canInteract"
                 :can-click="canInteract"
                 :player-mana="player?.mana ?? Infinity"
                 :auto-register-in-registry="false"
                 :ref="el => setCardRef(el, skill.uniqueID)"
                 :preview-mode="false" />
    </div>
  </div>
</template>

<script>
import SkillCard from './SkillCard.vue';
import frontendEventBus from '../frontendEventBus.js';
import backendEventBus, { EventNames } from '../backendEventBus.js';
import { registerCardEl, unregisterCardEl } from '../utils/cardDomRegistry.js';
import { getSkillTierColor } from '../utils/tierUtils.js';

export default {
  name: 'ActivatedSkillsBar',
  components: { SkillCard },
  props: {
    player: { type: Object, required: true },
    isPlayerTurn: { type: Boolean, default: true },
    isControlDisabled: { type: Boolean, default: false },
    listenTransferEvents: { type: Boolean, default: true },
    containerKey: { type: String, default: 'activated-bar' }
  },
  data() {
    return {
      cardRefs: {},
      appearing: {},
      leaving: {},
      prevIds: []
    };
  },
  computed: {
    visibleSkills() { return (this.player?.activatedSkills || []).filter(Boolean); },
    visibleIds() { return this.visibleSkills.map(s => s.uniqueID); },
    emptySlots() { return Math.max(0, (this.player?.maxActivatedSkills || 0) - this.visibleSkills.length); },
    canInteract() { return this.isPlayerTurn && !this.isControlDisabled; }
  },
  watch: {
    visibleIds: {
      immediate: true,
      handler(newIds, old) {
        if (!old) { this.prevIds = [...newIds]; return; }
        const prevSet = new Set(this.prevIds);
        const added = newIds.filter(id => !prevSet.has(id));
        const removed = this.prevIds.filter(id => !new Set(newIds).has(id));
        this.prevIds = [...newIds];
        if (added.length && this.listenTransferEvents) {
          added.forEach(id => { this.appearing[id] = true; this.scheduleAppearFallback(id); });
        }
        // Removed cards: keep leaving flag until transfer-end cleans it up (backend already updated state)
        removed.forEach(id => { delete this.appearing[id]; delete this.leaving[id]; });
      }
    }
  },
  mounted() {
    if (this.listenTransferEvents) {
      frontendEventBus.on('card-transfer-start', this.onTransferStart);
      frontendEventBus.on('card-transfer-end', this.onTransferEnd);
    }
  },
  beforeUnmount() {
    frontendEventBus.off('card-transfer-start', this.onTransferStart);
    frontendEventBus.off('card-transfer-end', this.onTransferEnd);
    Object.keys(this.cardRefs).forEach(id => unregisterCardEl(id));
  },
  methods: {
    setCardRef(el, id) {
      if (el) {
        if(this.cardRefs[id] === el) return ; // no change
        this.cardRefs[id] = el;
        const dom = el.$el ? el.$el : el;
        registerCardEl(id, dom);
      } else {
        // 解绑，保证删除的注册表项是本组件注册的项，避免因为时许原因误删其他元素注册的项
        unregisterCardEl(id, this.cardRefs[id]);
        delete this.cardRefs[id];
      }
    },
    scheduleAppearFallback(id) { setTimeout(() => { if (this.appearing[id]) delete this.appearing[id]; }, 1500); },
    onTransferStart(payload = {}) {
      if (payload.from === this.containerKey && payload.phase === 'start') {
        const id = payload.id;
        if (id != null) this.leaving[id] = true;
      }
    },
    onTransferEnd(payload = {}) {
      if (payload.phase !== 'end') return;
      const { id, to, from } = payload;
      if (to === this.containerKey && this.appearing[id]) {
        delete this.appearing[id];
      }
      if (from === this.containerKey && this.leaving[id]) {
        delete this.leaving[id];
      }
    },
    slotStyle(idx, skill) {
      const baseX = idx * 210; // spacing
      const hidden = !!this.appearing[skill.uniqueID];
      return {
        transform: `translateX(${baseX}px)`,
        visibility: hidden ? 'hidden' : 'visible'
      };
    },
    // 新增：是否为咏唱状态
    isChanting(skill) { return !!(skill && skill.cardMode === 'chant'); },
    // 新增：获取 tier 色
    tierColor(skill) {
      if (!skill) return '#ffffff';
      const tier = (skill.tier != null ? String(skill.tier) : (skill.skillTier != null ? String(skill.skillTier) : ''));
      return getSkillTierColor(tier) || '#ffffff';
    },
    // 新增：整合动态样式（注入颜色变量）
    slotDynamicStyle(idx, skill) {
      const base = this.slotStyle(idx, skill);
      return { ...base, '--tier-color': this.tierColor(skill) };
    },
    onSkillClick(skill) {
      // 默认点击行为：如果是咏唱牌，等同停止按钮
      if (skill.cardMode === 'chant' && this.canInteract) this.stopChant(skill);
    },
    stopChant(skill) {
      backendEventBus.emit(EventNames.Battle.PLAYER_STOP_ACTIVATED_SKILL, skill.uniqueID);
    }
  }
};
</script>

<style scoped>
.activated-skills-bar {
  position: absolute;
  left: 50%;
  bottom: 350px;
  transform: translateX(-50%);
  height: 280px;
  pointer-events: auto;
  min-width: 220px;
}
.activated-slot {
  position: absolute;
  top: 0;
  transition: transform .25s ease, visibility 0s linear;
}
/* 咏唱 ring-light：慢速脉动，仅淡入，不淡出；离开时移除 .chanting class 立即终止 */
.activated-slot.chanting::after {
  content: '';
  position: absolute;
  inset: 0px;
  border-radius: 18px;
  pointer-events: none;
  /* 使用双层阴影：第一层紧贴，第二层外扩发光 */
  box-shadow: 0 0 0 0 var(--tier-color, #fff), 0 0 0 0 var(--tier-color, #fff);
  border: 2px solid var(--tier-color, #fff);
  opacity: 0; /* 仅初始为 0，动画前段淡入后保持 */
  animation: ringLightPulse 3.6s ease-in infinite;
  filter: blur(1px) saturate(1.1);
  z-index: -1;
}
@keyframes ringLightPulse {
  0% { opacity: 0.2; box-shadow: 0 0 8px 2px var(--tier-color, #fff), 0 0 20px 8px var(--tier-color, #fff);}
  12% { box-shadow: 0 0 16px 6px var(--tier-color, #fff), 0 0 34px 14px var(--tier-color, #fff); }
  28% { box-shadow: 0 0 10px 4px var(--tier-color, #fff), 0 0 26px 12px var(--tier-color, #fff); }
  50% { opacity: 1; box-shadow: 0 0 13px 5px var(--tier-color, #fff), 0 0 28px 12px var(--tier-color, #fff); }
  0% { box-shadow: 0 0 8px 2px var(--tier-color, #fff), 0 0 20px 8px var(--tier-color, #fff);}
}

</style>
