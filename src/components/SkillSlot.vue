<template>
  <div 
    :class="['skill-slot', { 'empty': !skill, 'filled': skill }]"
    @click="onClick"
    @mouseenter="showPreview = true"
    @mouseleave="showPreview = false"
  >
    <div v-if="skill" class="skill-slot-content">
      <div class="skill-name">{{ skill.name }}</div>
      <div class="skill-tier">{{ getSkillTierLabelText(skill.tier) }}</div>
    </div>
    <div v-else class="empty-slot">
      空技能槽
    </div>
    
    <!-- 技能预览弹窗 -->
    <div v-if="showPreview && skill" class="skill-preview">
      <SkillCard :skill="skill" :preview-mode="true" />
    </div>
  </div>
</template>

<script>
import SkillCard from './SkillCard.vue';
import { getSkillTierLabel } from '../utils/tierUtils.js';

export default {
  name: 'SkillSlot',
  components: {
    SkillCard
  },
  props: {
    skill: {
      type: Object,
      default: null
    },
    index: {
      type: Number,
      required: true
    }
  },
  data() {
    return {
      showPreview: false
    };
  },
  methods: {
    onClick() {
      this.$emit('slot-clicked', this.index);
    },
    getSkillTierLabelText(tier) {
      return getSkillTierLabel(tier);
    }
  }
}
</script>

<style scoped>
.skill-slot {
  width: 120px;
  height: 80px;
  border: 2px dashed #ccc;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  cursor: pointer;
  transition: all 0.3s ease;
  background-color: #f9f9f9;
  position: relative; /* 添加定位上下文 */
}

.skill-slot:hover {
  border-color: #999;
  background-color: #e9e9e9;
}

.skill-slot.filled {
  border: 2px solid #4caf50;
  background-color: #e8f5e9;
}

.skill-slot-content {
  text-align: center;
}

.skill-name {
  font-weight: bold;
  font-size: 14px;
  margin-bottom: 4px;
}

.skill-tier {
  font-size: 12px;
  color: #666;
}

.empty-slot {
  color: #999;
  font-style: italic;
}

.skill-preview {
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  z-index: 950; /* 确保在技能槽选择面板上方，但在对话界面下方 */
  margin-top: 10px;
  box-shadow: 0 4px 8px rgba(0,0,0,0.15);
  border-radius: 8px;
  overflow: hidden;
}
</style>