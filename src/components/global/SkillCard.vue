<template>
  <div 
    class="skill-card"
    @click="onClick"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
    :style="skillCardStyle"
    ref="root"
  >
    <!-- Overlay 动画层（冷却/升级等）暂时注释，改由上层DOM/Pixi处理 -->
    <!-- <SkillCardAnimationAnchors :skill="skill" :disabled="previewMode" /> -->
    <!-- 背景 -->
    <div class="skill-card-background-paper"></div>
    <div class="skill-card-background-image" :style="skillCardImageStyle"></div>

    <div class="upgrade-badge" v-if="skill.isUpgradeCandidate">升级</div>
    <div v-if="hovered && skill.isUpgradeCandidate && skill.upgradedFrom" class="upgrade-replace-tooltip">
      将替换：{{ skill.upgradedFrom }}
    </div>

    <!-- 费用显示子组件 -->
    <SkillCosts :skill="skill" :player-mana="player ? player.mana : Infinity" />

    <div class="skill-tier">{{ getSkillTierLabel(skill.tier) }}</div>

    <div class="skill-card-panel">
      <!-- 名称/副标题子组件 -->
      <SkillMeta :skill="skill" :hovered="hovered" :background-color="skillBackgroundColor" />
      <div class="skill-description">
        <ColoredText :text="skillDescription" />
      </div>
      <!-- 卡牌特性/装填/冷却子组件 -->
      <SkillFeaturesAndUses :skill="skill" :preview-mode="previewMode" />
    </div>
  </div>
</template>

<script>
import ColoredText from './ColoredText.vue';
import { getSkillTierColor, getSkillTierLabel } from '../../utils/tierUtils.js';
import frontendEventBus from '../../frontendEventBus.js';
import SkillCosts from './skillCard/SkillCosts.vue';
import SkillFeaturesAndUses from './skillCard/SkillFeaturesAndUses.vue';
import SkillMeta from './skillCard/SkillMeta.vue';
import {adjustColorBrightness} from "../../utils/colorUtils";
// import SkillCardAnimationAnchors from './SkillCardAnimationAnchors.vue';
// import {displayGameState} from "../../data/gameState";

export default {
  name: 'SkillCard',
  components: { ColoredText, SkillCosts, SkillFeaturesAndUses: SkillFeaturesAndUses, SkillMeta },
  props: {
    skill: { type: Object, required: true },
    player: { type: Object, default: null },
    previewMode: { type: Boolean, default: false },
    canClick: { type: Boolean, default: true },
    suppressActivationAnimationOnClick: { type: Boolean, default: false },
  },
  data() {
    return { hovered: false};
  },
  computed: {
    skillDescription() {
      if (this.player && typeof this.skill?.regenerateDescription === 'function') {
        const p = (typeof this.player.getModifiedPlayer === 'function') ? this.player.getModifiedPlayer() : this.player;
        return this.skill.regenerateDescription(p);
      }
      if (typeof this.skill?.getDescription === 'function') return this.skill.getDescription();
      return this.skill?.description || '';
    },
    skillCardStyle() {
      const color = getSkillTierColor(this.skill.tier);
      return {
        backgroundColor: this.adjustColorBrightness(color, 40),
        borderColor: this.adjustColorBrightness(color, -40),
        cursor: (this.canClick) ? 'pointer' : 'not-allowed'
      };
    },
    skillBackgroundColor() {
      const color = getSkillTierColor(this.skill.tier);
      return this.adjustColorBrightness(color, 50);
    },
    skillCardImageUrl() {
      let imageName = this.skill.image;
      if (!imageName) {
        imageName = '0';
        if (this.skill.tier >= 2) imageName = '1';
        if (this.skill.tier >= 4) imageName = '2';
        if (this.skill.tier >= 6) imageName = '3';
        if (this.skill.tier >= 8) imageName = '4';
        imageName = `${this.skill.type}-${imageName}.png`;
      }
      return new URL(`../assets/cards/${imageName}`, import.meta.url).href;
    },
    skillCardImageStyle() {
      return { backgroundImage: `url(${this.skillCardImageUrl})` };
    }
  },
  methods: {
    getSkillTierLabel,
    adjustColorBrightness,
    onClick(event) {
      if (this.canClick) {
        this.$emit('skill-card-clicked', this.skill, event);
      }
    },
    onMouseEnter() {
      this.hovered = true;
      if (!this.previewMode) frontendEventBus.emit('skill-card-hover-start', this.skill);
    },
    onMouseLeave() {
      this.hovered = false;
      if (!this.previewMode) frontendEventBus.emit('skill-card-hover-end', this.skill);
    }
  }
};
</script>

<style scoped>
.skill-card {
  width: 198px;
  height: 266px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  position: relative;
  border: 3px solid #eee;
  border-radius: 5px;
}
.skill-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(0,0,0,0.15);
}

.skill-card-background-paper {
  position: absolute;
  width: 180px;
  height: 240px;
  background-color: white;
}
.skill-card-background-image {
  position: absolute;
  width: 212px;
  height: 280px;
  background-origin: content-box;
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
}

.skill-card-panel {
  position: absolute;
  width: 150px;
  padding: 15px;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  background-color: rgba(255, 255, 255, 0.8);
}
.skill-description {
  font-size: 14px;
  margin-bottom: 8px;
  text-align: center;
}

.skill-tier {
  position: absolute;
  top: 5px;
  right: 5px;
  font-weight: bold;
  font-size: 18px;
  padding: 2px 6px;
  border-radius: 4px;
  background-color: rgba(255, 255, 255, 0.8);
}
.upgrade-badge {
  position: absolute;
  top: 4px;
  left: 4px;
  background: linear-gradient(135deg, #ffcc33, #ff8800);
  color: #222;
  font-weight: bold;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 12px;
  box-shadow: 0 0 4px rgba(0,0,0,0.4);
  z-index: 2;
}

.upgrade-replace-tooltip {
  position: absolute;
  bottom: -6px;
  left: 50%;
  transform: translate(-50%, 100%);
  background: rgba(255,255,255,0.95);
  color: #222;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  box-shadow: 0 2px 6px rgba(0,0,0,0.25);
  border: 1px solid #e0e0e0;
  z-index: 10;
  pointer-events: none;
}
</style>
