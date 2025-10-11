<template>
  <div class="skills-hand-root" ref="handRoot" :class="{ dragging: isDragging }">
    <div
      v-for="(skill, idx) in visibleSkills"
      :key="skill.uniqueID"
      :class="['skill-wrapper', {'instant': idx === dragIndex}]"
      :style="wrapperStyle(idx, skill)"
      @mouseenter="onHoverStart(idx)"
      @mouseleave="onHoverEnd(idx)"
      @mousedown.left.prevent="onMouseDown(idx, $event)"
    >
      <SkillCard
        :skill="skill"
        :player="player"
        :disabled="!draggable && (!canUseSkill(skill) || !isPlayerTurn || isControlDisabled)"
        :player-mana="(player && player.mana != null) ? player.mana : Infinity"
        :can-click="draggable || (isPlayerTurn && !isControlDisabled && canUseSkill(skill))"
        :suppress-activation-animation-on-click="true"
        :auto-register-in-registry="false"
        :ref="el => setCardRef(el, skill.uniqueID)"
        @skill-card-clicked="onSkillCardClicked"
      />
    </div>
  </div>
</template>

<script>
import SkillCard from './SkillCard.vue';
import frontendEventBus from '../frontendEventBus.js';
import backendEventBus, { EventNames } from '../backendEventBus';
import { registerCardEl, unregisterCardEl } from '../utils/cardDomRegistry.js';
import {backendGameState} from "../data/gameState";

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

export default {
  name: 'SkillsHand',
  components: { SkillCard },
  emits: ['reorder-request'],
  props: {
    player: { type: Object, required: false, default: null },
    skills: { type: Array, default: null },
    isControlDisabled: { type: Boolean, default: false },
    isPlayerTurn: { type: Boolean, default: true },
    // 休整时（PreparationPanel）开启拖拽；战斗时（ActionPanel）关闭
    draggable: { type: Boolean, default: false },
    // 进入手中的卡牌是否立刻出现
    instantAppear: { type: Boolean, default: false },
    // 是否监听全局的 card-appear-finished 事件（关闭则不等待该事件，直接显示）
    // legacy param，不再使用
    transferContainerKey: { type: String, default: 'skills-hand' },
    // 新：是否等待通用 card-transfer-end (to == transferContainerKey) 后再显示
    waitTransferEnd: { type: Boolean, default: true }
  },
  data() {
    return {
      cardRefs: {},
      prevIds: [],
      appearing: {},
      // 布局测量
      containerWidth: 0,
      cardWidth: 198,
      cardHeight: 266,
      // 悬浮与拖拽占位
      hoveredIndex: -1,
      isDragging: false,
      dragIndex: -1,
      dragStartX: 0,
      dragDeltaX: 0,
      draggedOriginalX: 0,
      insertionIndex: -1, // 0..n 表示插槽位置；-1 表示无插槽
      // ResizeObserver
      _ro: null,
    };
  },
  computed: {
    visibleSkills() {
      const explicit = this.skills && Array.isArray(this.skills) ? this.skills : null;
      if (explicit) return explicit.filter(Boolean);
      return (this.player?.frontierSkills || []).filter(Boolean);
    },
    visibleIds() {
      return this.visibleSkills.map(s => s.uniqueID).filter(Boolean);
    },
    // 基于容器/悬浮/拖拽插槽来计算每张卡的位置
    layout() {
      const n = this.visibleSkills.length;
      const containerWidth = Math.max(0, this.containerWidth || 0);
      const cardWidth = Math.max(1, this.cardWidth || 198);
      if (n === 0) return [];

      // 基本参数
      const DEFAULT_GAP = 15;
      const MIN_STEP = 30; // 每张至少露出 30px
      const MIN_GAP = -cardWidth + MIN_STEP; // 允许的最小间距（强叠压）
      const INSERT_EXTRA = Math.max(60, Math.floor(cardWidth * 0.9));

      // 悬浮扩缝（对间）
      const pairExtra = new Array(Math.max(0, n - 1)).fill(0);
      if (!this.isDragging && this.hoveredIndex >= 0 && n > 1) {
        const i0 = this.hoveredIndex;
        const baseExtra = 120;
        const decay = 0.6;
        for (let d = 0; i0 - 1 - d >= 0 || i0 + d < n - 1; d++) {
          const inc = baseExtra * Math.pow(decay, d) / 2;
          const leftPair = i0 - 1 - d;
          const rightPair = i0 + d;
          if (leftPair >= 0) pairExtra[leftPair] += inc;
          if (rightPair < pairExtra.length) pairExtra[rightPair] += inc;
        }
        for (let i = 0; i < pairExtra.length; i++) {
          // 不允许正间距，仅在叠压时或距离鼠标悬浮卡牌极近时撑开
          const maxAllowed = (i === i0 - 1 || i === i0) ? DEFAULT_GAP : 0;
          pairExtra[i] = Math.min(pairExtra[i], maxAllowed);
        }
      }

      // 拖拽插槽扩缝（含首尾）
      let leadingExtra = 0;
      let trailingExtra = 0;
      if (this.isDragging && this.insertionIndex >= 0) {
        console.log('插槽位置', this.insertionIndex);
        pairExtra[this.dragIndex] = -cardWidth; // 被拖拽卡不占间距
        const offset = this.insertionIndex < this.dragIndex ? 0 : 1;
        const idx = this.insertionIndex + offset;
        if (idx === 0) {
          leadingExtra += INSERT_EXTRA;
        } else if (idx >= n) {
          trailingExtra += INSERT_EXTRA;
        } else {
          pairExtra[idx-1] += INSERT_EXTRA;
        }
      }

      const extraSum = pairExtra.reduce((a, b) => a + b, 0) + leadingExtra + trailingExtra;

      // 计算基础间距，使总宽度适配容器
      let baseGap;
      if (n === 1) {
        baseGap = 0;
      } else {
        // 在叠压时，baseGap可能为负数
        baseGap = (containerWidth - n * cardWidth - extraSum) / (n - 1);
        baseGap = clamp(baseGap, MIN_GAP, DEFAULT_GAP);
      }

      // 每对实际间距
      const pairGap = pairExtra.map(ex => baseGap + ex);
      const totalWidth = n * cardWidth + pairGap.reduce((a, b) => a + b, 0) + leadingExtra + trailingExtra;
      const leftPad = Math.max(0, (containerWidth - totalWidth) / 2) + leadingExtra;

      const out = new Array(n);
      let x = leftPad;
      for (let i = 0; i < n; i++) {
        out[i] = {
          x: Math.round(x),
          z: 10 + i + (i === this.hoveredIndex ? 1000 : 0),
          scale: (!this.isDragging && i === this.hoveredIndex) ? 1.08 : 1.0,
        };
        x += cardWidth;
        if (i < pairGap.length) x += pairGap[i];
      }
      return out;
    }
  },
  mounted() {
    if (this.waitTransferEnd) {
      frontendEventBus.on('card-transfer-end', this.onCardTransferEnd);
    }

    this._ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const cr = entry.contentRect;
        if (cr && cr.width !== this.containerWidth) this.containerWidth = cr.width;
      }
    });
    if (this.$refs.handRoot) this._ro.observe(this.$refs.handRoot);

    this.$nextTick(() => {
      const first = this.$el?.querySelector('.skill-wrapper .skill-card');
      if (first) {
        const r = first.getBoundingClientRect();
        if (r.width > 0) {
          this.cardWidth = Math.round(r.width);
          this.cardHeight = Math.round(r.height);
        }
      }
      const hr = this.$refs.handRoot;
      if (hr && hr.clientWidth) this.containerWidth = hr.clientWidth;
    });
  },
  beforeUnmount() {
    try { frontendEventBus.off('card-transfer-end', this.onCardTransferEnd); } catch (_) {}
    if (this._ro) {
      try { this._ro.disconnect(); } catch (_) {}
      this._ro = null;
    }
    this.detachDragListeners();
  },
  watch: {
    visibleIds: {
      immediate: true,
      handler(newIds, oldIds) {
        if (oldIds == null) {
          this.prevIds = [...newIds];
          return;
        }
        const prevSet = new Set(this.prevIds);
        const added = newIds.filter(id => !prevSet.has(id));
        this.prevIds = [...newIds];
        if (added.length === 0) return;
        // 若不等待转移完成事件或禁用入场动画，直接显示
        if (!this.waitTransferEnd || this.instantAppear) {
          added.forEach(id => { if (this.appearing[id]) delete this.appearing[id]; });
          return;
        }
        // 标记为入场中，等待 card-transfer-end 或兜底
        added.forEach(id => { this.appearing[id] = true; });
        this.$nextTick(() => {
          added.forEach(id => this.scheduleAppearFallback(id));
        });
      }
    }
  },
  methods: {
    // 通用转移动画完成事件：{ id, kind, type, from, to, token, phase: 'end' }
    onCardTransferEnd(payload = {}) {
      if (!payload || payload.phase !== 'end') return;
      const { id, to } = payload;
      if (to === this.transferContainerKey && id != null && this.appearing[id]) {
        delete this.appearing[id];
      }
    },
    setCardRef(el, id) {
      if (el) {
        if(this.cardRefs[id] === el) return;
        this.cardRefs[id] = el;
        const dom = el.$el ? el.$el : el;
        registerCardEl(id, dom, this.transferContainerKey);
      } else {
        // 保证销毁的注册表项是本元素注册的DOM，避免因为时序导致的误删（A增加->B增加->A销毁->B注册表项被删）
        unregisterCardEl(id, this.transferContainerKey);
        delete this.cardRefs[id];
      }
    },
    // 现在由后端统一触发入手动画；这里仅保留兜底清理逻辑，避免异常时卡片长时间不可见
    scheduleAppearFallback(id) {
      setTimeout(() => { if (this.appearing[id]) delete this.appearing[id]; }, 1500);
    },
    canUseSkill(frontEndSkill) {
      // 直接使用后端玩家状态和后端技能状态判断是否可用，避免因前端 player 状态不同步导致的误判
      const player = backendGameState.player;
      const p = (player && typeof player.getModifiedPlayer === 'function') ? player.getModifiedPlayer() : player;
      const skill = player.frontierSkills.find(s => s.uniqueID === frontEndSkill.uniqueID);
      return skill && typeof skill.canUse === 'function' && skill.canUse(p);
    },
    onSkillCardClicked(skill, event) {
      if (this.draggable || this.isControlDisabled || !this.isPlayerTurn) return; // 休整/不可控制/非玩家会和时禁用技能使用
      if (this.canUseSkill(skill)) {
        const manaCost = skill.manaCost;
        const actionPointCost = skill.actionPointCost;
        const mouseX = event.clientX;
        const mouseY = event.clientY;
        backendEventBus.emit(EventNames.PlayerOperations.PLAYER_USE_SKILL, skill.uniqueID);
        this.generateParticleEffects(manaCost, actionPointCost, mouseX, mouseY);
      }
    },
    generateParticleEffects(manaCost, actionPointCost, mouseX, mouseY) {
      const particles = [];
      if (manaCost > 0) {
        for (let i = 0; i < 2 + manaCost * 8; i++) {
          particles.push({
            x: mouseX, y: mouseY,
            vx: (Math.random() - 0.5) * 100,
            vy: (Math.random() - 0.5) * 100 - 50,
            color: '#2196f3', life: 2000, gravity: 400, size: 3 + Math.random() * 2
          });
        }
      }
      if (actionPointCost > 0) {
        for (let i = 0; i < 2 + actionPointCost * 8; i++) {
          particles.push({
            x: mouseX, y: mouseY,
            vx: (Math.random() - 0.5) * 100,
            vy: (Math.random() - 0.5) * 100 - 50,
            color: '#FFD700', life: 2000, gravity: 400, size: 3 + Math.random() * 2
          });
        }
      }
      frontendEventBus.emit('spawn-particles', particles);
    },

    // 悬浮：仅在非拖拽时生效
    onHoverStart(idx) { if (!this.isDragging) this.hoveredIndex = idx; },
    onHoverEnd(idx) { if (this.hoveredIndex === idx) this.hoveredIndex = -1; },

    // 拖拽（仅 PreparationPanel 开启 draggable 时）
    onMouseDown(idx, evt) {
      if (!this.draggable) return;
      if (evt.button !== 0) return; // 仅左键
      this.isDragging = true;
      this.dragIndex = idx;
      this.hoveredIndex = -1; // 避免与悬浮展开冲突
      this.dragStartX = evt.clientX;
      this.dragDeltaX = 0;
      this.draggedOriginalX = (this.layout[idx]?.x) || 0;
      this.computeInsertionIndex();
      this.attachDragListeners();
    },
    onMouseMove(evt) {
      if (!this.isDragging) return;
      this.dragDeltaX = evt.clientX - this.dragStartX;
      this.computeInsertionIndex();
    },
    onMouseUp(evt) {
      if (!this.isDragging) return;
      const from = this.dragIndex;
      const n = this.visibleSkills.length;
      let to = clamp(this.insertionIndex, 0, n);
      // 将插入位置映射到 0..n-1 的新索引（末尾插入等价于 n-1）
      if (to >= n) to = n - 1;
      this.isDragging = false;
      this.dragIndex = -1;
      this.dragDeltaX = 0;
      this.insertionIndex = -1;
      this.detachDragListeners();
      if (from !== -1 && to !== -1 && from !== to) {
        // 发出重排请求事件，外部（PreparationPanel）据此更新顺序
        this.$emit('reorder-request', { from, to });
      }
    },
    attachDragListeners() {
      window.addEventListener('mousemove', this.onMouseMove, { passive: true });
      window.addEventListener('mouseup', this.onMouseUp, { passive: true });
    },
    detachDragListeners() {
      window.removeEventListener('mousemove', this.onMouseMove);
      window.removeEventListener('mouseup', this.onMouseUp);
    },
    computeInsertionIndex() {
      const n = this.visibleSkills.length;
      const cw = Math.max(1, this.cardWidth || 198);
      if (n <= 1) { this.insertionIndex = 0; return; }

      // 使用“移除被拖拽卡后”的其他卡中心，基于拖拽中心决定插槽位置
      const centers = [];
      for (let i = 0; i < n; i++) {
        if (i === this.dragIndex) continue;
        const c = (this.layout[i]?.x || 0) + cw / 2;
        centers.push(c);
      }
      const draggedCenter = this.draggedOriginalX + this.dragDeltaX + cw / 2;
      let idx = 0;
      while (idx < centers.length && draggedCenter > centers[idx]) idx++;
      this.insertionIndex = idx; // 0..n-1 或 n（末尾）
    },

    // 位置样式
    wrapperStyle(idx, skill) {
      const l = this.layout[idx] || { x: 0, z: 1, scale: 1 };
      const hidden = !!this.appearing[skill.uniqueID];
      const isDragged = this.isDragging && idx === this.dragIndex;
      const tx = isDragged ? (this.draggedOriginalX + this.dragDeltaX) : l.x;
      const ty = isDragged ? -20 : 0;
      const sc = isDragged ? 1.08 : l.scale;
      const z = isDragged ? 5000 : l.z;
      return {
        transform: `translate(${Math.round(tx)}px, ${ty}px) scale(${sc})`,
        zIndex: z,
        visibility: hidden ? 'hidden' : 'visible',
        cursor: this.draggable ? (isDragged ? 'grabbing' : 'grab') : 'default',
        pointerEvents: isDragged ? 'none' : 'auto',
      };
    }
  }
};
</script>

<style scoped>
.skills-hand-root {
  position: relative;
  width: 100%;
  height: auto;
  min-height: 280px;
}
.skill-wrapper {
  position: absolute;
  top: 0;
  transition: transform 0.22s ease, visibility 0s linear;
}
.skill-wrapper.instant {
  transition: none;
}
</style>
