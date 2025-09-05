<template>
  <div 
    :class="['skill-card', 'tier-' + skill.tier, { disabled: disabled }]"
    @click="onClick"
  >
    <div class="mana-cost" v-if="skill.manaCost > 0">
      <span class="mana-icon">🔮</span>
      <span class="mana-value" :class="{ 'insufficient-mana': playerMana < skill.manaCost }">{{ skill.manaCost }}</span>
    </div>
    <div class="skill-tier">{{ getTierLabel(skill.tier) }}</div>
    <div class="skill-name">{{ skill.name }}</div>
    <div class="skill-description">
      <ColoredText :text="skill.description" />
    </div>
    <div class="skill-uses">
      <ColoredText v-if="skill.coldDownTurns != 0 && skill.remainingUses != skill.maxUses && !previewMode" :text="`/named{重整} ${skill.remainingColdDownTurns}/${skill.coldDownTurns}`"></ColoredText>
      <ColoredText v-else-if="skill.coldDownTurns != 0" :text="`/named{重整} ${skill.coldDownTurns} 回合`"></ColoredText>
      <ColoredText v-else-if="skill.remainingUses != Infinity" :text="`/named{消耗}`"></ColoredText>
      <br />
      <strong v-if="skill.maxUses === Infinity">无限</strong>
      <span v-else-if="previewMode">(装填 {{ skill.maxUses }}/{{ skill.maxUses }})</span>
      <span v-else>(装填 {{ skill.remainingUses }}/{{ skill.maxUses }})</span>
    </div>
  </div>
</template>

<script>
import ColoredText from './ColoredText.vue';

export default {
  name: 'SkillCard',
  components: {
    ColoredText
  },
  props: {
    skill: {
      type: Object,
      required: true
    },
    disabled: {
      type: Boolean,
      default: false
    },
    playerMana: {
      type: Number,
      default: Infinity
    },
    previewMode: {
      type: Boolean,
      default: false
    }
  },
  methods: {
    onClick() {
      if (!this.disabled) {
        this.$emit('skill-card-clicked', this.skill);
      }
    },
    getTierLabel(tier) {
      const tierLabels = {
        '-1': 'S',
        '0': 'D',
        '1': 'C-',
        '2': 'C+',
        '3': 'B-',
        '4': 'B',
        '5': 'B+',
        '6': 'A-',
        '7': 'A',
        '8': 'A+',
        '9': 'S'
      };
      return tierLabels[tier] || '';
    }
  }
}
</script>

<style scoped>
.skill-card {
  width: 150px;
  min-height: 100px;
  padding: 15px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  transition: all 0.3s ease;
  position: relative;
  background-color: white;
  border: 1px solid #eee;
}

.skill-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(0,0,0,0.15);
}

.skill-card.disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.skill-name {
  font-weight: bold;
  font-size: 16px;
  margin-bottom: 8px;
}

.skill-description {
  font-size: 14px;
  margin-bottom: 8px;
  text-align: center;
}

.skill-uses {
  font-size: 12px;
  color: #666;
}

.skill-tier {
  position: absolute;
  top: 5px;
  right: 5px;
  font-weight: bold;
  font-size: 18px;
  z-index: 2;
  padding: 2px 6px;
  border-radius: 4px;
  background-color: rgba(255, 255, 255, 0.8);
}

.mana-cost {
  position: absolute;
  top: 5px;
  left: 5px;
  display: flex;
  align-items: center;
  z-index: 2;
  background-color: rgba(255, 255, 255, 0.8);
  padding: 2px 6px;
  border-radius: 4px;
}

.mana-icon {
  font-size: 16px;
  margin-right: 4px;
}

.mana-value {
  font-weight: bold;
  color: #2196f3;
  font-size: 16px;
}

.mana-value.insufficient-mana {
  color: #f44336;
}

/* 不同等阶的技能卡片样式 */
/* D */
.skill-card.tier-0 { 
  background-color: #ffffff;
  border: 1px solid #000000;
}
/* C- */
.skill-card.tier-1 {
  background-color: #ffffff;
  border: 1px solid #41db39;
}

/* C+ */
.skill-card.tier-2 {
  background-color: #daffbc;
  border: 1px solid #41db39;
}

/* B- */
.skill-card.tier-3 {
  background-color: #ffffff;
  border: 1px solid #759eff;
}

/* B */
.skill-card.tier-4 {
  background-color: #bfebff;
  border: 1px solid #759eff;
}

/* B+ */
.skill-card.tier-5 {
  background-color: #ffffff;
  border: 1px solid #d072ff;
}


/* A- */
.skill-card.tier-6 {
  background-color: #f4daff;
  border: 1px solid #d072ff;
}

/* A */
.skill-card.tier-7 {
  background-color: #ffffff;
  border: 1px solid #ff9059;
}

/* A+ */
.skill-card.tier-8 {
  background-color: #ffe4d0;
  border: 1px solid #ff9059;
}

/* S */
.skill-card.tier-9 {
  background-color: #ffc0c0;
  border: 1px solid #ff0000;
}
</style>