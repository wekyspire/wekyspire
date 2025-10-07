<template>
  <div class="skill-features-and-uses">
    <div class="skill-features">
    <ColoredText v-if="skill.slowStart" text="/named{慢热}" />
    <ColoredText v-if="skill.cardMode === 'chant'" text="/named{咏唱}" />
    </div>
    <ColoredText
      v-if="skill.coldDownTurns !== 0 && skill.remainingUses !== skill.maxUses && !previewMode"
      :text="`/named{重整} ${skill.remainingColdDownTurns}/${skill.coldDownTurns}`"
    />
    <ColoredText
      v-else-if="skill.coldDownTurns !== 0"
      :text="`/named{重整} ${skill.coldDownTurns} 回合`"
    />
    <ColoredText
      v-else-if="skill.remainingUses !== Infinity"
      text="/named{消耗}"
    />
    <br />
    <strong v-if="skill.maxUses === Infinity && skill.coldDownTurns === 0">无限</strong>
    <span v-else-if="previewMode">(装填 {{ skill.maxUses }}/{{ skill.maxUses }})</span>
    <span v-else>(装填 {{ skill.remainingUses }}/{{ skill.maxUses }})</span>
  </div>
</template>

<script>
import ColoredText from '../ColoredText.vue';
export default {
  name: 'SkillFeaturesAndUses',
  components: { ColoredText },
  props: {
    skill: { type: Object, required: true },
    previewMode: { type: Boolean, default: false }
  }
};
</script>

<style scoped>
.skill-features {
  font-size: 12px;
  margin-bottom: 4px;
  display: flex;
  gap: 6px;
}
.skill-features-and-uses { font-size: 12px; color: #666; }
</style>

