<template>
  <div class="skill-slot-selection-overlay" v-if="isVisible">
    <div class="skill-slot-selection-panel">
      <h2>选择技能槽</h2>
      <p>选择一个技能槽来安装新技能：{{ skill ? skill.name : '无' }}</p>
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
      default: null
    },
    skillSlots: {
      type: Array,
      required: true
    },
    isVisible: {
      type: Boolean,
      default: false
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
.skill-slot-selection-overlay {
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

.skill-slot-selection-panel {
  border: 1px solid #ccc;
  padding: 20px;
  background-color: #f9f9f9;
  max-width: 80%;
  max-height: 80%;
  overflow: visible;
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