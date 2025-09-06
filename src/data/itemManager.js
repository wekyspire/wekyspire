import { RestoreHealth, RestoreMana, SkillSlot } from './item.js';

// 商品管理器类
class ItemManager {
  constructor() {
    this.items = [];
    // 初始化时注册预定义商品
    this.registerItem(RestoreHealth);
    this.registerItem(RestoreMana);
    this.registerItem(SkillSlot);
    this.isItemsInitialized = false;
  }
  
  // 注册商品
  registerItem(ItemClass) {
    const item = new ItemClass();
    this.items.push({
      name: item.name, ItemClass, price: item.price, tier: item.tier,
      spawnWeight: item.spawnWeight, alwaysPresent: item.alwaysPresent, stock: item.stock
    });
  }
  
  // 获取所有商品
  getAllItems() {
    return this.items;
  }
  
  // 创建商品实例
  createItem(itemName) {
    const item = this.items.find(i => i.name === itemName);
    if (item) {
      return new item.ItemClass();
    }
    throw new Error(`Unknown item: ${itemName}`);
  }
  
  // 根据玩家等阶和权重随机获取商品实例
  getRandomItems(count = 3, playerTier = 0) {
    // 过滤出有库存的商品
    const availableItems = this.items
      .filter(item => item.stock !== 0)
      .map(item => ({
        name: item.name,
        price: item.price,
        tier: item.tier,
        spawnWeight: item.spawnWeight,
        alwaysPresent: item.alwaysPresent || false,
        stock: item.stock
      }));
    
    // 如果没有可用商品，返回空数组
    if (availableItems.length === 0) {
      return [];
    }
    
    // 先添加所有常驻商品
    const alwaysPresentItems = availableItems
      .filter(item => item.alwaysPresent)
      .map(item => this.createItem(item.name));
    
    // 确定需要选择的随机商品数量
    const remainingCount = Math.max(0, count - alwaysPresentItems.length);
    
    // 过滤出非常驻商品用于随机选择
    const randomItemsPool = availableItems.filter(item => !item.alwaysPresent);
    
    // 根据spawnWeight计算每个非常驻商品的权重
    const weightedItems = randomItemsPool.map(item => {
      // 权重计算公式：spawnWeight * modifyFactor
      // modifyFactor基于商品等阶和玩家等阶差计算
      const tierDifference = playerTier - item.tier;
      let modifyFactor = 1.0;
      
      if (tierDifference <= 1) {
        modifyFactor = 1.0;
      } else if (tierDifference === 2) {
        modifyFactor = 1.2;
      } else if (tierDifference === 3) {
        modifyFactor = 1.5;
      } else if (tierDifference === 4) {
        modifyFactor = 2.0;
      } else {
        modifyFactor = 2.5;
      }
      
      const weight = item.spawnWeight * modifyFactor;
      return { ...item, weight };
    });
    
    // 根据权重随机选择商品
    const selected = [...alwaysPresentItems]; // 先添加常驻商品
    let availableWeightedItems = weightedItems;
    const maxEntries = Math.min(remainingCount, availableWeightedItems.length);
    
    for (let i = 0; i < maxEntries; i++) {
      // 计算总权重
      const totalWeight = availableWeightedItems.reduce((sum, item) => sum + item.weight, 0);
      
      // 生成随机数
      let random = Math.random() * totalWeight;
      
      // 根据随机数选择商品
      let selectedIndex = 0;
      for (let j = 0; j < availableWeightedItems.length; j++) {
        random -= availableWeightedItems[j].weight;
        if (random <= 0) {
          selectedIndex = j;
          break;
        }
      }
      
      // 添加选中的商品
      const selectedItem = this.createItem(availableWeightedItems[selectedIndex].name);
      selected.push(selectedItem);
      
      // 从可选列表中移除已选的商品
      availableWeightedItems.splice(selectedIndex, 1);
    }
    
    // 如果选择的商品数量超过请求数量，截取前count个
    return selected.slice(0, count);
  }
}

export default ItemManager;