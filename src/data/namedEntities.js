// 命名实体数据
const namedEntities = {
  '魏启': {
    icon: '💧',
    color: 'purple',
    description: '魏启是这个世界的基础能量，驱动着所有灵能技艺的施展。'
  },
  '生命': {
    icon: '❤️',
    color: 'red',
    description: '生命值代表角色的健康状况，归零时角色将被击败。'
  },
  '攻击': {
    icon: '⚔️',
    color: 'orange',
    description: '攻击力影响物理攻击技能造成的伤害。'
  },
  '灵能': {
    icon: '🔮',
    color: 'purple',
    description: '灵能值影响灵能技能的效果。'
  },
  '防御': {
    icon: '🛡️',
    color: 'blue',
    description: '防御力可以减少受到的伤害。'
  },
  '金钱': {
    icon: '💰',
    color: 'gold',
    description: '金钱是游戏中的通用货币，用于购买商品和升级。'
  },
  '等阶': {
    icon: '🏅',
    color: 'yellow',
    description: '等阶代表灵御的实力等级，影响可使用的技能。'
  },
  '重整': {
    icon: '🔄',
    color: 'green',
    description: '此技能需要在回合结束进行冷却。'
  },
  '消耗': {
    icon: '🔧',
    color: 'red',
    description: '此技能在战斗中不会自动冷却。'
  },
  '冷却': {
    icon: '⏳',
    color: 'aqua',
    description: '让技能重整进度条推进一次。'
  },
  '最近': {
    icon: '📍',
    color: 'brown',
    description: '往左走或往右走距离最近的技能。如果距离一样，优先选择左侧。'
  },
  '灵御': {
    icon: '🌟',
    color: 'gold',
    description: '灵御是强大的修行者，能掌控魏启之力作战。'
  },
  '技能': {
    icon: '🔮',
    color: 'purple',
    description: '技能是灵御的武器，能施展各种强大的攻击和防御。'
  },
  '突破': {
    icon: '🌟',
    color: 'gold',
    description: '提升灵御等阶，获得行动力、魏启容量，并恢复状态。'
  },
  '行动力': {
    icon: '⚡',
    color: 'gold',
    description: '行动力支付在战斗中使用技能的开销。'
  },
  '强化': {
    icon: '🆙',
    color: 'blue',
    description: '提升技能等级，让其变得更强。'
  },
  '左邻': {
    icon: '⬅️',
    color: 'orange',
    description: '左邻是当前技能的左侧技能。'
  },
  '右邻': {
    icon: '➡️',
    color: 'orange',
    description: '右邻是当前技能的右侧技能。'
  },
  '前方': {
    icon: '⬆️',
    color: 'orange',
    description: '前方是当前技能左侧技能集。'
  },
  '后方': {
    icon: '⬇️',
    color: 'orange',
    description: '后方是当前技能右侧技能集。'
  },
  '前端': {
    icon: '🔝',
    color: 'orange',
    description: '前端是目前可见的技能集。'
  },
  '后端': {
    icon: '🔚',
    color: 'orange',
    description: '后端是目前不可见但你拥有的技能集。'
  },
  '相邻': {
    icon: '🔗',
    color: 'orange',
    description: '相邻是当前技能的左侧和右侧技能。'
  },
  '护盾': {
    icon: '🛡️',
    color: 'blue',
    description: '护盾优先抵消伤害，回合开始时消失。'
  },
  '焚毁': {
    icon: '🔥',
    color: 'red',
    description: '焚毁会从一场战斗中永久移除一个技能。'
  },
  '慢热': {
    icon: '🐢',
    color: 'green',
    description: '慢热技能在战斗开始时没有充能，需要冷却后才能使用。'
  },
  '咏唱': {
    icon: '🎵',
    color: 'purple',
    description: '咏唱技能是仅能在咏唱槽上持续发动的技能，咏唱时生效，需持续占用咏唱槽。'
  },
  '光滑': {
    icon: '✨',
    color: 'aqua',
    description: '光滑技能在回合结束时，如在手牌中，弃入牌库。'
  }
};

export default namedEntities;