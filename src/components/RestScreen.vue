<template>
  <div class="rest-screen" :class="{'remi-present-rest-screen': gameState.isRemiPresent}">
    <div class="rest-screen-content">
      <h1 class="rest-title">{{ gameState.isRemiPresent ? '好好休息！' : '休整阶段'}}</h1>
      
      <div class="content-wrapper">
        <!-- 左侧固定大小面板容器 -->
        <div class="left-panel-container" :class="{ 'two-panels': currentStage === 'shop' }">
          <transition name="rest-screen-panels" mode="out-in">
          <!-- 金钱奖励面板 -->
          <MoneyRewardPanel
            v-if="currentStage === 'money'"
            :amount="gameState.rewards.money"
          />
          
          <!-- 突破奖励面板 -->
          <BreakthroughRewardPanel
            v-else-if="currentStage === 'breakthrough'"
          />
          
          <!-- 技能奖励面板 -->
          <SkillRewardPanel
            v-else-if="currentStage === 'skill'"
            :skills="gameState.rewards.skills"
            @close="onCloseSkillRewardPanel"
            @selected-skill-reward="onSkillRewardSelected"
          />
          
          <!-- 能力奖励面板 -->
          <AbilityRewardPanel
            v-else-if="currentStage === 'ability'"
            :abilities="gameState.rewards.abilities"
            @selected-ability-reward="onAbilityRewardSelected"
            @close="onCloseAbilityRewardPanel"
          />
          
          <!-- 商店 + 准备面板并列显示 -->
          <ShopPanel
            v-else-if="currentStage === 'shop'"
            :shop-items="gameState.shopItems"
            :game-state="gameState"
            @close="closeShopPanel"
          />
          </transition>
        </div>
        
        <!-- 右侧：玩家状态 + 常驻控制面板 -->
        <div class="right-panel-container">
          <PlayerStatusPanel :player="gameState.player" :restScreen="true"/>
          <RestControlPanel
            ref="restControl"
            :preparation-panel-visible="preparationPanelVisible"
            @toggle-preparation-panel="preparationPanelVisible = !preparationPanelVisible"
          />
        </div>

        <SkillSelectionPanel
          :is-visible="skillSelectionPanelVisible"
          :skills="this.gameState.player.cultivatedSkills"
          :skill="claimingSkill"
          @select-skill="onSkillSelected"
          @close="closeSkillSelectionPanel"
        />

        <PreparationPanel
            :is-visible="preparationPanelVisible"
            :skills="gameState.player.cultivatedSkills"
            @apply="onApplySkillOrderChanges"
            @close="preparationPanelVisible = false"
        />

      </div>
    </div>
  </div>
</template>

<script>
import ColoredText from './ColoredText.vue';
import AbilityRewardPanel from './AbilityRewardPanel.vue';
import SkillRewardPanel from './SkillRewardPanel.vue';
import SkillSelectionPanel from './SkillSelectionPanel.vue';
import ShopPanel from './ShopPanel.vue';
import PlayerStatusPanel from './PlayerStatusPanel.vue';
import MoneyRewardPanel from './MoneyRewardPanel.vue';
import BreakthroughRewardPanel from './BreakthroughRewardPanel.vue';
import PreparationPanel from './PreparationPanel.vue';
import RestControlPanel from './RestControlPanel.vue';
import frontendEventBus from "../frontendEventBus";
import backendEventBus, { EventNames } from "../backendEventBus";

export default {
  name: 'RestScreen',
  components: {
    ColoredText,
    AbilityRewardPanel,
    SkillRewardPanel,
    SkillSelectionPanel,
    ShopPanel,
    PlayerStatusPanel,
    MoneyRewardPanel,
    BreakthroughRewardPanel,
    PreparationPanel,
    RestControlPanel
  },
  props: {
    gameState: {
      type: Object,
      required: true
    }
  },
  data() {
    return {
      skillSelectionPanelVisible: false,
      preparationPanelVisible: false,
      claimingSkill: null,
    }
  },
  computed: {
    currentStage() {
      return this.gameState.restScreenStage || '';
    }
  },
  methods: {
    onCloseSkillRewardPanel() {
      // 后端控制阶段切换，此处不做处理 -> 改为发出放弃当前奖励事件
      backendEventBus.emit(EventNames.Rest.DROP_REWARD);
    },
    onCloseAbilityRewardPanel() {
      // 放弃当前能力奖励
      backendEventBus.emit(EventNames.Rest.DROP_REWARD);
    },

    onSkillRewardSelected(currentSkill) {
      // 简化后的自动升级逻辑：如果奖励技能带有 upgradedFrom，尝试替换来源技能
      if(currentSkill.isUpgradeCandidate && currentSkill.upgradedFrom) {
        const slots = this.gameState.player.cultivatedSkills;
        const sourceSlotIndex = slots.findIndex(s => s && s.name === currentSkill.upgradedFrom);
        if(sourceSlotIndex !== -1) {
          const oldSkill = slots[sourceSlotIndex];
          backendEventBus.emit(EventNames.Rest.CLAIM_SKILL, {
            skill: currentSkill,
            slotIndex: sourceSlotIndex,
            clearRewards: false
          });
          frontendEventBus.emit('pop-message', {
            id: 'skill-upgraded',
            text: `技能升级：${oldSkill.name} -> ${currentSkill.name}`
          });
          return;
        }
      }
      // 回退：未能自动升级则自动增添到末尾（若有空位）
      if(this.gameState.player.cultivatedSkills.length < this.gameState.player.maxSkills) {
        backendEventBus.emit(EventNames.Rest.CLAIM_SKILL, {
          skill: currentSkill,
          slotIndex: -1,
          clearRewards: false
        });
        return;
      }
      // 技能栏已满，弹出选择面板
      this.claimingSkill = currentSkill;
      setTimeout(() => { this.skillSelectionPanelVisible = true; }, 200);
    },
    closeSkillSelectionPanel() {
      this.skillSelectionPanelVisible = false;
    },
    onSkillSelected(slotIndex) {
      backendEventBus.emit(EventNames.Rest.CLAIM_SKILL, {
        skill: this.claimingSkill,
        slotIndex,
        clearRewards: false
      });
      this.closeSkillSelectionPanel();
    },
    onAbilityRewardSelected(ability) {
      backendEventBus.emit(EventNames.Rest.CLAIM_ABILITY, {
        ability,
        clearRewards: false
      });
    },
    closeShopPanel() {
      backendEventBus.emit(EventNames.Rest.FINISH);
    },
    onApplySkillOrderChanges(newSkills) {
      const skillIDs = newSkills.map(s => s.uniqueID);
      backendEventBus.emit(EventNames.Rest.REORDER_SKILLS, { skillIDs });
    }

  }
}
</script>

<style scoped>
.rest-screen {
  height: 100%;
  width: 100%;
  background-size: cover;
  overflow: hidden;
}

.remi-present-rest-screen {
  background-image: url('@assets/images/shop-background.png');
}

.rest-screen-content {
  margin: 0 auto;
  padding: 20px;
  max-width: 1200px;
}

.content-wrapper {
  display: flex;
  flex-direction: row;
  gap: 20px;
  justify-content: center;
  align-items: flex-start;
}

.rest-title {
  font-size: 2em;
  margin-bottom: 20px;
  color: #eef7ff;
}

.left-panel-container {
  width: 800px;
  min-height: 220px;
  position: relative;
  flex-shrink: 0;
}

.left-panel-container.two-panels {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.right-panel-container {
  width: 360px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: stretch;
  flex-shrink: 0;
}

/* 滑动进入和退出动画 */
.rest-screen-panels-enter-active, .rest-screen-panels-leave-active {
  transition: all 0.5s ease;
}

.rest-screen-panels-enter-from {
  transform: translateY(100%);
  opacity: 0;
}

.rest-screen-panels-leave-to {
  transform: translateY(-100%);
  opacity: 0;
}

.rest-screen-panels-enter-to, .rest-screen-panels-leave-from {
  transform: translateY(0);
  opacity: 1;
}


</style>