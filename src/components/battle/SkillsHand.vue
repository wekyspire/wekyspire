<template>
  <div class="skills-hand-root" ref="handRoot">
    <!-- 不再渲染卡牌，仅作为锚点计算器 -->
  </div>
</template>

<script>
import frontendEventBus from '../../frontendEventBus.js';
import animator from '../../utils/animator.js';
import { displayGameState } from '../../data/gameState.js';

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

export default {
  name: 'SkillsHand',
  components: {},
  props: {
    player: { type: Object, required: false, default: null },
    skills: { type: Array, default: null },
    draggable: { type: Boolean, default: false },
    transferContainerKey: { type: String, default: 'skills-hand' }
  },
  data() {
    return {
      containerWidth: 0,
      containerHeight: 0,
      cardWidth: 198,
      cardHeight: 266,
      hoveredIndex: -1,
      _ro: null,
      _pendingAnchorUpdate: false
    };
  },
  computed: {
    visibleSkills() {
      const explicit = this.skills && Array.isArray(this.skills) ? this.skills : null;
      if (explicit) return explicit.filter(Boolean);
      return (displayGameState.player?.frontierSkills || []).filter(Boolean);
    },
    visibleIds() {
      return this.visibleSkills.map(s => s.uniqueID).filter(Boolean);
    },
    anchorsMap() {
      const map = new Map();
      const layout = this.layout;
      
      // 获取容器的屏幕位置
      const rootRect = this.$refs.handRoot?.getBoundingClientRect();
      if (!rootRect) return map;
      
      const rootX = rootRect.left;
      const rootY = rootRect.top;
      
      this.visibleSkills.forEach((skill, index) => {
        if (!layout[index]) return;
        
        // 将相对于容器的位置转换为绝对屏幕坐标
        // 锚点是卡牌的中心点
        map.set(skill.uniqueID, {
          x: rootX + layout[index].x + this.cardWidth / 2,
          y: rootY + this.cardHeight / 2,
          scale: layout[index].scale || 1,
          rotation: 0
        });
      });
      
      return map;
    },
    layout() {
      const n = this.visibleSkills.length;
      const containerWidth = Math.max(0, this.containerWidth || 0);
      const cardWidth = Math.max(1, this.cardWidth || 198);
      if (n === 0) return [];

      const DEFAULT_GAP = 15;
      const MIN_STEP = 30;
      const MIN_GAP = -cardWidth + MIN_STEP;

      const pairExtra = new Array(Math.max(0, n - 1)).fill(0);
      if (this.hoveredIndex >= 0 && n > 1) {
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
          const maxAllowed = (i === i0 - 1 || i === i0) ? DEFAULT_GAP : 0;
          pairExtra[i] = Math.min(pairExtra[i], maxAllowed);
        }
      }

      const extraSum = pairExtra.reduce((a, b) => a + b, 0);

      let baseGap;
      if (n === 1) {
        baseGap = 0;
      } else {
        baseGap = (containerWidth - n * cardWidth - extraSum) / (n - 1);
        baseGap = clamp(baseGap, MIN_GAP, DEFAULT_GAP);
      }

      const pairGap = pairExtra.map(ex => baseGap + ex);
      const totalWidth = n * cardWidth + pairGap.reduce((a, b) => a + b, 0);
      const leftPad = Math.max(0, (containerWidth - totalWidth) / 2);

      const out = new Array(n);
      let x = leftPad;
      for (let i = 0; i < n; i++) {
        out[i] = {
          x: Math.round(x),
          z: 10 + i + (i === this.hoveredIndex ? 1000 : 0),
          scale: (i === this.hoveredIndex) ? 1.08 : 1.0,
        };
        x += cardWidth;
        if (i < pairGap.length) x += pairGap[i];
      }
      return out;
    }
  },
  mounted() {
    frontendEventBus.on('card-hover', this.onCardHover);
    frontendEventBus.on('card-leave', this.onCardLeave);

    this._ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const cr = entry.contentRect;
        if (cr && cr.width !== this.containerWidth) this.containerWidth = cr.width;
        if (cr && cr.height !== this.containerHeight) this.containerHeight = cr.height;
      }
    });
    if (this.$refs.handRoot) this._ro.observe(this.$refs.handRoot);

    this.$nextTick(() => {
      const hr = this.$refs.handRoot;
      if (hr && hr.clientWidth) this.containerWidth = hr.clientWidth;
      if (hr && hr.clientHeight) this.containerHeight = hr.clientHeight;
    });
  },
  beforeUnmount() {
    try { 
      frontendEventBus.off('card-hover', this.onCardHover);
      frontendEventBus.off('card-leave', this.onCardLeave);
    } catch (_) {}
    if (this._ro) {
      try { this._ro.disconnect(); } catch (_) {}
      this._ro = null;
    }
  },
  watch: {
    anchorsMap: {
      deep: true,
      immediate: true,
      handler() {
        this.scheduleAnchorsPush();
      }
    },
    // 监听 containerWidth 和 visibleSkills 的变化，在布局发生变化时更新锚点
    containerWidth() {
      this.scheduleAnchorsPush();
    },
    containerHeight() {
      this.scheduleAnchorsPush();
    }
  },
  methods: {
    onCardHover({ id }) {
      const index = this.visibleSkills.findIndex(s => s.uniqueID === id);
      if (index >= 0) {
        this.hoveredIndex = index;
      }
    },
    onCardLeave({ id }) {
      const index = this.visibleSkills.findIndex(s => s.uniqueID === id);
      if (index >= 0 && this.hoveredIndex === index) {
        this.hoveredIndex = -1;
      }
    },
    scheduleAnchorsPush() {
      if (this._pendingAnchorUpdate) return;
      this._pendingAnchorUpdate = true;
      this.$nextTick(() => {
        try {
          const hr = this.$refs.handRoot;
          const rect = hr?.getBoundingClientRect?.();
          // 跳过无效尺寸，避免把所有锚点推到屏幕左侧
          if (!rect || rect.height <= 0 || rect.width <= 0 || this.containerWidth <= 0 || this.containerHeight <= 0) {
            this._pendingAnchorUpdate = false;
            return;
          }
          const map = this.anchorsMap;
          if (map && map.size > 0) {
            animator.updateAnchors('skills-hand', map);
          }
        } finally {
          this._pendingAnchorUpdate = false;
        }
      });
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
</style>
