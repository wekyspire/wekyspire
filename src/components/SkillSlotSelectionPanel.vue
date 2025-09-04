<template>
  <div class="skill-slot-selection-panel">
    <h2>选择技能槽</h2>
    <p>选择一个技能槽来安装新技能：{{ skill.name }}</p>
    <div class="skill-slots">
      <SkillSlot
        v-for="(slot, index) in skillSlots"
        :key="index"
        :skill="slot"
        :index="index"
        @slot-clicked="selectSlot"
      />
    </div>
    <button @click="closePanel">取消</button>
  </div>
</template>

<script>
import SkillSlot from './SkillSlot.vue';

export default {
  name: 'SkillSlotSelectionPanel',
  components: {
    SkillSlot
  },
  props: {
    skill: {
      type: Object,
      required: true
    },
    skillSlots: {
      type: Array,
      required: true
    }
  },
  methods: {
    selectSlot(index) {
      this.$emit('select-slot', index, this.skill);
    },
    closePanel() {
      this.$emit('close');
    }
  }
}
</script>

<style scoped>
.skill-slot-selection-panel {
  border: 1px solid #ccc;
  padding: 20px;
  margin: 20px 0;
  background-color: #f9f9f9;
}

.skill-slots {
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
}
</style>