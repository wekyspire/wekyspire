<template>
  <div>
    <div class="mana-cost" v-if="skill?.manaCost > 0">
      <span class="mana-icon">💧</span>
      <span class="mana-value" :class="{ 'insufficient-mana': playerMana < skill.manaCost }">{{ skill.manaCost }}</span>
    </div>
    <div class="action-cost" v-if="skill?.actionPointCost > 0">
      <span class="action-icon">⚡</span>
      <span class="action-value">{{ skill.actionPointCost }}</span>
    </div>
  </div>
</template>

<script>
export default {
  name: 'SkillCosts',
  props: {
    skill: { type: Object, required: true },
    playerMana: { type: Number, default: Infinity }
  }
};
</script>

<style scoped>
.mana-cost {
  position: absolute;
  top: 5px;
  left: 5px;
  display: flex;
  align-items: center;
  background-color: rgba(255, 255, 255, 0.85);
  padding: 2px 6px;
  border-radius: 4px;
}
.mana-icon { font-size: 16px; margin-right: 4px; }
.mana-value { font-weight: bold; color: #2196f3; font-size: 16px; }
.mana-value.insufficient-mana { color: #f44336; }

.action-cost {
  position: absolute;
  bottom: 5px;
  left: 5px;
  display: flex;
  align-items: center;
  background-color: rgba(255, 255, 255, 0.85);
  padding: 2px 6px;
  border-radius: 4px;
}
.action-icon { font-size: 16px; margin-right: 4px; }
.action-value { font-weight: bold; color: #ff9800; font-size: 16px; }
</style>

