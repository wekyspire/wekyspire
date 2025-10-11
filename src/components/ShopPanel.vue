<template>
  <div class="shop-panel" key="panel">
    <h2>商店</h2>
    <div class="shop-items">
      <div 
        v-for="item in shopItems"
        :key="item.uniqueID"
        class="shop-item"
        :class="'tier-' + item.tier"
      >
        <div class="shop-item-tier">{{ getItemTierLabel(item.tier) }}</div>
        <div class="shop-item-name">{{ item.name }}</div>
        <div class="shop-item-description">
          <ColoredText :text="item.description" />
        </div>
        <div class="shop-item-price" :style="{ color: item.price > gameState.player.money ? 'red' : 'orange' }">💰 {{ item.price }}</div>
        <button 
          :disabled="gameState.player.money < item.price"
          @click="onBuy(item)"
          class="buy-button"
        >
          购买
        </button>
      </div>
    </div>
    <button @click="$emit('close')">离开</button>
  </div>
</template>

<script>
import ColoredText from './ColoredText.vue';
import { getItemTierLabel } from '../utils/tierUtils.js';
import backendEventBus, { EventNames } from '../backendEventBus.js';

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
    getItemTierLabel(tier) {
       return getItemTierLabel(tier);
     },
    onBuy(purchasedItem) {
      // 交由后端事件驱动处理
      backendEventBus.emit(EventNames.PlayerOperations.PURCHASE_ITEM, { item: purchasedItem });
      // 购买结果与刷新由后端通过事件通知（ITEM_PURCHASED + SHOP_REFRESHED）
    }
  }
}
</script>

<style scoped>
.shop-panel {
  border: 1px solid #9e9e9e; /* 灰色边框 */
  padding: 20px;
  background: linear-gradient(135deg, #fafafa, #eeeeee); /* 灰色渐变背景 */
  max-width: 80%;
  margin: 20px auto;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
  border-radius: 8px;
}

.shop-panel h2 {
  text-align: center;
  margin-bottom: 20px;
  color: #616161; /* 深灰色文字 */
}

.shop-items {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  margin: 20px 0;
  justify-content: center;
}

.shop-item {
  border: 1px solid #eee;
  padding: 15px;
  width: 200px;
  background-color: white;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  transition: transform 0.2s, box-shadow 0.2s;
  position: relative;
  cursor: pointer;
}

.shop-item:hover {
  transform: translateY(-5px);
  box-shadow: 0 4px 8px rgba(0,0,0,0.15);
}

.shop-item-tier {
  position: absolute;
  top: 5px;
  right: 5px;
  font-weight: bold;
  font-size: 14px;
  z-index: 2;
  padding: 2px 6px;
  border-radius: 4px;
  background-color: rgba(255, 255, 255, 0.8);
  box-shadow: 0 1px 2px rgba(0,0,0,0.1);
}

/* 不同等阶的商品样式 */
.shop-item.tier-1 {
  background-color: #e8f5e9; /* 绿色 */
  border: 1px solid #4caf50;
}

.shop-item.tier-2 {
  background-color: #e3f2fd; /* 蓝色 */
  border: 1px solid #2196f3;
}

.shop-item.tier-3 {
  background-color: #f3e5f5; /* 紫色 */
  border: 1px solid #9c27b0;
}

.shop-item.tier-4 {
  background-color: #fff3e0; /* 黄色 */
  border: 1px solid #ff9800;
}

.shop-item.tier-5 {
  background-color: #ffebee; /* 红色 */
  border: 1px solid #f44336;
}

/* 商品名称样式 */
.shop-item-name {
  font-weight: bold;
  font-size: 1.2em;
  margin-bottom: 10px;
  color: #333;
  text-align: center;
}

/* 商品描述样式 */
.shop-item-description {
  color: #666;
  margin-bottom: 15px;
  min-height: 60px;
}

/* 商品价格样式 */
.shop-item-price {
  font-weight: bold;
  color: #333;
  margin-bottom: 15px;
  text-align: center;
  font-size: 1.1em;
}

.shop-item-name {
  font-weight: bold;
  font-size: 1.2em;
  margin-bottom: 10px;
  color: #333;
}

.shop-item-description {
  color: #666;
}

.shop-item-price {
  font-weight: bold;
  color: #333;
  margin-top: 10px;
}

.buy-button {
  padding: 10px 15px;
  margin: 5px;
  cursor: pointer;
  background-color: #4caf50; /* 绿色按钮 */
  color: white;
  border: none;
  border-radius: 4px;
  width: 100%;
  font-weight: bold;
  transition: background-color 0.2s;
}

.buy-button:hover:not(:disabled) {
  background-color: #45a049; /* 深绿色 */
}

.buy-button:disabled {
  background-color: #cccccc; /* 灰色 */
  cursor: not-allowed;
}

button {
  padding: 10px 15px;
  margin: 5px;
  cursor: pointer;
  background-color: #9e9e9e; /* 灰色按钮 */
  color: white;
  border: none;
  border-radius: 4px;
}

button:hover {
  background-color: #616161; /* 深灰色 */
}
</style>