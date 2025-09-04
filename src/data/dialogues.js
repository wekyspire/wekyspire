// dialogues.js - 对话事件管理

// 开场对话序列
const openingDialog = [
  {
    character: '瑞米',
    text: '你好呀，小灵御。',
    avatar: new URL('../assets/remi.png', import.meta.url).href
  },
  {
    character: '瑞米',
    text: '我负责接引你，看到你的技能了吗？快打败那只史莱姆练练手吧！',
    avatar: new URL('../assets/remi.png', import.meta.url).href
  }
];

// 随机事件对话序列
const randomEvents = [
  [
    {
      character: '瑞米',
      text: '你好呀，小灵御，我又来拉！',
      avatar: new URL('../assets/remi.png', import.meta.url).href
    },
    {
      character: '瑞米',
      text: '一个超位的存在将我带到了这里。他告诉我，我们都在一场游戏中，而这个游戏似乎实际上还没开发好。',
      avatar: new URL('../assets/remi.png', import.meta.url).href
    }
  ],
  [
    {
      character: '瑞米',
      text: '你好呀，小灵御，我又来拉！',
      avatar: new URL('../assets/remi.png', import.meta.url).href
    },
    {
      character: '瑞米',
      text: '哎呀，你认识其它灵御吗？',
      avatar: new URL('../assets/remi.png', import.meta.url).href
    },
    {
      character: '瑞米',
      text: '有人让我随便找你聊点什么，我也不知道该聊点什么了~好吧，就这样吧！',
      avatar: new URL('../assets/remi.png', import.meta.url).href
    }
  ]
];

// Boss战后的特别对话
const postBossBattleEvents = [
  [
    {
      character: '瑞米',
      text: '芜湖，恭喜你打败了这个强大的Boss！',
      avatar: new URL('../assets/remi.png', import.meta.url).href
    }
  ],
  [
    {
      character: '瑞米',
      text: '好耶！你成功击败了Boss，再接再厉吧。',
      avatar: new URL('../assets/remi.png', import.meta.url).href
    }
  ]
];

// 获取开场对话
function getOpeningDialog() {
  return openingDialog;
}

// 获取事件对话（战斗后）
// 参数: battleCount(战斗场次数), player(玩家状态), enemy(下一张战斗面对的敌人)
function getEventAfterBattle(battleCount, player, enemy) {
  // 检查是否是Boss战
  if (enemy && enemy.isBoss) {
    // 面对Boss时触发特别对话
    const bossEventIndex = Math.floor(Math.random() * postBossBattleEvents.length);
    return postBossBattleEvents[bossEventIndex];
  }
  // 否然，随机触发事件（5%）
  const u = Math.random();
  if(u < 0.05) {
    // 普通随机事件
    const eventIndex = Math.floor(Math.random() * randomEvents.length);
    return randomEvents[eventIndex];
  }
  return null;
}

// Boss战前的特别对话
const preBossBattleEvents = [
  [
    {
      character: '瑞米',
      text: '小心，前方有一股强大的气息！',
      avatar: new URL('../assets/remi.png', import.meta.url).href
    },
    {
      character: '瑞米',
      text: '谨慎一些！',
      avatar: new URL('../assets/remi.png', import.meta.url).href
    }
  ],
  [
    {
      character: '瑞米',
      text: '我闻到了不祥的味道...',
      avatar: new URL('../assets/remi.png', import.meta.url).href
    },
    {
      character: '瑞米',
      text: '那个敌人很强！',
      avatar: new URL('../assets/remi.png', import.meta.url).href
    },
    {
      character: '瑞米',
      text: '务必小心行事！',
      avatar: new URL('../assets/remi.png', import.meta.url).href
    }
  ]
];

let metEnemyRemi = false;

// 获取事件对话（战斗前）
// 参数: battleCount(战斗场次数), player(玩家状态), enemy(下一张战斗面对的敌人)
function getEventBeforeBattle(battleCount, player, enemy) {

  // 检查是否是Boss战
  if (enemy && enemy.isBoss) {
    // 面对Boss时触发特别对话
    const bossEventIndex = Math.floor(Math.random() * preBossBattleEvents.length);
    return preBossBattleEvents[bossEventIndex];
  }

  // 特判事件
  // 第一次遇到魔化瑞米
  if(!metEnemyRemi && enemy.name === '魔化瑞米') {
    metEnemyRemi = true;
    return [
      {
        character: '瑞米',
        text: '这...这是...瑞米？',
        avatar: new URL('../assets/remi.png', import.meta.url).href
      },
      {
        character: '瑞米',
        text: '你好？额，看在同族的份上...',
        avatar: new URL('../assets/remi.png', import.meta.url).href
      },
      {
        character: '瑞米',
        text: '下手可以...轻一点吗？',
        avatar: new URL('../assets/remi.png', import.meta.url).href
      }
    ];
  }
  
  // 否然，随机触发事件（5%）
  const u = Math.random();
  if(u < 0.05) {
    // 普通随机事件
    const eventIndex = Math.floor(Math.random() * randomEvents.length);
    return randomEvents[eventIndex];
  }
  return null;
}


// 导出所有函数和数据
export { getOpeningDialog, getEventAfterBattle,
  getEventBeforeBattle
 };