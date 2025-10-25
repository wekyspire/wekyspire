<template>
  <div class="ability-reward-panel" key="panel">
    <!-- 选中效果覆盖层 -->
    <transition name="selection-overlay-fade">
      <div class="selection-overlay" v-if="showSelectionEffect" key="overlay"></div>
    </transition>

    <h2>选择一项能力！</h2>
    <div class="ability-cards">
      <div
        v-for="ability in abilities"
        :key="ability.uniqueID"
        :class="[
          'ability-card',
          'tier-' + ability.tier,
          { 'selected-glow': selectedAbility === ability && showSelectionEffect }
        ]"
        @click="selectAbility(ability)"
      >
        <div class="ability-tier">{{ getAbilityTierLabel(ability.tier) }}</div>
        <div class="ability-name">{{ ability.name }}</div>
        <div class="ability-description">
          <ColoredText :text="ability.description" />
        </div>
      </div>
    </div>
    <button @click="closePanel">放弃</button>
  </div>
</template>

<script>
import ColoredText from '../global/ColoredText.vue';
import { getAbilityTierLabel } from '../../utils/tierUtils.js';

export default {
  name: 'AbilityRewardPanel',
  components: {
    ColoredText
  },
  props: {
    abilities: {
      type: Array,
      default: () => []
    }
  },
  data() {
    return {
      selectedAbility: null,
      showSelectionEffect: false
    };
  },
  methods: {
    getAbilityTierLabel,
    selectAbility(ability) {
      // 设置选中的能力
      this.selectedAbility = ability;
      this.showSelectionEffect = true;
      
      // 等待动画完成后发出事件
      setTimeout(() => {
        this.$emit('selected-ability-reward', ability);
      }, 2000); // 动画持续时间
    },
    closePanel() {
      this.$emit('close');
    },

  }
}
</script>

<style scoped>
.ability-reward-panel {
  border: 1px solid #9c27b0; /* 紫色边框 */
  padding: 20px;
  background: linear-gradient(135deg, #f3e5f5, #e1bee7); /* 紫色渐变背景 */
  max-width: 80%;
  margin: 20px auto;
  box-shadow: 0 4px 8px rgba(156, 39, 176, 0.3);
  border-radius: 8px;
  position: relative;
  overflow: hidden;
}

.ability-reward-panel h2 {
  text-align: center;
  margin-bottom: 20px;
  color: #7b1fa2; /* 深紫色文字 */
}

.ability-cards {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  margin: 20px 0;
  justify-content: center;
}

.ability-card {
  border: 1px solid #eee;
  padding: 15px;
  width: 200px;
  cursor: pointer;
  background-color: white;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  transition: transform 0.2s;
  position: relative;
}

.ability-card:hover {
  transform: translateY(-5px);
  box-shadow: 0 4px 8px rgba(0,0,0,0.15);
}

.ability-tier {
  position: absolute;
  top: 5px;
  right: 5px;
  font-weight: bold;
  font-size: 18px;
  z-index: 2;
  padding: 2px 6px;
  border-radius: 4px;
  background-color: rgba(255, 255, 255, 0.8);
}

/* 不同等阶的能力卡片样式 */
.ability-card.tier-1 {
  background-color: #e8f5e9; /* 绿色 */
  border: 1px solid #4caf50;
}

.ability-card.tier-2 {
  background-color: #e3f2fd; /* 蓝色 */
  border: 1px solid #2196f3;
}

.ability-card.tier-3 {
  background-color: #f3e5f5; /* 紫色 */
  border: 1px solid #9c27b0;
}

.ability-card.tier-4 {
  background-color: #fff3e0; /* 黄色 */
  border: 1px solid #ff9800;
}

.ability-card.tier-5 {
  background-color: #ffebee; /* 红色 */
  border: 1px solid #f44336;
}

.ability-name {
  font-weight: bold;
  font-size: 1.2em;
  margin-bottom: 10px;
  color: #333;
}

.ability-description {
  color: #666;
}

button {
  padding: 10px 15px;
  margin: 5px;
  cursor: pointer;
  background-color: #9c27b0; /* 紫色按钮 */
  color: white;
  border: none;
  border-radius: 4px;
}

button:hover {
  background-color: #7b1fa2; /* 深紫色 */
}

/* 选中效果覆盖层 */
.selection-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.5);
  z-index: var(--z-overlay);
}

/* 选中效果覆盖层淡入淡出动画 */
.selection-overlay-fade-enter-active, .selection-overlay-fade-leave-active {
  transition: opacity 1.5s;
}

.selection-overlay-fade-enter-from, .selection-overlay-fade-leave-to {
  opacity: 0;
}

.selection-overlay-fade-enter-to, .selection-overlay-fade-leave-from {
  opacity: 1;
}

/* 选中能力卡发光效果 */
.selected-glow {
  position: relative;
  z-index: var(--z-overlay-content);
}

.selected-glow.tier-1 {
  box-shadow: 0 0 20px 10px #4caf50;
}

.selected-glow.tier-2 {
  box-shadow: 0 0 20px 10px #2196f3;
}

.selected-glow.tier-3 {
  box-shadow: 0 0 20px 10px #9c27b0;
}

.selected-glow.tier-4 {
  box-shadow: 0 0 20px 10px #ff9800;
}

.selected-glow.tier-5 {
  box-shadow: 0 0 20px 10px #f44336;
}

</style>