// 等阶工具函数

// 玩家等阶映射
const PLAYER_TIER_MAP = {
  '0': '见习灵御',
  '2': '普通灵御',
  '3': '中级灵御',
  '5': '高级灵御',
  '7': '准大师灵御',
  '8': '大师灵御',
  '9': '传奇灵御'
};

// 技能等阶映射
const SKILL_TIER_MAP = {
  '-1': '特殊技能',
  '0': 'D级',
  '1': 'C-级',
  '2': 'C+级',
  '3': 'B-级',
  '4': 'B级',
  '5': 'B+级',
  '6': 'A-级',
  '7': 'A级',
  '8': 'A+级',
  '9': 'S级'
};

// 玩家等阶颜色映射
const PLAYER_TIER_COLORS = {
  '0': '#999999', // 见习灵御 - 灰色
  '2': '#66CCFF', // 普通灵御 - 蓝色
  '3': '#3399FF', // 中级灵御 - 深蓝色
  '5': '#FFCC00', // 高级灵御 - 黄色
  '7': '#FF6600', // 准大师灵御 - 橙色
  '8': '#FF0000', // 大师灵御 - 红色
  '9': '#9900CC'  // 传奇灵御 - 紫色
};

// 技能等阶颜色映射
const SKILL_TIER_COLORS = {
  '-1': '#000000', // 特殊技能 - 黑色
  '0': '#999999',  // D级 - 灰色
  '1': '#66CCFF',  // C-级 - 蓝色
  '2': '#3399FF',  // C+级 - 深蓝色
  '3': '#66FF66',  // B-级 - 浅绿色
  '4': '#33CC33',  // B级 - 绿色
  '5': '#009900',  // B+级 - 深绿色
  '6': '#FFCC00',  // A-级 - 黄色
  '7': '#FF9900',  // A级 - 橙色
  '8': '#FF6600',  // A+级 - 深橙色
  '9': '#FF0000'   // S级 - 红色
};

// 商品等阶颜色映射
const ITEM_TIER_COLORS = {
  '1': '#4caf50', // 绿色
  '2': '#2196f3', // 蓝色
  '3': '#9c27b0', // 紫色
  '4': '#ff9800', // 橙色
  '5': '#f44336'  // 红色
};

// 玩家等阶样式类映射
const PLAYER_TIER_CLASSES = {
  '0': 'tier-0',
  '2': 'tier-2',
  '3': 'tier-3',
  '5': 'tier-5',
  '7': 'tier-7',
  '8': 'tier-8',
  '9': 'tier-9'
};

// 商品等阶样式类映射
const ITEM_TIER_CLASSES = {
  '1': 'item-tier-1',
  '2': 'item-tier-2',
  '3': 'item-tier-3',
  '4': 'item-tier-4',
  '5': 'item-tier-5'
};

// 根据玩家等阶获取标签
export function getPlayerTierLabel(tier) {
  return PLAYER_TIER_MAP[tier] || '';
}

// 根据技能等阶获取标签
export function getSkillTierLabel(tier) {
  return SKILL_TIER_MAP[tier] || '';
}

// 根据玩家等阶获取颜色
export function getPlayerTierColor(tier) {
  return PLAYER_TIER_COLORS[tier] || '#000000';
}

// 根据技能等阶获取颜色
export function getSkillTierColor(tier) {
  return SKILL_TIER_COLORS[tier] || '#000000';
}

// 根据商品等阶获取颜色
export function getItemTierColor(tier) {
  return ITEM_TIER_COLORS[tier] || '#000000';
}

// 根据玩家等阶获取样式类
export function getPlayerTierClass(tier) {
  return PLAYER_TIER_CLASSES[tier] || '';
}

// 根据商品等阶获取样式类
export function getItemTierClass(tier) {
  return ITEM_TIER_CLASSES[tier] || '';
}

// 根据标签获取玩家等阶
export function getPlayerTierFromLabel(label) {
  for (const [tier, tierLabel] of Object.entries(PLAYER_TIER_MAP)) {
    if (tierLabel === label) {
      return tier;
    }
  }
  return null;
}

// 根据标签获取技能等阶
export function getSkillTierFromLabel(label) {
  for (const [tier, tierLabel] of Object.entries(SKILL_TIER_MAP)) {
    if (tierLabel === label) {
      return tier;
    }
  }
  return null;
}

// 获取下一个玩家等阶
export function getNextPlayerTier(currentTier) {
  const playerTiers = ['0', '2', '3', '5', '7', '8', '9'];
  const currentIndex = playerTiers.indexOf(currentTier.toString());
  
  if (currentIndex !== -1 && currentIndex < playerTiers.length - 1) {
    return playerTiers[currentIndex + 1];
  }
  
  // 如果已经是最高等阶，返回当前等阶
  return currentTier;
}

// 检查等阶是否有效
export function isValidPlayerTier(tier) {
  return Object.keys(PLAYER_TIER_MAP).includes(tier.toString());
}

export function isValidSkillTier(tier) {
  return Object.keys(SKILL_TIER_MAP).includes(tier.toString());
}

export function isValidItemTier(tier) {
  return Object.keys(ITEM_TIER_CLASSES).includes(tier.toString());
}