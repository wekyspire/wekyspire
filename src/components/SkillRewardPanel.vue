<template>
  <div class="skill-reward-panel" key="panel">
    <h2>选择一个技能！</h2>
    <div class="skill-cards">
      <SkillCard
        v-for="(skill, index) in skills"
        :key="skill.uniqueID"
        :skill="skill"
        :preview-mode="true"
        @skill-card-clicked="onSkillCardClicked"
      />
    </div>
    <button @click="closePanel">放弃</button>
  </div>
</template>

<script>
import SkillCard from './SkillCard.vue';
export default {
  name: 'SkillRewardPanel',
  components: {
    SkillCard
  },
  props: {
    skills: {
      type: Array,
      default: () => []
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
</style>