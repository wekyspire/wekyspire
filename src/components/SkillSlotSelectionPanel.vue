<template>
  <transition name="overlay-fade">
    <div class="skill-slot-selection-overlay" v-if="isVisible">
      <transition name="panel-scale">
        <div class="skill-slot-selection-panel" v-if="isVisible">
          <h2>选择技能槽</h2>
          <SkillCard
          :skill="skill"
          :preview-mode="true"
          />
          <p>选择一个技能槽来安装新技能</p>
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
      </transition>
    </div>
  </transition>
</template>

<script>
import SkillSlot from './SkillSlot.vue';
import SkillCard from './SkillCard.vue';

export default {
  name: 'SkillSlotSelectionPanel',
  components: {
    SkillSlot,
    SkillCard
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
      this.$emit('select-slot', index);
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

/* 覆盖层淡入淡出动画 */
.overlay-fade-enter-active, .overlay-fade-leave-active {
  transition: opacity 0.3s;
}

.overlay-fade-enter-from, .overlay-fade-leave-to {
  opacity: 0;
}

.overlay-fade-enter-to, .overlay-fade-leave-from {
  opacity: 1;
}

/* 面板缩放动画 */
.panel-scale-enter-active, .panel-scale-leave-active {
  transition: transform 0.3s;
}

.panel-scale-enter-from, .panel-scale-leave-to {
  transform: scale(0.9);
}

.panel-scale-enter-to, .panel-scale-leave-from {
  transform: scale(1);
}
</style>