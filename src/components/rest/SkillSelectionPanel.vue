<template>
  <transition name="overlay-fade">
    <div class="skill-slot-selection-overlay" v-if="isVisible">
      <transition name="panel-scale">
        <div class="skill-slot-selection-panel" v-if="isVisible">
          <h2>选择技能槽</h2>
          <div class="skill-preview">
          <SkillCard
          :skill="skill"
          :can-click="false"
          :preview-mode="true"
          /></div>
          <p class="tooltip">选择一个技能替换为新技能</p>
          <div class="skills">
            <SkillCard
              v-for="(skill, index) in skills"
              :key="index"
              :skill="skill"
              :preview-mode="true"
              @skill-card-clicked="selectSkill"
            />
          </div>
          <button @click="closePanel">取消</button>
        </div>
      </transition>
    </div>
  </transition>
</template>

<script>
import SkillCard from '../global/SkillCard.vue';

export default {
  name: 'SkillSlotSelectionPanel',
  components: {
    SkillCard
  },
  props: {
    skill: {
      type: Object,
      default: null
    },
    skills: {
      type: Array,
      required: true
    },
    isVisible: {
      type: Boolean,
      default: false
    }
  },
  methods: {
    selectSkill(skill) {
      const index = this.skills.findIndex(s => s.uniqueID === skill.uniqueID);
      this.$emit('select-skill', index);
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
  z-index: var(--z-overlay);
}

.skill-slot-selection-panel {
  padding: 20px;
  max-height: 80%;
  overflow: visible;
}

.skill-slot-selection-panel h2 {
  color: white;
}

.skill-preview {
  margin: auto;
  display: flex;
  justify-content: center;
}

.tooltip {
  color: white;
  text-align: center;
  margin-top: 10px;
}

.skills {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  margin: auto;
  max-width: 80%;
  padding: 20px;
  justify-content: center;
  overflow: scroll;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.5) transparent;
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