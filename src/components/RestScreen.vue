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
            @click="claimMoney"
          >
            金钱: +{{ gameState.rewards.money }}
          </button>
          <button 
            v-if="gameState.rewards.skill" 
            class="reward-button skill-reward" 
            @click="showSkillRewards"
          >
            技能奖励
          </button>
          <button 
            v-if="gameState.rewards.ability" 
            class="reward-button ability-reward" 
            @click="showAbilityRewards"
          >
            {{abilityRewardButtonName()}}
          </button>
        </div>
        <button @click="showShop">结束奖励阶段</button>
      </div>
      
      <!-- 商店面板 -->
    <ShopPanel
      v-if="currentPanel === 'shop'"
      :shop-items="shopItems"
      :game-state="gameState"
      @item-purchased="onItemPurchased"
      @refresh-shop="$forceUpdate"
      @end-rest="endRest"
    />
      
      <!-- 玩家状态面板 -->
      <PlayerStatusPanel :player="gameState.player" />
    </div>
    
    <AbilityRewardPanel
      :is-visible="gameState.isAbilityRewardVisible"
      :abilities="gameState.abilityRewards"
      @select-ability="$emit('select-ability', $event)"
      @close="$emit('close-ability-rewards')"
    />
    
    <SkillRewardPanel
      :is-visible="gameState.isSkillRewardVisible"
      :skills="gameState.skillRewards"
      @select-skill="$emit('select-skill', $event)"
      @close="$emit('close-skill-rewards')"
    />
    
    <SkillSlotSelectionPanel
      :is-visible="gameState.isSkillSlotSelectionVisible"
      :skill="gameState.selectedSkillForSlot"
      :skill-slots="gameState.player.skillSlots"
      @select-slot="$emit('select-slot', $event)"
      @close="$emit('close-skill-slot-selection')"
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
import { getPlayerTierLabel, getPlayerTierClass, getItemTierClass } from '../utils/tierUtils.js';

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
      moneyClaimed: false
    }
  },
  methods: {
    claimMoney() {
      this.$emit('claim-money')
      this.moneyClaimed = true
    },
    showSkillRewards() {
      this.$emit('show-skill-rewards')
    },
    showAbilityRewards() {
      this.$emit('show-ability-rewards')
    },
    showShop() {
      this.currentPanel = 'shop'
    },
    abilityRewardButtonName () {
      if(this.gameState.enemy && this.gameState.enemy.isBoss) return "突破！";
      return "能力奖励";
    },
    buyItem(purchasedItem) {
      // 直接调用商品实例的purchase方法
      purchasedItem.purchase(this.$parent.player);
      
      // 更新玩家金钱
      this.$parent.player.money -= purchasedItem.price;
      
      // 添加日志
      this.$parent.battleLogs.push(`购买了 ${purchasedItem.name}`);
      
      // 重新生成商店物品
      this.$forceUpdate();
    },
    onItemPurchased(purchasedItem) {
      // 添加日志
      this.$parent.battleLogs.push(`购买了 ${purchasedItem.name}`);
    },
    endRest() {
      this.$emit('end-rest')
    },

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
  padding: 20px;
  margin: 20px 0;
  flex: 3;
}



/* 按钮样式已移至 src/assets/common.css */


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
  background-color: #2c3e50;
}

.skill-reward:hover {
  background-color: #7ed321;
  color: white;
}

.ability-reward {
  border-color: #bd10e0;
  background-color: #2c3e50;
}

.ability-reward:hover {
  background-color: #bd10e0;
  color: white;
}
</style>