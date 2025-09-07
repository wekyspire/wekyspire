<template>
  <div class="rest-screen">
    <h1>休整阶段</h1>
    
    <div class="content-wrapper">
      <!-- 奖励面板 -->
      <div v-if="currentPanel === 'rewards'" class="rewards-panel">
        <h2>战斗奖励</h2>
        <div class="reward-buttons">
          <button 
            v-if="!moneyClaimed && gameState.rewards.money > 0" 
            class="reward-button money-reward" 
            @click="onMoneyRewardButtonClicked"
          >
            金钱: +{{ gameState.rewards.money }}
          </button>
          <button 
            v-if="gameState.rewards.breakthrough" 
            class="reward-button breakthrough-reward" 
            @click="onBreakthroughRewardButtonClicked"
          >
            突破！
          </button>
          <button 
            v-if="gameState.rewards.skills.length > 0" 
            class="reward-button skill-reward" 
            @click="onSkillRewardButtonClicked"
          >
            新技能
          </button>
          <button 
            v-if="gameState.rewards.abilities.length > 0" 
            class="reward-button ability-reward" 
            @click="onAbilityRewardButtonClicked"
          >
            新能力
          </button>
        </div>
        <button @click="showShopPanel">继续</button>
      </div>
      
      <!-- 商店面板 -->
      <ShopPanel
        v-if="currentPanel === 'shop'"
        :shop-items="gameState.shopItems"
        :game-state="gameState"
        @item-purchased="onItemPurchased"
        @refresh-shop="$forceUpdate"
        @close="closeShopPanel"
      />
      
      <!-- 玩家状态面板 -->
      <PlayerStatusPanel :player="gameState.player" :restScreen="true"/>
    </div>
    
    <AbilityRewardPanel
      :is-visible="abilityRewardPanelVisible"
      :abilities="gameState.rewards.abilities"
      @selected-ability-reward="onAbilityRewardSelected"
      @close="closeAbilityRewardPanel"
    />
    
    <SkillRewardPanel
      :is-visible="skillRewardPanelVisible"
      :skills="gameState.rewards.skills"
      @close="closeSkillRewardPanel"
      @selected-skill-reward="onSkillRewardSelected"
    />
    
    <SkillSlotSelectionPanel
      :is-visible="skillSlotSelectionPanelVisible"
      :skill-slots="gameState.player.skillSlots"
      :skill="claimingSkill"
      @select-slot="onSkillSlotSelected"
      @close="closeSkillSlotSelectionPanel"
    />
  </div>
</template>

<script>
import ColoredText from './ColoredText.vue';
import AbilityRewardPanel from './AbilityRewardPanel.vue';
import SkillRewardPanel from './SkillRewardPanel.vue';
import SkillSlotSelectionPanel from './SkillSlotSelectionPanel.vue';
import ShopPanel from './ShopPanel.vue';
import PlayerStatusPanel from './PlayerStatusPanel.vue';
import { gameState } from '../data/gameState.js';
import { claimAbilityReward, claimMoney, claimSkillReward, endRestStage } from '../data/rest.js';
import { upgradePlayerTier } from '../data/player.js';

export default {
  name: 'RestScreen',
  components: {
    ColoredText,
    AbilityRewardPanel,
    SkillRewardPanel,
    SkillSlotSelectionPanel,
    ShopPanel,
    PlayerStatusPanel
  },
  data() {
    return {
      gameState: gameState,
      currentPanel: 'rewards', // 'rewards' or 'shop'
      moneyClaimed: false,
      skillRewardsSpawned: false,
      abilityRewardsSpawned: false,
      skillRewardPanelVisible: false,
      abilityRewardPanelVisible: false,
      skillSlotSelectionPanelVisible: false,
      claimingSkill: null
    }
  },
  methods: {
    onMoneyRewardButtonClicked() {
      claimMoney();
      this.moneyClaimed = true
    },
    onBreakthroughRewardButtonClicked() {
      gameState.rewards.breakthrough = false;
      upgradePlayerTier(gameState.player);
    },
    onSkillRewardButtonClicked() {
      this.skillRewardPanelVisible = true;
    },
    onAbilityRewardButtonClicked() {
      this.abilityRewardPanelVisible = true;
    },
    closeSkillRewardPanel() {
      this.skillRewardPanelVisible = false;
    },
    closeAbilityRewardPanel() {
      this.abilityRewardPanelVisible = false;
    },
    onSkillRewardSelected(currentSkill) {
      this.claimingSkill = currentSkill;
      // 稍等片刻后打开SkillSlotSelectionPanel，让动画放完
      setTimeout(() => {
        this.skillSlotSelectionPanelVisible = true;
      }, 300);
    },
    closeSkillSlotSelectionPanel() {
      this.skillSlotSelectionPanelVisible = false;
    },
    onSkillSlotSelected(slotIndex) {
      claimSkillReward(this.claimingSkill, slotIndex, true);
      
      // 关闭面板
      this.closeSkillSlotSelectionPanel();
      this.closeSkillRewardPanel();
    },
    onAbilityRewardSelected(ability) {
      claimAbilityReward(ability, true);
      this.closeAbilityRewardPanel();
    },
    showShopPanel() {
      this.currentPanel = 'shop'
    },
    closeShopPanel() {
      // 结束休整阶段，开始下一场战斗
      endRestStage();
    },
    buyItem(purchasedItem) {
      // 直接调用商品实例的purchase方法
      purchasedItem.purchase(this.$parent.player);
      
      // 添加日志
      this.$parent.battleLogs.push(`购买了 ${purchasedItem.name}`);
      
      // 重新生成商店物品
      this.$forceUpdate();
    },
    onItemPurchased(purchasedItem) {
      // 添加日志
      this.$parent.battleLogs.push(`购买了 ${purchasedItem.name}`);
    }

  }
}
</script>

<style scoped>
.rest-screen {
  padding: 20px;
}

.content-wrapper {
  display: flex;
  gap: 20px;
}

.rewards-panel {
  border: 1px solid #ccc;
  padding: 15px;
  border-radius: 8px;
  background-color: #fff;
  flex: 3;
}

.reward-buttons {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 20px;
}

.reward-button {
  padding: 15px;
  text-align: center;
  font-weight: bold;
  border: 2px solid #4a90e2;
  background-color: #2c3e50;
  color: white;
  border-radius: 8px;
  transition: all 0.3s ease;
}

.reward-button:hover {
  background-color: #4a90e2;
  color: white;
}

.breakthrough-reward {
  border-color: #f5a623;
  background-color: #a70a24;
}

.breakthrough-reward:hover {
  background-color: #ff2d2d;
  color: white;
}

.money-reward {
  border-color: #f5a623;
  background-color: #2c3e50;
}

.money-reward:hover {
  background-color: #f5a623;
  color: white;
}

.skill-reward {
  border-color: #7ed321;
  background-color: #138f34;
}

.skill-reward:hover {
  background-color: #7ed321;
  color: white;
}

.ability-reward {
  border-color: #bd10e0;
  background-color: #5b4791;
}

.ability-reward:hover {
  background-color: #df3fff;
  color: white;
}
</style>