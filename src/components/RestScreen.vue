<template>
  <div class="rest-screen">
    <h1>休整阶段</h1>
    
    <div class="content-wrapper">
      <!-- 奖励面板 -->
      <div v-if="currentPanel === 'rewards'" class="rewards-panel">
        <h2>战斗奖励</h2>
        <div class="reward-buttons">
          <button 
            v-if="!moneyClaimed && rewards.money > 0" 
            class="reward-button money-reward" 
            @click="claimMoney"
          >
            金钱: +{{ rewards.money }}
          </button>
          <button 
            v-if="rewards.skill" 
            class="reward-button skill-reward" 
            @click="showSkillRewards"
          >
            技能奖励
          </button>
          <button 
            v-if="rewards.ability" 
            class="reward-button ability-reward" 
            @click="showAbilityRewards"
          >
            能力奖励
          </button>
        </div>
        <button @click="showShop">结束奖励阶段</button>
      </div>
      
      <!-- 商店面板 -->
      <div v-if="currentPanel === 'shop'" class="shop-panel">
        <h2>商店</h2>
        <div class="shop-items">
          <div 
            v-for="(item, index) in shopItems" 
            :key="index" 
            class="shop-item"
          >
            <h3>{{ item.name }}</h3>
            <p>{{ item.description }}</p>
            <p>价格: {{ item.price }}金钱</p>
            <button 
              :disabled="player.money < item.price"
              @click="buyItem(item)"
            >
              购买
            </button>
          </div>
        </div>
        <button @click="endRest">离开商店</button>
      </div>
      
      <!-- 玩家状态面板 -->
      <div class="player-panel" :class="getPlayerTierClass(player.tier)">
        <h2>玩家状态</h2>
        <div class="player-stats">
          <p>❤️ 生命值: {{ player.hp }}/{{ player.maxHp }}</p>
          <p>🔮 魏启值: {{ player.mana }}/{{ player.maxMana }}</p>
          <p>⚡ 行动力: {{ player.actionPoints }}/{{ player.maxActionPoints }}</p>
          <p>⚔️ 攻击: {{ player.attack }}</p>
          <p>🔮 灵能: {{ player.magic }}</p>
          <p>🛡️ 防御: {{ player.defense }}</p>
          <p>💰 金钱: {{ player.money }}</p>
          <p>🏅 等阶: {{ getPlayerTierLabel(player.tier) }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'RestScreen',
  props: {
    player: {
      type: Object,
      required: true
    },
    rewards: {
      type: Object,
      default: () => ({})
    },
    shopItems: {
      type: Array,
      default: () => []
    }
  },
  data() {
    return {
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
    buyItem(item) {
      this.$emit('buy-item', item)
    },
    endRest() {
      this.$emit('end-rest')
    },
    // 获取玩家等阶标签
    getPlayerTierLabel(tier) {
      const tierLabels = {
        '0': '见习灵御',
        '2': '普通灵御',
        '3': '中级灵御',
        '5': '高级灵御',
        '7': '准大师灵御',
        '8': '大师灵御',
        '9': '传奇灵御'
      };
      return tierLabels[tier] || '';
    },
    // 获取玩家等阶样式类
    getPlayerTierClass(tier) {
      const tierClasses = {
        '0': 'tier-0',
        '2': 'tier-2',
        '3': 'tier-3',
        '5': 'tier-5',
        '7': 'tier-7',
        '8': 'tier-8',
        '9': 'tier-9'
      };
      return tierClasses[tier] || '';
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

.rewards-panel, .shop-panel {
  border: 1px solid #ccc;
  padding: 20px;
  margin: 20px 0;
  flex: 3;
}

.shop-items {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  margin: 20px 0;
}

.shop-item {
  border: 1px solid #eee;
  padding: 15px;
  width: 200px;
}

.player-panel {
  border: 1px solid #ccc;
  padding: 20px;
  margin: 20px 0;
  flex: 1;
  background-color: #f8f9fa;
  border-radius: 8px;
  transition: all 0.3s ease;
}

/* 等阶样式 */
.player-panel.tier-0 {
  background-color: #000000;
  color: white;
  border-color: #333333;
}

.player-panel.tier-2 {
  background-color: #4caf50;
  color: white;
  border-color: #388e3c;
}

.player-panel.tier-3 {
  background-color: #2196f3;
  color: white;
  border-color: #1976d2;
}

.player-panel.tier-5 {
  background-color: #9c27b0;
  color: white;
  border-color: #7b1fa2;
}

.player-panel.tier-7 {
  background-color: #ff9800;
  color: white;
  border-color: #f57c00;
}

.player-panel.tier-8 {
  background-color: #f44336;
  color: white;
  border-color: #d32f2f;
}

.player-panel.tier-9 {
  background-color: #ff5722;
  color: white;
  border: 2px solid #d84315;
  position: relative;
}

.player-panel.tier-9::before {
  content: "";
  position: absolute;
  top: -2px;
  left: -2px;
  right: -2px;
  bottom: -2px;
  border: 2px solid #ff9800;
  border-radius: 8px;
  z-index: -1;
}

.player-stats p {
  margin: 10px 0;
  font-weight: bold;
}

button {
  padding: 10px 15px;
  margin: 5px;
  cursor: pointer;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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