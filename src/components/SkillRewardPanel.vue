<template>
  <div class="skill-reward-overlay" v-if="isVisible">
    <div class="skill-reward-panel">
      <h2>技能奖励</h2>
      <div class="skill-cards">
        <SkillCard
          v-for="(skill, index) in skills" 
          :key="index"
          :skill="skill"
          :preview-mode="true"
          @skill-card-clicked="selectSkill"
        />
      </div>
      <button @click="closePanel">放弃</button>
    </div>
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
    },
    isVisible: {
      type: Boolean,
      default: false
    }
  },
  methods: {
    selectSkill(skill) {
      this.$emit('select-skill', skill);
    },
    closePanel() {
      this.$emit('close');
    }
  }
}
</script>

<style scoped>
.skill-reward-overlay {
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

.skill-reward-panel {
  border: 1px solid #ccc;
  padding: 20px;
  background-color: #f9f9f9;
  max-width: 80%;
  max-height: 80%;
  overflow-y: auto;
}

.skill-cards {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  margin: 20px 0;
  justify-content: center;
}

.skill-card {
  border: 1px solid #eee;
  padding: 15px;
  width: 200px;
  cursor: pointer;
  background-color: white;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  transition: transform 0.2s;
}

.skill-card:hover {
  transform: translateY(-5px);
  box-shadow: 0 4px 8px rgba(0,0,0,0.15);
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
}
</style>