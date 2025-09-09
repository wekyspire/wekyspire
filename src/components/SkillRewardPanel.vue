<template>
  <transition-group name="slide" tag="div" class="skill-reward-panel-wrapper">
    <div class="skill-reward-panel" v-if="isVisible" key="panel">
      <h2>选择一个技能！</h2>
      <div class="skill-cards">
        <SkillCard
          v-for="(skill, index) in skills" 
          :key="'skill-' + index"
          :skill="skill"
          :preview-mode="true"
          @skill-card-clicked="onSkillCardClicked"
        />
      </div>
      <button @click="closePanel">放弃</button>
    </div>
  </transition-group>
</template>

<script>
import SkillCard from './SkillCard.vue';
import eventBus from '../eventBus';
import gameState from '../data/gameState';

export default {
  name: 'SkillRewardPanel',
  components: {
    SkillCard
  },
  props: {
    skills: {
      type: Array,
      default: () => []
    },
    isVisible: {
      type: Boolean,
      default: false
    }
  },
  methods: {
    onSkillCardClicked(skill) {
      this.$emit('selected-skill-reward', skill);
    },
    closePanel() {
      this.$emit('close');
    }
  }
}
</script>

<style scoped>
.skill-reward-panel {
  border: 1px solid #4caf50; /* 绿色边框 */
  padding: 20px;
  background: linear-gradient(135deg, #e8f5e9, #c8e6c9); /* 绿色渐变背景 */
  max-width: 80%;
  margin: 20px auto;
  box-shadow: 0 4px 8px rgba(76, 175, 80, 0.3);
  border-radius: 8px;
}

.skill-reward-panel h2 {
  text-align: center;
  margin-bottom: 20px;
  color: #2e7d32; /* 深绿色文字 */
}

.skill-cards {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  margin: 20px 0;
  justify-content: center;
}

.skill-name {
  font-weight: bold;
  font-size: 1.2em;
  margin-bottom: 10px;
  color: #333;
}

.skill-description {
  color: #666;
  margin-bottom: 10px;
}

.skill-tier {
  font-style: italic;
  color: #999;
}

button {
  padding: 10px 15px;
  margin: 5px;
  cursor: pointer;
  background-color: #4caf50; /* 绿色按钮 */
  color: white;
  border: none;
  border-radius: 4px;
}

button:hover:not(:disabled) {
  background-color: #43a047; /* 深一点的绿色 */
}

/* 滑动进入和退出动画 */
.slide-enter-active, .slide-leave-active {
  transition: all 0.5s ease;
}

.slide-enter-from {
  transform: translateY(100%);
  opacity: 0;
}

.slide-leave-to {
  transform: translateY(-100%);
  opacity: 0;
}

.slide-enter-to, .slide-leave-from {
  transform: translateY(0);
  opacity: 1;
}

/* 为transition-group添加样式 */
.skill-reward-panel-wrapper {
  display: flex;
  justify-content: center;
}
</style>