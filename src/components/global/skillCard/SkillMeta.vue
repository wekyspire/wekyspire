<template>
  <div class="skill-meta">
    <div class="skill-name" :style="{ color: nameColor, borderColor: backgroundColor }">
      {{ nameText }}
    </div>
    <div class="skill-subtitle" :class="{ hovered: hovered }" v-if="skill.subtitle">
      {{ skill.subtitle }}
    </div>
  </div>
</template>

<script>
export default {
  name: 'SkillMeta',
  props: {
    skill: { type: Object, required: true },
    hovered: { type: Boolean, default: false },
    backgroundColor: { type: String, default: '#EEE' }
  },
  computed: {
    nameColor() {
      const p = this.skill?.power || 0;
      if (p < 0) return 'red';
      if (p > 0) return 'green';
      return 'black';
    },
    nameText() {
      const s = this.skill;
      const p = s?.power || 0;
      const powerText = p < 0 ? `（${p}）` : (p > 0 ? `（+${p}）` : '');
      return `${s?.name || ''}${powerText}`;
    }
  }
};
</script>

<style scoped>
.skill-meta { display: flex; flex-direction: column; align-items: center; }
.skill-name {
  font-weight: bold;
  font-size: 16px;
  padding: 2px;
  border-radius: 8px;
  border-width: 3px;
  border-style: solid;
  margin: 0 auto 8px auto;
}
.skill-subtitle {
  padding: 2px 6px;
  color: rgba(200, 200, 200, 0.7);
  font-size: 12px;
  font-style: italic;
  transition: 0.3s ease;
}
.skill-subtitle.hovered { color: black; background-color: rgba(255,255,255,0.7); }
</style>

