<template>
  <div class="ability-reward-overlay" v-if="isVisible">
    <div class="ability-reward-panel">
      <h2>能力奖励</h2>
      <div class="ability-cards">
        <div 
          v-for="(ability, index) in abilities" 
          :key="index"
          :class="['ability-card', 'tier-' + ability.tier]"
          @click="selectAbility(ability)"
        >
          <div class="ability-tier">{{ getTierLabel(ability.tier) }}</div>
          <div class="ability-name">{{ ability.name }}</div>
          <div class="ability-description">
            <ColoredText :text="ability.description" />
          </div>
        </div>
      </div>
      <button @click="closePanel">放弃</button>
    </div>
  </div>
</template>

<script>
import ColoredText from './ColoredText.vue';

export default {
  name: 'AbilityRewardPanel',
  components: {
    ColoredText
  },
  props: {
    abilities: {
      type: Array,
      default: () => []
    },
    isVisible: {
      type: Boolean,
      default: false
    }
  },
  methods: {
    selectAbility(ability) {
      this.$emit('select-ability', ability);
    },
    closePanel() {
      this.$emit('close');
    },
    getTierLabel(tier) {
      const tierLabels = {
        1: 'D',
        2: 'C',
        3: 'B',
        4: 'A',
        5: 'S'
      };
      return tierLabels[tier] || '';
    }
  }
}
</script>

<style scoped>
.ability-reward-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 900; /* 确保在对话界面之下 */
}

.ability-reward-panel {
  border: 1px solid #ccc;
  padding: 20px;
  background-color: #f9f9f9;
  max-width: 80%;
  max-height: 80%;
  overflow-y: auto;
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
}
</style>