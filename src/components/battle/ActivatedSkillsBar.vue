<template>
  <div class="activated-skills-bar" ref="barRoot">
    <!-- 不再渲染卡牌，仅作为锚点计算器 -->
  </div>
</template>

<script>
import frontendEventBus from '../../frontendEventBus.js';
import animator from '../../utils/animator.js';
import { displayGameState } from '../../data/gameState.js';
import { getSkillTierColor } from '../../utils/tierUtils.js';

export default {
  name: 'ActivatedSkillsBar',
  components: {},
  props: {
    player: { type: Object, required: true },
    containerKey: { type: String, default: 'activated-skills' }
  },
  data() {
    return {};
  },
  computed: {
    visibleSkills() { 
      return (displayGameState.player?.activatedSkills || []).filter(Boolean); 
    },
    visibleIds() { 
      return this.visibleSkills.map(s => s.uniqueID); 
    },
    anchorsMap() {
      const map = new Map();
      const spacing = 210;
      
      // 获取容器的屏幕位置
      const barRect = this.$refs.barRoot?.getBoundingClientRect();
      if (!barRect) return map;
      
      const barX = barRect.left;
      const barY = barRect.top;
      
      this.visibleSkills.forEach((skill, index) => {
        // 锚点是卡牌的中心点
        map.set(skill.uniqueID, {
          x: barX + index * spacing + 99, // 99 是卡牌宽度的一半 (198/2)
          y: barY + 133, // 133 是卡牌高度的一半 (266/2)
          scale: 1.0,
          rotation: 0
        });
      });
      
      return map;
    }
  },
  mounted() {
    // 初始化时更新锚点
    this.$nextTick(() => {
      if (this.anchorsMap.size > 0) {
        animator.updateAnchors(this.containerKey, this.anchorsMap);
      }
    });
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
  pointer-events: none;
  min-width: 220px;
}
</style>
