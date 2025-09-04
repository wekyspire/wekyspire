<template>
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
.skill-reward-panel {
  border: 1px solid #ccc;
  padding: 20px;
  margin: 20px 0;
  background-color: #f9f9f9;
}

.skill-cards {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  margin: 20px 0;
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