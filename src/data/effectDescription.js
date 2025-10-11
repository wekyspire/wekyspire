// 效果描述、图标和颜色定义
const effectDescriptions = {
  // 状态修正型效果
  '集中': {
    name: '集中',
    description: '提升层数点灵能',
    type: 'buff',
    icon: '🔮',
    color: '#9370DB' // 中紫色
  },
  '力量': {
    name: '力量',
    description: '造成伤害时，提升层数点伤害',
    type: 'buff',
    icon: '⚔️',
    color: '#FF4500' // 橙红色
  },
  '坚固': {
    name: '坚固',
    description: '提升层数点防御',
    type: 'buff',
    icon: '🔷',
    color: '#4682B4' // 钢蓝色
  },
  '易伤': {
    name: '易伤',
    description: '受到150%伤害，回合结束时，层数减1',
    type: 'debuff',
    icon: '💥',
    color: '#FF4500' // 橙红色
  },
  '虚弱': {
    name: '虚弱',
    description: '造成50%伤害，回合结束时，层数减1',
    type: 'debuff',
    icon: '🩶'
  },
  '火焰抗性': {
    name: '火焰抗性',
    description: '减少层数点受到的燃烧伤害',
    type: 'buff',
    icon: '🔥',
    color: '#FF8C00' // 深橙色
  },
  '火焰主宰': {
    name: '火焰主宰',
    description: '每3层燃烧提供1点灵能',
    type: 'buff',
    icon: '🔥',
    color: '#FF4500' // 橙红色
  },

  // 回合开始时触发的效果
  '泉涌': {
    name: '泉涌',
    description: '回合结束时，获得层数点魏启',
    type: 'buff',
    icon: '💧',
    color: '#00BFFF' // 深天蓝
  },
  '泄露': {
    name: '泄露',
    description: '回合结束时，失去层数点魏启',
    type: 'debuff',
    icon: '💨',
    color: '#808080' // 灰色
  },
  '吸热': {
    name: '吸热',
    description: '回合开始时，减少层数层燃烧',
    type: 'buff',
    icon: '❄️',
    color: '#1E90FF' // 道奇蓝
  },
  '燃烧': {
    name: '燃烧',
    description: '回合开始时，受到层数点伤害，层数减1',
    type: 'debuff',
    icon: '🔥',
    color: '#FF5555' // 橙红
  },
  '聚气': {
    name: '聚气',
    description: '回合结束时，获得层数点魏启，层数清零',
    type: 'buff',
    icon: '💧',
    color: '#00BFFF' // 深天蓝
  },
  '肌肉记忆': {
    name: '肌肉记忆',
    description: '回合开始时，额外冷却所有技能，层数减1',
    type: 'buff',
    icon: '🧠',
    color: '#8A2BE2' // 蓝紫色
  },
  '飞行': {
    name: '飞行',
    description: '回合开始时，获得闪避，受伤则层数减1',
    type: 'buff',
    icon: '🕊️',
    color: '#DDA0DD' // 梅花色
  },
  '眩晕': {
    name: '眩晕',
    description: '回合开始时，层数减1，结束回合',
    type: 'debuff',
    icon: '💫',
    color: '#FFD700' // 金色
  },

  // 回合结束时触发的效果
  '中毒': {
    name: '中毒',
    description: '回合结束时，受到层数点真实伤害，层数减1',
    type: 'debuff',
    icon: '☠️',
    color: '#228B22' // 森林绿
  },
  '再生': {
    name: '再生',
    description: '回合结束时，获得层数点生命，层数减1',
    type: 'buff',
    icon: '💚',
    color: '#32CD32' // 酸橙绿
  },
  '超然': {
    name: '超然',
    description: '回合结束时，增加层数层集中',
    type: 'buff',
    icon: '🕊️',
    color: '#DDA0DD' // 梅花色
  },
  '侵蚀': {
    name: '侵蚀',
    description: '回合结束时，减少层数层集中',
    type: 'debuff',
    icon: '🕳️',
    color: '#696969' // 暗灰色
  },
  '燃心': {
    name: '燃心',
    description: '回合结束时，增加3x层数层集中和8x层数层燃烧',
    type: 'neutral',
    icon: '🔥',
    color: '#FF6347' // 番茄红
  },
  '成长': {
    name: '成长',
    description: '回合结束时，增加层数层力量',
    type: 'buff',
    icon: '🌱',
    color: '#006400' // 深绿色
  },
  '衰败': {
    name: '衰败',
    description: '回合结束时，减少层数层力量',
    type: 'debuff',
    icon: '🥀',
    color: '#8B0000' // 深红色
  },
  '巩固': {
    name: '巩固',
    description: '回合结束时，增加层数层坚固',
    type: 'buff',
    icon: '💎',
    color: '#4169E1' // 皇家蓝
  },
  '崩溃': {
    name: '崩溃',
    description: '回合结束时，减少层数层坚固',
    type: 'debuff',
    icon: '💔',
    color: '#DC143C' // 深红
  },
  '魏宗圣体': {
    name: '魏宗圣体',
    description: '回合结束时，增加层数层集中、力量、坚固',
    type: 'buff',
    icon: '🌟',
    color: '#FFD700' // 金色
  },
  '解体': {
    name: '解体',
    description: '回合结束时，减少层数层集中、力量、坚固',
    type: 'debuff',
    icon: '🧟',
    color: '#800080' // 紫色
  },
  '不灭': {
    name: '不灭',
    description: '不会死亡。回合结束时，层数减1',
    type: 'buff',
    icon: '♾️',
    color: '#FF8C00' // 深橙色
  },
  '禁忌': {
    name: '禁忌',
    description: '层数达0时，死亡。回合结束时，层数减1',
    type: 'debuff',
    icon: '☠️',
    color: '#c36cff' // 靛青色
  },
  '滞气': {
    name: '滞气',
    description: '无法抽牌，回合结束时，层数减1',
    type: 'debuff',
    icon: '🌀',
    color: '#708090' // 石板灰
  },
  
  // 发动技能时触发的效果
  '连发': {
    name: '连发',
    description: '发动技能后，获得1行动力，层数减1',
    type: 'buff',
    icon: '🔫',
    color: '#FF8C00' // 深橙色
  },
  
  // 发动攻击时触发的效果
  '超频': {
    name: '超频',
    description: '攻击结算后，有10%概率双倍伤害',
    type: 'buff',
    icon: '⚡',
    color: '#FFD700' // 金色
  },
  
  // 受伤时触发的效果
  '灼烧': {
    name: '灼烧',
    description: '受伤后，有50%概率获得1层燃烧',
    type: 'debuff',
    icon: '🔥',
    color: '#FF4500' // 橙红色
  },
  
  // 受到攻击时触发的效果
  '格挡': {
    name: '格挡',
    description: '攻击结算发生后，将伤害值减半，层数减1',
    type: 'buff',
    icon: '🛡️',
    color: '#1E90FF' // 道奇蓝
  },
  '闪避': {
    name: '闪避',
    description: '攻击结算发生后，将伤害减少到0',
    type: 'buff',
    icon: '👻',
    color: '#6e6e6e' // 银色
  },
  
  // 受到伤害时触发的效果
  '暴怒': {
    name: '暴怒',
    description: '受到伤害后，增加层数层力量',
    type: 'buff',
    icon: '💢',
    color: '#FF0000' // 红色
  },
  '执着': {
    name: '执着',
    description: '受到伤害后，增加层数层集中',
    type: 'buff',
    icon: '❤️',
    color: '#DC143C' // 深红
  },

  // 特殊效果（boss等）
  '高燃弹药': {
    name: '高燃弹药',
    description: '攻击造成伤害则赋予2层燃烧',
    type: 'buff',
    icon: '🔥',
    color: '#FF4500' // 橙红色
  },
  '机枪升温': {
    name: '机枪升温',
    description: '下次扫射时的次数将继续提升',
    type: 'buff',
    icon: '🔫',
    color: '#FF8C00' // 深橙色
  },
  '警戒': {
    name: '警戒',
    description: '回合开始时，不失去护盾，层数减1',
    type: 'buff',
    icon: '👀',
    color: '#808080' // 灰色
  },
  '神焰': {
    name: '神焰',
    description: '每两层燃烧提供一点灵能',
    type: 'buff',
    icon: '🔥',
    color: '#FF0000'
  }
};

export default effectDescriptions;