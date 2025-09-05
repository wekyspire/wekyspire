// 效果描述、图标和颜色定义
const effectDescriptions = {
  // 状态修正型效果
  '防御': {
    name: '防御',
    description: '提升层数点防御力。',
    icon: '🛡️',
    color: '#1E90FF' // 道奇蓝
  },
  '集中': {
    name: '集中',
    description: '提升层数点灵能。',
    icon: '🔮',
    color: '#9370DB' // 中紫色
  },
  '力量': {
    name: '力量',
    description: '提升层数点攻击力。',
    icon: '⚔️',
    color: '#FF4500' // 橙红色
  },
  '坚固': {
    name: '坚固',
    description: '提升层数点防御力。',
    icon: '🔷',
    color: '#4682B4' // 钢蓝色
  },
  
  // 回合开始时触发的效果
  '吸收': {
    name: '吸收',
    description: '回合结束时，获得层数点魏启。',
    icon: '💧',
    color: '#00BFFF' // 深天蓝
  },
  '漏气': {
    name: '漏气',
    description: '回合结束时，失去层数点魏启。',
    icon: '💨',
    color: '#808080' // 灰色
  },
  '眩晕': {
    name: '眩晕',
    description: '回合开始时，层数减1，结束回合。',
    icon: '💫',
    color: '#FFD700' // 金色
  },
  '燃烧': {
    name: '燃烧',
    description: '回合开始时，受到层数点伤害，层数减1。',
    icon: '🔥',
    color: '#FF5555' // 橙红
  },
  '聚气': {
    name: '聚气',
    description: '回合结束时，获得层数点魏启，层数清零。',
    icon: '💧',
    color: '#00BFFF' // 深天蓝
  },
  
  // 回合结束时触发的效果
  '中毒': {
    name: '中毒',
    description: '回合结束时，受到层数点真实伤害，层数减1。',
    icon: '☠️',
    color: '#228B22' // 森林绿
  },
  '再生': {
    name: '再生',
    description: '回合结束时，获得层数点生命，层数减1。',
    icon: '💚',
    color: '#32CD32' // 酸橙绿
  },
  '超然': {
    name: '超然',
    description: '回合结束时，增加层数层集中。',
    icon: '🕊️',
    color: '#DDA0DD' // 梅花色
  },
  '侵蚀': {
    name: '侵蚀',
    description: '回合结束时，减少层数层集中。',
    icon: '🕳️',
    color: '#696969' // 暗灰色
  },
  '燃心': {
    name: '燃心',
    description: '回合结束时，增加1层集中，层数减1。',
    icon: '🔥',
    color: '#FF6347' // 番茄红
  },
  '成长': {
    name: '成长',
    description: '回合结束时，增加层数层力量。',
    icon: '🌱',
    color: '#006400' // 深绿色
  },
  '衰败': {
    name: '衰败',
    description: '回合结束时，减少层数层力量。',
    icon: '🥀',
    color: '#8B0000' // 深红色
  },
  '巩固': {
    name: '巩固',
    description: '回合结束时，增加层数层坚固。',
    icon: '💎',
    color: '#4169E1' // 皇家蓝
  },
  '崩溃': {
    name: '崩溃',
    description: '回合结束时，减少层数层坚固。',
    icon: '💔',
    color: '#DC143C' // 深红
  },
  '魏宗圣体': {
    name: '魏宗圣体',
    description: '回合结束时，增加层数层集中、力量、坚固。',
    icon: '🌟',
    color: '#FFD700' // 金色
  },
  '解体': {
    name: '解体',
    description: '回合结束时，减少层数层集中、力量、坚固。',
    icon: '🧟',
    color: '#800080' // 紫色
  },
  
  // 发动技能时触发的效果
  '连发': {
    name: '连发',
    description: '发动技能后，获得1行动力，层数减1。',
    icon: '🔫',
    color: '#FF8C00' // 深橙色
  },
  
  // 发动攻击时触发的效果
  '超频': {
    name: '超频',
    description: '攻击结算后，有10%概率双倍伤害。',
    icon: '⚡',
    color: '#FFD700' // 金色
  },
  
  // 敌人受伤时触发的效果
  '灼烧': {
    name: '灼烧',
    description: '受伤后，有15%概率获得1层燃烧。',
    icon: '🔥',
    color: '#FF4500' // 橙红色
  },
  
  // 受到攻击时触发的效果
  '格挡': {
    name: '格挡',
    description: '攻击结算发生后，将伤害值减半，层数减1。',
    icon: '🛡️',
    color: '#1E90FF' // 道奇蓝
  },
  '闪避': {
    name: '闪避',
    description: '攻击结算发生后，将伤害减少到0。',
    icon: '👻',
    color: '#C0C0C0' // 银色
  },
  
  // 受到伤害时触发的效果
  '暴怒': {
    name: '暴怒',
    description: '受到伤害后，增加层数层力量。',
    icon: '💢',
    color: '#FF0000' // 红色
  },
  '执着': {
    name: '执着',
    description: '受到伤害后，增加层数层集中。',
    icon: '❤️',
    color: '#DC143C' // 深红
  },

  // 特殊效果（boss等）
  '高燃弹药': {
    name: '高燃弹药',
    description: '这些古老的弹药竟如此易燃！每次攻击后，赋予2层燃烧。',
    icon: '🔥',
    color: '#FF4500' // 橙红色
  },
  '机枪升温': {
    name: '机枪升温',
    description: '下次扫射时的次数将继续提升。',
    icon: '🔫',
    color: '#FF8C00' // 深橙色
  }
};

export default effectDescriptions;