<template>
  <div class="shop-panel">
    <h2>商店</h2>
    <div class="shop-items">
      <div 
        v-for="(item, index) in shopItems" 
        :key="index" 
        class="shop-item"
        :class="getItemTierClass(item.tier)"
      >
        <h3>{{ item.name }}</h3>
        <p><ColoredText :text="item.description" /></p>
        <p :style="{ color: item.price > gameState.player.money ? 'red' : 'orange' }">💰 {{ item.price }}</p>
        <button 
          :disabled="gameState.player.money < item.price"
          @click="buyItem(item)"
        >
          购买
        </button>
      </div>
    </div>
    <button @click="endRest">离开商店</button>
  </div>
</template>

<script>
import ColoredText from './ColoredText.vue';
import { getItemTierClass } from '../utils/tierUtils.js';

export default {
  name: 'ShopPanel',
  components: {
    ColoredText
  },
  props: {
    shopItems: {
      type: Array,
      default: () => []
    },
    gameState: {
      type: Object,
      required: true
    }
  },
  methods: {
    buyItem(purchasedItem) {
      // 直接调用商品实例的purchase方法
      purchasedItem.purchase(this.gameState.player);
      
      // 更新玩家金钱
      this.gameState.player.money -= purchasedItem.price;
      
      // 添加日志
      // 注意：这里需要通过事件传递日志信息给父组件
      this.$emit('item-purchased', purchasedItem);
      
      // 重新生成商店物品
      this.$emit('refresh-shop');
    },
    endRest() {
      this.$emit('end-rest');
    },

  }
}
</script>

<style scoped>
.shop-panel {
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
  padding: 5px;
  width: 200px;
}

/* 按钮样式已移至 src/assets/common.css */

/* 商品等阶样式 */
.item-tier-1 {
  border: 1px solid #4caf50;
  background-color: #e8f5e9;
}

.item-tier-2 {
  border: 1px solid #2196f3;
  background-color: #e3f2fd;
}

.item-tier-3 {
  border: 1px solid #9c27b0;
  background-color: #f3e5f5;
}

.item-tier-4 {
  border: 1px solid #ff9800;
  background-color: #fff3e0;
}

.item-tier-5 {
  border: 2px solid #f44336;
  background-color: #ffebee;
  position: relative;
}

.item-tier-5::before {
  content: "";
  position: absolute;
  top: -2px;
  left: -2px;
  right: -2px;
  bottom: -2px;
  border: 1px solid #d32f2f;
  border-radius: 4px;
  z-index: -1;
}
</style>