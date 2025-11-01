<template>
  <div class="upgrade-reward-panel">
    <h2>升级一个已有技能！</h2>
    <div class="skill-cards">
      <SkillCard
        v-for="(skill, index) in skills"
        :key="skill.uniqueID"
        :skill="skill"
        :preview-mode="true"
        @skill-card-clicked="onSkillCardClicked"
      />
    </div>
    <button @click="$emit('close')">放弃</button>
  </div>
</template>

<script>
import SkillCard from '../global/SkillCard.vue';
export default {
  name: 'UpgradeRewardPanel',
  components: { SkillCard },
  props: {
    skills: { type: Array, default: () => [] }
  },
  methods: {
    onSkillCardClicked(skill) {
      this.$emit('selected-upgrade-reward', skill);
    }
  }
}
</script>

<style scoped>
.upgrade-reward-panel {
  border: 1px solid #ff9800; /* 橙色边框 */
  padding: 20px;
  background: linear-gradient(135deg, #fff3e0, #ffe0b2); /* 橙色渐变背景 */
  max-width: 80%;
  margin: 20px auto;
  box-shadow: 0 4px 8px rgba(255, 152, 0, 0.3);
  border-radius: 8px;
}

.upgrade-reward-panel h2 { text-align: center; margin-bottom: 20px; color: #e65100; }
.skill-cards { display: flex; flex-wrap: wrap; gap: 20px; margin: 20px 0; justify-content: center; }
button { padding: 10px 15px; margin: 5px; cursor: pointer; background-color: #ff9800; color: white; border: none; border-radius: 4px; }
button:hover:not(:disabled) { background-color: #fb8c00; }
</style>

