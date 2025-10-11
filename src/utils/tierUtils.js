// 等阶工具函数
import {getPlayerTierFromTierIndex} from "../data/player";

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

export const SkillTier = {
  SPECIAL: -1,
  D: 0,
  C_MINUS: 1,
  C_PLUS: 2,
  B_MINUS: 3,
  B: 4,
  B_PLUS: 5,
  A_MINUS: 6,
  A: 7,
  A_PLUS: 8,
  S: 9
};

// 能力等阶映射
const ABILITY_TIER_MAP = {
  '-1': '特殊',
  '1': '平庸',
  '2': '优良',
  '3': '上佳',
  '4': '极品',
  '5': '传奇'
};

// 商品等阶映射
const ITEM_TIER_MAP = {
  '1': '普通',
  '2': '精良',
  '3': '稀有',
  '4': '史诗',
  '5': '传说'
};


// 玩家等阶颜色映射
const PLAYER_TIER_PALLETE = {
  '0': {major: '#333333', background: '#DDDDDD', text: '#000000'}, // 旅人 - 黑色 + 灰色
  '1': {major: '#008000', background: '#90EE90', text: '#000000'}, // 见习灵御 - 绿色 + 淡绿色
  '2': {major: '#00FFFF', background: '#E0FFFF', text: '#000000'}, // 普通灵御 - 青色 + 浅青色
  '3': {major: '#00008B', background: '#ADD8E6', text: '#000000'}, // 中级灵御 - 深蓝色 + 浅蓝色
  '4': {major: '#700090', background: '#cfbfd8', text: '#000000'}, // 资深灵御 - 紫色 + 淡紫色
  '5': {major: '#A00050', background: '#d8bfcc', text: '#000000'}, // 高级灵御 - 嫣红色 + 淡紫色
  '6': {major: '#FFA500', background: '#FFFFFF', text: '#000000'},  // 准大师灵御 - 橙色
  '7': {major: '#FF8800', background: '#FFE5A0', text: '#000000'}, // 大师灵御 - 橙色 + 金色
  '8': {major: '#FF0000', background: '#FFC0A0', text: '#000000'}, // 一代宗师 - 红色 + 橙红色
  '9': {major: '#CCCCCC', background: '#000000', text: '#FFFFFF'} // 传奇 - 深红色 + 红色 （白字）
};

// 技能等阶颜色映射
const SKILL_TIER_COLORS = {
  '-1': '#000000', // 特殊技能 - 黑色
  '0': '#999999',  // D级 - 灰色
  '1': '#66FF66',  // C-级 - 浅绿色
  '2': '#009900',  // C+级 - 绿色
  '3': '#66CCFF',  // B-级 - 蓝色
  '4': '#3399FF',  // B级 - 深蓝色
  '5': '#8855EE',  // B+级 - 紫色
  '6': '#663399',  // A-级 - 深紫色
  '7': '#FFCC00',  // A 级 - 黄色
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

// 能力等阶颜色映射
const ABILITY_TIER_COLORS = {
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
  return getPlayerTierFromTierIndex(tier).name || '';
}

// 根据技能等阶获取标签
export function getSkillTierLabel(tier) {
  return SKILL_TIER_MAP[tier] || '';
}

// 根据能力等阶获取标签
export function getAbilityTierLabel(tier) {
  return ABILITY_TIER_MAP[tier] || '';
}

// 根据商品等阶获取标签
export function getItemTierLabel(tier) {
  return ITEM_TIER_MAP[tier] || '';
}

// 根据玩家等阶获取颜色
export function getPlayerTierColor(tier) {
  return PLAYER_TIER_PALLETE[tier].major || '#000000';
}

export function getPlayerTierPallete(tier) {
  return PLAYER_TIER_PALLETE[tier] || {major: '#000000', minor: '#000000', background: '#DDDDDD'};
}

// 根据技能等阶获取颜色
export function getSkillTierColor(tier) {
  return SKILL_TIER_COLORS[tier] || '#000000';
}

// 根据能力等阶获取颜色
export function getAbilityTierColor(tier) {
  return ABILITY_TIER_COLORS[tier] || '';
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